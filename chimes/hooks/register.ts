// chimes: a soft sound when Claude finishes a long turn, when it needs you, and for other mods'
// notifications (operator-board's CI passed or failed, needs-reply, usage). Sounds that land
// together play once, the most urgent, and nothing plays while you're typing.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChimeKind } from '../types'

type $T = EngineInterface

const RANK: Record<ChimeKind, number> = { done: 1, good: 2, attention: 3, bad: 4 }
/** Sounds asked for within this window play once: the most urgent. */
const GATHER_MS = 400
const TYPING_MS = 5000
const STORE_ON = 'on-v1'

const isOn = atom({ plugin: 'chimes', key: 'isOn' } as const, true)
const typedAt = atom({ plugin: 'chimes', key: 'typedAt' } as const, 0)

/** Which sound a notification's text calls for. */
export function kindOf(text: string): ChimeKind {
  if (/\b(fail(ed|ing)?|red|error|broke|broken|stop(ped)?|limit|usage at)\b/i.test(text)) return 'bad'
  if (/\b(pass(ed)?|green|merged|ready|succeeded)\b/i.test(text)) return 'good'
  return 'attention'
}

/** The most urgent of the sounds asked for, or undefined for none. */
export function loudest(kinds: ChimeKind[]): ChimeKind | undefined {
  return kinds.reduce<ChimeKind | undefined>((a, k) => (!a || RANK[k] > RANK[a] ? k : a), undefined)
}

/** The person's settings, read once when the module registers. */
const cfg = { done: true, needsYou: true, notifications: true, quietWhileTyping: true, minTurnMs: 20_000, gain: 0.7 }
/** Sounds asked for in the current window. */
let pending: ChimeKind[] = []

async function play($: $T, kind: ChimeKind) {
  await $.audio.play({ asset: `sounds/${kind}.wav` }, { gain: cfg.gain }).catch(() => undefined)
}

async function flush($: $T) {
  const kind = loudest(pending)
  pending = []
  if (!kind || !(await read($, isOn))) return
  if (cfg.quietWhileTyping && (await $.clock.now()) - (await read($, typedAt)) < TYPING_MS) return
  await play($, kind)
}

async function markTyped($: $T) {
  const now = await $.clock.now()
  await update($, typedAt, () => now)
}

/** Asks for a sound; the first ask opens a short window that gathers the rest. */
function chime($: $T, kind: ChimeKind) {
  if (!pending.length) $.clock.after(GATHER_MS, () => void flush($))
  pending.push(kind)
}

export const register: Register = (on, options) => {
  cfg.done = options.done !== false
  cfg.needsYou = options.needsYou !== false
  cfg.notifications = options.notifications !== false
  cfg.quietWhileTyping = options.quietWhileTyping !== false
  cfg.minTurnMs = Math.max(0, Number(options.minTurnSeconds ?? 20)) * 1000
  cfg.gain = Math.min(1, Math.max(0, Number(options.volume ?? 0.7)))

  on('session.start', async ($, e, next) => {
    if ((await $.store.get(STORE_ON)) === false) await update($, isOn, () => false)
    await $.command.register({ name: 'chimes', description: 'chimes on, off, or test to hear each sound', argumentHint: '[on|off|test]' })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (cfg.done && !e.agentId && !e.isAborted && e.durationMs >= cfg.minTurnMs) chime($, 'done')
    return done
  })

  // Claude Code's own notification: a permission prompt, or Claude waiting on you.
  on('classic.Notification', async ($, e, next) => {
    if (cfg.needsYou) chime($, 'attention')
    return next(e)
  })

  // Every mod's desktop notification passes here (operator-board's CI, needs-reply, usage alerts).
  on('ui.notify', async ($, e, next) => {
    if (cfg.notifications) chime($, kindOf(`${e.title ?? ''} ${e.text}`))
    return next(e)
  })

  // On the typing path: pass the keystroke on at once, note the time after.
  on('prompt.edit', async ($, e, next) => {
    void markTyped($)
    return next(e)
  })

  on('command.run', { command: 'chimes' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await update($, isOn, () => arg === 'on')
      await $.store.set(STORE_ON, arg === 'on')
      return { text: arg === 'on' ? 'chimes are on.' : 'chimes are off until /chimes on.' }
    }
    if (arg === 'test') {
      for (const k of ['done', 'good', 'attention', 'bad'] as const) {
        await play($, k)
        await $.clock.sleep(900)
      }
      return { text: 'That was: finished, passed, needs you, failed.' }
    }
    return { text: `chimes are ${(await read($, isOn)) ? 'on' : 'off'}. /chimes test plays each sound.` }
  })
}
