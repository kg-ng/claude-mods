// The operator board's shared files, read and written the same way the Claude Code mod does,
// so to-dos, board items and checkpoints are shared between Claude Code and Copilot CLI.
//   ~/.claude/operator-board/todos.json        { v: 1, lists: {}, items: Todo[] }
//   ~/.claude/operator-board/board.json        { v: 1, items: BoardItem[] }
//   ~/.claude/operator-board/checkpoints.json  { v: 1, items: Checkpoint[] }
// Every function takes the folder the files live in, so tests can point it at a temp folder.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const defaultDir = () => join(process.env.HOME || homedir(), '.claude', 'operator-board')

const CHECKPOINT_CAP = 200

export const oneLine = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function readJson(dir, name) {
  try {
    return JSON.parse(readFileSync(join(dir, name), 'utf8'))
  } catch {
    return undefined
  }
}

// Written to a temp file and renamed, so the other tool never reads half a file.
function writeJson(dir, name, data) {
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.${name}.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(data, null, 1))
  renameSync(tmp, join(dir, name))
}

const nextId = (prefix, taken) => {
  let n = taken.length + 1
  while (taken.some(i => i.id === `${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

// ---------- to-dos ----------

export function readTodos(dir) {
  const x = readJson(dir, 'todos.json')
  return {
    v: 1,
    lists: x?.lists && typeof x.lists === 'object' ? x.lists : {},
    items: Array.isArray(x?.items) ? x.items.filter(i => i && typeof i.id === 'string') : [],
  }
}

export const TODO_DESCRIPTION = `Keep the user's to-do list for this project folder (shown on their operator board, shared by every session in the folder, in Copilot CLI and Claude Code).
- "add": an item you think should be done (title, optional detail). It waits as proposed until the user approves it.
- "start": mark an item as doing before you work on it.
- "done": only when it is really finished, with a one-line note on how you know (tests pass, PR #n merged, checked in the browser).
- "update" (title/detail), "remove", "list".
Work on the user's items in order. Do not mention the list unless the user asks.`

export const TODO_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['add', 'start', 'done', 'update', 'remove', 'list'] },
    id: { type: 'string' },
    title: { type: 'string' },
    detail: { type: 'string' },
    note: { type: 'string', description: 'For done: how you know it is finished.' },
  },
  required: ['action'],
}

/** Applies one todo_update call and returns the message for the model. */
export function applyTodo(dir, args, ctx) {
  const { cwd, session, now = Date.now() } = ctx
  const f = readTodos(dir)
  const it = args.id ? f.items.find(i => i.id === args.id && i.project === cwd) : undefined
  let msg = ''
  let changed = false
  const ok = m => ((msg = m), (changed = true))
  switch (args.action) {
    case 'add': {
      if (!args.title?.trim()) {
        msg = 'add needs a title.'
        break
      }
      const id = nextId('t', f.items)
      f.items.push({
        id,
        project: cwd,
        title: oneLine(args.title, 120),
        detail: args.detail?.slice(0, 600),
        status: 'proposed',
        by: 'claude',
        createdAt: now,
        updatedAt: now,
        source: 'copilot',
      })
      ok(`Added ${id} as proposed; the user approves it before it can start.`)
      break
    }
    case 'start':
      if (!it) msg = `No item ${args.id}.`
      else if (it.status === 'proposed') msg = `${it.id} is still proposed; the user has to approve it first.`
      else {
        it.status = 'doing'
        it.session = session
        it.updatedAt = now
        ok(`${it.id} is doing.`)
      }
      break
    case 'done':
      if (!it) msg = `No item ${args.id}.`
      else if (!args.note?.trim()) msg = 'done needs a note on how you know it is finished.'
      else {
        it.status = 'done'
        it.doneNote = oneLine(args.note, 160)
        it.updatedAt = now
        ok(`${it.id} is done.`)
      }
      break
    case 'update':
      if (!it) msg = `No item ${args.id}.`
      else {
        if (args.title) it.title = oneLine(args.title, 120)
        if (args.detail !== undefined) it.detail = args.detail.slice(0, 600)
        it.updatedAt = now
        ok(`Updated ${it.id}.`)
      }
      break
    case 'remove':
      if (!it) msg = `No item ${args.id}.`
      else {
        f.items = f.items.filter(i => i !== it)
        ok(`Removed ${it.id}.`)
      }
      break
    case 'list':
      break
    default:
      msg = `Unknown action ${args.action}.`
  }
  if (changed) writeJson(dir, 'todos.json', f)
  return `${msg} List: ${todoSummary(f, cwd) || 'nothing open'}`.trim()
}

const todoSummary = (f, cwd) =>
  f.items
    .filter(i => i.project === cwd && i.status !== 'done')
    .map(i => `${i.id} [${i.status}] ${oneLine(i.title, 60)}`)
    .join('; ')

/** Adds an item as the user (status todo, ready to start). */
export function addUserTodo(dir, title, ctx) {
  const { cwd, now = Date.now() } = ctx
  const f = readTodos(dir)
  const id = nextId('t', f.items)
  f.items.push({ id, project: cwd, title: oneLine(title, 120), status: 'todo', by: 'you', createdAt: now, updatedAt: now, source: 'copilot' })
  writeJson(dir, 'todos.json', f)
  return id
}

/** Approves a proposed item. */
export function approveTodo(dir, id, ctx) {
  const f = readTodos(dir)
  const it = f.items.find(i => i.id === id && i.project === ctx.cwd)
  if (!it) return `No item ${id}.`
  if (it.status !== 'proposed') return `${id} is ${it.status}, not proposed.`
  it.status = 'todo'
  it.updatedAt = ctx.now ?? Date.now()
  writeJson(dir, 'todos.json', f)
  return `Approved ${id}.`
}

// ---------- board ----------

export function readBoard(dir) {
  const list = readJson(dir, 'board.json')?.items
  return Array.isArray(list) ? list.filter(i => i && typeof i.id === 'string') : []
}

export const BOARD_DESCRIPTION = `Maintain the user's session board (shown in the operator board pane in Claude Code and in /board here).
- When you ask the user a question or need a decision from them, add a "reply" item: title = the question in one line; context = a short background with the options and your recommendation; reply = the exact short text they could send to accept your recommendation (e.g. "rollout 1").
- When work is left open (waiting on CI, a follow-up, something the user must do), add a "pending" item with a short section name ("your action", "CI", "follow-ups").
- Use "update" to change an item, "remove" once it is resolved or answered, "clear" with kind to empty a whole kind.
Keep titles under ~90 characters. Do not mention the board to the user unless they ask.`

export const BOARD_SCHEMA = {
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

const mineIn = cwd => i => !i.project || i.project === cwd

/** Applies one board_update call and returns the message for the model. */
export function applyBoard(dir, args, ctx) {
  const { cwd, session, now = Date.now() } = ctx
  let list = readBoard(dir)
  let msg = ''
  let changed = false
  switch (args.action) {
    case 'add': {
      if (!args.title) {
        msg = 'add needs a title.'
        break
      }
      const kind = args.kind === 'reply' ? 'reply' : 'pending'
      const item = {
        id: nextId(kind === 'reply' ? 'r' : 'p', list),
        kind,
        section: kind === 'reply' ? '' : (args.section ?? 'general').trim(),
        title: args.title,
        context: args.context,
        reply: args.reply,
        createdAt: now,
        updatedAt: now,
        project: cwd,
        session,
        source: 'copilot',
      }
      list = [...list, item]
      msg = `Added ${item.id}.`
      changed = true
      break
    }
    case 'update':
      if (!list.some(i => i.id === args.id)) {
        msg = `No item ${args.id}.`
        break
      }
      list = list.map(i =>
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
      msg = `Updated ${args.id}.`
      changed = true
      break
    case 'remove':
      msg = list.some(i => i.id === args.id) ? `Removed ${args.id}.` : `No item ${args.id}.`
      changed = list.some(i => i.id === args.id)
      list = list.filter(i => i.id !== args.id)
      break
    case 'clear': {
      // Clears this folder's items only; other folders' items stay on the shared board.
      const mine = mineIn(cwd)
      list = list.filter(i => !mine(i) || (args.kind ? i.kind !== args.kind : false))
      msg = args.kind ? `Cleared this folder's ${args.kind} items.` : "Cleared this folder's board."
      changed = true
      break
    }
    default:
      msg = `Unknown action ${String(args.action)}.`
  }
  if (changed) writeJson(dir, 'board.json', { v: 1, items: list })
  const summary = list
    .filter(mineIn(cwd))
    .map(i => `${i.id} [${i.kind}] ${oneLine(i.title, 60)}`)
    .join('; ')
  return `${msg} Board now: ${summary || 'empty'}`
}

// ---------- checkpoints ----------

export function readCheckpoints(dir) {
  const items = readJson(dir, 'checkpoints.json')?.items
  return Array.isArray(items) ? items : []
}

export const CHECKPOINT_DESCRIPTION =
  "Save a checkpoint for this session on the user's operator board: one or two lines on where things stand and the next step. Use it when the user asks for a checkpoint, says they are stopping, or a sprint or gate closes. The user can later start a new session from it."

export const CHECKPOINT_SCHEMA = {
  type: 'object',
  properties: { note: { type: 'string', description: 'Where things stand and the next step.' } },
  required: ['note'],
}

export function saveCheckpoint(dir, note, ctx) {
  const { cwd, session, now = Date.now() } = ctx
  const cp = { id: `c${now}`, at: now, note: String(note).trim(), session, project: cwd, source: 'copilot' }
  const next = [...readCheckpoints(dir), cp].slice(-CHECKPOINT_CAP)
  writeJson(dir, 'checkpoints.json', { v: 1, items: next })
  return cp
}

export const latestCheckpoint = (dir, cwd) =>
  [...readCheckpoints(dir)].reverse().find(c => c.project === cwd)

// ---------- what a session starts with ----------

const ago = (ms, now) => {
  const m = Math.round((now - ms) / 60000)
  if (m < 60) return `${m}m ago`
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

/** The board, to-dos and latest checkpoint for a folder, as text for the model (or the user). */
export function folderSummary(dir, cwd, now = Date.now()) {
  const lines = []
  const cp = latestCheckpoint(dir, cwd)
  if (cp) lines.push(`Latest checkpoint (${ago(cp.at, now)}, from ${cp.source ?? 'claude-code'}): ${cp.note}`)
  const todos = readTodos(dir).items.filter(i => i.project === cwd && i.status !== 'done')
  if (todos.length) {
    lines.push('Open to-dos:')
    for (const t of todos) lines.push(`  ${t.id} [${t.status}] ${t.title}`)
  }
  const board = readBoard(dir).filter(i => i.project === cwd)
  const replies = board.filter(i => i.kind === 'reply')
  const pending = board.filter(i => i.kind === 'pending')
  if (replies.length) {
    lines.push('Waiting on the user:')
    for (const r of replies) lines.push(`  ${r.id} ${r.title}`)
  }
  if (pending.length) {
    lines.push('Pending:')
    for (const p of pending) lines.push(`  ${p.id} (${p.section || 'general'}) ${p.title}`)
  }
  return lines.join('\n')
}

/** Counts for the status line. */
export function counts(dir, cwd) {
  const todos = readTodos(dir).items.filter(i => i.project === cwd)
  const board = readBoard(dir).filter(i => i.project === cwd)
  return {
    doing: todos.filter(i => i.status === 'doing').length,
    todo: todos.filter(i => i.status === 'todo').length,
    proposed: todos.filter(i => i.status === 'proposed').length,
    replies: board.filter(i => i.kind === 'reply').length,
    pending: board.filter(i => i.kind === 'pending').length,
  }
}

/** The status line text: Copilot's context use and AI credits, then the folder's board counts. */
export function statusText(s, c) {
  const parts = []
  const pct = s?.context_window?.current_context_used_percentage ?? s?.context_window?.used_percentage
  if (typeof pct === 'number') parts.push(`ctx ${Math.round(pct)}%`)
  if (s?.ai_used?.formatted) parts.push(`AI ${s.ai_used.formatted}`)
  if (c.replies) parts.push(`${c.replies} needs reply`)
  const open = c.doing + c.todo
  if (open) parts.push(`${open} to-do${open > 1 ? 's' : ''}${c.doing ? ` (${c.doing} doing)` : ''}`)
  if (c.proposed) parts.push(`${c.proposed} proposed`)
  if (c.pending) parts.push(`${c.pending} pending`)
  return parts.join(' · ')
}
