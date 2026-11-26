// session-notes: /handoff writes a handoff note for this session from what it did and what git says:
// what you asked, commits, files Claude edited, the last test and lint results, what's not
// committed, and what's next. /handoff save writes it to a file; /handoff pr asks Claude for a PR
// description from it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Check } from '../types'
import { isCheck, note } from './notes'
import type { Facts } from './notes'

type $T = EngineInterface

const asks = atom({ plugin: 'session-notes', key: 'asks' } as const, [], { shape: 'asks-1' })
const edited = atom({ plugin: 'session-notes', key: 'edited' } as const, [], { shape: 'edited-1' })
const checks = atom({ plugin: 'session-notes', key: 'checks' } as const, [], { shape: 'checks-1' })
const start = atom({ plugin: 'session-notes', key: 'start' } as const, null)

const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const DEFAULT_PATH = '.claude/handoff.md'

async function root($: $T) {
  return (await $.session.root()).replace(/\/+$/, '')
}

async function git($: $T, cwd: string, args: string[]) {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 8000 }).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout : undefined
}

async function gather($: $T): Promise<Facts> {
  const [dir, s, usage, now, asked, files, ran] = await Promise.all([
    root($),
    read($, start),
    $.session.usage(),
    $.clock.now(),
    read($, asks),
    read($, edited),
    read($, checks),
  ])
  const [branch, log, status, stat] = await Promise.all([
    git($, dir, ['branch', '--show-current']),
    s?.head ? git($, dir, ['log', '--oneline', '--no-decorate', `${s.head}..HEAD`]) : undefined,
    git($, dir, ['status', '--short']),
    git($, dir, ['diff', '--stat', 'HEAD']),
  ])
  return {
    project: dir.split('/').at(-1) || dir,
    branch: branch?.trim() || undefined,
    startedAt: usage.startedAt,
    now,
    asks: [...asked],
    edited: [...files],
    commits: (log ?? '').split('\n').filter(Boolean).reverse(),
    uncommitted: (status ?? '').split('\n').filter(Boolean),
    diffStat: (stat ?? '').trim().split('\n').at(-1) || undefined,
    checks: [...ran],
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handoff', description: 'A handoff note for this session: asked, done, checks, not committed, next', argumentHint: '[save [path]|pr]' })
    const r = await next(e)
    // HEAD as the session found it, so /handoff can list the commits made since.
    if (!(await read($, start))) {
      const head = (await git($, await root($), ['rev-parse', 'HEAD']))?.trim()
      await update($, start, () => (head ? { head } : {}))
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && e.origin.kind === 'composer') {
      const first = e.text.trim().split('\n')[0]!.slice(0, 140)
      if (first) await update($, asks, list => [...list, first].slice(-20))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const tool = String(e.tool)
    const input = e as unknown as { file_path?: string; notebook_path?: string; command?: string }
    if (EDIT_TOOLS.includes(tool) && !ran.isError) {
      const dir = await root($)
      const abs = String(input.file_path ?? input.notebook_path ?? '')
      const path = abs.startsWith(dir + '/') ? abs.slice(dir.length + 1) : abs
      if (path) await update($, edited, list => (list.includes(path) ? list : [...list, path].slice(-200)))
    } else if (tool === 'Bash' && input.command && isCheck(input.command)) {
      const out = ran.result as { backgroundTaskId?: string } | undefined
      if (typeof out === 'object' && out?.backgroundTaskId) return ran
      const command = input.command.trim().split('\n')[0]!.slice(0, 100)
      const c: Check = { command, ok: !ran.isError }
      await update($, checks, list => [...list.filter(x => x.command !== command), c].slice(-20))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const text = note(await gather($))
    if (verb === 'save') {
      // Relative to the project root: `$.fs` resolves a relative path against the process's own folder.
      const asked = rest.join(' ') || DEFAULT_PATH
      const path = asked.startsWith('/') ? asked : `${await root($)}/${asked}`
      await $.fs.write(path, text)
      return { text: `session-notes: saved to ${path}.\n\n${text}` }
    }
    if (verb === 'pr') {
      await $.prompt.fill({
        text: `Write a pull request title and description for this branch from the handoff note below, checking the diff for anything it misses. Don't open the PR yet.\n\n${text}`,
        mode: 'replace',
      })
      return { text: 'session-notes: a PR description request is in the prompt box. Press Enter to send it.' }
    }
    return { text }
  })
}
