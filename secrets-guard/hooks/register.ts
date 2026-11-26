// secrets-guard: before Claude writes a file, commits, or sends a PR body, looks for API keys,
// tokens and private keys in what's about to go out, and stops it with where, never the value.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Stop } from '../types'
import { ALLOW, describe, scan, scanDiff, sends, written } from './rules'

type $T = EngineInterface

const isOn = atom({ plugin: 'secrets-guard', key: 'isOn' } as const, true)
const stops = atom({ plugin: 'secrets-guard', key: 'stops' } as const, [], { shape: 'stops-1' })
const STORE_ON = 'on-v1'
const KEEP = 10
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']

async function git($: $T, args: string[], cwd: string) {
  return $.process.run(['git', ...args], { cwd, timeoutMs: 10_000 }).catch(() => undefined)
}

async function isIgnored($: $T, path: string, cwd: string) {
  const r = await git($, ['check-ignore', '-q', '--', path], cwd)
  return r?.exitCode === 0
}

async function stop($: $T, where: string, kind: string, why: string) {
  const now = await $.clock.now()
  await update($, stops, s => [{ at: now, where, kind }, ...s].slice(0, KEEP))
  $.ui.toast(`secrets-guard stopped a ${kind} in ${where.split(',')[0]}`)
  return {
    deny:
      `secrets-guard: ${why} Read the value from an environment variable or a gitignored file (.env) instead. ` +
      `If the user confirms it's a fake value for a test, add the comment \`${ALLOW}\` on that line. ` +
      '(The user can turn this off with /secrets off.)',
  }
}

export const register: Register = (on, options) => {
  const allowIgnored = options.allowIgnored !== false

  on('session.start', async ($, e, next) => {
    if ((await $.store.get(STORE_ON)) === false) await update($, isOn, () => false)
    await $.command.register({ name: 'secrets', description: 'secrets-guard on, off, or what it stopped', argumentHint: '[on|off]' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const cwd = await $.session.cwd()

    if (EDIT_TOOLS.includes(tool)) {
      const w = written(tool, input)
      if (!w || !w.text) return next(e)
      const found = scan(w.text)
      if (!found.length) return next(e)
      if (allowIgnored && w.path && (await isIgnored($, w.path, cwd))) return next(e)
      const file = w.path.startsWith(cwd + '/') ? w.path.slice(cwd.length + 1) : w.path
      return stop($, file, found[0]!.kind, `what you're writing to ${file} has ${describe(found)}.`)
    }

    if (tool === 'Bash') {
      const command = String(input.command ?? '')
      const s = sends(command)
      if (s.text) {
        const found = scan(command)
        if (found.length) return stop($, 'the command', found[0]!.kind, `the command sends ${describe(found)} to a remote.`)
      }
      if (s.commit) {
        const diffs = [await git($, ['diff', '--cached', '-U0', '--no-color'], cwd)]
        if (s.commit.all) diffs.push(await git($, ['diff', '-U0', '--no-color'], cwd))
        const found = diffs.flatMap(d => (d?.exitCode === 0 ? scanDiff(d.stdout) : []))
        if (found.length)
          return stop(
            $,
            describe(found),
            found[0]!.kind,
            `the commit would add ${describe(found)}. Unstage it (\`git restore --staged <file>\`) and take the key out first.`,
          )
      }
    }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'secrets-guard: its check failed, so the call was stopped. (/secrets off turns it off.)' }))

  on('command.run', { command: 'secrets' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await update($, isOn, () => arg === 'on')
      await $.store.set(STORE_ON, arg === 'on')
      return { text: arg === 'on' ? 'secrets-guard is on.' : 'secrets-guard is off until /secrets on.' }
    }
    const list = await read($, stops)
    const state = (await read($, isOn)) ? 'on' : 'off'
    if (!list.length) return { text: `secrets-guard is ${state}. Nothing stopped this session.` }
    return { text: [`secrets-guard is ${state}. Stopped this session:`, ...list.map(s => `  ${s.kind} in ${s.where}`)].join('\n') }
  })
}
