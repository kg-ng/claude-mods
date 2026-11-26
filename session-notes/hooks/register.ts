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

async function git($: $T, args: string[]) {
  const r = await $.process.run(['git', ...args], { timeoutMs: 8000 }).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout : undefined
}

async function gather($: $T): Promise<Facts> {
  const root = (await $.session.cwd()).replace(/\/+$/, '')
  const s = await read($, start)
  const now = await $.clock.now()
  const head = s?.head
  const [branch, log, status, stat] = await Promise.all([
    git($, ['branch', '--show-current']),
    head ? git($, ['log', '--oneline', '--no-decorate', `${head}..HEAD`]) : Promise.resolve(undefined),
    git($, ['status', '--short']),
    git($, ['diff', '--stat', 'HEAD']),
  ])
  return {
    project: root.split('/').at(-1) || root,
    branch: branch?.trim() || undefined,
    startedAt: s?.at ?? now,
    now,
    asks: [...(await read($, asks))],
    edited: [...(await read($, edited))],
    commits: (log ?? '').split('\n').filter(Boolean).reverse(),
    uncommitted: (status ?? '').split('\n').filter(Boolean),
    diffStat: (stat ?? '').trim().split('\n').at(-1) || undefined,
    checks: [...(await read($, checks))],
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handoff', description: 'A handoff note for this session: asked, done, checks, not committed, next', argumentHint: '[save [path]|pr]' })
    const r = await next(e)
    if (!(await read($, start))) {
      const head = (await git($, ['rev-parse', 'HEAD']))?.trim()
      const at = await $.clock.now()
      await update($, start, () => ({ at, ...(head ? { head } : {}) }))
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
      const root = (await $.session.cwd()).replace(/\/+$/, '')
      const abs = String(input.file_path ?? input.notebook_path ?? '')
      const path = abs.startsWith(root + '/') ? abs.slice(root.length + 1) : abs
      if (path) await update($, edited, list => (list.includes(path) ? list : [...list, path].slice(-200)))
    } else if (tool === 'Bash' && input.command && isCheck(input.command)) {
      const out = ran.result as { backgroundTaskId?: string } | undefined
      if (typeof out === 'object' && out?.backgroundTaskId) return ran
      const command = input.command.trim().split('\n')[0]!.slice(0, 100)
      const c: Check = { command, ok: !ran.isError, at: await $.clock.now() }
      await update($, checks, list => [...list.filter(x => x.command !== command), c].slice(-20))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const text = note(await gather($))
    if (verb === 'save') {
      const root = (await $.session.cwd()).replace(/\/+$/, '')
      const asked = rest.join(' ') || DEFAULT_PATH
      const path = asked.startsWith('/') ? asked : `${root}/${asked}`
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
