// secrets-guard's rules: pure functions over text, so they're easy to test in a table.
// A finding names the kind of key and the line it's on, never the value.

/** One key-looking string: what kind, and which line (1-based) of the text it's on. */
export type Finding = { kind: string; line: number }

/** The marker that lets one line through, for a value the user says is fake. */
export const ALLOW = 'secrets-guard: allow'

const PATTERNS: [kind: string, re: RegExp][] = [
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|\bsk-proj-[A-Za-z0-9_-]{40,}/],
  ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['Slack webhook', /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['PyPI token', /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/],
  ['SendGrid key', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/],
  ['password in a URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:([^\s:/@'"]{6,})@[^\s'"]+/i],
]

// `api_key = "…"`, `"secret": "…"`, `TOKEN=…`: a name that says secret, then a long literal value.
const ASSIGNED =
  /\b([A-Za-z0-9_]*(?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key|access[_-]?key|auth(?!or))[A-Za-z0-9_]*)["']?\s*[:=]\s*["']?([^\s"'`,;)}]{16,})/i

const PLACEHOLDER =
  /^(?:x+|\*+|\.+|<[^>]*>|\$\{?[A-Za-z_][\w.]*\}?|\{\{[^}]*\}\}|%[A-Za-z_]+%?)$|your|example|placeholder|changeme|dummy|fake|sample|redacted|xxxx|test|process\.env|os\.environ|getenv|import\.meta\.env|env\(|secrets\.|vault:/i

/** Bits of surprise per character: real keys score high, words and repeats score low. */
export function entropy(s: string): number {
  const counts = new Map<string, number>()
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}

function assignedSecret(line: string): string | undefined {
  const m = ASSIGNED.exec(line)
  if (!m) return
  const value = m[2]!
  if (PLACEHOLDER.test(value)) return
  // A path, a URL without a password, or a call reads as code, not a secret.
  if (/^(?:https?:|\/|\.\/|~\/)/.test(value) || /[()[\]]/.test(value)) return
  if (entropy(value) < 3.5) return
  if (!/\d/.test(value) || !/[A-Za-z]/.test(value)) return
  return `${m[1]} value`
}

/** The key-looking strings in `text`, one per line at most, skipping lines marked `secrets-guard: allow`. */
export function scan(text: string): Finding[] {
  const out: Finding[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.includes(ALLOW) || line.length > 4000) continue
    const hit = PATTERNS.find(([, re]) => re.test(line))
    const kind = hit?.[0] ?? assignedSecret(line)
    if (kind) out.push({ kind, line: i + 1 })
  }
  return out
}

/** One file's findings in a unified diff with no context (`git diff -U0`), lines counted in the new file. */
export function scanDiff(diff: string): (Finding & { file: string })[] {
  const out: (Finding & { file: string })[] = []
  let file = ''
  let at = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '')
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line)
    if (hunk) {
      at = Number(hunk[1])
      continue
    }
    if (line.startsWith('+') && file && file !== '/dev/null') {
      for (const f of scan(line.slice(1))) out.push({ file, kind: f.kind, line: at })
      at++
    } else if (!line.startsWith('-')) at++
  }
  return out
}

/** The text an edit tool is about to write, by tool. */
export function written(tool: string, input: Record<string, unknown>): { path: string; text: string } | undefined {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  if (tool === 'Edit') return { path: str(input.file_path), text: str(input.new_string) }
  if (tool === 'Write') return { path: str(input.file_path), text: str(input.content) }
  if (tool === 'NotebookEdit') return { path: str(input.notebook_path), text: str(input.new_source) }
  if (tool === 'MultiEdit' && Array.isArray(input.edits))
    return { path: str(input.file_path), text: input.edits.map(e => str((e as { new_string?: unknown }).new_string)).join('\n') }
}

/** What a shell command sends somewhere others read: `commit` (scan what's staged), `text` (scan the command). */
export function sends(cmd: string): { commit?: { all: boolean }; text?: boolean } {
  const commit = /\bgit\s+(?:-C\s+\S+\s+|-c\s+\S+\s+)*commit\b/.exec(cmd)
  const all = !!commit && /\s(?:-[a-zA-Z]*a[a-zA-Z]*|--all)\b/.test(cmd.slice(commit.index))
  const text = /\bgh\s+(?:pr|issue|release|gist)\s+(?:create|edit|comment)\b|\bgh\s+api\b|\bcurl\b[\s\S]*\s(?:-d|--data(?:-raw)?|-F|--form)\s/.test(cmd)
  return { ...(commit ? { commit: { all } } : {}), ...(text ? { text } : {}) }
}

/** `a.ts:12 (GitHub token), b.env:3 (AWS access key)`, at most a few. */
export function describe(found: { file?: string; kind: string; line: number }[]): string {
  const shown = found.slice(0, 4).map(f => `${f.file ? `${f.file}:` : 'line '}${f.line} (${f.kind})`)
  return shown.join(', ') + (found.length > 4 ? ` and ${found.length - 4} more` : '')
}
