import type { EngineInterface } from 'claude-code'

import { clockText } from './time'

/** Shared helpers for the operator-board modules: no state of their own. */
export type $T = EngineInterface

export const pad = (n: number) => String(n).padStart(2, '0')
export const hhmm = (ms: number) => clockText(ms)
export const dayTime = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm(ms)}`
}
export const age = (iso: string, now: number) => {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.round(mins / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}
export const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
export const newId = (prefix: string, taken: readonly { id: string }[]) => {
  let n = taken.length + 1
  while (taken.some(i => i.id === `${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

export async function homeDir($: $T): Promise<string> {
  try {
    return (await $.env.get('HOME')) ?? ''
  } catch {
    return ''
  }
}

export const shellQuote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`
