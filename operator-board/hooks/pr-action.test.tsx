import { expect, test } from 'claude-code/testing'
import { prAction, prStatusLine } from './prs'
import { paneOrder } from './register'

const base = {
  repo: 'o/r', number: 7, title: 't', url: 'https://x/7', isDraft: false, createdAt: '', head: 'abc',
  reviewDecision: null, openThreads: 0,
  ci: { passed: 0, failed: 0, running: 0, skipped: 0, failedNames: [] as string[] },
} as const

test('red PR offers fix CI with failing check names', async () => {
  const a = prAction({ ...base, status: 'red', ci: { ...base.ci, failed: 2, failedNames: ['lint', 'e2e'] } })
  expect(a?.label).toBe('fix CI')
  expect(a?.text).toContain('o/r#7')
  expect(a?.text).toContain('lint, e2e')
})

test('PR with open threads offers address threads; ready PR offers nothing', async () => {
  expect(prAction({ ...base, status: 'attention', openThreads: 3 })?.text).toContain('3 open review threads')
  expect(prAction({ ...base, status: 'ready' })).toBeUndefined()
})

const NOW = Date.parse('2026-11-22T12:00:00Z')
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString()

test('PR status line fits on one row: problem, CI, age', async () => {
  const red = { ...base, status: 'red', createdAt: at(3), ci: { ...base.ci, failed: 3, passed: 4, failedNames: ['lint', 'e2e', 'unit'] as string[] } } as const
  expect(prStatusLine(red, NOW)).toBe('CI red: lint, e2e +1 · 3d')
  const threads = { ...base, status: 'attention', openThreads: 2, createdAt: at(1), ci: { ...base.ci, passed: 5 } } as const
  expect(prStatusLine(threads, NOW)).toBe('2 threads · CI green · 24h')
  const running = { ...base, status: 'running', createdAt: at(5), ci: { ...base.ci, passed: 3, running: 2 } } as const
  expect(prStatusLine(running, NOW)).toBe('CI 3/5 · 5d')
  const draft = { ...base, status: 'draft', createdAt: at(10) } as const
  expect(prStatusLine(draft, NOW)).toBe('draft · no checks · 10d')
})

test('sections that need you move to the top, the rest keep their order', async () => {
  const keys = ['board', 'todo', 'usage', 'git', 'prs'] as const
  expect(paneOrder(keys, new Set())).toEqual([...keys])
  expect(paneOrder(keys, new Set(['prs', 'usage'] as const))).toEqual(['usage', 'prs', 'board', 'todo', 'git'])
})
