import { expect, mock, test } from 'claude-code/testing'
import { left, parseMinutes, statusText, summary } from '../hooks/register'

test('lengths, the status line and the summary', () => {
  expect([parseMinutes('25'), parseMinutes('90m'), parseMinutes('1h'), parseMinutes('1.5 hours')]).toEqual([25, 90, 60, 90])
  expect([parseMinutes('soon'), parseMinutes('0'), parseMinutes('900')]).toEqual([undefined, undefined, undefined])
  expect([left(18 * 60_000 - 1), left(45_000)]).toEqual(['18m', '45s'])
  const s = { startedAt: 0, endAt: 18 * 60_000, held: [{ at: 1, text: 'CI failed: #12' }], mutedSounds: 1 }
  expect(statusText(s, 0)).toBe('◉ focus · 18m left · 2 held')
  expect(summary(s.held, 1)).toBe('• CI failed: #12')
  expect(summary([], 2)).toBe('2 sounds muted')
  expect(summary([], 0)).toBe('Nothing came in.')
})

test('the timer counts down in the status line, and the break sends one summary', async ($, on) => {
  const notified: any[] = []
  const status: (string | undefined)[] = []
  mock.store(on)
  const clock = mock.clock(on, { now: 1_790_000_000_000 })
  on('command.register', () => ({ value: { command: 'focus-timer' } }))
  on('ui.status', (_: unknown, e: any) => (status.push(e.text), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', (_: unknown, e: any) => (notified.push(e), { value: { isSent: true, channel: 'iterm2' } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const r: any = await $.command.run({ command: 'focus-timer', args: '20' } as any)
  expect(r.text).toMatch(/Focusing for 20m/)
  expect(status.at(-1)).toBe('◉ focus · 20m left')
  await clock.advance(5 * 60_000)
  expect(status.at(-1)).toBe('◉ focus · 15m left')
  await clock.advance(15 * 60_000)
  expect(status.at(-1)).toBeUndefined()
  expect(notified.length).toBe(1)
  expect(notified[0]).toMatchObject({ title: 'Focus done: 20m', text: 'Nothing came in.' })
})

test('/focus-timer stop ends it early; an unclear length asks again', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_790_000_000_000 })
  on('command.register', () => ({ value: { command: 'focus-timer' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'iterm2' } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const run = async (args: string) => ((await $.command.run({ command: 'focus-timer', args } as any)) as any).text
  expect(await run('soon')).toMatch(/Say how long/)
  expect(await run('stop')).toBe('No focus session running.')
  expect(await run('')).toMatch(/Focusing for 25m/)
  expect(await run('10')).toMatch(/Already focusing/)
  expect(await run('stop')).toBe('Focus stopped.')
})
