// guard: checks Claude's shell commands before they run. Stops pushes onto protected branches
// and rm -rf outside the project, and strips Claude co-author lines from commits and PR bodies.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Stop } from '../types'
import { check, stripCoauthor } from './rules'

type $T = EngineInterface

const isOn = atom({ plugin: 'guard', key: 'isOn' } as const, true)
const stops = atom({ plugin: 'guard', key: 'stops' } as const, [], { shape: 'stops-1' })
const STORE_ON = 'on-v1'
const KEEP = 10

async function branch($: $T, cwd: string) {
  const r = await $.process.run(['git', 'branch', '--show-current'], { cwd, timeoutMs: 3000 }).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout.trim() : undefined
}

async function setOn($: $T, on: boolean) {
  await update($, isOn, () => on)
  await $.store.set(STORE_ON, on)
}

export const register: Register = (on, options) => {
  const protectedBranches = String(options.protectedBranches ?? 'main,master')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const shouldStrip = options.stripCoauthor !== false

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get(STORE_ON)
    if (saved === false) await update($, isOn, () => false)
    await $.command.register({ name: 'guard', description: 'guard on, off, or what it stopped lately', argumentHint: '[on|off]' })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const command = String((e as { command?: unknown }).command ?? '')
    const cwd = await $.session.cwd()
    const currentBranch = /\bgit\b[\s\S]*\bpush\b/.test(command) ? await branch($, cwd) : undefined
    const v = check(command, { protectedBranches, cwd, currentBranch })
    if (v) {
      const now = await $.clock.now()
      await update($, stops, s => [{ at: now, rule: v.rule, command: command.slice(0, 200) }, ...s].slice(0, KEEP))
      $.ui.toast(`guard stopped: ${command.split('\n')[0]!.slice(0, 60)}`)
      return { deny: `guard: ${v.reason} (The user can turn this off with /guard off.)` }
    }
    if (shouldStrip) {
      const clean = stripCoauthor(command)
      if (clean !== command) {
        $.ui.toast('guard removed the Claude co-author line')
        return next({ ...e, command: clean } as typeof e)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'guard' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off') {
      await setOn($, false)
      return { text: 'guard is off: Claude’s commands run unchecked until /guard on.' }
    }
    if (arg === 'on') {
      await setOn($, true)
      return { text: `guard is on: protected branches ${protectedBranches.join(', ')}.` }
    }
    const list = await read($, stops)
    const state = (await read($, isOn)) ? 'on' : 'off'
    if (!list.length) return { text: `guard is ${state}. Nothing stopped this session.` }
    return {
      text: [`guard is ${state}. Stopped this session:`, ...list.map(s => `  ${s.rule}: ${s.command.split('\n')[0]}`)].join('\n'),
    }
  })
}
