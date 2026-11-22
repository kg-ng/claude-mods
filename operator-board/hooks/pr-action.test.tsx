import { expect, test } from 'claude-code/testing'
import { prAction } from './register'

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
