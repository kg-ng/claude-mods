// test-cards: a test run's output in the transcript folds to one line, ✓ 142 passed · ✗ 3 failed
// · 4.2s, with the failing tests named under it and a button that unfolds the runner's own output.
// Only the drawing changes: Claude still reads the whole output.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { parse } from './parse'

/** Unfolded runs remembered, so the list stays small in a long session. */
const KEEP = 200
const SHOW_NAMES = 5

export const open = atom({ plugin: 'test-cards', key: 'open' } as const, [], { shape: 'open-1' })

type BashOutput = { stdout?: string; stderr?: string; backgroundTaskId?: string; interrupted?: boolean }

export const register: Register = on => {
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const p = e.props
    if (p.tool !== 'Bash' || p.isExpanded) return next(e)
    // A run that exits non-zero (failing tests do) arrives errored, its output as the error text.
    const out = (typeof p.output === 'object' && p.output ? p.output : {}) as BashOutput
    if (out.backgroundTaskId || out.interrupted) return next(e)
    const s = parse(typeof p.output === 'string' ? p.output : `${out.stdout ?? ''}\n${out.stderr ?? ''}`)
    if (!s || s.passed + s.failed + s.skipped === 0) return next(e)

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
            <Text color="success">{`✓ ${s.passed} passed`}</Text>
            {s.failed ? <Text color="error">{` · ✗ ${s.failed} failed`}</Text> : null}
            {s.skipped ? <Text dimColor>{` · ${s.skipped} skipped`}</Text> : null}
            {s.duration ? <Text dimColor>{` · ${s.duration}`}</Text> : null}
            <Text dimColor>{` · ${s.runner}`}</Text>
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
