import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { check, segments, stripCoauthor } from '../hooks/rules'

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]

const OPTS = { protectedBranches: ['main', 'master'], cwd: '/work/app', currentBranch: 'feat/x' }

test('commands that pass', () => {
  for (const cmd of [
    'git push',
    'git push -u origin feat/x',
    'git push --force-with-lease origin feat/x',
    'git push -f origin feat/x',
    'git push origin HEAD',
    'rm -rf dist',
    'rm -rf node_modules ./build',
    'rm -rf /work/app/dist',
    'rm -r ~/tmp', // not forced
    'echo "git push -f origin main"',
    "grep -n 'rm -rf /' notes.md",
    'git commit -m "push to main later"',
    'gh pr create --base main --title x --body y',
    'git checkout main && git pull',
  ])
    expect([cmd, check(cmd, OPTS)]).toEqual([cmd, undefined])
})

test('commands that are stopped, with the rule that stops them', () => {
  const cases: [string, string][] = [
    ['git push origin main', 'push-protected'],
    ['git push origin feat/x:main', 'push-protected'],
    ['git push -u origin HEAD:refs/heads/master', 'push-protected'],
    ['cd x && git push -f origin main', 'force-protected'],
    ['git push --force-with-lease origin main', 'force-protected'],
    ['git push origin +main', 'force-protected'],
    ['git -C ../repo push origin main', 'push-protected'],
    ['git push origin --delete main', 'delete-protected'],
    ['git push origin :main', 'delete-protected'],
    ['git push --mirror', 'push-all'],
    ['rm -rf /', 'rm-outside'],
    ['rm -rf ~', 'rm-outside'],
    ['rm -fr ~/Documents', 'rm-outside'],
    ['rm -rf ../other', 'rm-outside'],
    ['rm -rf "$BUILD_DIR"/', 'rm-outside'],
    ['rm -rf .', 'rm-outside'],
    ['rm -rf /etc', 'rm-outside'],
    ['sudo rm --recursive --force /var/lib/x', 'rm-outside'],
    ['ls; rm -rf -- /', 'rm-outside'],
  ]
  for (const [cmd, rule] of cases) expect([cmd, check(cmd, OPTS)?.rule]).toEqual([cmd, rule])
})

test('a plain push from a protected branch is stopped; from a feature branch it passes', () => {
  expect(check('git push', { ...OPTS, currentBranch: 'main' })?.rule).toBe('push-protected')
  expect(check('git push -u origin HEAD', { ...OPTS, currentBranch: 'main' })?.rule).toBe('push-protected')
  expect(check('git push', OPTS)).toBeUndefined()
})

test('heredoc bodies and quoted strings are not read as commands', () => {
  const cmd = 'cat > notes.md <<EOF\nrm -rf /\ngit push -f origin main\nEOF\necho done'
  expect(check(cmd, OPTS)).toBeUndefined()
  expect(segments('a "b; c" && d')).toEqual([['a', 'b; c'], ['d']])
})

test('co-author and "Generated with Claude Code" lines come out of commits and PR bodies', () => {
  const commit = `git commit -m "$(cat <<'EOF'\nFix the thing\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nEOF\n)"`
  expect(stripCoauthor(commit)).toBe(`git commit -m "$(cat <<'EOF'\nFix the thing\nEOF\n)"`)
  const pr = 'gh pr create --title x --body "Does y.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"'
  expect(stripCoauthor(pr)).toBe('gh pr create --title x --body "Does y.\n"')
  const other = 'echo "Co-Authored-By: Claude"'
  expect(stripCoauthor(other)).toBe(other)
  const human = 'git commit -m "x\n\nCo-Authored-By: Ada <ada@example.com>"'
  expect(stripCoauthor(human)).toBe(human)
})

async function boot($: T$, on: TOn, ran: any[]) {
  mock.store(on)
  mock.clock(on, { now: 1_790_000_000_000 })
  on('command.register', () => ({ value: { command: 'guard' } }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'feat/x\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', (_: unknown, e: any) => (ran.push(e), { result: 'ran' }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
}

test('in a session: a stopped command never runs, a co-author line is stripped before it does, /guard off lets it through', async ($, on) => {
  const ran: any[] = []
  await boot($, on, ran)
  const stopped: any = await $.tool.call({ tool: 'Bash', command: 'git push origin main' } as any)
  expect(stopped.deny ?? stopped.text).toMatch(/main` is protected/)
  expect(ran.length).toBe(0)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"' } as any)
  expect(ran.at(-1).command).toBe('git commit -m "x\n"')
  const status: any = await $.command.run({ command: 'guard', args: '' } as any)
  expect(status.text).toMatch(/push-protected: git push origin main/)
  await $.command.run({ command: 'guard', args: 'off' } as any)
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' } as any)
  expect(ran.at(-1).command).toBe('git push origin main')
})
