// guard's rules: pure functions over a shell command, so they're easy to test in a table.
// A seatbelt, not a sandbox: it reads the command as written and catches the common slips.

/** Why a command was stopped, said so Claude can act on it. */
export type Verdict = { rule: string; reason: string }

/** Drops heredoc bodies, keeping the line that opens each one. */
export function dropHeredocs(cmd: string): string {
  return cmd.replace(/<<-?[ \t]*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, '$3')
}

/**
 * The command's simple commands, each as its words: split on `;`, `&&`, `||`, `|`, `&` and new
 * lines outside quotes. A quoted string is one word, so `echo "git push -f"` is an echo.
 */
export function segments(cmd: string): string[][] {
  const src = dropHeredocs(cmd)
  const out: string[][] = []
  let words: string[] = []
  let word = ''
  let has = false
  let quote = ''
  const endWord = () => {
    if (has) words.push(word)
    word = ''
    has = false
  }
  const endSeg = () => {
    endWord()
    if (words.length) out.push(words)
    words = []
  }
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"' && i + 1 < src.length) word += src[++i]
      else word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      has = true
    } else if (c === '\\' && i + 1 < src.length) {
      word += src[++i]
      has = true
    } else if (c === ' ' || c === '\t') endWord()
    else if (c === '\n' || c === ';' || c === '|' || c === '&') endSeg()
    else {
      word += c
      has = true
    }
  }
  endSeg()
  return out
}

/** Leading `VAR=x`, `sudo`, `command`, `exec`, `env` and `time` don't change what runs. */
function head(words: string[]): string[] {
  let i = 0
  while (i < words.length && (/^\w+=/.test(words[i]!) || ['sudo', 'command', 'exec', 'env', 'time', 'nohup'].includes(words[i]!))) i++
  return words.slice(i)
}

const shortFlags = (w: string) => (/^-[a-zA-Z]+$/.test(w) ? w.slice(1) : '')

/** `git push` that force-pushes, deletes, or lands straight on a protected branch. */
export function checkPush(words: string[], protectedBranches: string[], currentBranch?: string): Verdict | undefined {
  const w = head(words)
  if (w[0] !== 'git') return
  let i = 1
  // git's own options before the subcommand: -C dir, -c k=v, --git-dir=…
  while (i < w.length && w[i]!.startsWith('-')) i += w[i] === '-C' || w[i] === '-c' ? 2 : 1
  if (w[i] !== 'push') return
  const args = w.slice(i + 1)
  const flags = args.filter(a => a.startsWith('-'))
  const isForce =
    flags.some(f => f === '--force' || f.startsWith('--force-with-lease') || f === '--force-if-includes' || shortFlags(f).includes('f')) ||
    args.some(a => a.startsWith('+'))
  const isDelete = flags.some(f => f === '--delete' || shortFlags(f).includes('d'))
  if (flags.includes('--mirror') || flags.includes('--all'))
    return { rule: 'push-all', reason: '`git push --mirror` / `--all` can overwrite protected branches. Push the one branch you mean.' }
  const pos = args.filter(a => !a.startsWith('-'))
  const refspecs = pos.slice(1)
  // `git push --tags` with no refspec pushes tags alone, no branch.
  if (!refspecs.length && flags.includes('--tags')) return
  const targets = (refspecs.length ? refspecs : [currentBranch ?? '']).map(r => {
    const s = r.replace(/^\+/, '')
    const dst = s.includes(':') ? s.slice(s.indexOf(':') + 1) : s
    const name = dst === 'HEAD' || dst === '' ? (s.startsWith(':') ? '' : currentBranch ?? '') : dst
    return name.replace(/^refs\/heads\//, '')
  })
  const hit = targets.find(t => t && protectedBranches.includes(t))
  if (!hit) return
  if (isDelete || refspecs.some(r => r.startsWith(':')))
    return { rule: 'delete-protected', reason: `That deletes the protected branch \`${hit}\` on the remote. Don't.` }
  if (isForce)
    return { rule: 'force-protected', reason: `That force-pushes the protected branch \`${hit}\`. Push a branch of your own and open a PR.` }
  return {
    rule: 'push-protected',
    reason: `\`${hit}\` is protected: push a branch of your own and open a PR (\`git switch -c <name>\`, then \`git push -u origin <name>\`).`,
  }
}

/** `rm -rf` on something outside the project: /, ~, a variable, `..`, or the project itself. */
export function checkRm(words: string[], cwd: string): Verdict | undefined {
  const w = head(words)
  if (w[0] !== 'rm') return
  let isRec = false
  let isForce = false
  const targets: string[] = []
  let ended = false
  for (const a of w.slice(1)) {
    if (!ended && a === '--') ended = true
    else if (!ended && a.startsWith('--')) {
      if (a === '--recursive') isRec = true
      if (a === '--force') isForce = true
    } else if (!ended && a.startsWith('-') && a.length > 1) {
      const f = a.slice(1)
      if (/[rR]/.test(f)) isRec = true
      if (f.includes('f')) isForce = true
    } else targets.push(a)
  }
  if (!isRec || !isForce) return
  const root = cwd.replace(/\/+$/, '')
  for (const t of targets) {
    const why =
      t === '/' || t === '/*'
        ? 'the whole disk'
        : t === '~' || t.startsWith('~/') || t.startsWith('~')
          ? 'your home folder'
          : t.includes('$')
            ? `a path from a variable (\`${t}\`), which could be empty or anything`
            : t.split('/').includes('..')
              ? `a path outside the project (\`${t}\`)`
              : t === '.' || t === './' || t === '*' || t === './*'
                ? 'the whole project'
                : t.startsWith('/') && !(t + '/').startsWith(root + '/')
                  ? `a path outside the project (\`${t}\`)`
                  : t.startsWith('/') && (t === root || t === root + '/')
                    ? 'the whole project'
                    : ''
    if (why) return { rule: 'rm-outside', reason: `\`rm -rf\` on ${why}. Name the folder inside the project you mean, or ask the user to run it.` }
  }
}

/** The first rule the command breaks, checking each of its simple commands. */
export function check(cmd: string, opts: { protectedBranches: string[]; cwd: string; currentBranch?: string }): Verdict | undefined {
  for (const seg of segments(cmd)) {
    const v = checkPush(seg, opts.protectedBranches, opts.currentBranch) ?? checkRm(seg, opts.cwd)
    if (v) return v
  }
}

// Up to the end of the line, but never a closing quote or paren that belongs to the command.
const COAUTHOR = /^[ \t]*Co-Authored-By:[ \t]*Claude\b[^\n"')]*(?:\)[^\n"')]*)?[ \t]*(?:\n|(?=["')]|$))/gim
const GENERATED = /^[ \t]*(?:🤖[ \t]*)?Generated with \[?Claude Code\]?(?:\([^)\n]*\))?[ \t]*(?:\n|(?=["')]|$))/gim

/** True for a command that writes a commit message or a PR body. */
export const writesMessage = (cmd: string) => /\bgit\s+(?:-C\s+\S+\s+)?commit\b|\bgh\s+pr\s+(?:create|edit|merge)\b/.test(cmd)

/** The command without Claude co-author and "Generated with Claude Code" lines; the same string when there are none. */
export function stripCoauthor(cmd: string): string {
  if (!writesMessage(cmd)) return cmd
  const out = cmd.replace(COAUTHOR, '').replace(GENERATED, '')
  if (out === cmd) return cmd
  return (
    out
      .replace(/\n{3,}/g, '\n\n')
      // a blank line left just before a heredoc's end or a closing quote
      .replace(/\n[ \t]*\n(?=[ \t]*(?:EOF|['"])[^\n]*(?:\n|$))/g, '\n')
  )
}
