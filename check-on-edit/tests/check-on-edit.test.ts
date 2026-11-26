import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { checkersFor, problems, report } from '../hooks/checkers'

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]

const BOX = { eslint: ['/w/node_modules/.bin/eslint'], tsc: ['/w/node_modules/.bin/tsc'], ruff: ['/usr/bin/ruff'], gofmt: ['/usr/bin/gofmt'], govet: ['/usr/bin/go'] }

test('picks the checks a file gets from what the project has', () => {
  const names = (f: string, typecheck = false) => checkersFor(f, BOX, { typecheck }).map(c => c.name)
  expect(names('src/a.ts')).toEqual(['eslint'])
  expect(names('src/a.ts', true)).toEqual(['eslint', 'tsc'])
  expect(names('src/a.js', true)).toEqual(['eslint'])
  expect(names('src/a.mts', true)).toEqual(['eslint', 'tsc'])
  expect(checkersFor('a.ts', BOX, { typecheck: true })[1]!.argv).toContain('--incremental')
  expect(names('app/main.py')).toEqual(['ruff'])
  expect(names('cmd/x/main.go')).toEqual(['gofmt', 'go vet'])
  expect(checkersFor('cmd/x/main.go', BOX, { typecheck: false })[1]!.argv).toEqual(['/usr/bin/go', 'vet', './cmd/x'])
  expect(names('README.md')).toEqual([])
  expect(names('run.sh')).toEqual([])
  expect(checkersFor('a.ts', BOX, { typecheck: false, custom: 'npx eslint --max-warnings 0 {file}' })[0]!.argv).toEqual([
    'npx', 'eslint', '--max-warnings', '0', 'a.ts',
  ])
})

test('reads problems; a clean run, summary lines and errors in other files are not problems', () => {
  const eslint = { exitCode: 1, stdout: "/work/app/src/a.ts:3:7: 'x' is assigned a value but never used. [Error/no-unused-vars]\n\n1 problem\n", stderr: '' }
  expect(problems('file', 'src/a.ts', eslint)).toEqual(["/work/app/src/a.ts:3:7: 'x' is assigned a value but never used. [Error/no-unused-vars]"])
  expect(problems('file', 'src/a.ts', { exitCode: 0, stdout: '', stderr: '' })).toEqual([])
  const tsc = { exitCode: 2, stdout: "src/a.ts(4,1): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/old.ts(9,9): error TS7006: x\n", stderr: '' }
  expect(problems('file', 'src/a.ts', tsc)).toEqual(["src/a.ts(4,1): error TS2322: Type 'string' is not assignable to type 'number'."])
  expect(problems('listed', 'main.go', { exitCode: 0, stdout: 'main.go\n', stderr: '' })).toEqual(['main.go: not formatted (run the formatter on it)'])
  const ruff = { exitCode: 1, stdout: 'app.py:1:8: F401 [*] `os` imported but unused\nFound 1 error.\n[*] 1 fixable with the `--fix` option.\n', stderr: '' }
  expect(problems('file', 'app.py', ruff)).toEqual(['app.py:1:8: F401 [*] `os` imported but unused'])
  expect(problems('all', 'a.ts', { exitCode: 1, stdout: 'bad thing\n', stderr: '' })).toEqual(['bad thing'])
})

test('the note Claude reads is short and says what to do', () => {
  expect(report('a.ts', [{ name: 'eslint', lines: [] }])).toBeUndefined()
  const many = Array.from({ length: 30 }, (_, i) => `a.ts:${i + 1}:1: bad`)
  const note = report('a.ts', [{ name: 'eslint', lines: many }])!
  expect(note.split('\n')[0]).toBe('check-on-edit: after this edit, eslint reports 30 problems in a.ts:')
  expect(note).toMatch(/… and 5 more\./)
  expect(note).toMatch(/Fix them before moving on/)
})

async function boot($: T$, on: TOn, lint: { exitCode: number; stdout: string }) {
  const runs: string[][] = []
  mock.store(on)
  on('command.register', () => ({ value: { command: 'checks' } }))
  on('session.root', () => ({ value: '/work/app' }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.exists', (_: unknown, e: any) => ({
    value: ['/work/app/node_modules/.bin/eslint', '/work/app/eslint.config.js'].includes(e.path),
  }))
  on('process.run', (_: unknown, e: any) => {
    runs.push(e.argv)
    const isEslint = String(e.argv[0]).endsWith('/eslint')
    return { value: { exitCode: isEslint ? lint.exitCode : 1, stdout: isEslint ? lint.stdout : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', (_: unknown, e: any) => (e.file_path?.endsWith('fail.ts') ? { isError: true, result: 'no', text: 'no' } : { result: 'edited' }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  return runs
}

test('in a session: an edit with lint errors comes back with them for Claude; a clean edit, a failed edit and /checks off add nothing', async ($, on) => {
  const lint = { exitCode: 1, stdout: "src/a.ts:3:7: 'x' is never used. [Error/no-unused-vars]\n1 problem\n" }
  const runs = await boot($, on, lint)
  const edit = { tool: 'Edit', file_path: '/work/app/src/a.ts', old_string: 'a', new_string: 'b' } as any

  const bad: any = await $.tool.call(edit)
  expect(bad.result).toBe('edited')
  expect(bad.context?.[0]).toMatch(/eslint reports 1 problem in src\/a\.ts:\n\[eslint\] src\/a\.ts:3:7/)
  expect(runs.at(-1)).toEqual(['/work/app/node_modules/.bin/eslint', '--format', 'unix', 'src/a.ts'])

  lint.exitCode = 0
  lint.stdout = ''
  const clean: any = await $.tool.call(edit)
  expect(clean.context).toBeUndefined()

  const n = runs.length
  await $.tool.call({ ...edit, file_path: '/work/app/src/fail.ts' })
  await $.tool.call({ ...edit, file_path: '/work/app/README.md' })
  await $.tool.call({ ...edit, file_path: '/elsewhere/a.ts' })
  expect(runs.length).toBe(n)

  const status: any = await $.command.run({ command: 'checks', args: '' } as any)
  expect(status.text).toMatch(/Checks: eslint\./)

  lint.exitCode = 1
  await $.command.run({ command: 'checks', args: 'off' } as any)
  const off: any = await $.tool.call(edit)
  expect(off.context).toBeUndefined()
})
