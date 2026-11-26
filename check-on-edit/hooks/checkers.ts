// check-on-edit's checkers: which read-only check runs on which file, and how to read its output.
// Every one only reports. None of them rewrites the file, so Claude's next edit finds it as it left it.

/**
 * How a checker's problems are read from its output:
 * - `file`: a one-line format (unix, gcc, concise, tsc's): the lines about the edited file
 * - `listed`: the tool lists the files that fail (gofmt -l), so any output is one problem
 * - `all`: every line, on a non-zero exit (a custom command, biome's own format)
 */
export type Pick = 'file' | 'listed' | 'all'

/** A check to run on one file: `argv` with the file in it, and how to read what it prints. */
export type Checker = { name: string; argv: string[]; timeoutMs: number; pick: Pick }

/** What the project has, found once per session: tools by name, each its command's first words. */
export type Toolbox = Partial<Record<'eslint' | 'biome' | 'tsc' | 'ruff' | 'mypy' | 'gofmt' | 'govet' | 'shellcheck', string[]>>

const ext = (file: string) => file.slice(file.lastIndexOf('.') + 1).toLowerCase()
const JS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts']
const isTs = (e: string) => /^[mc]?tsx?$/.test(e)
// tsc checks the whole project; its build info makes the second and later runs fast.
const TSC_CACHE = 'node_modules/.cache/check-on-edit/tsbuildinfo'

/** The checks for one file, from what the project has. `custom` (with `{file}`) replaces them all. */
export function checkersFor(file: string, box: Toolbox, opts: { typecheck: boolean; custom?: string }): Checker[] {
  if (opts.custom) {
    const argv = opts.custom.split(/\s+/).filter(Boolean).map(w => w.replaceAll('{file}', file))
    if (!argv.includes(file)) argv.push(file)
    return [{ name: argv[0]!.split('/').at(-1)!, argv, timeoutMs: 60_000, pick: 'all' }]
  }
  const e = ext(file)
  const out: Checker[] = []
  if (JS.includes(e)) {
    if (box.biome) out.push({ name: 'biome', argv: [...box.biome, 'lint', '--colors=off', file], timeoutMs: 30_000, pick: 'all' })
    else if (box.eslint) out.push({ name: 'eslint', argv: [...box.eslint, '--format', 'unix', file], timeoutMs: 30_000, pick: 'file' })
    if (opts.typecheck && box.tsc && isTs(e))
      out.push({
        name: 'tsc',
        argv: [...box.tsc, '--noEmit', '--pretty', 'false', '--incremental', '--tsBuildInfoFile', TSC_CACHE],
        timeoutMs: 120_000,
        pick: 'file',
      })
  } else if (e === 'py') {
    if (box.ruff) out.push({ name: 'ruff', argv: [...box.ruff, 'check', '--output-format', 'concise', '--no-fix', file], timeoutMs: 30_000, pick: 'file' })
    if (opts.typecheck && box.mypy)
      out.push({ name: 'mypy', argv: [...box.mypy, '--no-color-output', '--no-error-summary', file], timeoutMs: 120_000, pick: 'file' })
  } else if (e === 'go') {
    if (box.gofmt) out.push({ name: 'gofmt', argv: [...box.gofmt, '-l', file], timeoutMs: 15_000, pick: 'listed' })
    if (box.govet) out.push({ name: 'go vet', argv: [...box.govet, 'vet', `./${dirOf(file) || '.'}`], timeoutMs: 60_000, pick: 'file' })
  } else if (e === 'sh' || e === 'bash') {
    if (box.shellcheck) out.push({ name: 'shellcheck', argv: [...box.shellcheck, '-f', 'gcc', file], timeoutMs: 15_000, pick: 'file' })
  }
  return out
}

function dirOf(file: string) {
  const at = file.lastIndexOf('/')
  return at < 0 ? '' : file.slice(0, at)
}

/**
 * The problem lines from one run, or none when it passed. A `file` checker's lines about other
 * files (tsc and go vet check more than the edited file) were there before this edit.
 */
export function problems(c: Pick, file: string, run: { exitCode: number; stdout: string; stderr: string }): string[] {
  const lines = `${run.stdout}\n${run.stderr}`.split('\n').map(l => l.trimEnd()).filter(Boolean)
  if (c === 'listed') return lines.length ? [`${file}: not formatted (run the formatter on it)`] : []
  if (run.exitCode === 0) return []
  // The path may be printed as given, with ./, or absolute (eslint's unix format).
  if (c === 'file') return lines.filter(l => l.includes(`${file}:`) || l.includes(`${file}(`))
  return lines
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
