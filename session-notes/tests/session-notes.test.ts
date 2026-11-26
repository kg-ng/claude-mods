import { expect, mock, test } from 'claude-code/testing'
import { isCheck, note } from '../hooks/notes'

const NOW = Date.parse('2026-11-26T15:00:00Z')

test('knows check commands', () => {
  for (const c of ['npm test', 'pnpm run lint', 'npx vitest run', 'pytest -q', 'go test ./...', 'cargo clippy', 'make check', 'bun run typecheck', 'tsc --noEmit'])
    expect([c, isCheck(c)]).toEqual([c, true])
  for (const c of ['npm install', 'git status', 'ls tests', 'echo test'])
    expect([c, isCheck(c)]).toEqual([c, false])
})

test('the note: asked, done, checks, not committed, next', () => {
  const text = note({
    project: 'app', branch: 'feat/login', startedAt: NOW - 95 * 60_000, now: NOW,
    asks: ['add a login page', 'make the tests pass'],
    edited: ['src/login.tsx', 'src/auth.ts'],
    commits: ['a1b2c3d Add login page'],
    uncommitted: [' M src/auth.ts'],
    diffStat: ' 1 file changed, 4 insertions(+), 1 deletion(-)',
    checks: [
      { command: 'npm test', ok: false, at: 1 },
      { command: 'npm run lint', ok: true, at: 2 },
      { command: 'npm test', ok: false, at: 3 },
    ],
  })
  expect(text).toBe(
    [
      '# Handoff: app (feat/login)', '', '2026-11-26 · session of 1 h 35 min', '',
      '## Asked', '', '- add a login page', '- make the tests pass', '',
      '## Done', '', '- a1b2c3d Add login page', '- Claude edited 2 files: `src/login.tsx`, `src/auth.ts`', '',
      '## Checks', '', '- ✗ `npm test`', '- ✓ `npm run lint`', '',
      '## Not committed', '', '- `M src/auth.ts`', '', '1 file changed, 4 insertions(+), 1 deletion(-)', '',
      '## Next', '', '- Fix what fails: `npm test`.', '- Commit or drop the uncommitted changes.', '- Push `feat/login` and open a PR, if that isn\'t done yet.',
      '',
    ].join('\n'),
  )
  const quiet = note({ project: 'app', startedAt: NOW, now: NOW, asks: [], edited: [], commits: [], uncommitted: [], checks: [] })
  expect(quiet).toMatch(/No commits this session/)
  expect(quiet).toMatch(/working tree is clean/)
  expect(quiet).toMatch(/Nothing left open/)
})

test('in a session: asks, edits and checks are kept; /handoff shows the note, save writes it, pr fills the prompt', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const written: [string, string][] = []
  const filled: string[] = []
  on('command.register', () => ({ value: { command: 'handoff' } }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('fs.write', (_: unknown, e: any) => (written.push([e.path, e.text]), { value: undefined }))
  on('prompt.fill', (_: unknown, e: any) => (filled.push(e.text), { isFilled: true }))
  on('process.run', (_: unknown, e: any) => {
    const a = e.argv.join(' ')
    const stdout = a.includes('rev-parse') ? 'abc000\n' : a.includes('show-current') ? 'feat/x\n' : a.includes('log') ? 'def111 Second\nabc111 First\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', (_: unknown, e: any) => (e.command === 'npm test' ? { isError: true, result: 'x', text: 'Exit code 1' } : { result: 'ok' }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'fix the flaky test\nmore detail here', wait: false, origin: { kind: 'composer' } } as any)
  await $.tool.call({ tool: 'Edit', file_path: '/work/app/src/a.ts', old_string: 'a', new_string: 'b' } as any)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as any)

  const shown: any = await $.command.run({ command: 'handoff', args: '' } as any)
  expect(shown.text).toMatch(/# Handoff: app \(feat\/x\)/)
  expect(shown.text).toMatch(/- fix the flaky test\n/)
  expect(shown.text).toMatch(/- abc111 First\n- def111 Second/)
  expect(shown.text).toMatch(/`src\/a\.ts`/)
  expect(shown.text).toMatch(/- ✗ `npm test`/)

  await $.command.run({ command: 'handoff', args: 'save' } as any)
  expect(written[0]?.[0]).toBe('/work/app/.claude/handoff.md')
  await $.command.run({ command: 'handoff', args: 'pr' } as any)
  expect(filled[0]).toMatch(/^Write a pull request title and description/)
})
