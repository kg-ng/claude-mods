// Usage meter, checkpoints, quick prompts, git at a glance and alerts for the operator pane.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Checkpoint, GitSnap, Look, QuickPrompt, UsageLimits, UsageSnap } from '../types'
import { dim } from './look'
import { clockText, fromSetting, setTimeFmt, timeFmt } from './time'
import type { TimeFmt } from './time'

type $T = EngineInterface

const DIR = '.claude/operator-board'
const USAGE_LOG = `${DIR}/usage-log.jsonl`
const CHECKPOINTS = `${DIR}/checkpoints.json`
const QUICK = `${DIR}/quick.json`
const USAGE_LOG_CAP = 2000
const CHECKPOINT_CAP = 200
const DEFAULT_LIMITS: UsageLimits = { warn: 75, stop: 90, isSet: false }
const STORE_LIMITS = 'usage-limits-v1'
const LIMIT_PRESETS: [number, number][] = [
  [75, 90],
  [60, 80],
  [80, 95],
]
const SOUND = '/System/Library/Sounds/Glass.aiff'

export const usage = atom({ plugin: 'operator-board', key: 'usage' } as const, { updatedAt: 0 }, {
  shape: 'usage-1',
})
/** Advisor calls in this session's main thread: how many, and the last one's time and length. */
export const advisorCalls = atom(
  { plugin: 'operator-board', key: 'advisorCalls' } as const,
  { count: 0, lastAt: 0, lastMs: 0 },
  { shape: 'advisor-1' },
)

/** Counts the advisor calls in one step's response (the API runs them, so they show only here). */
export async function recordAdvisor($: $T, uses: readonly { name: string; startedAt: number; endedAt?: number }[] | undefined) {
  const calls = (uses ?? []).filter(u => u.name === 'advisor')
  const last = calls.at(-1)
  if (!last) return
  await update($, advisorCalls, a => ({
    count: a.count + calls.length,
    lastAt: last.startedAt,
    lastMs: last.endedAt !== undefined ? Math.max(0, last.endedAt - last.startedAt) : 0,
  }))
}

/** Tokens one model used in this session's main thread, summed from each step's response. */
export type ModelTally = { input: number; output: number; cacheRead: number; cacheWrite: number; steps: number }
/** Main-thread tokens by the API's model id; `current` is the model of the last step, `label` as /model shows it. */
export const modelUsage = atom(
  { plugin: 'operator-board', key: 'modelUsage' } as const,
  { current: '', label: '', byModel: {} },
  { shape: 'model-usage-1' },
)

/** Adds one step's token counts to its model's tally. */
export async function recordModelUsage(
  $: $T,
  u:
    | { model: string; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
    | null
    | undefined,
) {
  if (!u?.model) return
  const label = await $.session.model().catch(() => '')
  await update($, modelUsage, m => {
    const t = m.byModel[u.model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, steps: 0 }
    return {
      current: u.model,
      label: label || m.label,
      byModel: {
        ...m.byModel,
        [u.model]: {
          input: t.input + u.input_tokens,
          output: t.output + u.output_tokens,
          cacheRead: t.cacheRead + u.cache_read_input_tokens,
          cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
          steps: t.steps + 1,
        },
      },
    }
  })
}

/** 950 → `950`, 12_400 → `12k`, 1_240_000 → `1.2M`. */
export const tokens = (n: number) =>
  n < 1000 ? String(n) : n < 1_000_000 ? `${Math.round(n / 1000)}k` : `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`

/** `1.2M in · 48k out · 91% cached` for one model's tally. */
export function tallyText(t: ModelTally) {
  const totalIn = t.input + t.cacheRead + t.cacheWrite
  const cached = totalIn ? Math.round((t.cacheRead / totalIn) * 100) : 0
  return `${tokens(totalIn)} in · ${tokens(t.output)} out${totalIn ? ` · ${cached}% cached` : ''}`
}

export const BTW_FILL = '/btw '
export const ADVISOR_FILL = '/advisor '
export const MODEL_FILL = '/model '

export const checkpoints = atom({ plugin: 'operator-board', key: 'checkpoints' } as const, [], {
  shape: 'checkpoints-1',
})
export const quick = atom({ plugin: 'operator-board', key: 'quick' } as const, [], { shape: 'quick-1' })
export const quickSuggest = atom({ plugin: 'operator-board', key: 'quickSuggest' } as const, [], {
  shape: 'quick-suggest-1',
})
export const git = atom({ plugin: 'operator-board', key: 'git' } as const, { updatedAt: 0 }, {
  shape: 'git-1',
})
export const usageLimits = atom({ plugin: 'operator-board', key: 'usageLimits' } as const, DEFAULT_LIMITS, {
  shape: 'usage-limits-1',
})
const limitsDraft = atom({ plugin: 'operator-board', key: 'limitsDraft' } as const, { warn: 75, stop: 90 }, {
  shape: 'limits-draft-1',
})
const PCT_OPTIONS = [50, 60, 65, 70, 75, 80, 85, 90, 95, 100].map(n => ({ value: String(n), label: `${n}%` }))
export const timeFormat = atom({ plugin: 'operator-board', key: 'timeFormat' } as const, '24')

/** The saved choice, else Claude Code's timeFormat setting, else 24-hour. */
export async function restoreTimeFmt($: $T) {
  const saved = await $.store.get('time-format-v1')
  let f: TimeFmt | undefined = saved === '12' || saved === '24' ? saved : undefined
  if (!f) {
    try {
      f = fromSetting((await $.settings.read()).timeFormat)
    } catch {
      f = undefined
    }
  }
  setTimeFmt(f ?? '24')
  await update($, timeFormat, () => timeFmt())
}

export async function toggleTimeFmt($: $T) {
  const f: TimeFmt = timeFmt() === '24' ? '12' : '24'
  setTimeFmt(f)
  await update($, timeFormat, () => f)
  await $.store.set('time-format-v1', f)
}

export const alertsOn = atom({ plugin: 'operator-board', key: 'alertsOn' } as const, true)

// ---------- small helpers ----------

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (ms: number) => clockText(ms)
const line1 = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export async function home($: $T): Promise<string> {
  try {
    return (await $.env.get('HOME')) ?? ''
  } catch {
    return ''
  }
}

async function readJson($: $T, rel: string): Promise<unknown> {
  try {
    const path = `${await home($)}/${rel}`
    if (!(await $.fs.exists(path))) return undefined
    return JSON.parse(await $.fs.read(path))
  } catch {
    return undefined
  }
}

async function writeJson($: $T, rel: string, data: unknown) {
  await $.fs.write(`${await home($)}/${rel}`, JSON.stringify(data, null, 1))
}

const bar = (pct: number, width = 10) => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '█'.repeat(full) + '░'.repeat(width - full)
}
const levelColor = (L: Look, pct: number, lim: UsageLimits) =>
  pct >= lim.stop ? L.err : pct >= lim.warn ? L.warn : L.ok

export async function setLimits($: $T, warn: number, stop: number, isSet = true) {
  const lim: UsageLimits = { warn, stop, isSet }
  await update($, usageLimits, () => lim)
  await update($, limitsDraft, () => ({ warn, stop }))
  await $.store.set(STORE_LIMITS, lim)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** "resets in 4h (17:30)", or with the weekday once it is not today: "resets in 3d (Mon 09:00)". */
export const untilText = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const at = Date.parse(iso)
  const ms = at - now
  if (!(ms > 0)) return ''
  const d = new Date(at)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  const clock = `${sameDay ? '' : `${DAYS[d.getDay()]} `}${hhmm(at)}`
  const mins = Math.round(ms / 60000)
  const h = Math.round(mins / 60)
  const left = mins < 60 ? `${mins}m` : h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
  return `resets in ${left} (${clock})`
}

// ---------- alerts ----------

const alerted = new Set<string>()

export const alertLog = atom({ plugin: 'operator-board', key: 'alertLog' } as const, [], {
  shape: 'alert-log-1',
})
const ALERT_LOG_CAP = 20
const ALERT_TOAST_MS = 15000

/** Last folder name of the session, so a notification says which session it is. */
async function folderName($: $T): Promise<string> {
  const cwd = await $.session.cwd().catch(() => '')
  return cwd.split('/').filter(Boolean).pop() ?? ''
}

/**
 * An alert you can find again: kept on the pane until dismissed, a long toast,
 * a native notification titled with this session's folder, and (sound) the
 * alert sound on macOS. Each key alerts once per session.
 */
export async function alert($: $T, key: string, text: string, sound = true) {
  if (alerted.has(key) || !(await read($, alertsOn))) return
  alerted.add(key)
  const at = await $.clock.now()
  await update($, alertLog, l => [...l.filter(a => a.key !== key), { key, at, text }].slice(-ALERT_LOG_CAP))
  $.ui.toast(text, { timeoutMs: ALERT_TOAST_MS })
  const folder = await folderName($)
  await $.ui.notify(text, { title: folder ? `Claude · ${folder}` : 'Claude', key }).catch(() => undefined)
  if (!sound) return
  try {
    if ((await $.process.run(['uname'], { timeoutMs: 3000 })).stdout.trim() === 'Darwin')
      await $.process.run(['afplay', SOUND], { timeoutMs: 5000 })
  } catch {
    // No sound player: the toast is enough.
  }
}

export async function dismissAlert($: $T, key?: string) {
  await update($, alertLog, l => (key ? l.filter(a => a.key !== key) : []))
}

/** The strip at the top of the pane, shown whatever is folded, while any alert is undismissed. */
export async function alertsStrip($: $T, e: any, L: Look) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const list = [...(await read($, alertLog))].reverse()
  if (list.length === 0) return null
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        <Text color={L.warn} bold>
          ● Alerts ({list.length})
        </Text>
        <Button key="alerts-clear" plain label="dismiss all" onPress={() => dismissAlert($)} />
      </Box>
      {list.map(a => (
        <Box flexDirection="row" gap={1} key={`alert-${a.key}`}>
          <Box flexGrow={1}>
            <Text wrap="truncate-end">
              <Text {...dim(L)}>{hhmm(a.at)}</Text> {a.text}
            </Text>
          </Box>
          <Button key={`adis-${a.key}`} plain label="✓" onPress={() => dismissAlert($, a.key)} />
        </Box>
      ))}
    </Box>
  )
}

export async function alertCount($: $T): Promise<number> {
  return (await read($, alertLog)).length
}

/** Drops reply/wait alerts whose board item is gone (answered or marked done). */
export async function pruneBoardAlerts($: $T, ids: ReadonlySet<string>) {
  const gone = (await read($, alertLog)).filter(a => {
    const m = /^(?:reply|wait)-(.+)$/.exec(a.key)
    return m && !ids.has(m[1]!)
  })
  if (gone.length) await update($, alertLog, l => l.filter(a => !gone.some(g => g.key === a.key)))
}

export async function restoreAlerts($: $T) {
  const v = await $.store.get('alerts-v1')
  if (typeof v === 'boolean') await update($, alertsOn, () => v)
  const lim = (await $.store.get(STORE_LIMITS)) as UsageLimits | undefined
  if (lim && typeof lim.warn === 'number' && typeof lim.stop === 'number')
    await update($, usageLimits, () => ({ ...DEFAULT_LIMITS, ...lim }))
}

/** Sets alerts on or off (undefined flips them); returns the new setting. */
export async function toggleAlerts($: $T, on?: boolean): Promise<boolean> {
  const v = on ?? !(await read($, alertsOn))
  await setAlerts($, v)
  return v
}

export async function setSuggestions($: $T, historyText: string) {
  const list = suggestFrom(historyText)
  await update($, quickSuggest, () => list)
}

export async function allCheckpoints($: $T): Promise<Checkpoint[]> {
  return [...(await read($, checkpoints))]
}

export async function setAlerts($: $T, on: boolean) {
  await update($, alertsOn, () => on)
  await $.store.set('alerts-v1', on)
}

// ---------- 1. usage ----------

let loggedStart = false

export async function refreshUsage($: $T) {
  try {
    const u = await $.session.usage()
    const now = await $.clock.now()
    const find = (kind: string) => u.rateLimits.find(r => r.kind === kind)
    const five = find('five_hour')
    const week = find('seven_day')
    const snap: UsageSnap = {
      updatedAt: now,
      contextPct: u.context.percent,
      contextTokens: u.context.tokens,
      window: u.context.window,
      fiveHour: five ? { pct: five.percentUsed, resetsAt: five.resetsAt } : undefined,
      sevenDay: week ? { pct: week.percentUsed, resetsAt: week.resetsAt } : undefined,
      costUsd: u.cost?.usd,
    }
    await update($, usage, () => snap)
    if (!loggedStart && (five || week)) {
      loggedStart = true
      await logUsage($, 'start')
    }
    const lim = await read($, usageLimits)
    for (const [name, w] of [
      ['5-hour', five],
      ['weekly', week],
    ] as const) {
      if (!w || !lim.isSet) continue
      if (w.percentUsed >= lim.stop)
        await alert($, `usage-${name}-${w.resetsAt ?? ''}`, `${name} usage at ${w.percentUsed}% (your stop is ${lim.stop}%)`)
      else if (w.percentUsed >= lim.warn)
        await alert($, `usage-warn-${name}-${w.resetsAt ?? ''}`, `${name} usage at ${w.percentUsed}%`, false)
    }
  } catch (err) {
    await update($, usage, s => ({ ...s, error: line1(String(err), 120) })).catch(() => undefined)
  }
}

/** Appends one reading to ~/.claude/operator-board/usage-log.jsonl. */
export async function logUsage($: $T, kind: 'start' | 'end' | 'mark', label = '') {
  const u = await read($, usage)
  const row = {
    at: await $.clock.now(),
    kind,
    label: label || undefined,
    session: await $.session.id(),
    project: await $.session.cwd(),
    fiveHourPct: u.fiveHour?.pct,
    weeklyPct: u.sevenDay?.pct,
    contextPct: u.contextPct,
    costUsd: u.costUsd,
  }
  const path = `${await home($)}/${USAGE_LOG}`
  let old = ''
  try {
    if (await $.fs.exists(path)) old = await $.fs.read(path)
  } catch {
    old = ''
  }
  const lines = old.split('\n').filter(Boolean)
  lines.push(JSON.stringify(row))
  await $.fs.write(path, lines.slice(-USAGE_LOG_CAP).join('\n') + '\n')
}

export async function usageBody($: $T, e: any, L: Look) {
  const { Box, Button, Text, Input, Select } = $.ui.resolve(e)
  const u = await read($, usage)
  const now = await $.clock.now()
  const on = await read($, alertsOn)
  const lim = await read($, usageLimits)
  const tf = await read($, timeFormat)
  const draft = await read($, limitsDraft)
  const adv = await read($, advisorCalls)
  const mu = await read($, modelUsage)
  if (!lim.isSet)
    return (
      <Box flexDirection="column">
        <Text color={L.accent} bold>
          Set up usage limits
        </Text>
        <Text wrap="wrap">
          When should the board warn you, and at what point do you want to stop? These apply to the 5-hour
          and weekly limits.
        </Text>
        <Box flexDirection="row" gap={2}>
          {LIMIT_PRESETS.map(([w, st], n) => (
            <Button
              key={`limits-${w}-${st}`}
              plain
              variant={n === 0 ? 'primary' : undefined}
              label={`warn ${w}% · stop ${st}%${n === 0 ? ' (recommended)' : ''}`}
              onPress={() => setLimits($, w, st)}
            />
          ))}
        </Box>
        <Box flexDirection="row" gap={2}>
          <Select
            key="limits-warn"
            label="warn at"
            options={PCT_OPTIONS}
            value={String(draft.warn)}
            onSelect={(v: string) => void update($, limitsDraft, d => ({ ...d, warn: Number(v) }))}
          />
          <Select
            key="limits-stop"
            label="stop at"
            options={PCT_OPTIONS}
            value={String(draft.stop)}
            onSelect={(v: string) => void update($, limitsDraft, d => ({ ...d, stop: Number(v) }))}
          />
          <Button
            key="limits-save"
            plain
            label="save"
            onPress={() =>
              draft.warn < draft.stop
                ? setLimits($, draft.warn, draft.stop)
                : $.ui.toast('Warn has to be lower than stop.')
            }
          />
        </Box>
      </Box>
    )
  const meter = (label: string, pct: number | undefined, extra: string) =>
    pct === undefined ? (
      <Text {...dim(L)}>{label.padEnd(8)} no reading yet</Text>
    ) : (
      <Text wrap="truncate-end">
        {label.padEnd(8)}
        <Text color={levelColor(L, pct, lim)}>
          {bar(pct)} {Math.round(pct)}%
        </Text>
        <Text {...dim(L)}>{extra ? ` · ${extra}` : ''}</Text>
      </Text>
    )
  return (
    <Box flexDirection="column">
      {meter('context', u.contextPct, u.window ? `of ${Math.round(u.window / 1000)}k` : '')}
      {meter('5-hour', u.fiveHour?.pct, untilText(u.fiveHour?.resetsAt, now))}
      {meter('weekly', u.sevenDay?.pct, untilText(u.sevenDay?.resetsAt, now))}
      {u.costUsd !== undefined && <Text {...dim(L)}>cost this session ${u.costUsd.toFixed(2)}</Text>}
      <Box flexDirection="row" gap={2}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            {'advisor'.padEnd(8)}
            <Text {...dim(L)}>
              {adv.count === 0
                ? 'not called this session'
                : `${adv.count} call${adv.count > 1 ? 's' : ''} this session · last ${hhmm(adv.lastAt)}${adv.lastMs ? `, ${Math.max(1, Math.round(adv.lastMs / 1000))}s` : ''}`}
            </Text>
          </Text>
        </Box>
        <Button
          key="usage-advisor"
          plain
          label="/advisor"
          onPress={() => $.prompt.fill({ text: ADVISOR_FILL, mode: 'replace' })}
        />
      </Box>
      <Box flexDirection="row" gap={2}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            {'model'.padEnd(8)}
            {mu.current ? (
              <Text>
                <Text color={L.accent}>{mu.label || mu.current}</Text>
                <Text {...dim(L)}> · {tallyText(mu.byModel[mu.current]!)}</Text>
              </Text>
            ) : (
              <Text {...dim(L)}>no reply yet this session</Text>
            )}
          </Text>
        </Box>
        <Button key="usage-model" plain label="/model" onPress={() => $.prompt.fill({ text: MODEL_FILL, mode: 'replace' })} />
      </Box>
      {Object.keys(mu.byModel).length > 1 && (
        <Text {...dim(L)} wrap="truncate-end">
          {'        '}also{' '}
          {Object.entries(mu.byModel)
            .filter(([id]) => id !== mu.current)
            .map(([id, t]) => `${id.replace(/^claude-/, '')} ${tokens(t.input + t.cacheRead + t.cacheWrite)} in`)
            .join(' · ')}
        </Text>
      )}
      {u.error && <Text color={L.err}>{u.error}</Text>}
      <Box flexDirection="row" gap={2}>
        <Text {...dim(L)}>{u.updatedAt ? `updated ${hhmm(u.updatedAt)}` : 'loading…'}</Text>
        <Button key="usage-refresh" plain label="refresh" onPress={() => refreshUsage($)} />
        <Button key="time-format" plain label={tf === '12' ? 'time: 12h' : 'time: 24h'} onPress={() => toggleTimeFmt($)} />
        <Button
          key="limits-change"
          plain
          label={`limits ${lim.warn}/${lim.stop}%`}
          onPress={() => setLimits($, lim.warn, lim.stop, false)}
        />
        <Button
          key="alerts-toggle"
          plain
          label={on ? 'alerts: on' : 'alerts: off'}
          onPress={() => setAlerts($, !on)}
        />
      </Box>
      <Input
        key="usage-mark"
        label="Log"
        placeholder="label, e.g. sprint 23 start"
        submitLabel="log reading"
        onSubmit={async (v: string) => {
          await refreshUsage($)
          await logUsage($, 'mark', v.trim())
          $.ui.toast(`Logged a usage reading${v.trim() ? `: ${v.trim()}` : ''}`)
        }}
      />
      <Text {...dim(L)}>Readings are logged at session start and end to ~/{USAGE_LOG}.</Text>
    </Box>
  )
}

// ---------- 2. checkpoints ----------

export async function loadCheckpoints($: $T) {
  const data = (await readJson($, CHECKPOINTS)) as { items?: Checkpoint[] } | undefined
  const list = Array.isArray(data?.items) ? data!.items : []
  await update($, checkpoints, () => list)
}

export async function saveCheckpoint($: $T, note: string): Promise<Checkpoint> {
  const data = (await readJson($, CHECKPOINTS)) as { items?: Checkpoint[] } | undefined
  const list = Array.isArray(data?.items) ? data!.items : []
  const at = await $.clock.now()
  const cp: Checkpoint = {
    id: `c${at}`,
    at,
    note: note.trim(),
    session: await $.session.id(),
    project: await $.session.cwd(),
  }
  const next_ = [...list, cp].slice(-CHECKPOINT_CAP)
  await writeJson($, CHECKPOINTS, { v: 1, items: next_ })
  await update($, checkpoints, () => next_)
  return cp
}

export const CHECKPOINT_ASK =
  'Save a checkpoint with the checkpoint_save tool: one or two lines on where this session stands and the next step.'

/** The newest checkpoint of a session, if any. */
export const latestFor = (list: readonly Checkpoint[], session: string) =>
  [...list].reverse().find(c => c.session === session)

// ---------- 3. quick prompts ----------

export async function loadQuick($: $T) {
  const data = (await readJson($, QUICK)) as { items?: QuickPrompt[] } | undefined
  await update($, quick, () => (Array.isArray(data?.items) ? data!.items : []))
}

export async function pinQuick($: $T, text: string) {
  const t = text.trim()
  if (!t) return
  await loadQuick($)
  const list = await read($, quick)
  if (list.some(q => q.text === t)) return
  const next_ = [...list, { id: `q${await $.clock.now()}`, text: t }]
  await writeJson($, QUICK, { v: 1, items: next_ })
  await update($, quick, () => next_)
}

export async function unpinQuick($: $T, id: string) {
  await loadQuick($)
  const next_ = (await read($, quick)).filter(q => q.id !== id)
  await writeJson($, QUICK, { v: 1, items: next_ })
  await update($, quick, () => next_)
}

/** Prompts typed at least twice, most used first; commands and long ones left out. */
export function suggestFrom(historyText: string): string[] {
  const counts = new Map<string, number>()
  for (const l of historyText.split('\n')) {
    try {
      const d = JSON.parse(l)
      const t = typeof d?.display === 'string' ? d.display.trim() : ''
      if (!t || t.startsWith('/') || t.length > 80 || t.includes('[Pasted')) continue
      counts.set(t, (counts.get(t) ?? 0) + 1)
    } catch {
      // not a JSON line
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t)
}

export async function quickBody($: $T, e: any, L: Look) {
  const { Box, Button, Text, Input } = $.ui.resolve(e)
  const list = await read($, quick)
  const pinned = new Set(list.map(q => q.text))
  const ideas = (await read($, quickSuggest)).filter(t => !pinned.has(t)).slice(0, 5)
  const fill = (text: string) => $.prompt.fill({ text, mode: 'replace' })
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Button key="quick-btw" plain onPress={() => fill(BTW_FILL)}>
          <Text color={L.accent}>▸ /btw</Text>
        </Button>
        <Text {...dim(L)} wrap="truncate-end">
          a side question, answered without interrupting Claude
        </Text>
      </Box>
      {list.length === 0 && <Text {...dim(L)}>No pinned prompts yet.</Text>}
      {list.map(q => (
        <Box flexDirection="row" gap={1} key={`quick-${q.id}`}>
          <Box flexGrow={1} flexShrink={1}>
            <Button key={`qfill-${q.id}`} plain onPress={() => fill(q.text)}>
              <Text wrap="truncate-end" color={L.accent}>
                ▸ {line1(q.text, 80)}
              </Text>
            </Button>
          </Box>
          <Button key={`qdel-${q.id}`} plain label="×" onPress={() => unpinQuick($, q.id)} />
        </Box>
      ))}
      <Input
        key="quick-add"
        label="Pin"
        placeholder="a prompt you send often"
        submitLabel="pin"
        onSubmit={(v: string) => pinQuick($, v)}
      />
      {ideas.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text {...dim(L)}>You often send:</Text>
          {ideas.map((t, n) => (
            <Box flexDirection="row" gap={1} key={`idea-${n}`}>
              <Box flexGrow={1} flexShrink={1}>
                <Button key={`ifill-${n}`} plain onPress={() => fill(t)}>
                  <Text wrap="truncate-end">{line1(t, 80)}</Text>
                </Button>
              </Box>
              <Button key={`ipin-${n}`} plain label="+ pin" onPress={() => pinQuick($, t)} />
            </Box>
          ))}
        </Box>
      )}
      <Text {...dim(L)}>Click a prompt to put it in the prompt box.</Text>
    </Box>
  )
}

// ---------- 4. git ----------

let gitBusy = false
export const GIT_REVIEW_PROMPT = '/code-review'
export const GIT_COMMIT_PROMPT = 'Commit the current changes with a clear message (branch first if on main).'

// ---------- what Claude changed this session ----------

/** Paths (relative to the session's folder) of the files Claude edited this session. */
const claudeEdits = atom({ plugin: 'operator-board', key: 'claudeEdits' } as const, [] as string[], {
  shape: 'claude-edits-1',
})

/** Records a file an Edit / Write / MultiEdit / NotebookEdit call changed, then refreshes Git. */
export async function recordEdit($: $T, path: string) {
  const cwd = await $.session.cwd()
  const rel = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path.startsWith('/') ? '' : path
  if (!rel) return // outside this folder: not this repo's change
  const list = await read($, claudeEdits)
  if (!list.includes(rel)) await update($, claudeEdits, l => [...l, rel])
  void refreshGit($)
}

/** owner/name from a GitHub remote URL (https or ssh), else ''. */
export function repoFromRemote(url: string): string {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : ''
}

/** Line counts for Claude's files that still differ from HEAD: tracked from numstat, new ones by line. */
async function claudeChanges($: $T, cwd: string): Promise<GitSnap['claude']> {
  const paths = await read($, claudeEdits)
  if (paths.length === 0) return undefined
  const changed = new Set<string>()
  let added = 0
  let removed = 0
  const diff = await $.process.run(['git', '-C', cwd, 'diff', '--numstat', 'HEAD', '--', ...paths], { timeoutMs: 10000 })
  if (diff.exitCode === 0)
    for (const l of diff.stdout.split('\n')) {
      const [a, r, p] = l.split('\t')
      if (!p) continue
      changed.add(p)
      added += Number(a) || 0
      removed += Number(r) || 0
    }
  const fresh = await $.process.run(['git', '-C', cwd, 'ls-files', '--others', '--exclude-standard', '--', ...paths], {
    timeoutMs: 10000,
  })
  if (fresh.exitCode === 0)
    for (const p of fresh.stdout.split('\n').filter(Boolean)) {
      changed.add(p)
      const text = await $.fs.read(`${cwd}/${p}`).catch(() => '')
      added += text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0
    }
  if (changed.size === 0) return undefined
  return { paths: paths.filter(p => changed.has(p)), added, removed }
}

/** The one next step for this branch, as a prompt to fill: push it, or open its PR. */
export function gitNext(
  g: GitSnap,
  hasPr: (repo: string, branch: string) => boolean,
): { label: string; text: string } | undefined {
  const b = g.branch ?? ''
  if (!g.updatedAt || g.isRepo === false || !b || b === '(detached)' || /^(main|master|trunk)$/.test(b)) return undefined
  if (!g.upstream) return { label: 'push', text: `Push the branch ${b} and set its upstream.` }
  if ((g.ahead ?? 0) > 0) return { label: 'push', text: `Push the ${g.ahead} new commit${g.ahead === 1 ? '' : 's'} on ${b}.` }
  if (g.repo && !hasPr(g.repo, b))
    return {
      label: 'open PR',
      text: `Open a pull request for the branch ${b}: a short title, and a description that sums up its commits.`,
    }
  return undefined
}

// ---------- run buttons and branch CI ----------

const RUN_SCRIPTS = ['test', 'lint', 'typecheck', 'build'] as const

/** The command that runs a package.json script with this package manager. */
function scriptCommand(pm: string, script: string): string {
  if (pm === 'npm') return script === 'test' ? 'npm test' : `npm run ${script}`
  if (pm === 'bun') return `bun run ${script}`
  return `${pm} ${script}`
}

/**
 * The project's test / lint / typecheck / build commands: package.json scripts first, else
 * Makefile targets of those names. `pm` is the package manager the lockfile names.
 */
export function runTargets(pkg: string | undefined, makefile: string | undefined, pm: string): { label: string; command: string }[] {
  let scripts: Record<string, unknown> = {}
  try {
    scripts = (pkg && JSON.parse(pkg)?.scripts) || {}
  } catch {
    scripts = {}
  }
  const fromPkg = RUN_SCRIPTS.filter(s => typeof scripts[s] === 'string').map(s => ({ label: s, command: scriptCommand(pm, s) }))
  if (fromPkg.length) return fromPkg
  const targets = new Set([...(makefile ?? '').matchAll(/^([A-Za-z0-9_-]+)\s*:(?!=)/gm)].map(m => m[1]))
  return [...RUN_SCRIPTS, 'check' as const].filter(t => targets.has(t)).map(t => ({ label: t, command: `make ${t}` }))
}

/** The prompt a run button fills. */
export function runPrompt(r: { label: string; command: string }): string {
  return r.label === 'build' ? `Run \`${r.command}\` and fix any errors.` : `Run \`${r.command}\` and fix what fails.`
}

/** Sums GitHub check runs: passed, failed (with names), still running. */
export function summariseChecks(runs: { name?: string; status?: string; conclusion?: string | null }[]): NonNullable<GitSnap['ci']> {
  const ci = { passed: 0, failed: 0, running: 0, failedNames: [] as string[] }
  for (const r of runs) {
    if (r.status !== 'completed') ci.running += 1
    else if (r.conclusion === 'success') ci.passed += 1
    else if (r.conclusion === 'skipped' || r.conclusion === 'neutral') continue
    else {
      ci.failed += 1
      ci.failedNames.push(r.name ?? '?')
    }
  }
  return ci
}

/** One line for a branch's checks: `CI red: lint`, `CI 3/5`, `CI green`; '' with none. */
export function ciText(ci: GitSnap['ci']): string {
  if (!ci) return ''
  const total = ci.passed + ci.failed + ci.running
  if (total === 0) return ''
  if (ci.failed) return `CI red: ${ci.failedNames.slice(0, 2).join(', ')}${ci.failedNames.length > 2 ? ` +${ci.failedNames.length - 2}` : ''}`
  if (ci.running) return `CI ${total - ci.running}/${total}`
  return 'CI green'
}

async function projectRun($: $T, cwd: string): Promise<GitSnap['run']> {
  const read_ = (f: string) => $.fs.read(`${cwd}/${f}`).catch(() => undefined)
  const has = async (f: string) => (await $.fs.exists(`${cwd}/${f}`).catch(() => false)) === true
  const pm = (await has('pnpm-lock.yaml')) ? 'pnpm' : (await has('yarn.lock')) ? 'yarn' : (await has('bun.lockb')) || (await has('bun.lock')) ? 'bun' : 'npm'
  const list = runTargets(await read_('package.json'), await read_('Makefile'), pm)
  return list.length ? list : undefined
}

/** Checks on the pushed branch, from GitHub; undefined when there's no GitHub remote or gh fails. */
async function branchChecks($: $T, repo: string, branch: string): Promise<GitSnap['ci']> {
  const out = await $.process.run(
    ['gh', 'api', `repos/${repo}/commits/${encodeURIComponent(branch)}/check-runs?per_page=100`, '--jq', '.check_runs'],
    { timeoutMs: 20000 },
  )
  if (out.exitCode !== 0) return undefined
  const runs = JSON.parse(out.stdout || '[]')
  return Array.isArray(runs) && runs.length ? summariseChecks(runs) : undefined
}

/** owner/name of this folder's GitHub remote, as Git last read it. */
export async function gitRepo($: $T): Promise<string> {
  return (await read($, git)).repo ?? ''
}

/** The Git snapshot, for gitNext. */
export async function gitSnap($: $T): Promise<GitSnap> {
  return read($, git)
}

export async function refreshGit($: $T) {
  if (gitBusy) return
  gitBusy = true
  try {
    const cwd = await $.session.cwd()
    const now = await $.clock.now()
    const st = await $.process.run(['git', '-C', cwd, 'status', '--porcelain=v2', '--branch'], {
      timeoutMs: 10000,
    })
    if (st.exitCode !== 0) {
      await update($, git, (): GitSnap => ({ updatedAt: now, isRepo: false }))
      return
    }
    let branch = ''
    let ahead = 0
    let behind = 0
    let upstream = ''
    const files: string[] = []
    for (const l of st.stdout.split('\n')) {
      if (l.startsWith('# branch.head ')) branch = l.slice(14)
      else if (l.startsWith('# branch.upstream ')) upstream = l.slice(18)
      else if (l.startsWith('# branch.ab ')) {
        const m = /\+(\d+) -(\d+)/.exec(l)
        if (m) {
          ahead = Number(m[1])
          behind = Number(m[2])
        }
      } else if (/^[12u?] /.test(l)) {
        const parts = l.split(' ')
        const tag = l[0] === '?' ? '??' : (parts[1] ?? '').replace(/\./g, ' ').trim()
        files.push(`${tag.padEnd(2)} ${parts[parts.length - 1]}`)
      }
    }
    const log = await $.process.run(['git', '-C', cwd, 'log', '-1', '--format=%h %s (%cr)'], {
      timeoutMs: 10000,
    })
    const remote = await $.process.run(['git', '-C', cwd, 'remote', 'get-url', 'origin'], { timeoutMs: 10000 })
    const claude = await claudeChanges($, cwd).catch(() => undefined)
    const run = await projectRun($, cwd).catch(() => undefined)
    const repo = remote.exitCode === 0 ? repoFromRemote(remote.stdout) : ''
    // A pushed branch other than main: its checks, so CI shows before there's a PR.
    const ci =
      repo && upstream && branch && !/^(main|master|trunk)$/.test(branch)
        ? await branchChecks($, repo, branch).catch(() => undefined)
        : undefined
    await update(
      $,
      git,
      (): GitSnap => ({
        updatedAt: now,
        isRepo: true,
        branch,
        upstream,
        ahead,
        behind,
        changed: files.length,
        files: files.slice(0, 6),
        last: log.exitCode === 0 ? line1(log.stdout, 90) : '',
        repo,
        claude,
        run,
        ci,
      }),
    )
  } catch (err) {
    await update($, git, s => ({ ...s, error: line1(String(err), 120) })).catch(() => undefined)
  } finally {
    gitBusy = false
  }
}

/** `hasPr`: the branch has an open PR, whose CI the PRs section shows, so Git doesn't repeat it. */
export async function gitBody($: $T, e: any, L: Look, hasPr = false) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const g = await read($, git)
  if (!g.updatedAt) return <Text {...dim(L)}>loading…</Text>
  if (g.isRepo === false) return <Text {...dim(L)}>This folder is not a git repository.</Text>
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={L.accent} bold>
          {g.branch || '(no branch)'}
        </Text>
        {g.upstream ? (
          <Text {...dim(L)}>
            {' '}
            · ↑{g.ahead ?? 0} ↓{g.behind ?? 0}
          </Text>
        ) : (
          <Text {...dim(L)}> · not pushed</Text>
        )}
        <Text color={g.changed ? L.warn : L.ok}>
          {' '}
          · {g.changed ? `${g.changed} changed` : 'clean'}
        </Text>
      </Text>
      {(g.files ?? []).map(f => (
        <Text wrap="truncate-end" {...dim(L)}>
          {'  '}
          {f}
        </Text>
      ))}
      {(g.changed ?? 0) > (g.files?.length ?? 0) && (
        <Text {...dim(L)}>  … {(g.changed ?? 0) - (g.files?.length ?? 0)} more</Text>
      )}
      {g.claude && (
        <Box flexDirection="row" gap={2}>
          <Box flexGrow={1}>
            <Text wrap="truncate-end">
              Claude changed {g.claude.paths.length} file{g.claude.paths.length === 1 ? '' : 's'}{' '}
              <Text color={L.ok}>+{g.claude.added}</Text> <Text color={L.err}>−{g.claude.removed}</Text>
            </Text>
          </Box>
          <Button
            key="git-claude-review"
            plain
            variant="primary"
            label="review"
            onPress={() => $.prompt.fill({ text: GIT_REVIEW_PROMPT, mode: 'replace' })}
          />
          <Button
            key="git-claude-commit"
            plain
            label="commit"
            onPress={() =>
              $.prompt.fill({
                text: `Commit the files Claude changed this session: ${g.claude!.paths.join(', ')}.`,
                mode: 'replace',
              })
            }
          />
        </Box>
      )}
      {!hasPr && ciText(g.ci) && (
        <Text wrap="truncate-end">
          <Text color={g.ci!.failed ? L.err : g.ci!.running ? L.warn : L.ok}>{ciText(g.ci)}</Text>
          <Text {...dim(L)}> on {g.branch} · no PR yet</Text>
        </Text>
      )}
      {g.last && <Text wrap="truncate-end">last: {g.last}</Text>}
      {g.error && <Text color={L.err}>{g.error}</Text>}
      {(g.changed ?? 0) > 0 && (
        <Box flexDirection="row" gap={2}>
          <Button
            key="git-review"
            plain
            variant="primary"
            label="review"
            onPress={() => $.prompt.fill({ text: GIT_REVIEW_PROMPT, mode: 'replace' })}
          />
          <Button
            key="git-commit"
            plain
            label="commit"
            onPress={() => $.prompt.fill({ text: GIT_COMMIT_PROMPT, mode: 'replace' })}
          />
        </Box>
      )}
      {(g.run ?? []).length > 0 && (
        <Box flexDirection="row" gap={2}>
          <Text {...dim(L)}>run:</Text>
          {(g.run ?? []).map(r => (
            <Button
              key={`git-run-${r.label}`}
              plain
              label={r.label}
              onPress={() => $.prompt.fill({ text: runPrompt(r), mode: 'replace' })}
            />
          ))}
        </Box>
      )}
      <Box flexDirection="row" gap={2}>
        <Text {...dim(L)}>updated {hhmm(g.updatedAt)}</Text>
        <Button key="git-refresh" plain label="refresh" onPress={() => refreshGit($)} />
      </Box>
    </Box>
  )
}

// ---------- folded-header summaries ----------

/** One line for the Git header: ` · main · 3 changed · ↑2`. */
export async function gitSummary($: $T): Promise<string> {
  const g = await read($, git)
  if (!g.updatedAt || g.isRepo === false) return ''
  const parts = [g.branch || '(no branch)', g.changed ? `${g.changed} changed` : 'clean']
  if (!g.upstream) parts.push('not pushed')
  else {
    if (g.ahead) parts.push(`↑${g.ahead}`)
    if (g.behind) parts.push(`↓${g.behind}`)
  }
  const ci = ciText(g.ci)
  if (ci && ci !== 'CI green') parts.push(ci)
  return ` · ${parts.join(' · ')}`
}

/** One line for the Usage header: ` · ctx 42% · 5h 30% · $1.20`. */
export async function usageSummary($: $T): Promise<string> {
  const u = await read($, usage)
  const parts: string[] = []
  if (u.contextPct !== undefined) parts.push(`ctx ${Math.round(u.contextPct)}%`)
  if (u.fiveHour) parts.push(`5h ${Math.round(u.fiveHour.pct)}%`)
  if (u.sevenDay) parts.push(`wk ${Math.round(u.sevenDay.pct)}%`)
  if (u.costUsd !== undefined) parts.push(`$${u.costUsd.toFixed(2)}`)
  return parts.length ? ` · ${parts.join(' · ')}` : ''
}

/** Highest 5-hour or weekly reading against the limits: 'stop', 'warn' or ''. */
export async function usageLevel($: $T): Promise<'stop' | 'warn' | ''> {
  const u = await read($, usage)
  const lim = await read($, usageLimits)
  const top = Math.max(u.fiveHour?.pct ?? 0, u.sevenDay?.pct ?? 0)
  return top >= lim.stop ? 'stop' : top >= lim.warn ? 'warn' : ''
}

export async function quickSummary($: $T): Promise<string> {
  const n = (await read($, quick)).length
  return n ? ` (${n})` : ''
}

/** Why usage says autopilot should stop: a window at or past the warn line. */
export async function usageBlockReason($: $T): Promise<string | undefined> {
  const u = await read($, usage)
  const lim = await read($, usageLimits)
  if (!lim.isSet) return undefined
  for (const [name, w] of [
    ['5-hour', u.fiveHour],
    ['weekly', u.sevenDay],
  ] as const)
    if (w && w.pct >= lim.warn) return `${name} usage at ${Math.round(w.pct)}% (warn line ${lim.warn}%)`
  return undefined
}

// ---------- pane scrollbar ----------

/** The pane's height in rows, as the engine last reported it on a scroll. */
export const paneScroll = atom({ plugin: 'operator-board', key: 'paneScroll' } as const, { contentRows: 0, bodyRows: 0 }, {
  shape: 'pane-scroll-2',
})

/**
 * Where the thumb sits in a window of `bodyRows` over `contentRows` rows, the window's
 * top at `offset`. Undefined when everything fits. `top` is the window's top, clamped:
 * the engine's own clamps (after a fold) don't redraw, so a stale offset can run past the end.
 */
export function scrollbar(offset: number, bodyRows: number, contentRows: number) {
  if (bodyRows < 2 || contentRows <= bodyRows) return undefined
  const max = contentRows - bodyRows
  const top = Math.max(0, Math.min(offset, max))
  const thumb = Math.max(1, Math.min(bodyRows, Math.round((bodyRows * bodyRows) / contentRows)))
  const start = Math.round(((bodyRows - thumb) * top) / max)
  return { top, thumb, start }
}

/** Remembers the pane's height from a scroll; writes only when it changed, so a scroll redraws once. */
export async function recordScroll($: $T, contentRows: number, bodyRows: number) {
  const s = await read($, paneScroll)
  if (s.contentRows !== contentRows || s.bodyRows !== bodyRows) await update($, paneScroll, () => ({ contentRows, bodyRows }))
}

/**
 * What to reveal so a scroll moves nothing and only re-measures: the scrollbar, which is pinned
 * to the window, while there is one; else the top, where a pane that fits already is.
 */
export async function stillTarget($: $T): Promise<'start' | { key: string }> {
  const s = await read($, paneScroll)
  return s.bodyRows > 0 && s.contentRows > s.bodyRows ? { key: 'pane-scrollbar' } : 'start'
}

/** The bar, pinned to the window's right edge. Terminal only: other surfaces draw their own. */
export async function scrollbarColumn($: $T, e: any, L: Look) {
  if (e.surface !== 'terminal' || e.props.placement === 'widget') return null
  const { offset, bodyRows } = e.props.scroll
  const bar = scrollbar(offset, bodyRows, (await read($, paneScroll)).contentRows)
  if (!bar) return null
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box key="pane-scrollbar" position="absolute" top={bar.top} right={0} height={bodyRows} flexDirection="column">
      {Array.from({ length: bodyRows }, (_, i) =>
        i >= bar.start && i < bar.start + bar.thumb ? (
          <Text key={`sb-${i}`} color={L.accent}>┃</Text>
        ) : (
          <Text key={`sb-${i}`} {...dim(L)}>│</Text>
        ),
      )}
    </Box>
  )
}
