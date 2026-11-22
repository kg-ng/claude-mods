// The board's clock format, shared by every section: 24-hour (17:30) or 12-hour (5:30 PM).
export type TimeFmt = '24' | '12'

let fmt: TimeFmt = '24'

export const setTimeFmt = (f: TimeFmt) => {
  fmt = f
}
export const timeFmt = (): TimeFmt => fmt

const pad = (n: number) => String(n).padStart(2, '0')

/** "17:30" or "5:30 PM", in local time. */
export function clockText(ms: number): string {
  const d = new Date(ms)
  if (fmt === '24') return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const h = d.getHours() % 12 || 12
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
}

/** Reads Claude Code's own timeFormat setting: "12-hour" gives 12, anything else 24. */
export function fromSetting(v: unknown): TimeFmt | undefined {
  if (v === '12-hour') return '12'
  if (v === '24-hour' || v === '24-hour-utc') return '24'
  return undefined
}
