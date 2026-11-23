// focus: a timer in the status line. While it runs, other mods' desktop notifications and
// sounds are held back; at the break you get one summary of what you missed. Claude Code's own
// permission prompts are never held: they show in the terminal as always.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Held, Session } from '../types'

type $T = EngineInterface

const TICK_MS = 30 * 1000
const KEEP = 50
const IDLE: Session = { startedAt: 0, endAt: 0, held: [], mutedSounds: 0 }

const session = atom({ plugin: 'focus', key: 'session' } as const, IDLE, { shape: 'session-1' })

const cfg = { minutes: 25, holdSounds: true }

/** `18m`, or `45s` in the last minute. */
export function left(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.ceil(s / 60)}m`
}

/** The status line while focusing: `◉ focus · 18m left · 2 held`. */
export function statusText(s: Session, now: number) {
  const n = s.held.length + s.mutedSounds
  return `◉ focus · ${left(s.endAt - now)} left${n ? ` · ${n} held` : ''}`
}

/** What you missed, for the break: one line per held notification, newest last. */
export function summary(held: Held[], mutedSounds: number) {
  if (!held.length && !mutedSounds) return 'Nothing came in.'
  const lines = held.map(h => `• ${h.text}`)
  if (mutedSounds && !held.length) lines.push(`${mutedSounds} sound${mutedSounds > 1 ? 's' : ''} muted`)
  return lines.join('\n')
}

/** `25`, `1h`, `90m` from `/focus-timer <length>`; undefined for anything else. */
export function parseMinutes(arg: string): number | undefined {
  const m = arg.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(h|hr|hours?|m|min|minutes?)?$/)
  if (!m) return
  const n = Number(m[1]) * (m[2]?.startsWith('h') ? 60 : 1)
  return n > 0 && n <= 600 ? n : undefined
}

async function isFocusing($: $T) {
  const s = await read($, session)
  return s.endAt > 0 && (await $.clock.now()) < s.endAt
}

async function start($: $T, minutes: number) {
  const now = await $.clock.now()
  const s: Session = { startedAt: now, endAt: now + minutes * 60_000, held: [], mutedSounds: 0 }
  await update($, session, () => s)
  $.ui.status(statusText(s, now))
}

async function finish($: $T, isEarly: boolean) {
  const s = await read($, session)
  if (!s.endAt) return
  await update($, session, () => IDLE)
  $.ui.status(undefined)
  const mins = Math.round(((isEarly ? await $.clock.now() : s.endAt) - s.startedAt) / 60_000)
  const title = `Focus ${isEarly ? 'stopped' : 'done'}: ${mins}m`
  const text = summary(s.held, s.mutedSounds)
  $.ui.toast(`${title}. ${s.held.length ? `${s.held.length} held: see the notification.` : text}`)
  if (!isEarly || s.held.length) await $.ui.notify(text, { title, key: 'focus-break' }).catch(() => undefined)
}

async function tick($: $T) {
  const s = await read($, session)
  if (!s.endAt) return
  const now = await $.clock.now()
  if (now >= s.endAt) await finish($, false)
  else $.ui.status(statusText(s, now))
}

export const register: Register = (on, options) => {
  cfg.minutes = parseMinutes(String(options.minutes ?? 25)) ?? 25
  cfg.holdSounds = options.holdSounds !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'focus-timer', description: 'Focus for a while: hold notifications and sounds until the break', argumentHint: '[minutes|stop]' })
    $.clock.every(TICK_MS, () => void tick($))
    // A reload keeps the session; put its line back.
    void tick($)
    return next(e)
  })

  // Every other mod's desktop notification passes here: held while focusing.
  on('ui.notify', async ($, e, next) => {
    if (!(await isFocusing($))) return next(e)
    const at = await $.clock.now()
    const text = e.title ? `${e.text} (${e.title})` : e.text
    await update($, session, s => ({ ...s, held: [...s.held, { at, text }].slice(-KEEP) }))
    $.ui.status(statusText(await read($, session), at))
    return { value: { isSent: false, reason: 'refused' } }
  })

  on('audio.play', async ($, e, next) => {
    if (!cfg.holdSounds || !(await isFocusing($))) return next(e)
    await update($, session, s => ({ ...s, mutedSounds: s.mutedSounds + 1 }))
    return { value: undefined }
  })

  on('command.run', { command: 'focus-timer' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'stop' || arg === 'off' || arg === 'end') {
      if (!(await isFocusing($))) return { text: 'No focus session running.' }
      await finish($, true)
      return { text: 'Focus stopped.' }
    }
    const minutes = arg ? parseMinutes(arg) : cfg.minutes
    if (minutes === undefined) return { text: 'Say how long: /focus-timer 25, /focus-timer 90m, /focus-timer 1h, or /focus-timer stop.' }
    if (await isFocusing($)) {
      const s = await read($, session)
      return { text: `Already focusing: ${statusText(s, await $.clock.now())}. /focus-timer stop to end it.` }
    }
    await start($, minutes)
    return { text: `Focusing for ${minutes}m. Other mods' notifications${cfg.holdSounds ? ' and sounds' : ''} wait until the break; permission prompts still show.` }
  })
}
