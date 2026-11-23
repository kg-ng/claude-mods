import { expect, mock, test } from 'claude-code/testing'
import { match, meterText, tokens, usd } from '../hooks/register'

test('numbers read short', () => {
  expect([tokens(950), tokens(3_140), tokens(180_400), tokens(1_240_000)]).toEqual(['950', '3.1k', '180k', '1.2M'])
  expect([usd(0.001), usd(0.414)]).toEqual(['<$0.01', '$0.41'])
  expect(meterText({ durationMs: 1, input: 400, output: 3_100, cacheRead: 179_600, costUsd: 0.41 })).toBe(' · 180k in · 3.1k out · $0.41')
})

test('a closing line finds its turn by duration, give or take 50ms, never a nearby one', () => {
  const list = [
    { durationMs: 42_000, input: 1, output: 1, cacheRead: 0 },
    { durationMs: 9_000, input: 2, output: 2, cacheRead: 0 },
  ]
  expect(match(list, 42_000)?.input).toBe(1)
  expect(match(list, 9_030)?.input).toBe(2)
  expect(match(list, 9_600)).toBeUndefined()
  expect(match(list, 20_000)).toBeUndefined()
})

test('a main-thread turn gets its tokens and the cost it added; a subagent turn and ctrl+o are left alone', async ($, on) => {
  mock.store(on)
  let cost = 1.0
  on('session.usage', () => ({
    value: { startedAt: 0, context: { percent: 1, tokens: 1, window: 200_000 }, rateLimits: [], cost: { usd: cost } },
  }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const usage = { model: 'claude-opus-5-5', input_tokens: 400, output_tokens: 3_100, cache_read_input_tokens: 179_600, cache_creation_input_tokens: 0 }
  cost = 1.6
  await $.turn.complete({ answer: 'x', durationMs: 42_000, isAborted: false, turnId: 't1', reason: 'answer', usage } as any)
  cost = 1.7
  await $.turn.complete({ answer: 'y', durationMs: 30_000, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1', usage } as any)
  cost = 1.75
  await $.turn.complete({ answer: 'z', durationMs: 5_000, isAborted: false, turnId: 't3', reason: 'answer', usage: { ...usage, cache_read_input_tokens: 0, output_tokens: 200 } } as any)
  const line = (durationMs: number, extra = {}) =>
    ({ plugin: 'turn-meter', component: 'TurnDuration', surface: 'terminal', props: { word: 'Baked', durationMs, ...extra } }) as any
  let ui = await $.ui.mount(line(42_000))
  expect(await ui.find({ type: 'Text', text: '· 180k in · 3.1k out · $0.60' })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(line(5_000))
  // the subagent's turn added $0.10 before it, which this turn's reading includes: 1.75 - 1.6
  expect(await ui.find({ type: 'Text', text: '· 400 in · 200 out · $0.15' })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(line(30_000))
  expect(await ui.find({ type: 'Text', text: /in ·/ })).toBeUndefined()
  await ui.unmount()
  ui = await $.ui.mount(line(42_000, { isExpanded: true }))
  expect(await ui.find({ type: 'Text', text: /in ·/ })).toBeUndefined()
  await ui.unmount()
})
