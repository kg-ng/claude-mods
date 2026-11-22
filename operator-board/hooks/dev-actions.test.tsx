import { expect, test } from 'claude-code/testing'
import { gitNext, repoFromRemote } from './extras'
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
