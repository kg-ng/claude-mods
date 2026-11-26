// session-notes' writer: builds the handoff note from what the session did and what git says.
// Pure, so tested on sample facts.
import type { Check } from '../types'

export type Facts = {
  project: string
  branch?: string
  startedAt: number
  now: number
  /** What the person asked, first line of each, oldest first. */
  asks: string[]
  /** Files Claude edited, relative to the project. */
  edited: string[]
  /** Commits made since the session started, `abc1234 subject`. */
  commits: string[]
  /** `git status --short` lines: what's not committed yet. */
  uncommitted: string[]
  /** `git diff --stat HEAD`'s last line, e.g. `3 files changed, 40 insertions(+), 2 deletions(-)`. */
  diffStat?: string
  /** The last run of each test, lint, typecheck or build command, newest last. */
  checks: Check[]
}

/** Test, lint, typecheck and build commands, which the note reports the last result of. */
export function isCheck(cmd: string): boolean {
  return /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|type-check|check|build)\b|npx\s+(?:vitest|jest|tsc|eslint)\b|vitest\b|jest\b|pytest\b|tsc\b(?:\s|$)|go\s+(?:test|vet|build)\b|cargo\s+(?:test|check|build|clippy)\b|make\s+(?:test|check|lint|build)\b|ruff\s+check\b|mypy\b|eslint\b)/.test(cmd)
}

const since = (ms: number) => {
  const m = Math.round(ms / 60_000)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** The handoff note, as Markdown. */
export function note(f: Facts): string {
  const day = new Date(f.now).toISOString().slice(0, 10)
  const lines = [`# Handoff: ${f.project}${f.branch ? ` (${f.branch})` : ''}`, '', `${day} · session of ${since(f.now - f.startedAt)}`, '']
  lines.push('## Asked', '', ...(f.asks.length ? f.asks.map(a => `- ${a}`) : ['- (nothing typed this session)']), '')
  lines.push('## Done', '')
  if (f.commits.length) lines.push(...f.commits.map(c => `- ${c}`))
  else lines.push('- No commits this session.')
  if (f.edited.length)
    lines.push(`- Claude edited ${f.edited.length} file${f.edited.length === 1 ? '' : 's'}: ${f.edited.slice(0, 12).map(p => `\`${p}\``).join(', ')}${f.edited.length > 12 ? `, and ${f.edited.length - 12} more` : ''}`)
  lines.push('')
  // The latest result of each distinct check.
  const latest = new Map<string, Check>()
  for (const c of f.checks) latest.set(c.command, c)
  if (latest.size)
    lines.push('## Checks', '', ...[...latest.values()].map(c => `- ${c.ok ? '✓' : '✗'} \`${c.command}\``), '')
  lines.push('## Not committed', '')
  if (f.uncommitted.length)
    lines.push(...f.uncommitted.slice(0, 20).map(l => `- \`${l.trim()}\``), ...(f.uncommitted.length > 20 ? [`- … and ${f.uncommitted.length - 20} more`] : []), ...(f.diffStat ? ['', f.diffStat.trim()] : []))
  else lines.push('- Nothing: the working tree is clean.')
  lines.push('')
  const failing = [...latest.values()].filter(c => !c.ok)
  const next: string[] = []
  if (failing.length) next.push(`Fix what fails: ${failing.map(c => `\`${c.command}\``).join(', ')}.`)
  if (f.uncommitted.length) next.push('Commit or drop the uncommitted changes.')
  if (f.commits.length && f.branch && !['main', 'master'].includes(f.branch)) next.push(`Push \`${f.branch}\` and open a PR, if that isn't done yet.`)
  lines.push('## Next', '', ...(next.length ? next.map(n => `- ${n}`) : ['- Nothing left open that the session can see.']))
  return lines.join('\n') + '\n'
}
