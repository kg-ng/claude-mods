// test-cards: a test run's output in the transcript folds to one line, ✓ 142 passed · ✗ 3 failed
// · 4.2s, with the failing tests named under it and a button that unfolds the runner's own output.
// Only the drawing changes: Claude still reads the whole output.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { parse, segments } from './parse'
import type { Summary } from './parse'

/** Unfolded runs remembered, so the list stays small in a long session. */
const KEEP = 200
const SHOW_NAMES = 5

export const open = atom({ plugin: 'test-cards', key: 'open' } as const, [], { shape: 'open-1' })

type BashOutput = { stdout?: string; stderr?: string; backgroundTaskId?: string; interrupted?: boolean }

/** Each row's summary (or none), parsed once: a row is drawn again on every transcript redraw. */
const parsed = new Map<string, Summary | null>()
const CACHE = 500

function summaryOf(id: string, output: unknown): Summary | null {
  const hit = parsed.get(id)
  if (hit !== undefined) return hit
  // A run that exits non-zero (failing tests do) arrives errored, its output as the error text.
  const out = (typeof output === 'object' && output ? output : {}) as BashOutput
  let s: Summary | null = null
  if (!out.backgroundTaskId && !out.interrupted) {
    const found = parse(typeof output === 'string' ? output : `${out.stdout ?? ''}\n${out.stderr ?? ''}`)
    if (found && found.passed + found.failed + found.skipped > 0) s = found
  }
  if (parsed.size >= CACHE) parsed.delete(parsed.keys().next().value!)
  parsed.set(id, s)
  return s
}

export const register: Register = on => {
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const p = e.props
    if (p.tool !== 'Bash' || p.isExpanded) return next(e)
    const s = summaryOf(p.tool_use_id, p.output)
    if (!s) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const id = p.tool_use_id
    const isOpen = (await read($, open)).includes(id)
    const toggle = () =>
      update($, open, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id].slice(-KEEP)))
    const more = s.failed - Math.min(s.failures.length, SHOW_NAMES)

    const card = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text>
            {[...segments(s), { text: s.runner, tone: 'dim' as const }].map((x, i) => (
              <Text key={`seg-${i}`} color={x.tone === 'dim' ? undefined : x.tone} dimColor={x.tone === 'dim'}>
                {i ? ` · ${x.text}` : x.text}
              </Text>
            ))}
          </Text>
          <Button key={`tests-${id}`} plain label={isOpen ? 'hide output ▴' : 'show output ▾'} onPress={toggle} />
        </Box>
        {s.failures.slice(0, SHOW_NAMES).map(n => (
          <Text key={`fail-${n}`} color="error">
            {`  ✗ ${n}`}
          </Text>
        ))}
        {more > 0 && s.failures.length ? <Text dimColor>{`  … ${more} more`}</Text> : null}
      </Box>
    )
    if (!isOpen) return card
    return (
      <Box flexDirection="column">
        {card}
        {await next(e)}
      </Box>
    )
  })
}
