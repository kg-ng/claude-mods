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

/** A toast, plus the alert sound on macOS; each key alerts once per session. */
export async function alert($: $T, key: string, text: string, sound = true) {
  if (alerted.has(key) || !(await read($, alertsOn))) return
  alerted.add(key)
  $.ui.toast(text)
  if (!sound) return
  try {
    if ((await $.process.run(['uname'], { timeoutMs: 3000 })).stdout.trim() === 'Darwin')
      await $.process.run(['afplay', SOUND], { timeoutMs: 5000 })
  } catch {
    // No sound player: the toast is enough.
  }
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
            onSelect={v => void update($, limitsDraft, d => ({ ...d, warn: Number(v) }))}
          />
          <Select
            key="limits-stop"
            label="stop at"
            options={PCT_OPTIONS}
            value={String(draft.stop)}
            onSelect={v => void update($, limitsDraft, d => ({ ...d, stop: Number(v) }))}
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
        onSubmit={async v => {
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
        onSubmit={v => pinQuick($, v)}
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
      }),
    )
  } catch (err) {
    await update($, git, s => ({ ...s, error: line1(String(err), 120) })).catch(() => undefined)
  } finally {
    gitBusy = false
  }
}

export async function gitBody($: $T, e: any, L: Look) {
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
      {g.last && <Text wrap="truncate-end">last: {g.last}</Text>}
      {g.error && <Text color={L.err}>{g.error}</Text>}
      <Box flexDirection="row" gap={2}>
        <Text {...dim(L)}>updated {hhmm(g.updatedAt)}</Text>
        <Button key="git-refresh" plain label="refresh" onPress={() => refreshGit($)} />
      </Box>
    </Box>
  )
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
