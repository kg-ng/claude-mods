// Crew: the session's subagents, live, in the band above the prompt. One row an agent with what
// it is doing now, its time and tokens, and buttons to watch its transcript, message it or stop it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CrewAgent, Look } from '../types'
import { dim } from './look'
import { tokens } from './extras'

type $T = EngineInterface

/** Finished agents stay on the band this long, then drop off. */
export const CREW_LINGER_MS = 60 * 1000
export const CREW_TICK_MS = 5 * 1000
/** Rows the band shows before "+N more". */
export const CREW_ROWS = 4

export const crew = atom({ plugin: 'operator-board', key: 'crew' } as const, {}, { shape: 'crew-1' })
/** Folded to one line; which agent's message box is open. */
export const crewUi = atom({ plugin: 'operator-board', key: 'crewUi' } as const, { folded: false, msgFor: '' }, {
  shape: 'crew-ui-1',
})
/** Written by the tick while an agent runs, so elapsed times move between its tool calls. */
export const crewNow = atom({ plugin: 'operator-board', key: 'crewNow' } as const, 0)

const isLive = (a: CrewAgent) => a.status === 'running' || a.status === 'pending' || a.status === 'waiting'

async function patch($: $T, id: string, fn: (a: CrewAgent) => CrewAgent) {
  await update($, crew, c => (c[id] ? { ...c, [id]: fn(c[id]!) } : c))
}

/** A spawned subagent joins the crew. */
export async function crewSpawned(
  $: $T,
  e: { description: string; subagentType: string },
  r: { agentId?: string; model?: string },
) {
  if (!r.agentId) return
  const now = await $.clock.now()
  const a: CrewAgent = {
    id: r.agentId,
    desc: e.description || e.subagentType,
    type: e.subagentType,
    model: r.model ?? '',
    status: 'running',
    startedAt: now,
    step: 'starting',
    tokensIn: 0,
    tokensOut: 0,
  }
  await update($, crew, c => ({ ...c, [a.id]: a }))
}

/** `Read operator-board/hooks/crew.tsx` from a tool call: the tool and a short look at what it's on. */
export function stepText(tool: string, input: any): string {
  const arg =
    input?.file_path ?? input?.path ?? input?.pattern ?? input?.command ?? input?.url ?? input?.query ?? input?.description ?? ''
  const s = String(arg).replace(/\s+/g, ' ').trim()
  const short = s.length > 48 ? `${s.slice(0, 47)}…` : s
  return short ? `${tool} ${short}` : tool
}

/** A subagent's tool call: its step changes. Written only when the text changes, to spare redraws. */
export async function crewStep($: $T, agentId: string, tool: string, input: unknown) {
  const text = stepText(tool, input)
  const cur = (await read($, crew))[agentId]
  if (!cur || cur.step === text) return
  await patch($, agentId, a => ({ ...a, step: text }))
}

/** A subagent's response: its tokens add up. */
export async function crewTokens(
  $: $T,
  agentId: string,
  u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model?: string } | null | undefined,
) {
  if (!u) return
  await patch($, agentId, a => ({
    ...a,
    model: a.model || u.model || '',
    tokensIn: a.tokensIn + u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
    tokensOut: a.tokensOut + u.output_tokens,
  }))
}

/** A subagent's turn ended: done, or stopped when it was aborted. */
export async function crewDone($: $T, agentId: string, isAborted: boolean) {
  const now = await $.clock.now()
  await patch($, agentId, a => ({ ...a, status: isAborted ? 'killed' : 'completed', endedAt: a.endedAt ?? now }))
}

/**
 * Every few seconds: take each agent's status from the engine (failed, killed, an agent a
 * reload or resume left behind), drop finished agents past their linger, and move the clock
 * the elapsed times read while one is running.
 */
export async function crewTick($: $T) {
  const c = await read($, crew)
  const ids = Object.keys(c)
  if (!ids.length) return
  const now = await $.clock.now()
  const listed = new Map((await $.agent.list().catch(() => [])).map(a => [a.id, a]))
  const next: Record<string, CrewAgent> = {}
  let changed = false
  for (const id of ids) {
    let a = c[id]!
    const l = listed.get(id)
    if (isLive(a) && (!l || !['pending', 'running', 'waiting'].includes(l.status))) {
      a = { ...a, status: l?.status ?? 'completed', endedAt: now }
      changed = true
    }
    if (!isLive(a) && now - (a.endedAt ?? now) > CREW_LINGER_MS) {
      changed = true
      continue
    }
    next[id] = a
  }
  if (changed) await update($, crew, () => next)
  if (Object.values(next).some(isLive)) await update($, crewNow, () => now)
}

const since = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

const GLYPH: Record<string, string> = { running: '●', pending: '○', waiting: '◐', idle: '◌', completed: '✓', failed: '✗', killed: '■' }

const shortModel = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '')

/** One line for the band's header: `crew 2 running · 1 done`. */
export function crewSummary(list: CrewAgent[]) {
  const live = list.filter(isLive).length
  const done = list.length - live
  return `crew ${live} running${done ? ` · ${done} done` : ''}`
}

async function stop($: $T, a: CrewAgent) {
  const r: any = await $.tool.call({ tool: 'TaskStop', task_id: a.id } as any).catch((err: unknown) => ({ deny: String(err) }))
  if (r?.deny) {
    await $.prompt.fill({ text: `Stop the subagent ${a.id} (${a.desc}).`, mode: 'replace' })
    $.ui.toast('Stopping needs your OK: press Enter to ask Claude to stop it.')
    return
  }
  await crewDone($, a.id, true)
}

/** The crew's rows for the band, or null when there are no subagents. */
export async function crewBand($: $T, e: any, L: Look) {
  const { Box, Button, Text, Input } = $.ui.resolve(e)
  const all = Object.values(await read($, crew)).sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || a.startedAt - b.startedAt)
  if (!all.length) return null
  const ui = await read($, crewUi)
  const now = Math.max(await read($, crewNow), await $.clock.now())
  const shown = all.slice(0, CREW_ROWS)
  const head = (
    <Box flexDirection="row" gap={2} key="crew-head">
      <Button
        key="crew-fold"
        plain
        variant={all.some(isLive) ? 'primary' : undefined}
        label={`${ui.folded ? '▸' : '▾'} ${crewSummary(all)}`}
        onPress={() => update($, crewUi, u => ({ ...u, folded: !u.folded }))}
      />
      {ui.folded && shown[0] && (
        <Text {...dim(L)} wrap="truncate-end">
          {shown[0].desc} · {shown[0].step}
        </Text>
      )}
    </Box>
  )
  if (ui.folded) return <Box flexDirection="column">{head}</Box>
  return (
    <Box flexDirection="column">
      {head}
      {shown.map(a => {
        const live = isLive(a)
        const color = a.status === 'failed' ? L.err : live ? L.accent : L.ok
        return (
          <Box flexDirection="column" key={`crew-${a.id}`}>
            <Box flexDirection="row" gap={1}>
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="truncate-end">
                  <Text color={color}>{GLYPH[a.status] ?? '●'} </Text>
                  <Text bold={live}>{a.desc}</Text>
                  <Text {...dim(L)}>
                    {' '}
                    · {a.type}
                    {a.model ? ` · ${shortModel(a.model)}` : ''} · {since((a.endedAt ?? now) - a.startedAt)}
                    {a.tokensIn ? ` · ${tokens(a.tokensIn)} in ${tokens(a.tokensOut)} out` : ''}
                  </Text>
                </Text>
              </Box>
              <Button
                key={`crew-view-${a.id}`}
                plain
                label="view"
                onPress={async () => {
                  const r = await $.ui.view({ agentId: a.id } as any)
                  if (r?.deny) $.ui.toast(r.deny)
                }}
              />
              {live && (
                <Button
                  key={`crew-msg-${a.id}`}
                  plain
                  label="msg"
                  onPress={() => update($, crewUi, u => ({ ...u, msgFor: u.msgFor === a.id ? '' : a.id }))}
                />
              )}
              {live && <Button key={`crew-stop-${a.id}`} plain label="stop" onPress={() => stop($, a)} />}
            </Box>
            <Text {...dim(L)} wrap="truncate-end">
              {'  '}
              {live ? `↳ ${a.step}` : a.status === 'completed' ? '↳ done' : `↳ ${a.status}`}
            </Text>
            {live && ui.msgFor === a.id && (
              <Input
                key={`crew-input-${a.id}`}
                label="  to agent"
                placeholder="e.g. skip the tests, just report"
                submitLabel="send"
                onSubmit={async (v: string) => {
                  const text = v.trim()
                  if (!text) return
                  const r = await $.session.send({ to: { agentId: a.id }, text })
                  $.ui.toast(r.isDelivered ? `Sent to ${a.desc}` : `Not sent: ${r.reason}`)
                  if (r.isDelivered) await update($, crewUi, u => ({ ...u, msgFor: '' }))
                }}
              />
            )}
          </Box>
        )
      })}
      {all.length > shown.length && <Text {...dim(L)}>+{all.length - shown.length} more</Text>}
    </Box>
  )
}
