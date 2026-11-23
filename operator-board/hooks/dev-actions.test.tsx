import { expect, test } from 'claude-code/testing'
import { ciText, gitNext, repoFromRemote, runPrompt, runTargets, summariseChecks } from './extras'
import { ciJustPassed, reviewPrompt } from './prs'

const g = { updatedAt: 1, isRepo: true, branch: 'feat/x', upstream: 'origin/feat/x', ahead: 0, behind: 0, repo: 'o/r' }
const none = () => false

test('the branch\'s next step: push, push commits, open PR, or nothing', async () => {
  expect(gitNext({ ...g, upstream: '' }, none)?.label).toBe('push')
  expect(gitNext({ ...g, ahead: 2 }, none)?.text).toBe('Push the 2 new commits on feat/x.')
  expect(gitNext(g, none)?.label).toBe('open PR')
  expect(gitNext(g, (r, b) => r === 'o/r' && b === 'feat/x')).toBeUndefined()
  expect(gitNext({ ...g, branch: 'main' }, none)).toBeUndefined()
  expect(gitNext({ ...g, isRepo: false }, none)).toBeUndefined()
})

test('a GitHub remote gives owner/name, over https or ssh', async () => {
  expect(repoFromRemote('https://github.com/kg-ng/claude-mods.git')).toBe('kg-ng/claude-mods')
  expect(repoFromRemote('git@github.com:kg-ng/claude-mods.git\n')).toBe('kg-ng/claude-mods')
  expect(repoFromRemote('https://github.com/kg-ng/claude-mods')).toBe('kg-ng/claude-mods')
  expect(repoFromRemote('https://gitlab.com/a/b.git')).toBe('')
})

const pr = (head: string, ci: Partial<{ passed: number; failed: number; running: number }>) => ({
  repo: 'o/r', number: 7, title: 't', url: 'https://x/7', isDraft: false, createdAt: '', head, reviewDecision: null,
  openThreads: 0, status: 'ready' as const,
  ci: { passed: 0, failed: 0, running: 0, skipped: 0, failedNames: [] as string[], ...ci },
})

test('CI just passed: same commit, was running or red, now all green', async () => {
  expect(ciJustPassed(pr('a', { running: 2, passed: 1 }), pr('a', { passed: 3 }))).toBe(true)
  expect(ciJustPassed(pr('a', { failed: 1 }), pr('a', { passed: 3 }))).toBe(true)
  expect(ciJustPassed(pr('a', { passed: 3 }), pr('a', { passed: 3 }))).toBe(false)
  expect(ciJustPassed(pr('a', { running: 1 }), pr('b', { passed: 3 }))).toBe(false)
  expect(ciJustPassed(undefined, pr('a', { passed: 3 }))).toBe(false)
})

test('a review button runs /code-review for this repo, and names the PR for another', async () => {
  expect(reviewPrompt(pr('a', {}), 'o/r')).toBe('/code-review 7')
  expect(reviewPrompt(pr('a', {}), 'x/y')).toBe('Review o/r#7 (https://x/7).')
})

test('run targets: package.json scripts with the lockfile\'s package manager, else Makefile targets', async () => {
  const pkg = JSON.stringify({ scripts: { test: 'jest', lint: 'eslint', typecheck: 'tsc', build: 'vite build', dev: 'vite' } })
  expect(runTargets(pkg, undefined, 'npm').map(r => r.command)).toEqual(['npm test', 'npm run lint', 'npm run typecheck', 'npm run build'])
  expect(runTargets(pkg, undefined, 'yarn')[1]?.command).toBe('yarn lint')
  expect(runTargets(pkg, undefined, 'bun')[0]?.command).toBe('bun run test')
  expect(runTargets(undefined, 'build:\n\tgo build\ntest: build\n\tgo test ./...\nVAR := 1\n', 'npm').map(r => r.command)).toEqual(['make test', 'make build'])
  expect(runTargets('not json', undefined, 'npm')).toEqual([])
  expect(runPrompt({ label: 'lint', command: 'npm run lint' })).toBe('Run `npm run lint` and fix what fails.')
})

test('branch checks: summed and said in one line', async () => {
  const ci = summariseChecks([
    { name: 'a', status: 'completed', conclusion: 'success' },
    { name: 'b', status: 'completed', conclusion: 'skipped' },
    { name: 'c', status: 'queued', conclusion: null },
  ])
  expect(ci).toEqual({ passed: 1, failed: 0, running: 1, failedNames: [] })
  expect(ciText(ci)).toBe('CI 1/2')
  expect(ciText({ passed: 3, failed: 0, running: 0, failedNames: [] })).toBe('CI green')
  expect(ciText({ passed: 0, failed: 3, running: 0, failedNames: ['x', 'y', 'z'] })).toBe('CI red: x, y +1')
  expect(ciText(undefined)).toBe('')
})
