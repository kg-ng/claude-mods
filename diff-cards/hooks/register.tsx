// diff-cards: each edit's diff in the transcript folds to one line, +12 −18 · 2 hunks, with a
// button that unfolds Claude Code's own diff in place. Small diffs are left as they are.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit']
/** Unfolded calls remembered, so the list stays small in a long session. */
const KEEP = 200

export const open = atom({ plugin: 'diff-cards', key: 'open' } as const, [], { shape: 'open-1' })

type Hunk = { lines: string[] }
type EditOutput = {
  filePath?: string
  type?: 'create' | 'update'
  structuredPatch?: Hunk[]
  staged?: boolean
}

/** Lines added and removed, and the hunks, from a structured patch. */
export function count(patch: Hunk[]) {
  let added = 0
  let removed = 0
  for (const h of patch)
    for (const l of h.lines) {
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
  return { added, removed, hunks: patch.length }
}

/** `+12 −18 · 2 hunks`, or `new file · +40` for a file written from nothing. */
export function summary(out: EditOutput) {
  const { added, removed, hunks } = count(out.structuredPatch ?? [])
  if (out.type === 'create') return `new file · +${added}`
  return `+${added} −${removed} · ${hunks} hunk${hunks === 1 ? '' : 's'}`
}

export const register: Register = (on, options) => {
  const inlineUpTo = Math.max(0, Number(options.inlineUpTo ?? 6))

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const p = e.props
    if (!EDIT_TOOLS.includes(p.tool) || p.isErrored || p.isExpanded) return next(e)
    const out = (p.output ?? {}) as EditOutput
    if (out.staged || !Array.isArray(out.structuredPatch)) return next(e)
    const { added, removed } = count(out.structuredPatch)
    if (added + removed <= inlineUpTo) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const id = p.tool_use_id
    const isOpen = (await read($, open)).includes(id)
    const toggle = () =>
      update($, open, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id].slice(-KEEP)))
    const line = (
      <Box flexDirection="row" gap={1}>
        {out.type === 'create' ? (
          <Text>
            <Text dimColor>new file · </Text>
            <Text color="success">+{added}</Text>
          </Text>
        ) : (
          <Text>
            <Text color="success">+{added}</Text> <Text color="error">−{removed}</Text>
            <Text dimColor> · {summary(out).split(' · ')[1]}</Text>
          </Text>
        )}
        <Button key={`diff-${id}`} plain label={isOpen ? 'hide diff ▴' : 'show diff ▾'} onPress={toggle} />
      </Box>
    )
    if (!isOpen) return line
    return (
      <Box flexDirection="column">
        {line}
        {await next(e)}
      </Box>
    )
  })
}
