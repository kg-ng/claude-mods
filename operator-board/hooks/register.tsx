import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ask, BoardItem, Pr, PrSnapshot, SessionRow, SessionsSnapshot } from '../types'
import { BASE_LOOK, dim, watchLook } from './look'
import { clockText } from './time'
import {
  CHECKPOINT_ASK,
  allCheckpoints,
  restoreAlerts,
  restoreTimeFmt,
  setSuggestions,
  toggleAlerts,
  alert,
  alertCount,
  alertsStrip,
  pruneBoardAlerts,
  gitBody,
  gitSummary,
  recordScroll,
  scrollbarColumn,
  quickSummary,
  usageLevel,
  usageSummary,
  latestFor,
  loadCheckpoints,
  loadQuick,
  logUsage,
  pinQuick,
  quickBody,
  refreshGit,
  refreshUsage,
  saveCheckpoint,
  usageBody,
  usageBlockReason,
} from './extras'
import {
  TODO_TOOL,
  TODO_TOOL_DESCRIPTION,
  TODO_TOOL_SCHEMA,
  applyTodoTool,
  autopilotAfterTurn,
  loadTodos,
  todoBody,
  todoCount,
} from './todo'

type $T = EngineInterface

const P = 'operator-board'
const TOOL = 'board_update'
const TOOL_FULL = `mcp__${P}__${TOOL}`
const STORE_RECALL = 'recall-v1'
const RECALL_CAP = 500
const ANSWER_CAP = 4000
const STALE_MS = 24 * 60 * 60 * 1000
const PR_EVERY_MS = 3 * 60 * 1000
// Width asked for when the pane docks to the right of a fullscreen transcript.

// One pane holds every section; each section folds open or closed.
const PANE = { id: 'operator', title: 'operator' } as const
const SECTIONS = {
  board: 'Board',
  todo: 'To-do',
  usage: 'Usage',
  git: 'Git',
  sessions: 'Sessions',
  quick: 'Quick prompts',
  prs: 'PRs',
  recall: 'Recall',
} as const
type PaneKey = keyof typeof SECTIONS

// Change a shape tag when that value's fields change.
const asks = atom({ plugin: 'operator-board', key: 'asks' } as const, [], { shape: 'asks-1' })
const items = atom({ plugin: 'operator-board', key: 'items' } as const, [], { shape: 'items-1' })
const prs = atom(
  { plugin: 'operator-board', key: 'prs' } as const,
  { updatedAt: 0, items: [] },
  { shape: 'prs-1' },
)
const recallIndex = atom({ plugin: 'operator-board', key: 'recallIndex' } as const, [], {
  shape: 'recall-1',
})
const showContext = atom({ plugin: 'operator-board', key: 'showContext' } as const, true)
const recallQuery = atom({ plugin: 'operator-board', key: 'recallQuery' } as const, '')
// The CLI theme published by persona (see look.ts).
const look = atom({ plugin: 'operator-board', key: 'look' } as const, BASE_LOOK, { shape: 'look-1' })
const recallPick = atom({ plugin: 'operator-board', key: 'recallPick' } as const, null)
const STORE_OPEN = 'sections-v1'
const STORE_SCOPE = 'scope-v1'
// The board every session shares: one file, polled for changes.
const BOARD_FILE = '.claude/operator-board/board.json'
const BOARD_EVERY_MS = 2000
const boardScope = atom({ plugin: 'operator-board', key: 'boardScope' } as const, 'here')
const cwdAtom = atom({ plugin: 'operator-board', key: 'cwd' } as const, '')
const sessions = atom(
  { plugin: 'operator-board', key: 'sessions' } as const,
  { updatedAt: 0, items: [] },
  { shape: 'sessions-1' },
)
const SESSIONS_SHOWN = 8
// Earlier sessions listed under Recent asks, each with its last three asks.
const OTHER_SESSIONS_ASKS = 3
const HISTORY_TAIL = 4000
// Every section starts folded; what the person opens is remembered for the next session.
const DEFAULT_OPEN: Record<PaneKey, boolean> = {
  board: false,
  todo: false,
  usage: false,
  git: false,
  sessions: false,
  quick: false,
  prs: false,
  recall: false,
}
const CP_TOOL = 'checkpoint_save'
const TICK_MS = 60 * 1000
const REPLY_WAIT_MS = 30 * 60 * 1000
const openSections = atom({ plugin: 'operator-board', key: 'openSections' } as const, DEFAULT_OPEN, {
  shape: 'sections-1',
})

// ---------- helpers ----------

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (ms: number) => clockText(ms)
const dayTime = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm(ms)}`
}
const age = (iso: string, now: number) => {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.round(mins / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}
const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const newId = (prefix: string, taken: readonly { id: string }[]) => {
  let n = taken.length + 1
  while (taken.some(i => i.id === `${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

// ---------- recall search ----------

function search(index: readonly Ask[], query: string): Ask[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const phrases: string[] = []
  const rest = q.replace(/"([^"]+)"/g, (_, p: string) => {
    phrases.push(p)
    return ' '
  })
  const words = rest.split(/\s+/).filter(Boolean)
  const terms = [...phrases, ...words]
  const scored: { ask: Ask; score: number }[] = []
  for (const ask of index) {
    const qText = ask.question.toLowerCase()
    const aText = (ask.answer ?? '').toLowerCase()
    if (!terms.every(t => qText.includes(t) || aText.includes(t))) continue
    const score = terms.filter(t => qText.includes(t)).length * 10 + ask.at / 1e13
    scored.push({ ask, score })
  }
  return scored.sort((a, b) => b.score - a.score).map(s => s.ask)
}

// ---------- PRs ----------

const PR_QUERY = `query($q:String!){ search(query:$q, type:ISSUE, first:30){ nodes{ ... on PullRequest {
  number title url isDraft createdAt repository{nameWithOwner} headRefOid reviewDecision
  reviewThreads(first:100){nodes{isResolved}}
  commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){nodes{
    __typename ... on CheckRun{name status conclusion} ... on StatusContext{context state}
  }}}}}}
} } } }`

type GqlCtx = {
  __typename: string
  name?: string
  status?: string
  conclusion?: string | null
  context?: string
  state?: string
}

function toPr(n: any): Pr {
  const ctxs: GqlCtx[] =
    n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  const ci = { passed: 0, failed: 0, running: 0, skipped: 0, failedNames: [] as string[] }
  for (const c of ctxs) {
    const name = c.name ?? c.context ?? '?'
    const verdict =
      c.__typename === 'CheckRun'
        ? c.status !== 'COMPLETED'
          ? 'PENDING'
          : (c.conclusion ?? 'PENDING')
        : (c.state ?? 'PENDING')
    if (verdict === 'SUCCESS') ci.passed += 1
    else if (verdict === 'SKIPPED' || verdict === 'NEUTRAL') ci.skipped += 1
    else if (verdict === 'PENDING' || verdict === 'EXPECTED' || verdict === 'QUEUED')
      ci.running += 1
    else {
      ci.failed += 1
      ci.failedNames.push(name)
    }
  }
  const openThreads = (n.reviewThreads?.nodes ?? []).filter(
    (t: { isResolved: boolean }) => !t.isResolved,
  ).length
  const status: Pr['status'] =
    ci.failed > 0
      ? 'red'
      : ci.running > 0
        ? 'running'
        : openThreads > 0 || n.reviewDecision === 'CHANGES_REQUESTED'
          ? 'attention'
          : n.isDraft
            ? 'draft'
            : 'ready'
  return {
    repo: n.repository?.nameWithOwner ?? '?',
    number: n.number,
    title: n.title,
    url: n.url,
    isDraft: !!n.isDraft,
    createdAt: n.createdAt,
    head: String(n.headRefOid ?? '').slice(0, 7),
    reviewDecision: n.reviewDecision ?? null,
    openThreads,
    ci,
    status,
  }
}

const ORDER: Record<Pr['status'], number> = {
  red: 0,
  attention: 1,
  running: 2,
  draft: 3,
  ready: 4,
}

let refreshing = false
async function refreshPrs($: $T) {
  if (refreshing) return
  refreshing = true
  try {
    const out = await $.process.run(
      [
        'gh',
        'api',
        'graphql',
        '-f',
        `query=${PR_QUERY}`,
        '-f',
        'q=is:pr is:open author:@me archived:false',
      ],
      { timeoutMs: 30000 },
    )
    const now = await $.clock.now()
    if (out.exitCode !== 0) {
      const error = oneLine(out.stderr || 'gh failed', 160)
      await update($, prs, p => ({ ...p, error }))
      return
    }
    const nodes = JSON.parse(out.stdout)?.data?.search?.nodes ?? []
    const list: Pr[] = nodes
      .filter((n: any) => n && n.number)
      .map(toPr)
      .sort((a: Pr, b: Pr) => ORDER[a.status] - ORDER[b.status])
    const before = await read($, prs)
    await update($, prs, (): PrSnapshot => ({ updatedAt: now, items: list }))
    if (before.updatedAt > 0)
      for (const pr of list.filter(x => x.status === 'red'))
        await alert($, `pr-red-${pr.repo}-${pr.number}-${pr.head}`, `CI failed: #${pr.number} ${oneLine(pr.title, 50)}`)
  } catch (err) {
    const error = oneLine(String(err), 160)
    await update($, prs, p => ({ ...p, error }))
  } finally {
    refreshing = false
  }
}

// ---------- sessions ----------

/** Groups history.jsonl lines into sessions, newest first, leaving out `current`. */
export function toSessions(text: string, current: string): SessionRow[] {
  const byId = new Map<string, SessionRow & { said: { at: number; text: string }[] }>()
  for (const line of text.split('\n')) {
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    const id = typeof d?.sessionId === 'string' ? d.sessionId : ''
    if (!id || id === current) continue
    const at = typeof d.timestamp === 'number' ? d.timestamp : 0
    const said = typeof d.display === 'string' ? d.display.trim() : ''
    const row = byId.get(id) ?? { id, project: '', last: '', at: 0, prompts: 0, name: '', recent: [], said: [] }
    row.prompts += 1
    if (at >= row.at) {
      row.at = at
      row.project = String(d.project ?? row.project)
    }
    if (said && !said.startsWith('/')) row.said.push({ at, text: oneLine(said, 120) })
    byId.set(id, row)
  }
  return [...byId.values()]
    .map(({ said, ...row }) => {
      const byTime = [...said].sort((x, y) => x.at - y.at)
      const recent = byTime.slice(-3).reverse().map(x => x.text)
      return { ...row, name: byTime[0]?.text ?? '', recent, last: recent[0] ?? '' }
    })
    .sort((a, b) => b.at - a.at)
}

let loadingSessions = false
async function refreshSessions($: $T) {
  if (loadingSessions) return
  loadingSessions = true
  try {
    const home = await homeDir($)
    const out = await $.process.run(['tail', '-n', String(HISTORY_TAIL), `${home}/.claude/history.jsonl`], {
      timeoutMs: 10000,
    })
    const now = await $.clock.now()
    if (out.exitCode !== 0) {
      const error = oneLine(out.stderr || 'could not read history', 160)
      await update($, sessions, s => ({ ...s, error }))
      return
    }
    const list = toSessions(out.stdout, await $.session.id()).slice(0, SESSIONS_SHOWN)
    await update($, sessions, (): SessionsSnapshot => ({ updatedAt: now, items: list }))
    await setSuggestions($, out.stdout)
    await loadCheckpoints($)
  } catch (err) {
    const error = oneLine(String(err), 160)
    await update($, sessions, s => ({ ...s, error })).catch(() => undefined)
  } finally {
    loadingSessions = false
  }
}

async function homeDir($: $T): Promise<string> {
  try {
    return (await $.env.get('HOME')) ?? ''
  } catch {
    return ''
  }
}

const shellQuote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`

// ---------- panes ----------

/**
 * True only while the pane is drawn. The pane opened at session start is "unasked", and on a
 * terminal under 144 columns (110 once you've opened it yourself) it waits open but undrawn:
 * that counts as closed, so /operator shows it instead of closing it.
 */
const isPaneOpen = async ($: $T) => (await $.ui.panes()).some(p => p.id === PANE.id && p.isPlaced)

async function openPane($: $T) {
  // No fixed width: the dock takes Claude Code's share of the terminal and follows it as the
  // terminal resizes; a width the person drags or keys the dock to wins and is kept.
  const opened = await $.ui.open({ id: PANE.id, title: PANE.title })
  measurePane($, 'start')
  return opened
}

/**
 * Asks for a scroll that doesn't move, so the engine reports the pane's height for the
 * scrollbar. Only from a press or an open, never while drawing: a scroll redraws.
 */
async function measurePane($: $T, to: 'start' | { key: string }) {
  await $.ui.scroll({ in: PANE.id, to }).catch(() => undefined)
}

async function setSection($: $T, key: PaneKey, open: boolean) {
  let next_: Record<PaneKey, boolean> = DEFAULT_OPEN
  await update($, openSections, s => (next_ = { ...s, [key]: open }))
  await $.store.set(STORE_OPEN, next_)
  // The header just pressed is on screen, so revealing it moves nothing.
  await measurePane($, { key: `sec-${key}` })
}

// Band button or command: closed pane -> open it on that section; section showing -> fold it; folded -> unfold it.
async function showSection($: $T, key: PaneKey) {
  if (!(await isPaneOpen($))) {
    await setSection($, key, true)
    await openPane($)
    return
  }
  const open = (await read($, openSections))[key]
  await setSection($, key, !open)
}

// ---------- shared board ----------

let boardSeen = -1

async function boardPath($: $T): Promise<string> {
  return `${await homeDir($)}/${BOARD_FILE}`
}

const asList = (data: unknown): BoardItem[] => {
  const list = (data as { items?: unknown })?.items
  return Array.isArray(list) ? (list.filter(i => i && typeof i.id === 'string') as BoardItem[]) : []
}

async function readShared($: $T): Promise<BoardItem[] | undefined> {
  const path = await boardPath($)
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (!stat) return undefined
  boardSeen = stat.mtimeMs
  return asList(JSON.parse(await $.fs.read(path)))
}

/** Read the shared board fresh, change it, write it back, and show the result here. */
async function mutateBoard($: $T, fn: (list: BoardItem[]) => BoardItem[]) {
  let fresh: BoardItem[] | undefined
  try {
    fresh = await readShared($)
  } catch {
    fresh = undefined
  }
  const next_ = fn(fresh ?? (await read($, items)))
  await update($, items, () => next_)
  const path = await boardPath($)
  await $.fs.write(path, JSON.stringify({ v: 1, items: next_ }, null, 1))
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat) boardSeen = stat.mtimeMs
  await pruneAlerts($)
}

/** Picks up changes other sessions make to the shared board. */
async function watchBoard($: $T) {
  const check = async () => {
    try {
      const path = await boardPath($)
      const stat = await $.fs.stat(path).catch(() => undefined)
      if (!stat || stat.mtimeMs === boardSeen) return
      const list = await readShared($)
      if (list) {
        await update($, items, () => list)
        await pruneAlerts($)
      }
    } catch {
      // A half-written file: the next check reads it whole.
    }
  }
  $.clock.every(BOARD_EVERY_MS, () => void check())
  await check()
}

/** Items the board shows: this folder's (and older untagged ones), or all of them. */
async function visibleItems($: $T): Promise<BoardItem[]> {
  const list = await read($, items)
  if ((await read($, boardScope)) === 'all') return list
  const cwd = await read($, cwdAtom)
  return list.filter(i => !i.project || i.project === cwd)
}

// ---------- the board tool ----------

type BoardArgs = {
  action: 'add' | 'update' | 'remove' | 'clear'
  id?: string
  kind?: 'reply' | 'pending'
  section?: string
  title?: string
  context?: string
  reply?: string
}

const TOOL_DESCRIPTION = `Maintain the user's session board (a side pane they watch).
- When you ask the user a question or need a decision from them, add a "reply" item: title = the question in one line; context = a short background with the options and your recommendation; reply = the exact short text they could send to accept your recommendation (e.g. "rollout 1").
- When work is left open (waiting on CI, a follow-up, something the user must do), add a "pending" item with a short section name ("your action", "CI", "follow-ups").
- Use "update" to change an item, "remove" once it is resolved or answered, "clear" with kind to empty a whole kind.
Keep titles under ~90 characters. Do not mention the board to the user unless they ask.`

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['add', 'update', 'remove', 'clear'] },
    id: { type: 'string', description: 'Item id, for update/remove.' },
    kind: { type: 'string', enum: ['reply', 'pending'] },
    section: { type: 'string', description: 'Pending section name.' },
    title: { type: 'string' },
    context: { type: 'string' },
    reply: { type: 'string' },
  },
  required: ['action'],
}

async function applyBoard($: $T, args: BoardArgs): Promise<string> {
  const now = await $.clock.now()
  const cwd = await read($, cwdAtom)
  const session = await $.session.id()
  let message = ''
  let added: BoardItem | undefined
  await mutateBoard($, list => {
    switch (args.action) {
      case 'add': {
        if (!args.title) {
          message = 'add needs a title.'
          return list
        }
        const kind = args.kind ?? 'pending'
        const item: BoardItem = {
          id: newId(kind === 'reply' ? 'r' : 'p', list),
          kind,
          section: kind === 'reply' ? '' : (args.section ?? 'general').trim(),
          title: args.title,
          context: args.context,
          reply: args.reply,
          createdAt: now,
          updatedAt: now,
          project: cwd,
          session,
        }
        added = item
        message = `Added ${item.id}.`
        return [...list, item]
      }
      case 'update': {
        if (!list.some(i => i.id === args.id)) {
          message = `No item ${args.id}.`
          return list
        }
        message = `Updated ${args.id}.`
        return list.map(i =>
          i.id === args.id
            ? {
                ...i,
                section: args.section ?? i.section,
                title: args.title ?? i.title,
                context: args.context ?? i.context,
                reply: args.reply ?? i.reply,
                updatedAt: now,
              }
            : i,
        )
      }
      case 'remove': {
        message = list.some(i => i.id === args.id)
          ? `Removed ${args.id}.`
          : `No item ${args.id}.`
        return list.filter(i => i.id !== args.id)
      }
      case 'clear': {
        // Clears this folder's items only; other folders' items stay on the shared board.
        message = args.kind ? `Cleared this folder's ${args.kind} items.` : "Cleared this folder's board."
        const mine = (i: BoardItem) => !i.project || i.project === cwd
        return list.filter(i => !mine(i) || (args.kind ? i.kind !== args.kind : false))
      }
      default:
        message = `Unknown action ${String(args.action)}.`
        return list
    }
  })
  if (added?.kind === 'reply') $.ui.toast(`Needs reply: ${oneLine(added.title, 70)}`)
  const all = (await read($, items)).filter(i => !i.project || i.project === cwd)
  const summary = all.map(i => `${i.id} [${i.kind}] ${oneLine(i.title, 60)}`).join('; ')
  return `${message} Board now: ${summary || 'empty'}`
}

// ---------- board pane ----------
async function boardBody($: $T, e: any) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const L = await read($, look)
  const now = await $.clock.now()
  const list = await visibleItems($)
  const scope = await read($, boardScope)
  const cwd = await read($, cwdAtom)
  const home = await homeDir($)
  const where = (i: BoardItem) =>
    scope === 'all' && i.project && i.project !== cwd
      ? ` · ${home && i.project.startsWith(home) ? `~${i.project.slice(home.length)}` : i.project}`
      : ''
  const ctx = await read($, showContext)
  const replies = list.filter(i => i.kind === 'reply')
  const pending = list.filter(i => i.kind === 'pending')
  const sections = [...new Set(pending.map(i => i.section))]
  const remove = (id: string) => mutateBoard($, l => l.filter(i => i.id !== id))
  const recent = (await read($, asks)).slice(-3).reverse()
  const others = (await read($, sessions)).items
    .filter(r => r.recent.length > 0)
    .filter(r => scope === 'all' || r.project === cwd)
    .slice(0, OTHER_SESSIONS_ASKS)
  const thisName = (await read($, asks)).find(a => !a.question.startsWith('/'))?.question ?? ''
  const setScope = async (v: 'here' | 'all') => {
    await update($, boardScope, () => v)
    await $.store.set(STORE_SCOPE, v)
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2}>
        <Text {...dim(L)}>showing:</Text>
        <Button
          key="scope-here"
          plain
          variant={scope === 'here' ? 'primary' : undefined}
          label="this folder"
          onPress={() => setScope('here')}
        />
        <Button
          key="scope-all"
          plain
          variant={scope === 'all' ? 'primary' : undefined}
          label="all sessions"
          onPress={() => setScope('all')}
        />
      </Box>
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text color={L.accent} bold>
            Needs reply ({replies.length})
          </Text>
          <Button
            key="ctx-toggle"
            plain
            label={ctx ? 'hide context' : 'show context'}
            onPress={() => update($, showContext, v => !v)}
          />
        </Box>
        {replies.length === 0 && <Text {...dim(L)}>Nothing waiting on you.</Text>}
        {replies.map((it, n) => (
          <Box flexDirection="column" key={`reply-${it.id}`}>
            <Text>
              {n + 1}. {it.title}
            </Text>
            {ctx && it.context && <Text {...dim(L)}>   {it.context}</Text>}
            <Box flexDirection="row" gap={2}>
              <Text> </Text>
              {it.reply && (
                <Button
                  key={`fill-${it.id}`}
                  plain
                  variant="primary"
                  label={`reply "${oneLine(it.reply, 40)}"`}
                  onPress={() => $.prompt.fill({ text: it.reply!, mode: 'replace' })}
                />
              )}
              <Button key={`done-${it.id}`} plain label="done" onPress={() => remove(it.id)} />
            </Box>
          </Box>
        ))}
      </Box>

      {sections.map(sec => {
        const rows = pending.filter(i => i.section === sec)
        return (
          <Box flexDirection="column" key={`sec-${sec}`}>
            <Text color={L.accent} bold>
              Pending – {sec} ({rows.length})
            </Text>
            {rows.map((it, n) => {
              const stale = now - it.updatedAt > STALE_MS
              return (
                <Box flexDirection="row" gap={1} key={`pend-${it.id}`}>
                  <Box flexGrow={1}>
                    <Text dimColor={stale}>
                      {n + 1}. {it.title}
                      {stale ? ' (stale)' : ''}
                    </Text>
                  </Box>
                  <Button key={`pdone-${it.id}`} plain label="✓" onPress={() => remove(it.id)} />
                </Box>
              )
            })}
          </Box>
        )
      })}
      {pending.length === 0 && <Text {...dim(L)}>No pending items.</Text>}
      <Box flexDirection="column">
        <Text color={L.accent} bold>
          Recent asks
        </Text>
        <Text wrap="truncate-end" color={L.fg} bold>
          ◆ This session{thisName ? ` · ${oneLine(thisName, 60)}` : ''}
        </Text>
        {recent.length === 0 && <Text {...dim(L)}>  Nothing asked yet.</Text>}
        {recent.map(a => (
          <Text wrap="truncate-end" dimColor={a.answer !== undefined}>
            {'  '}
            {a.answer === undefined ? '… ' : ''}
            {oneLine(a.question, 200)}
          </Text>
        ))}
        {others.map(r => (
          <Box flexDirection="column" marginTop={1} key={`asks-${r.id}`}>
            <Text wrap="truncate-end">
              <Text color={L.accent} bold>
                ◇ {oneLine(r.name || '(unnamed session)', 60)}
              </Text>
              <Text {...dim(L)}> · {hhmm(r.at)}{r.project !== cwd ? ` · ${home && r.project.startsWith(home) ? `~${r.project.slice(home.length)}` : r.project}` : ''}</Text>
            </Text>
            {r.recent.map(q => (
              <Text wrap="truncate-end" {...dim(L)}>
                {'  '}
                {q}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
      <Text {...dim(L)}>updated {dayTime(now)}</Text>
    </Box>
  )
}

/** The one-click next step for a PR that needs work, as a prompt to fill in. */
export function prAction(p: Pr): { label: string; text: string } | undefined {
  const ref = `${p.repo}#${p.number} (${p.url})`
  if (p.status === 'red')
    return {
      label: 'fix CI',
      text: `Fix the failing CI on ${ref}. Failing checks: ${p.ci.failedNames.join(', ') || 'unknown'}.`,
    }
  if (p.status === 'attention')
    return {
      label: p.openThreads ? 'address threads' : 'address review',
      text: p.openThreads
        ? `Address the ${p.openThreads} open review thread${p.openThreads > 1 ? 's' : ''} on ${ref}.`
        : `Address the requested changes on ${ref}.`,
    }
  return undefined
}

/** A PR's second row: what's wrong first, then CI when it's a separate problem, then age. */
export function prStatusLine(p: Pr, now: number): string {
  const { passed, failed, running, skipped, failedNames } = p.ci
  const total = passed + failed + running + skipped
  const names = failedNames.slice(0, 2).join(', ') + (failedNames.length > 2 ? ` +${failedNames.length - 2}` : '')
  const ci = failed
    ? `CI red: ${names || `${failed} failed`}`
    : running
      ? `CI ${total - running}/${total}`
      : total
        ? 'CI green'
        : 'no checks'
  const parts =
    p.status === 'attention'
      ? [p.openThreads ? `${p.openThreads} thread${p.openThreads > 1 ? 's' : ''}` : 'changes requested', ci]
      : p.status === 'draft'
        ? ['draft', ci]
        : [ci]
  return [...parts, age(p.createdAt, now)].filter(Boolean).join(' · ')
}

/** Section order for the pane: sections that need you first, the rest as listed. */
export function paneOrder<K extends string>(keys: readonly K[], urgent: ReadonlySet<K>): K[] {
  return [...keys.filter(k => urgent.has(k)), ...keys.filter(k => !urgent.has(k))]
}

// ---------- PRs pane ----------
async function prsBody($: $T, e: any) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const L = await read($, look)
  const snap = await read($, prs)
  const now = await $.clock.now()
  const color = (s: Pr['status']) =>
    s === 'red' ? L.err : s === 'running' || s === 'attention' ? L.warn : L.ok
  const openUrl = (url: string) => $.process.run(['open', url])
  const full = snap.items.filter(p => p.status !== 'ready')
  const ready = snap.items.filter(p => p.status === 'ready')

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2}>
        <Text {...dim(L)}>
          {snap.updatedAt ? `updated ${hhmm(snap.updatedAt)}` : 'loading…'}
        </Text>
        <Button key="pr-refresh" plain label="refresh" onPress={() => refreshPrs($)} />
      </Box>
      {snap.error && <Text color={L.err}>{snap.error}</Text>}
      {snap.updatedAt > 0 && snap.items.length === 0 && (
        <Text {...dim(L)}>No open PRs authored by you.</Text>
      )}
      {full.map(p => {
        const act = prAction(p)
        return (
          <Box flexDirection="column" key={`pr-${p.repo}-${p.number}`}>
            <Button key={`open-${p.repo}-${p.number}`} plain onPress={() => openUrl(p.url)}>
              <Text wrap="truncate-end">
                <Text color={L.accent} bold>
                  #{p.number} {p.title}
                </Text>
                <Text {...dim(L)}> {p.repo.split('/').pop()}</Text>
              </Text>
            </Button>
            <Box flexDirection="row" gap={1}>
              <Box flexGrow={1}>
                <Text wrap="truncate-end" color={color(p.status)}>
                  {'  '}
                  {prStatusLine(p, now)}
                </Text>
              </Box>
              {act && (
                <Button
                  key={`pract-${p.repo}-${p.number}`}
                  plain
                  variant="primary"
                  label={act.label}
                  onPress={() => $.prompt.fill({ text: act.text, mode: 'replace' })}
                />
              )}
            </Box>
          </Box>
        )
      })}
      {ready.length > 0 && (
        <Box flexDirection="column">
          <Text color={L.ok} bold>
            Ready ({ready.length})
          </Text>
          {ready.map(p => (
            <Button key={`ready-${p.repo}-${p.number}`} plain onPress={() => openUrl(p.url)}>
              <Text color={L.ok}>✓</Text> #{p.number} {oneLine(p.title, 60)}{' '}
              <Text {...dim(L)}>{p.repo}</Text>
            </Button>
          ))}
        </Box>
      )}
      <Text {...dim(L)}>Click a PR to open it in the browser.</Text>
    </Box>
  )
}

// ---------- recall pane ----------
async function recallBody($: $T, e: any) {
  const { Box, Button, Text, Input, Markdown } = $.ui.resolve(e)
  const L = await read($, look)
  const index = await read($, recallIndex)
  const query = await read($, recallQuery)
  const pickId = await read($, recallPick)
  const picked = pickId ? index.find(a => a.id === pickId) : undefined
  const hits = search(index, query).slice(0, 30)

  return (
    <Box flexDirection="column" gap={1}>
      <Input
        key="recall-q"
        label="Find"
        placeholder='words, or "a phrase"'
        value={query}
        submitLabel="search"
        onSubmit={v => {
          void update($, recallPick, () => null)
          return update($, recallQuery, () => v)
        }}
      />
      {picked ? (
        <Box flexDirection="column" gap={1}>
          <Button key="recall-back" plain label="← back to list" onPress={() => update($, recallPick, () => null)} />
          <Text {...dim(L)}>{dayTime(picked.at)}</Text>
          <Text color={L.accent} bold>
            You asked
          </Text>
          <Text>{picked.question}</Text>
          <Text color={L.accent} bold>
            Answer
          </Text>
          <Markdown text={picked.answer ?? '(no answer recorded)'} />
        </Box>
      ) : (
        <Box flexDirection="column">
          {!query && (
            <Text {...dim(L)}>
              {index.length} saved question{index.length === 1 ? '' : 's'}. Type words to search.
            </Text>
          )}
          {query && (
            <Text {...dim(L)}>
              {hits.length} earlier question{hits.length === 1 ? '' : 's'} match "{query}"
            </Text>
          )}
          {hits.map(a => (
            <Button key={`hit-${a.id}`} plain onPress={() => update($, recallPick, () => a.id)}>
              <Text {...dim(L)}>{dayTime(a.at)}</Text> {oneLine(a.question, 90)}
            </Button>
          ))}
          {query && hits.length > 0 && (
            <Text {...dim(L)}>Picking a question shows it with the reply it got.</Text>
          )}
        </Box>
      )}
    </Box>
  )
}

// ---------- sessions pane ----------
async function sessionsBody($: $T, e: any) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const L = await read($, look)
  const snap = await read($, sessions)
  const cps = await allCheckpoints($)
  const mine = latestFor(cps, await $.session.id())
  const cwd = await $.session.cwd()
  const home = await homeDir($)
  const short = (p: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p)
  const day = dayTime(await $.clock.now()).slice(0, 10)
  const when = (ms: number) => (dayTime(ms).slice(0, 10) === day ? hhmm(ms) : dayTime(ms).slice(5))

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        <Text {...dim(L)}>{snap.updatedAt ? `updated ${hhmm(snap.updatedAt)}` : 'loading…'}</Text>
        <Button key="sessions-refresh" plain label="refresh" onPress={() => refreshSessions($)} />
        <Button
          key="checkpoint-now"
          plain
          variant="primary"
          label="checkpoint"
          onPress={() => $.prompt.fill({ text: CHECKPOINT_ASK, mode: 'replace' })}
        />
      </Box>
      {mine && (
        <Text wrap="truncate-end">
          <Text color={L.ok}>✓ this session</Text> <Text {...dim(L)}>{hhmm(mine.at)}</Text> {mine.note}
        </Text>
      )}
      {snap.error && <Text color={L.err}>{snap.error}</Text>}
      {snap.updatedAt > 0 && snap.items.length === 0 && <Text {...dim(L)}>No earlier sessions.</Text>}
      {snap.items.map(r => {
        const here = r.project === cwd
        const shell = `cd ${shellQuote(r.project)} && claude --resume ${r.id}`
        const cp = latestFor(cps, r.id)
        const go = cp ? `resume: ${cp.note}` : ''
        const goShell = cp ? `cd ${shellQuote(r.project)} && claude ${shellQuote(go)}` : ''
        return (
          <Box flexDirection="column" key={`sess-${r.id}`}>
            <Text wrap="truncate-end">
              <Text {...dim(L)}>{when(r.at)}</Text> {r.last || '(no message)'}
            </Text>
            {cp && (
              <Text wrap="truncate-end">
                {'  '}
                <Text color={L.ok}>✓</Text> {cp.note}
              </Text>
            )}
            <Box flexDirection="row" gap={2}>
              <Text {...dim(L)}>
                {'  '}
                {short(r.project)} · {r.prompts} msg
              </Text>
              {here && (
                <Button
                  key={`resume-${r.id}`}
                  plain
                  variant="primary"
                  label="resume"
                  onPress={() => $.prompt.fill({ text: `/resume ${r.id}`, mode: 'replace' })}
                />
              )}
              {cp && (
                <Button
                  key={`continue-${r.id}`}
                  plain
                  variant="primary"
                  label="continue"
                  onPress={async press => {
                    if (here) return void (await $.prompt.fill({ text: go, mode: 'replace' }))
                    const done = await $.ui.copy({ text: goShell, surface: press.surface })
                    $.ui.toast(done.isCopied ? 'Copied: paste it in a terminal to continue' : `Copy failed: ${done.reason}`)
                  }}
                />
              )}
              <Button
                key={`copy-${r.id}`}
                plain
                label="copy cmd"
                onPress={async press => {
                  const done = await $.ui.copy({ text: shell, surface: press.surface })
                  $.ui.toast(done.isCopied ? 'Copied: paste it in a terminal to resume' : `Copy failed: ${done.reason}`)
                }}
              />
            </Box>
          </Box>
        )
      })}
      <Text {...dim(L)}>
        resume reopens a session; continue starts fresh from its checkpoint; copy cmd works from any folder.
      </Text>
    </Box>
  )
}

// ---------- to-do autopilot context ----------
async function pilotContext($: $T) {
  const cwd = await read($, cwdAtom)
  const openReplies = (await read($, items)).filter(
    i => i.kind === 'reply' && (!i.project || i.project === cwd),
  ).length
  return { cwd, openReplies, usageBlock: await usageBlockReason($) }
}

/** Once a turn ends: chime and notify for each needs-reply item this session raised and hasn't alerted. */
async function alertNeedsYou($: $T) {
  const cwd = await read($, cwdAtom)
  const me = await $.session.id()
  for (const it of await read($, items)) {
    if (it.kind !== 'reply' || it.session !== me || (it.project && it.project !== cwd)) continue
    await alert($, `reply-${it.id}`, `Finished, needs your reply: ${oneLine(it.title, 70)}`)
  }
}

/** Alerts about board items that no longer exist are dropped. */
async function pruneAlerts($: $T) {
  await pruneBoardAlerts($, new Set((await read($, items)).map(i => i.id)))
}

// ---------- periodic checks ----------
async function tick($: $T) {
  await loadTodos($)
  await refreshUsage($)
  await refreshGit($)
  const now = await $.clock.now()
  const cwd = await read($, cwdAtom)
  for (const it of await read($, items)) {
    if (it.kind !== 'reply' || (it.project && it.project !== cwd)) continue
    if (now - it.createdAt > REPLY_WAIT_MS)
      await alert($, `wait-${it.id}`, `Still waiting on you: ${oneLine(it.title, 60)}`)
  }
}

// ---------- register ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = (await $.store.get(STORE_RECALL)) as Ask[] | undefined
    if (Array.isArray(stored)) await update($, recallIndex, () => stored)

    await $.tool.register({
      name: TOOL,
      description: TOOL_DESCRIPTION,
      inputSchema: TOOL_SCHEMA,
      isDeferred: false,
    })
    await $.command.register({ name: 'operator', description: 'Open or close the operator pane' })
    await $.command.register({ name: 'board', description: 'Show or fold the board section' })
    await $.command.register({ name: 'sessions', description: 'Show or fold earlier sessions to resume' })
    await $.command.register({ name: 'prs', description: 'Show or fold the PRs section (refreshes)' })
    await $.command.register({
      name: 'recall',
      description: 'Search earlier questions and answers',
      argumentHint: '[words or "a phrase"]',
    })

    await update($, cwdAtom, () => e.cwd)
    await restoreAlerts($)
    await restoreTimeFmt($)
    await loadCheckpoints($)
    await loadQuick($)
    await loadTodos($)
    await $.tool.register({ name: TODO_TOOL, description: TODO_TOOL_DESCRIPTION, inputSchema: TODO_TOOL_SCHEMA, isDeferred: false })
    await $.tool.register({
      name: CP_TOOL,
      description:
        "Save a checkpoint for this session on the user's operator board: one or two lines on where things stand and the next step. Use it when the user asks for a checkpoint, says they are stopping, or a sprint or gate closes. The user can later start a new session from it.",
      inputSchema: {
        type: 'object',
        properties: { note: { type: 'string', description: 'Where things stand and the next step.' } },
        required: ['note'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'savepoint', description: 'Save a checkpoint of this session (Sessions can continue from it)', argumentHint: '[note]' })
    await $.command.register({ name: 'quick', description: 'Pin a quick prompt', argumentHint: '<prompt text>' })
    await $.command.register({ name: 'alerts', description: 'Turn operator alerts on or off', argumentHint: '[on|off]' })
    $.clock.every(TICK_MS, () => void tick($))
    void refreshUsage($)
    void refreshGit($)
    const scope = await $.store.get(STORE_SCOPE)
    if (scope === 'here' || scope === 'all') await update($, boardScope, () => scope)
    await watchBoard($)
    await watchLook($, l => update($, look, () => l))
    $.clock.every(PR_EVERY_MS, () => void refreshPrs($))
    void refreshPrs($)
    void refreshSessions($)

    // Open the operator pane for every new session; it docks right in a wide fullscreen terminal.
    const folds = (await $.store.get(STORE_OPEN)) as Record<PaneKey, boolean> | undefined
    if (folds && typeof folds === 'object') await update($, openSections, () => ({ ...DEFAULT_OPEN, ...folds }))
    const opened = await openPane($)
    if (!opened.isPlaced) $.ui.log(`operator-board: pane not opened: ${opened.reason}`)

    return next(e)
  })

  // Board tool, answered by the mod.
  on('tool.call', { tool: TOOL_FULL }, async ($, e) => {
    const text = await applyBoard($, e as unknown as BoardArgs)
    return { result: text }
  })

  // Commands.
  on('command.run', { command: 'operator' }, async $ => {
    if (await isPaneOpen($)) {
      await $.ui.close({ id: PANE.id })
      return { text: 'Closed the operator pane.' }
    }
    await openPane($)
    return { text: 'Opened the operator pane.' }
  })
  on('tool.call', { tool: 'mcp__operator-board__todo_update' }, async ($, e) => {
    const text = await applyTodoTool($, e as unknown as { action: string }, await read($, cwdAtom))
    return { result: text }
  })

  on('tool.call', { tool: 'mcp__operator-board__checkpoint_save' }, async ($, e) => {
    const note = String((e as unknown as { note?: string }).note ?? '').trim()
    if (!note) return { result: 'checkpoint_save needs a note.' }
    const cp = await saveCheckpoint($, note)
    $.ui.toast(`Checkpoint saved: ${oneLine(cp.note, 60)}`)
    return { result: `Saved checkpoint ${cp.id}.` }
  })

  on('command.run', { command: 'savepoint' }, async ($, e) => {
    const note = e.args.trim()
    if (!note) {
      await $.prompt.fill({ text: CHECKPOINT_ASK, mode: 'replace' })
      return { text: 'Press Enter and Claude will write the checkpoint.' }
    }
    await saveCheckpoint($, note)
    return { text: `Checkpoint saved: ${oneLine(note, 80)}` }
  })
  on('command.run', { command: 'quick' }, async ($, e) => {
    if (!e.args.trim()) {
      await setSection($, 'quick', true)
      await openPane($)
      return { text: 'Quick prompts opened.' }
    }
    await pinQuick($, e.args)
    return { text: `Pinned: ${oneLine(e.args, 80)}` }
  })
  on('command.run', { command: 'alerts' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const on_ = await toggleAlerts($, arg === 'on' ? true : arg === 'off' ? false : undefined)
    return { text: `Operator alerts ${on_ ? 'on' : 'off'}.` }
  })

  // A last usage reading when the session ends.
  on('session.end', async ($, e, next) => {
    try {
      await refreshUsage($)
      await logUsage($, 'end')
    } catch {
      // Ending anyway.
    }
    return next(e)
  })

  on('command.run', { command: 'board' }, async $ => {
    await showSection($, 'board')
    return { text: 'Toggled the board section.' }
  })
  on('command.run', { command: 'sessions' }, async $ => {
    void refreshSessions($)
    await showSection($, 'sessions')
    return { text: 'Toggled the sessions section.' }
  })
  on('command.run', { command: 'prs' }, async $ => {
    void refreshPrs($)
    await showSection($, 'prs')
    return { text: 'Toggled the PRs section.' }
  })
  on('command.run', { command: 'recall' }, async ($, e) => {
    const q = e.args.trim()
    if (q) {
      await update($, recallQuery, () => q)
      await update($, recallPick, () => null)
    }
    await setSection($, 'recall', true)
    await openPane($)
    return { text: q ? `Recall: searching "${q}".` : 'Recall opened.' }
  })

  // Capture questions, and tell Claude which needs-reply items are open.
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !e.text.trim()) return next(e)
    const now = await $.clock.now()
    await update($, asks, list =>
      [...list, { id: `a${now}`, at: now, question: e.text.trim() }].slice(-50),
    )
    const cwd = await read($, cwdAtom)
    const open = (await read($, items)).filter(
      i => i.kind === 'reply' && (!i.project || i.project === cwd),
    )
    if (open.length === 0) return next(e)
    const note = `[operator-board] Open needs-reply items: ${open
      .map(i => `${i.id} "${oneLine(i.title, 80)}"`)
      .join('; ')}. If this message answers one, remove it with ${TOOL}.`
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  // Pair the main thread's answer with the question, and save it for recall.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId || e.isAborted || !e.answer.trim()) return done
    const answer = e.answer.trim().slice(0, ANSWER_CAP)
    let paired: Ask | undefined
    await update($, asks, list => {
      const idx = list.map(a => a.answer === undefined).lastIndexOf(true)
      const open = list[idx]
      if (!open) return list
      const done: Ask = { ...open, answer }
      paired = done
      return list.map((a, i) => (i === idx ? done : a))
    })
    if (paired) {
      const entry = paired
      const next_ = [...(await read($, recallIndex)).filter(a => a.id !== entry.id), entry].slice(
        -RECALL_CAP,
      )
      await update($, recallIndex, () => next_)
      await $.store.set(STORE_RECALL, next_)
    }
    const snap = await read($, prs)
    if ((await $.clock.now()) - snap.updatedAt > 60000) void refreshPrs($)
    if ((await $.clock.now()) - (await read($, sessions)).updatedAt > 60000) void refreshSessions($)
    void refreshUsage($)
    void refreshGit($)
    await alertNeedsYou($)
    await autopilotAfterTurn($, await pilotContext($))
    return done
  })

  // ---------- band ----------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const L = await read($, look)
    const list = await visibleItems($)
    const replies = list.filter(i => i.kind === 'reply').length
    const snap = await read($, prs)
    const red = snap.items.filter(p => p.status === 'red').length
    const prLabel = `PRs (${snap.items.length}${red ? `, ${red} red` : ''})`
    const alertsN = await alertCount($)
    // Opened at session start but held back undrawn (terminal under Claude Code's width floor
    // for a pane opened on its own): one press opens it, since a press is the person asking.
    const isHeld = (await $.ui.panes()).some(p => p.id === PANE.id && !p.isPlaced)
    return (
      <Box flexDirection="row" gap={2}>
        {isHeld && (
          <Button key="band-show-pane" plain variant="primary" label="▸ show operator pane" onPress={() => openPane($)} />
        )}
        <Button
          key="band-board"
          plain
          variant={replies ? 'primary' : undefined}
          label={replies ? `board (${replies} need reply)` : 'board'}
          onPress={() => showSection($, 'board')}
        />
        <Button key="band-recall" plain label="recall" onPress={() => showSection($, 'recall')} />
        <Button
          key="band-prs"
          plain
          label={prLabel}
          onPress={() => {
            void refreshPrs($)
            return showSection($, 'prs')
          }}
        />
        {red > 0 && <Text color={L.err}>●</Text>}
        {alertsN > 0 && (
          <Button
            key="band-alerts"
            plain
            variant="primary"
            label={`● ${alertsN} alert${alertsN > 1 ? 's' : ''}`}
            onPress={async () => {
              if (!(await isPaneOpen($))) await openPane($)
            }}
          />
        )}
      </Box>
    )
  })

  // ---------- the operator pane: every section in one place ----------
  on('ui.scroll', { component: 'Pane', requestId: PANE.id }, async ($, e, next) => {
    await recordScroll($, e.contentRows).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE.id }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const L = await read($, look)
    const open = await read($, openSections)
    const list = await visibleItems($)
    const replies = list.filter(i => i.kind === 'reply').length
    const snap = await read($, prs)
    const red = snap.items.filter(p => p.status === 'red').length
    const pendingN = list.filter(i => i.kind === 'pending').length
    const sessN = (await read($, sessions)).items.length
    const recallN = (await read($, recallIndex)).length
    const level = await usageLevel($)
    const counts: Record<PaneKey, string> = {
      board:
        replies || pendingN
          ? ` (${[replies && `${replies} need reply`, pendingN && `${pendingN} pending`].filter(Boolean).join(', ')})`
          : '',
      todo: await todoCount($, await read($, cwdAtom)),
      usage: await usageSummary($),
      git: await gitSummary($),
      sessions: sessN ? ` (${sessN})` : '',
      quick: await quickSummary($),
      prs: ` (${snap.items.length}${red ? `, ${red} red` : ''})`,
      recall: recallN ? ` (${recallN} saved)` : '',
    }
    const headColor = (k: PaneKey) =>
      (k === 'prs' && red) || (k === 'usage' && level === 'stop')
        ? L.err
        : (k === 'board' && replies) || (k === 'usage' && level === 'warn')
          ? L.warn
          : L.accent
    // Sections that need you (a reply waiting, red CI, usage at your limits) come first.
    const urgent = new Set<PaneKey>()
    if (replies) urgent.add('board')
    if (red) urgent.add('prs')
    if (level) urgent.add('usage')
    const keys = paneOrder(Object.keys(SECTIONS) as PaneKey[], urgent)
    const rendered: Record<PaneKey, unknown> = {
      board: open.board ? await boardBody($, e) : null,
      todo: open.todo ? await todoBody($, e, L, await pilotContext($)) : null,
      usage: open.usage ? await usageBody($, e, L) : null,
      git: open.git ? await gitBody($, e, L) : null,
      sessions: open.sessions ? await sessionsBody($, e) : null,
      quick: open.quick ? await quickBody($, e, L) : null,
      prs: open.prs ? await prsBody($, e) : null,
      recall: open.recall ? await recallBody($, e) : null,
    }
    return (
      <Box flexDirection="column" gap={1} paddingRight={1}>
        {await scrollbarColumn($, e, L)}
        {await alertsStrip($, e, L)}
        {keys.map(k => (
          <Box flexDirection="column" key={`section-${k}`}>
            <Button key={`sec-${k}`} plain onPress={() => setSection($, k, !open[k])}>
              <Text wrap="truncate-end" color={headColor(k)} bold>
                {open[k] ? '▾' : '▸'} {SECTIONS[k]}
                {counts[k]}
              </Text>
            </Button>
            {rendered[k] as any}
          </Box>
        ))}
      </Box>
    )
  })
}
