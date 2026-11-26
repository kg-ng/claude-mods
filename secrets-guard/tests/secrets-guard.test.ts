import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { describe as where, scan, scanDiff, sends } from '../hooks/rules'

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]

// Fake keys, built in pieces so no scanner reads this file as holding real ones.
const j = (...p: string[]) => p.join('')
const AWS = j('AKIA', 'Q3EXAMPLEKEY7Z2W')
const GH = j('ghp_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8')
const ANT = j('sk-ant-', 'api03-Zx9Qw8Er7Ty6Ui5Op4As3Df2')
const STRIPE = j('sk_', 'live_', '4eC39HqLyjWDarjtT1zdp7dc')
const PEM = j('-----BEGIN ', 'RSA PRIVATE KEY-----')

test('finds keys, and says which line and kind', () => {
  const cases: [string, string][] = [
    [`const k = "${AWS}"`, 'AWS access key'],
    [`token: ${GH}`, 'GitHub token'],
    [`ANTHROPIC_API_KEY=${ANT}`, 'Anthropic API key'],
    [`stripe.key = '${STRIPE}'`, 'Stripe live key'],
    [PEM, 'private key'],
    ['DATABASE_URL=postgres://app:hunter2secret@db.internal:5432/app', 'password in a URL'],
    ['api_key = "q8ZrT4mW9xLp2VbN7cK3"', 'api_key value'],
    ['"clientSecret": "Jd83kfLq0Zp1Xm7Rt5Wy"', 'clientSecret value'],
  ]
  for (const [text, kind] of cases) expect([text, scan(text)]).toEqual([text, [{ kind, line: 1 }]])
  expect(scan(`a\nb\nexport const KEY = "${AWS}"`)).toEqual([{ kind: 'AWS access key', line: 3 }])
})

test('leaves placeholders, env lookups, ordinary code and allowed lines alone', () => {
  for (const text of [
    'const apiKey = process.env.OPENAI_API_KEY',
    'API_KEY=your-api-key-here-please',
    'token: "<YOUR_TOKEN_GOES_HERE>"',
    'secret = "${{ secrets.DEPLOY_SECRET }}"',
    'password: "xxxxxxxxxxxxxxxxxxxx"',
    'const tokenizer = new Tokenizer(options.vocabularyPath)',
    'author: "kg-ng and friends 2026"',
    'auth_url = "https://example.com/oauth/authorize"',
    'const passwordField = document.querySelector("#password-input")',
    'TOKEN_LIMIT = 1000000000000000000',
    `const k = "${AWS}" // secrets-guard: allow`,
    'git push origin main',
  ])
    expect([text, scan(text)]).toEqual([text, []])
})

test('reads added lines of a diff, counted in the new file', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,0 +11,2 @@',
    '+const ok = 1',
    `+const k = "${AWS}"`,
    'diff --git a/old.ts b/old.ts',
    '--- a/old.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    `-const gone = "${GH}"`,
  ].join('\n')
  expect(scanDiff(diff)).toEqual([{ file: 'src/a.ts', kind: 'AWS access key', line: 12 }])
  expect(where(scanDiff(diff))).toBe('src/a.ts:12 (AWS access key)')
})

test('knows which commands send things out', () => {
  expect(sends('git commit -m "x"')).toEqual({ commit: { all: false } })
  expect(sends('git add . && git commit -am "x"')).toEqual({ commit: { all: true } })
  expect(sends('gh pr create --title t --body b')).toEqual({ text: true })
  expect(sends('git status')).toEqual({})
  expect(sends('echo "git commit"').commit).toBeDefined() // reads as written: a seatbelt, not a parser
})

async function boot($: T$, on: TOn, ran: any[], staged = '') {
  mock.store(on)
  mock.clock(on, { now: 1_790_000_000_000 })
  on('command.register', () => ({ value: { command: 'secrets' } }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_: unknown, e: any) => {
    const argv: string[] = e.argv
    const out = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[1] === 'check-ignore') return out(argv.at(-1)!.endsWith('.env') ? 0 : 1)
    if (argv[1] === 'diff' && argv.includes('--cached')) return out(0, staged)
    return out(0)
  })
  on('tool.call', (_: unknown, e: any) => (ran.push(e), { result: 'ran' }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
}

test('in a session: a key in an edit or a commit is stopped without its value; gitignored files and /secrets off pass', async ($, on) => {
  const ran: any[] = []
  const staged = `--- a/config.ts\n+++ b/config.ts\n@@ -0,0 +1 @@\n+export const KEY = "${GH}"`
  await boot($, on, ran, staged)

  const edit: any = await $.tool.call({ tool: 'Write', file_path: '/work/app/src/config.ts', content: `export const k = "${AWS}"\n` } as any)
  const why = edit.deny ?? edit.text
  expect(why).toMatch(/src\/config\.ts has line 1 \(AWS access key\)/)
  expect(why.includes(AWS)).toBe(false)
  expect(ran.length).toBe(0)

  await $.tool.call({ tool: 'Write', file_path: '/work/app/.env', content: `AWS_KEY=${AWS}\n` } as any)
  expect(ran.length).toBe(1)

  const commit: any = await $.tool.call({ tool: 'Bash', command: 'git commit -m "add config"' } as any)
  expect(commit.deny ?? commit.text).toMatch(/config\.ts:1 \(GitHub token\)/)
  expect(ran.length).toBe(1)

  await $.tool.call({ tool: 'Edit', file_path: '/work/app/a.ts', old_string: 'a', new_string: 'const n = 1' } as any)
  expect(ran.length).toBe(2)

  const status: any = await $.command.run({ command: 'secrets', args: '' } as any)
  expect(status.text).toMatch(/AWS access key in src\/config\.ts/)
  expect(status.text.includes(AWS)).toBe(false)

  await $.command.run({ command: 'secrets', args: 'off' } as any)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "add config"' } as any)
  expect(ran.length).toBe(3)
})
