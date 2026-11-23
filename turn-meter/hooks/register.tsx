// turn-meter: each main-thread turn's tokens and cost on the line that closes it in the
// transcript (`Baked for 42s · 180k in · 3.1k out · $0.41`). The cost is how much the session's
// total rose during the turn, so it includes any subagent or advisor spend in that turn.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TurnReading } from '../types'

type $T = EngineInterface

const KEEP = 200
/**
 * The closing line is matched to its turn by duration, both the turn's length in ms. A wrong cost
 * on a line is worse than none, so only a hair of drift counts: an old line never borrows a turn's.
 */
const MATCH_MS = 50

export const turns = atom({ plugin: 'turn-meter', key: 'turns' } as const, [], { shape: 'turns-1' })
export const costSoFar = atom({ plugin: 'turn-meter', key: 'costSoFar' } as const, 0)

/** 950 → `950`, 12_400 → `12k`, 1_240_000 → `1.2M`. */
export const tokens = (n: number) =>
  n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k` : `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`

/** `$0.41`, or `<$0.01` for a cheap turn. */
export const usd = (n: number) => (n < 0.005 ? '<$0.01' : `$${n.toFixed(2)}`)

/** ` · 180k in · 3.1k out · $0.41` for one turn. */
export function meterText(t: TurnReading) {
  const parts = [`${tokens(t.input + t.cacheRead)} in`, `${tokens(t.output)} out`]
  if (t.costUsd !== undefined) parts.push(usd(t.costUsd))
  return ` · ${parts.join(' · ')}`
}

/** The recorded turn a closing line of this duration belongs to: the same length, give or take 50ms. */
export function match(list: TurnReading[], durationMs: number) {
  let best: TurnReading | undefined
  for (const t of list) {
    const d = Math.abs(t.durationMs - durationMs)
    if (d <= MATCH_MS && (!best || d < Math.abs(best.durationMs - durationMs))) best = t
  }
  return best
}

async function sessionCost($: $T) {
  return (await $.session.usage().catch(() => undefined))?.cost?.usd
}

export const register: Register = (on, options) => {
  const costlyAt = Math.max(0, Number(options.costlyAt ?? 0.5))

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const c = await sessionCost($)
    if (c !== undefined) await update($, costSoFar, () => c)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) return done
    const u = e.usage
    const now = await sessionCost($)
    const before = await read($, costSoFar)
    if (now !== undefined) await update($, costSoFar, () => now)
    if (!u) return done
    const reading: TurnReading = {
      durationMs: e.durationMs,
      input: u.input_tokens + u.cache_creation_input_tokens,
      output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens,
      ...(now !== undefined ? { costUsd: Math.max(0, now - before) } : {}),
    }
    await update($, turns, list => [...list, reading].slice(-KEEP))
    return done
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.waitingFor) return next(e)
    const t = match(await read($, turns), e.props.durationMs)
    if (!t) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const isCostly = costlyAt > 0 && (t.costUsd ?? 0) >= costlyAt
    return (
      <Box flexDirection="row">
        {await next(e)}
        <Text dimColor={!isCostly} color={isCostly ? 'warning' : undefined}>
          {meterText(t)}
        </Text>
      </Box>
    )
  })
}
