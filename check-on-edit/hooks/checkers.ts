// check-on-edit's checkers: which read-only check runs on which file, and how to read its output.
// Every one only reports. None of them rewrites the file, so Claude's next edit finds it as it left it.

/** A check to run on one file: `argv` with the file in it, and which lines of output are problems. */
export type Checker = { name: string; argv: string[]; timeoutMs: number }

/** What the project has, found once per session: tools by name, each its command's first words. */
export type Toolbox = Partial<Record<'eslint' | 'biome' | 'tsc' | 'ruff' | 'mypy' | 'gofmt' | 'govet' | 'shellcheck', string[]>>

const ext = (file: string) => file.slice(file.lastIndexOf('.') + 1).toLowerCase()
const JS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts']

/** The checks for one file, from what the project has. `custom` (with `{file}`) replaces them all. */
export function checkersFor(file: string, box: Toolbox, opts: { typecheck: boolean; custom?: string }): Checker[] {
  if (opts.custom) {
    const argv = opts.custom.split(/\s+/).filter(Boolean).map(w => w.replaceAll('{file}', file))
    if (!argv.includes(file)) argv.push(file)
    return [{ name: argv[0]!.split('/').at(-1)!, argv, timeoutMs: 60_000 }]
  }
  const e = ext(file)
  const out: Checker[] = []
  if (JS.includes(e)) {
    if (box.biome) out.push({ name: 'biome', argv: [...box.biome, 'lint', '--colors=off', file], timeoutMs: 30_000 })
    else if (box.eslint) out.push({ name: 'eslint', argv: [...box.eslint, '--format', 'unix', file], timeoutMs: 30_000 })
    if (opts.typecheck && box.tsc && e !== 'js' && e !== 'jsx' && e !== 'mjs' && e !== 'cjs')
      out.push({ name: 'tsc', argv: [...box.tsc, '--noEmit', '--pretty', 'false'], timeoutMs: 120_000 })
  } else if (e === 'py') {
    if (box.ruff) out.push({ name: 'ruff', argv: [...box.ruff, 'check', '--output-format', 'concise', '--no-fix', file], timeoutMs: 30_000 })
    if (opts.typecheck && box.mypy) out.push({ name: 'mypy', argv: [...box.mypy, '--no-color-output', '--no-error-summary', file], timeoutMs: 120_000 })
  } else if (e === 'go') {
    if (box.gofmt) out.push({ name: 'gofmt', argv: [...box.gofmt, '-l', file], timeoutMs: 15_000 })
    if (box.govet) out.push({ name: 'go vet', argv: [...box.govet, 'vet', `./${dirOf(file) || '.'}`], timeoutMs: 60_000 })
  } else if (e === 'sh' || e === 'bash') {
    if (box.shellcheck) out.push({ name: 'shellcheck', argv: [...box.shellcheck, '-f', 'gcc', file], timeoutMs: 15_000 })
  }
  return out
}

function dirOf(file: string) {
  const at = file.lastIndexOf('/')
  return at < 0 ? '' : file.slice(0, at)
}

/**
 * The problem lines from one run, or none when it passed. `tsc` checks the whole project, so only
 * its lines about the edited file count: errors elsewhere were there before this edit.
 */
export function problems(name: string, file: string, run: { exitCode: number; stdout: string; stderr: string }): string[] {
  const text = `${run.stdout}\n${run.stderr}`
  const lines = text.split('\n').map(l => l.trimEnd()).filter(Boolean)
  if (name === 'gofmt') return lines.length ? [`${file}: not gofmt-formatted (run gofmt -w ${file})`] : []
  if (run.exitCode === 0) return []
  if (name === 'tsc') return lines.filter(l => l.startsWith(file + '(') || l.startsWith('./' + file + '('))
  // Summary and noise lines that aren't a problem of their own.
  return lines.filter(
    l =>
      !/^\s*(?:✖|✔|Found \d+ error|\d+ problems?|Checked \d+ files?|All checks passed|Run `?ruff|\[\*\]|Oops!|Failed to load)/i.test(l),
  )
}

/** The note Claude reads after the edit, cut to a size it can act on. */
export function report(file: string, found: { name: string; lines: string[] }[], max = 25): string | undefined {
  const all = found.filter(f => f.lines.length)
  if (!all.length) return
  const total = all.reduce((n, f) => n + f.lines.length, 0)
  const shown: string[] = []
  for (const f of all) for (const l of f.lines) if (shown.length < max) shown.push(`[${f.name}] ${l}`)
  return [
    `check-on-edit: after this edit, ${all.map(f => f.name).join(' and ')} report${all.length === 1 ? 's' : ''} ${total} problem${total === 1 ? '' : 's'} in ${file}:`,
    ...shown,
    ...(total > shown.length ? [`… and ${total - shown.length} more.`] : []),
    'Fix them before moving on, unless they were there before your edit.',
  ].join('\n')
}
