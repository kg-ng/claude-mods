// touched-files' pure parts: which files a tool call touches, and the heat map drawn as text.
import type { Touch } from '../types'

/** About four characters to a token: close enough to compare files, not to bill by. */
const tokensOf = (chars: number) => Math.ceil(chars / 4)

export type Hit = { path: string; kind: 'read' | 'edit'; chars: number }

const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const READERS = ['cat', 'head', 'tail', 'less', 'bat', 'nl']

/** What one finished tool call touched. `resultChars` is the length of what Claude read back. */
export function hits(tool: string, input: Record<string, unknown>, resultChars: number): Hit[] {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  if (tool === 'Read') return s(input.file_path) ? [{ path: s(input.file_path), kind: 'read', chars: resultChars }] : []
  if (EDIT_TOOLS.includes(tool)) {
    const path = s(input.file_path) || s(input.notebook_path)
    const edits = Array.isArray(input.edits) ? (input.edits as { new_string?: unknown; old_string?: unknown }[]) : []
    const written =
      s(input.content).length + s(input.new_string).length + s(input.old_string).length + s(input.new_source).length +
      edits.reduce((n, e) => n + s(e.new_string).length + s(e.old_string).length, 0)
    return path ? [{ path, kind: 'edit', chars: written }] : []
  }
  if (tool === 'Bash') {
    // `cat a.ts`, `head -50 b.py`, `sed -n '1,80p' c.go`: simple reads, the output split between the files.
    const cmd = s(input.command).trim()
    if (/[|;&<>`$]/.test(cmd)) return []
    const w = cmd.split(/\s+/)
    const isSed = w[0] === 'sed' && w[1] === '-n'
    if (!READERS.includes(w[0] ?? '') && !isSed) return []
    const files = w.slice(isSed ? 3 : 1).filter(x => !x.startsWith('-') && !/^\d+$/.test(x) && /[./]/.test(x))
    return files.map(path => ({ path, kind: 'read' as const, chars: Math.round(resultChars / files.length) }))
  }
  return []
}

/** The path shown: relative to the project when it's inside it. */
function rel(path: string, root: string): string {
  const r = root.replace(/\/+$/, '')
  if (path.startsWith(r + '/')) return path.slice(r.length + 1)
  return path.replace(/^\.\//, '')
}

/** The list with one call's hits added. */
export function add(list: readonly Touch[], add: Hit[], root: string): Touch[] {
  const out = list.map(t => ({ ...t }))
  for (const h of add) {
    const path = rel(h.path, root)
    let t = out.find(x => x.path === path)
    if (!t) out.push((t = { path, reads: 0, edits: 0, tokens: 0 }))
    if (h.kind === 'read') t.reads++
    else t.edits++
    t.tokens += tokensOf(h.chars)
  }
  return out
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))
const BAR = 10

/** The heat map: the hottest files by tokens, a bar each, then what was only read. */
export function heatMap(list: readonly Touch[], max = 15): string {
  if (!list.length) return 'touched-files: Claude has not read or edited a file this session yet.'
  const total = list.reduce((n, t) => n + t.tokens, 0)
  const sorted = [...list].sort((a, b) => b.tokens - a.tokens || b.edits + b.reads - (a.edits + a.reads))
  const top = sorted[0]!.tokens || 1
  const width = Math.min(48, Math.max(...sorted.slice(0, max).map(t => t.path.length)))
  const rows = sorted.slice(0, max).map(t => {
    const n = Math.max(t.tokens ? 1 : 0, Math.round((t.tokens / top) * BAR))
    const bar = '█'.repeat(n) + '░'.repeat(BAR - n)
    const name = t.path.length > width ? `…${t.path.slice(-(width - 1))}` : t.path.padEnd(width)
    const what = [t.reads ? `read ${t.reads}` : '', t.edits ? `edit ${t.edits}` : ''].filter(Boolean).join(' · ')
    return `  ${bar} ${fmt(t.tokens).padStart(5)}  ${name}  ${what}`
  })
  const onlyRead = list.filter(t => !t.edits)
  const onlyReadTokens = onlyRead.reduce((n, t) => n + t.tokens, 0)
  return [
    `touched-files: ${list.length} file${list.length === 1 ? '' : 's'}, ~${fmt(total)} tokens of file content this session`,
    ...rows,
    ...(sorted.length > max ? [`  … and ${sorted.length - max} more (/touched all)`] : []),
    ...(onlyRead.length && list.some(t => t.edits)
      ? [`Read but never edited: ${onlyRead.length} file${onlyRead.length === 1 ? '' : 's'}, ~${fmt(onlyReadTokens)} tokens.`]
      : []),
  ].join('\n')
}
