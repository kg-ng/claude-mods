// trace-fold: stack traces in a shell command's output are drawn with each run of library and
// runtime frames folded to one line, `… 14 library frames (express)`, and a button for the
// whole trace. Only the drawing changes: Claude still reads every frame.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { fold } from './frames'

const KEEP = 200
/** Most lines drawn for an errored result, which trace-fold draws itself. */
const MAX_LINES = 60

export const open = atom({ plugin: 'trace-fold', key: 'open' } as const, [], { shape: 'open-1' })

type BashOutput = { stdout?: string; stderr?: string }

export const register: Register = (on, options) => {
  const minRun = Math.max(2, Number(options.minRun ?? 3))

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const p = e.props
    if (p.tool !== 'Bash' || p.isExpanded) return next(e)
    const isText = typeof p.output === 'string'
    const out = (typeof p.output === 'object' && p.output ? p.output : {}) as BashOutput
    const parts = isText ? [fold(p.output as string, minRun)] : [fold(out.stdout ?? '', minRun), fold(out.stderr ?? '', minRun)]
    const hidden = parts.reduce((n, f) => n + f.hidden, 0)
    if (!hidden) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const id = p.tool_use_id
    const isOpen = (await read($, open)).includes(id)
    const toggle = () =>
      update($, open, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id].slice(-KEEP)))
    const bar = (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{`${hidden} library frame${hidden === 1 ? '' : 's'} folded`}</Text>
        <Button key={`trace-${id}`} plain label={isOpen ? 'fold again ▴' : 'show all ▾'} onPress={toggle} />
      </Box>
    )
    if (isOpen)
      return (
        <Box flexDirection="column">
          {bar}
          {await next(e)}
        </Box>
      )

    // An errored result draws its error text, not `output`, so draw the folded text here.
    if (isText || p.isErrored) {
      const text = isText ? parts[0]!.text : [parts[0]!.text, parts[1]!.text].filter(Boolean).join('\n')
      const lines = text.split('\n')
      const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} more lines`] : lines
      return (
        <Box flexDirection="column">
          {bar}
          <Text color={p.isErrored ? 'error' : undefined}>{shown.join('\n')}</Text>
        </Box>
      )
    }
    const folded = { ...out, stdout: parts[0]!.text, stderr: parts[1]!.text }
    return (
      <Box flexDirection="column">
        {bar}
        {await next({ ...e, props: { ...p, output: folded } })}
      </Box>
    )
  })
}
