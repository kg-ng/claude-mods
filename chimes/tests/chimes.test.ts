import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { kindOf, loudest } from '../hooks/register'

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]

test('a notification picks its sound; sounds together play the most urgent', () => {
  expect(kindOf('CI failed: #12 Shorter PR rows')).toBe('bad')
  expect(kindOf('5-hour usage at 91% (your stop is 90%)')).toBe('bad')
  expect(kindOf('CI passed: #12 Shorter PR rows')).toBe('good')
  expect(kindOf('Finished, needs your reply: merge it?')).toBe('attention')
  expect(loudest(['done', 'attention'])).toBe('attention')
  expect(loudest(['good', 'bad', 'done'])).toBe('bad')
  expect(loudest([])).toBeUndefined()
})

async function boot($: T$, on: TOn, played: string[]) {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_790_000_000_000 })
  on('command.register', () => ({ value: { command: 'chimes' } }))
  on('audio.play', (_: unknown, e: any) => (played.push(e.clip.asset), { value: undefined }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('classic.Notification', () => ({}))
  on('prompt.edit', (_: unknown, e: any) => ({ text: e.inputText, cursor: e.inputText.length }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  return clock
}

const turn = (durationMs: number, extra = {}) =>
  ({ answer: 'ok', durationMs, isAborted: false, turnId: 't', reason: 'answer', ...extra }) as any

test('a long turn chimes; a short, aborted or subagent turn does not; a turn end that also needs you plays once, the more urgent', async ($, on) => {
  const played: string[] = []
  const clock = await boot($, on, played)
  await $.turn.complete(turn(45_000))
  await clock.advance(500)
  expect(played).toEqual(['sounds/done.wav'])
  await $.turn.complete(turn(3_000))
  await $.turn.complete(turn(60_000, { isAborted: true }))
  await $.turn.complete(turn(60_000, { agentId: 'a1' }))
  await clock.advance(500)
  expect(played.length).toBe(1)
  await $.turn.complete(turn(45_000))
  await ($ as any).classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  await clock.advance(500)
  expect(played).toEqual(['sounds/done.wav', 'sounds/attention.wav'])
})

test('quiet while typing, and /chimes off', async ($, on) => {
  const played: string[] = []
  const clock = await boot($, on, played)
  await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'h' })
  await $.turn.complete(turn(45_000))
  await clock.advance(500)
  expect(played).toEqual([])
  await clock.advance(6_000)
  await $.command.run({ command: 'chimes', args: 'off' } as any)
  await $.turn.complete(turn(45_000))
  await clock.advance(500)
  expect(played).toEqual([])
  await $.command.run({ command: 'chimes', args: 'on' } as any)
  await $.turn.complete(turn(45_000))
  await clock.advance(500)
  expect(played).toEqual(['sounds/done.wav'])
})
