// trace-fold: stack traces in a shell command's output are drawn with each run of library and
// runtime frames folded to one line, `… 14 library frames (express)`, and a button for the
// whole trace. Only the drawing changes: Claude still reads every frame.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { fold } from './frames'

const KEEP = 200
/** Most lines drawn for an errored row, which trace-fold draws itself. */
const MAX_LINES = 60

export const open = atom({ plugin: 'trace-fold', key: 'open' } as const, [], { shape: 'open-1' })

type BashOutput = { stdout?: string; stderr?: string }

/** A row's output with library frames folded, in the shape it came in, and how many were hidden. */
type Folded = { hidden: number; output: unknown; text: string }

// A frame line of any language trace-fold reads: anything without one is skipped before folding.
const MAYBE_FRAMES = /\n\s+at |\n\s+File "|\.go:\d|\n\tat /
const folds = new Map<string, Folded | null>()
const CACHE = 500

/** Each row folded once: a row is drawn again on every transcript redraw. */
function foldedOf(id: string, output: unknown, minRun: number): Folded | null {
  const hit = folds.get(id)
  if (hit !== undefined) return hit
  let f: Folded | null = null
  if (typeof output === 'string') {
    const r = MAYBE_FRAMES.test(output) ? fold(output, minRun) : undefined
    if (r?.hidden) f = { hidden: r.hidden, output: r.text, text: r.text }
  } else if (output && typeof output === 'object') {
    const out = output as BashOutput
    if (MAYBE_FRAMES.test(`${out.stdout ?? ''}\n${out.stderr ?? ''}`)) {
      const [o, err] = [fold(out.stdout ?? '', minRun), fold(out.stderr ?? '', minRun)]
      if (o.hidden + err.hidden)
        f = { hidden: o.hidden + err.hidden, output: { ...out, stdout: o.text, stderr: err.text }, text: [o.text, err.text].filter(Boolean).join('\n') }
    }
  }
  if (folds.size >= CACHE) folds.delete(folds.keys().next().value!)
  folds.set(id, f)
  return f
}

/** True when another plugin beneath drew this row (test-cards' card): trace-fold then leaves it be. */
function drawnByOther(node: unknown, me: string) {
  const part = node && typeof node === 'object' ? (node as { part?: { plugin?: string } }).part : undefined
  return !!part?.plugin && part.plugin !== me
}

export const register: Register = (on, options) => {
  const minRun = Math.max(2, Number(options.minRun ?? 3))

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const p = e.props
    if (p.tool !== 'Bash' || p.isExpanded) return next(e)
    const f = foldedOf(p.tool_use_id, p.output, minRun)
    if (!f) return next(e)

    const id = p.tool_use_id
    const isOpen = (await read($, open)).includes(id)
    // An errored row draws its error text, not `output`, so trace-fold draws that one itself;
    // any other row gets the folded output, drawn as Claude Code draws it.
    const below = await next(isOpen || p.isErrored ? e : { ...e, props: { ...p, output: f.output } })
    if (drawnByOther(below, $.plugin.name)) return below

    const { Box, Button, Text } = $.ui.resolve(e)
    const toggle = () =>
      update($, open, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id].slice(-KEEP)))
    let body = below
    if (!isOpen && p.isErrored) {
      const lines = f.text.split('\n')
      const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} more lines`] : lines
      body = <Text color="error">{shown.join('\n')}</Text>
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{`${f.hidden} library frame${f.hidden === 1 ? '' : 's'} folded`}</Text>
          <Button key={`trace-${id}`} plain label={isOpen ? 'fold again ▴' : 'show all ▾'} onPress={toggle} />
        </Box>
        {body}
      </Box>
    )
  })
}
