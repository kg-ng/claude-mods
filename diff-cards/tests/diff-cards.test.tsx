import { expect, mock, test } from 'claude-code/testing'
import { count, summary } from '../hooks/register'

const patch = (adds: number, dels: number, hunks = 1) =>
  Array.from({ length: hunks }, () => ({
    oldStart: 1, oldLines: dels, newStart: 1, newLines: adds,
    lines: [' ctx', ...Array(adds).fill('+x'), ...Array(dels).fill('-y')],
  }))

const result = (id: string, output: unknown, extra: Record<string, unknown> = {}) => ({
  plugin: 'diff-cards', component: 'ToolResult',
  props: { tool_use_id: id, tool: 'Edit', output, isErrored: false, ...extra },
}) as any

test('counts and the one-line summary', () => {
  expect(count(patch(12, 18, 2))).toEqual({ added: 24, removed: 36, hunks: 2 })
  expect(summary({ structuredPatch: patch(3, 1) })).toBe('+3 −1 · 1 hunk')
  expect(summary({ type: 'create', structuredPatch: patch(40, 0) })).toBe('new file · +40')
})

for (const surface of ['terminal', 'desktop'] as const)
  test(`${surface}: a big diff folds to one line and unfolds to Claude Code's own; small, errored and ctrl+o rows are left alone`, async ($, on) => {
    mock.store(on)
    on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
    let ui = await $.ui.mount({ ...result('t1', { filePath: 'a.ts', structuredPatch: patch(12, 18, 2) }), surface })
    expect(await ui.find({ type: 'Text', text: /\+24/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 hunks/ })).toBeDefined()
    expect(await ui.find({ key: 'diff-t1', text: /show diff/ })).toBeDefined()
    await ui.press({ key: 'diff-t1' })
    expect(await ui.find({ key: 'diff-t1', text: /hide diff/ })).toBeDefined()
    await ui.press({ key: 'diff-t1' })
    expect(await ui.find({ key: 'diff-t1', text: /show diff/ })).toBeDefined()
    await ui.unmount()
    for (const [props, why] of [
      [result('t2', { structuredPatch: patch(2, 1) }), 'small'],
      [result('t3', { structuredPatch: patch(20, 20) }, { isErrored: true }), 'errored'],
      [result('t4', { structuredPatch: patch(20, 20) }, { isExpanded: true }), 'ctrl+o'],
      [result('t5', { structuredPatch: patch(20, 20), staged: true }), 'staged'],
      [{ ...result('t6', { stdout: 'x' }), props: { ...result('t6', {}).props, tool: 'Bash', output: { stdout: 'x' } } }, 'not an edit'],
    ] as const) {
      ui = await $.ui.mount({ ...props, surface })
      expect([why, await ui.find({ key: `diff-${props.props.tool_use_id}` })]).toEqual([why, undefined])
      await ui.unmount()
    }
  })
