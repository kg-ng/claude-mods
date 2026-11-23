import { atom, read, update } from 'claude-code'

import type { Ask, BoardItem, Look } from '../types'
import { alert, pruneBoardAlerts, usageBlockReason } from './extras'
import { dim } from './look'
import { sessionRows } from './sessions'
import { dayTime, hhmm, homeDir, newId, oneLine } from './util'
import type { $T } from './util'
import { registry } from '../../../core/registry.js'

/**
 * The board every session shares (needs reply, pending), the board_update tool Claude keeps it
 * with, the asks typed in this session, and the Board section.
 */
const P = 'operator-board'
export const TOOL = 'board_update'
export const TOOL_FULL = `mcp__${P}__${TOOL}`
const ANSWER_CAP = 4000
const STALE_MS = 24 * 60 * 60 * 1000
const REPLY_WAIT_MS = 30 * 60 * 1000
const STORE_SCOPE = 'scope-v1'
// The board every session shares: one file, polled for changes.
const BOARD_FILE = '.claude/operator-board/board.json'
const BOARD_EVERY_MS = 2000
// Earlier sessions listed under Recent asks, each with its last three asks.
const OTHER_SESSIONS_ASKS = 3

// Change a shape tag when that value's fields change.
const asks = atom({ plugin: 'operator-board', key: 'asks' } as const, [], { shape: 'asks-1' })
const items = atom({ plugin: 'operator-board', key: 'items' } as const, [], { shape: 'items-1' })
const showContext = atom({ plugin: 'operator-board', key: 'showContext' } as const, true)
const boardScope = atom({ plugin: 'operator-board', key: 'boardScope' } as const, 'here')
const cwdAtom = atom({ plugin: 'operator-board', key: 'cwd' } as const, '')
const devMode = atom({ plugin: 'operator-board', key: 'devMode' } as const, false, { shape: 'devMode' })

// ---------- this session's folder and the board's scope ----------

export async function setCwd($: $T, cwd: string) {
  await update($, cwdAtom, () => cwd)
}

export async function getCwd($: $T): Promise<string> {
  return read($, cwdAtom)
}

/** The "this folder" / "all sessions" choice, as last picked. */
export async function restoreScope($: $T) {
  const scope = await $.store.get(STORE_SCOPE)
  if (scope === 'here' || scope === 'all') await update($, boardScope, () => scope)
}

/** What the band and the pane header count: replies and pending items in view. */
export async function boardStats($: $T) {
  const list = await visibleItems($)
  return {
    replies: list.filter(i => i.kind === 'reply').length,
    pending: list.filter(i => i.kind === 'pending').length,
  }
}

// ---------- asks ----------

/**
 * Records a question typed in this session, and returns a note for Claude naming the folder's
 * open needs-reply items (so an answer to one gets it removed), or undefined when none are open.
 */
export async function recordAsk($: $T, text: string): Promise<string | undefined> {
  const now = await $.clock.now()
  await update($, asks, list => [...list, { id: `a${now}`, at: now, question: text }].slice(-50))
  const cwd = await read($, cwdAtom)
  const open = (await read($, items)).filter(i => i.kind === 'reply' && (!i.project || i.project === cwd))
  if (open.length === 0) return undefined
  return `[operator-board] Open needs-reply items: ${open
    .map(i => `${i.id} "${oneLine(i.title, 80)}"`)
    .join('; ')}. If this message answers one, remove it with ${TOOL}.`
}

/** Pairs the main thread's answer with the latest unanswered ask; returns the pair, if any. */
export async function pairAnswer($: $T, answerText: string): Promise<Ask | undefined> {
  const answer = answerText.slice(0, ANSWER_CAP)
  let paired: Ask | undefined
  await update($, asks, list => {
    const idx = list.map(a => a.answer === undefined).lastIndexOf(true)
    const open = list[idx]
    if (!open) return list
    const done: Ask = { ...open, answer }
    paired = done
    return list.map((a, i) => (i === idx ? done : a))
  })
  return paired
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
export async function mutateBoard($: $T, fn: (list: BoardItem[]) => BoardItem[]) {
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
export async function watchBoard($: $T) {
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
export async function visibleItems($: $T): Promise<BoardItem[]> {
  const list = await read($, items)
  if ((await read($, boardScope)) === 'all') return list
  const cwd = await read($, cwdAtom)
  return list.filter(i => !i.project || i.project === cwd)
}

// ---------- the board tool ----------

export type BoardArgs = {
  action: 'add' | 'update' | 'remove' | 'clear'
  id?: string
  kind?: 'reply' | 'pending'
  section?: string
  title?: string
  context?: string
  reply?: string
}

export const TOOL_DESCRIPTION = `Maintain the user's session board (a side pane they watch).
- When you ask the user a question or need a decision from them, add a "reply" item: title = the question in one line; context = a short background with the options and your recommendation; reply = the exact short text they could send to accept your recommendation (e.g. "rollout 1").
- When work is left open (waiting on CI, a follow-up, something the user must do), add a "pending" item with a short section name ("your action", "CI", "follow-ups").
- Use "update" to change an item, "remove" once it is resolved or answered, "clear" with kind to empty a whole kind.
Keep titles under ~90 characters. Do not mention the board to the user unless they ask.`

export const TOOL_SCHEMA = {
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

export async function applyBoard($: $T, args: BoardArgs): Promise<string> {
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

// ---------- alerts and the to-do autopilot ----------

export async function pilotContext($: $T) {
  const cwd = await read($, cwdAtom)
  const openReplies = (await read($, items)).filter(
    i => i.kind === 'reply' && (!i.project || i.project === cwd),
  ).length
  return { cwd, openReplies, usageBlock: await usageBlockReason($) }
}

/** Once a turn ends: chime and notify for each needs-reply item this session raised and hasn't alerted. */
export async function alertNeedsYou($: $T) {
  const cwd = await read($, cwdAtom)
  const me = await $.session.id()
  for (const it of await read($, items)) {
    if (it.kind !== 'reply' || (it.project && it.project !== cwd)) continue
    await alert($, `reply-${it.id}`, `Finished, needs your reply: ${oneLine(it.title, 70)}`)
  }
}

/** Alerts about board items that no longer exist are dropped. */
async function pruneAlerts($: $T) {
  await pruneBoardAlerts($, new Set((await read($, items)).map(i => i.id)))
}

/** Every minute: a reminder for each of this folder's replies left waiting over half an hour. */
export async function waitAlerts($: $T) {
  const now = await $.clock.now()
  const cwd = await read($, cwdAtom)
  for (const it of await read($, items)) {
    if (it.kind !== 'reply' || (it.project && it.project !== cwd)) continue
    if (now - it.createdAt > REPLY_WAIT_MS)
      await alert($, `wait-${it.id}`, `Still waiting on you: ${oneLine(it.title, 60)}`)
  }
}

// ---------- the section ----------

export async function boardBody($: $T, e: any, L: Look) {
  const { Box, Button, Text } = $.ui.resolve(e)
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
  const others = (await sessionRows($))
    .filter(r => r.recent.length > 0)
    .filter(r => scope === 'all' || r.project === cwd)
    .slice(0, OTHER_SESSIONS_ASKS)
  const thisName = (await read($, asks)).find(a => !a.question.startsWith('/'))?.question ?? ''
  const setScope = async (v: 'here' | 'all') as Promise<void> => {
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
        <Button
          key="dev-mode-toggle"
          plain
          variant={devMode ? 'primary' : undefined}
          label={devMode ? 'Dev Mode ON' : 'Dev Mode'}
          onPress={() => update($, devMode, v => !v)}
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
      {devMode && (
        <Box flexDirection="column" marginTop={1} key={`dev-info`}>
          <Text color={L.accent} bold>Dev Info</Text>
          <Text {...dim(L)}>
            Registry: {registry.listMods().map(m => `${m.id} (${m.version})`).join(', ')}
          </Text>
        </Box>
      )}
import { registry } from '../../../core/registry.js'

/**
 * The board every session shares (needs reply, pending), the board_update tool Claude keeps it
 * with, the asks typed in this session, and the Board section.
 * ...

/**
 * The board every session shares (needs reply, pending), the board_update tool Claude keeps it
 * with, the asks typed in this session, and the Board section.
 */
const P = 'operator-board'
export const TOOL = 'board_update'
export const TOOL_FULL = `mcp__${P}__${TOOL}`
const ANSWER_CAP = 4000
const STALE_MS = 24 * 60 * 60 * 1000
const REPLY_WAIT_MS = 30 * 60 * 1000
const STORE_SCOPE = 'scope-v1'
// The board every session shares: one file, polled for changes.
const BOARD_FILE = '.claude/operator-board/board.json'
const BOARD_EVERY_MS = 2000
// Earlier sessions listed under Recent asks, each with its last three asks.
const OTHER_SESSIONS_ASKS = 3

// Change a shape tag when that value's fields change.
const asks = atom({ plugin: 'operator-board', key: 'asks' } as const, [], { shape: 'asks-1' })
const items = atom({ plugin: 'operator-board', key: 'items' } as const, [], { shape: 'items-1' })
const showContext = atom({ plugin: 'operator-board', key: 'showContext' } as const, true)
const boardScope = atom({ plugin: 'operator-board', key: 'boardScope' } as const, 'here')
const cwdAtom = atom({ plugin: 'operator-board', key: 'cwd' } as const, '')

// ---------- this session's folder and the board's scope ----------

export async function setCwd($: $T, cwd: string) {
  await update($, cwdAtom, () => cwd)
}

export async function getCwd($: $T): Promise<string> {
  return read($, cwdAtom)
}

/** The "this folder" / "all sessions" choice, as last picked. */
export async function restoreScope($: $T) {
  const scope = await $.store.get(STORE_SCOPE)
  if (scope === 'here' || scope === 'all') await update($, boardScope, () => scope)
}

/** What the band and the pane header count: replies and pending items in view. */
export async function boardStats($: $T) {
  const list = await visibleItems($)
  return {
    replies: list.filter(i => i.kind === 'reply').length,
    pending: list.filter(i => i.kind === 'pending').length,
  }
}

// ---------- asks ----------

/**
 * Records a question typed in this session, and returns a note for Claude naming the folder's
 * open needs-reply items (so an answer to one gets it removed), or undefined when none are open.
 */
export async function recordAsk($: $T, text: string): Promise<string | undefined> {
  const now = await $.clock.now()
  await update($, asks, list => [...list, { id: `a${now}`, at: now, question: text }].slice(-50))
  const cwd = await read($, cwdAtom)
  const open = (await read($, items)).filter(i => i.kind === 'reply' && (!i.project || i.project === cwd))
  if (open.length === 0) return undefined
  return `[operator-board] Open needs-reply items: ${open
    .map(i => `${i.id} "${oneLine(i.title, 80)}"`)
    .join('; ')}. If this message answers one, remove it with ${TOOL}.`
}

/** Pairs the main thread's answer with the latest unanswered ask; returns the pair, if any. */
export async function pairAnswer($: $T, answerText: string): Promise<Ask | undefined> {
  const answer = answerText.slice(0, ANSWER_CAP)
  let paired: Ask | undefined
  await update($, asks, list => {
    const idx = list.map(a => a.answer === undefined).lastIndexOf(true)
    const open = list[idx]
    if (!open) return list
    const done: Ask = { ...open, answer }
    paired = done
    return list.map((a, i) => (i === idx ? done : a))
  })
  return paired
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
export async function mutateBoard($: $T, fn: (list: BoardItem[]) => BoardItem[]) {
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
export async function watchBoard($: $T) {
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
export async function visibleItems($: $T): Promise<BoardItem[]> {
  const list = await read($, items)
  if ((await read($, boardScope)) === 'all') return list
  const cwd = await read($, cwdAtom)
  return list.filter(i => !i.project || i.project === cwd)
}

// ---------- the board tool ----------

export type BoardArgs = {
  action: 'add' | 'update' | 'remove' | 'clear'
  id?: string
  kind?: 'reply' | 'pending'
  section?: string
  title?: string
  context?: string
  reply?: string
}

export const TOOL_DESCRIPTION = `Maintain the user's session board (a side pane they watch).
- When you ask the user a question or need a decision from them, add a "reply" item: title = the question in one line; context = a short background with the options and your recommendation; reply = the exact short text they could send to accept your recommendation (e.g. "rollout 1").
- When work is left open (waiting on CI, a follow-up, something the user must do), add a "pending" item with a short section name ("your action", "CI", "follow-ups").
- Use "update" to change an item, "remove" once it is resolved or answered, "clear" with kind to empty a whole kind.
Keep titles under ~90 characters. Do not mention the board to the user unless they ask.`

export const TOOL_SCHEMA = {
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

export async function applyBoard($: $T, args: BoardArgs): Promise<string> {
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

// ---------- alerts and the to-do autopilot ----------

export async function pilotContext($: $T) {
  const cwd = await read($, cwdAtom)
  const openReplies = (await read($, items)).filter(
    i => i.kind === 'reply' && (!i.project || i.project === cwd),
  ).length
  return { cwd, openReplies, usageBlock: await usageBlockReason($) }
}

/** Once a turn ends: chime and notify for each needs-reply item this session raised and hasn't alerted. */
export async function alertNeedsYou($: $T) {
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

/** Every minute: a reminder for each of this folder's replies left waiting over half an hour. */
export async function waitAlerts($: $T) {
  const now = await $.clock.now()
  const cwd = await read($, cwdAtom)
  for (const it of await read($, items)) {
    if (it.kind !== 'reply' || (it.project && it.project !== cwd)) continue
    if (now - it.createdAt > REPLY_WAIT_MS)
      await alert($, `wait-${it.id}`, `Still waiting on you: ${oneLine(it.title, 60)}`)
  }
}

// ---------- the section ----------
export async function boardBody($: $T, e: any, L: Look) {
  const { Box, Button, Text } = $.ui.resolve(e)
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
  const others = (await sessionRows($))
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
        <Button
          key="dev-mode-toggle"
          plain
          variant={devMode ? 'primary' : undefined}
          label={devMode ? 'Dev Mode ON' : 'Dev Mode'}
          onPress={() => update($, devMode, v => !v)}
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
          <Box flexDirection="column" marginTop={1} key={`mods-section`}>
            <Text color={L.accent} bold>
              Registered Mods
            </Text>
            {registry.listMods().map(m => (
              <Text key={m.id} {...dim(L)}>
                {m.name} ({m.version}) - {m.type}
              </Text>
            ))}
          </Box>
        }
      </Box>
    </Box>
  )
}

