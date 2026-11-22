// To-do lists, one per project folder, shared by every session through one file,
// with an autopilot that starts the next item when Claude finishes one.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Look, Todo, TodoFile, TodoList } from '../types'
import { dim } from './look'

type $T = EngineInterface

const FILE = '.claude/operator-board/todos.json'
const DONE_SHOWN = 3
const RUNNER_STALE_MS = 2 * 60 * 60 * 1000
const CAP_OPTIONS = [1, 3, 5, 10].map(n => ({ value: String(n), label: `stop after ${n}` }))
export const TODO_TOOL = 'todo_update'

const EMPTY: TodoFile = { v: 1, lists: {}, items: [] }
export const todos = atom({ plugin: 'operator-board', key: 'todos' } as const, EMPTY, { shape: 'todos-1' })
const todoNote = atom({ plugin: 'operator-board', key: 'todoNote' } as const, '')

const line1 = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

async function path($: $T): Promise<string> {
  let home = ''
  try {
    home = (await $.env.get('HOME')) ?? ''
  } catch {
    home = ''
  }
  return `${home}/${FILE}`
}

const asFile = (d: unknown): TodoFile => {
  const x = d as Partial<TodoFile> | undefined
  return {
    v: 1,
    lists: x?.lists && typeof x.lists === 'object' ? x.lists : {},
    items: Array.isArray(x?.items) ? x!.items.filter(i => i && typeof i.id === 'string') : [],
  }
}

/** Reads the shared to-do file into this session. */
export async function loadTodos($: $T) {
  try {
    const p = await path($)
    if (!(await $.fs.exists(p))) return
    const data = asFile(JSON.parse(await $.fs.read(p)))
    await update($, todos, () => data)
  } catch {
    // A half-written file: the next load reads it whole.
  }
}

/** Reads the file fresh, changes it, writes it back. */
async function mutate($: $T, fn: (f: TodoFile) => TodoFile): Promise<TodoFile> {
  await loadTodos($)
  const next_ = fn(JSON.parse(JSON.stringify(await read($, todos))) as TodoFile)
  await update($, todos, () => next_)
  await $.fs.write(await path($), JSON.stringify(next_, null, 1))
  return next_
}

const listOf = (f: TodoFile, project: string): TodoList =>
  f.lists[project] ?? { autopilot: false, cap: 3, streak: 0 }

const newId = (f: TodoFile) => {
  let n = f.items.length + 1
  while (f.items.some(i => i.id === `t${n}`)) n += 1
  return `t${n}`
}

const prompt = (it: Todo) =>
  [
    `[to-do] Work on item ${it.id}: "${it.title}"${it.detail ? `\n${it.detail}` : ''}`,
    `When it is finished, call ${TODO_TOOL} with action "done", id "${it.id}" and a one-line note on how you know (tests pass, PR merged, …).`,
    `If you cannot finish it, say why and leave it as doing.`,
  ].join('\n')

/** Starts one item: marks it doing and sends Claude its prompt. */
export async function startItem($: $T, id: string, cwd: string, byAutopilot = false) {
  const now = await $.clock.now()
  const session = await $.session.id()
  let started: Todo | undefined
  await mutate($, f => {
    const it = f.items.find(i => i.id === id && i.project === cwd)
    if (!it || (it.status !== 'todo' && it.status !== 'doing')) return f
    it.status = 'doing'
    it.session = session
    it.updatedAt = now
    started = it
    if (byAutopilot) {
      const l = listOf(f, cwd)
      f.lists[cwd] = { ...l, streak: l.streak + 1 }
    }
    return f
  })
  if (started) void $.prompt.submit({ text: prompt(started) })
}

// ---------- the tool ----------

export const TODO_TOOL_DESCRIPTION = `Keep the user's to-do list for this project folder (shown on their operator board, shared by every session in the folder).
- "add": an item you think should be done (title, optional detail). It waits as proposed until the user approves it.
- "start": mark an item as doing before you work on it.
- "done": only when it is really finished, with a one-line note on how you know (tests pass, PR #n merged, checked in the browser).
- "update" (title/detail), "remove", "list".
Work on the user's items in order. Do not mention the list unless the user asks.`

export const TODO_TOOL_SCHEMA = {
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

type TodoArgs = { action: string; id?: string; title?: string; detail?: string; note?: string }

export async function applyTodoTool($: $T, args: TodoArgs, cwd: string): Promise<string> {
  const now = await $.clock.now()
  let msg = ''
  const f = await mutate($, f => {
    const it = args.id ? f.items.find(i => i.id === args.id && i.project === cwd) : undefined
    switch (args.action) {
      case 'add': {
        if (!args.title?.trim()) return ((msg = 'add needs a title.'), f)
        const id = newId(f)
        f.items.push({
          id,
          project: cwd,
          title: line1(args.title, 120),
          detail: args.detail?.slice(0, 600),
          status: 'proposed',
          by: 'claude',
          createdAt: now,
          updatedAt: now,
        })
        msg = `Added ${id} as proposed; the user approves it before it can start.`
        return f
      }
      case 'start':
        if (!it) return ((msg = `No item ${args.id}.`), f)
        if (it.status === 'proposed') return ((msg = `${it.id} is still proposed; the user has to approve it first.`), f)
        it.status = 'doing'
        it.updatedAt = now
        msg = `${it.id} is doing.`
        return f
      case 'done':
        if (!it) return ((msg = `No item ${args.id}.`), f)
        if (!args.note?.trim()) return ((msg = 'done needs a note on how you know it is finished.'), f)
        it.status = 'done'
        it.doneNote = line1(args.note, 160)
        it.updatedAt = now
        msg = `${it.id} is done.`
        return f
      case 'update':
        if (!it) return ((msg = `No item ${args.id}.`), f)
        if (args.title) it.title = line1(args.title, 120)
        if (args.detail !== undefined) it.detail = args.detail.slice(0, 600)
        it.updatedAt = now
        msg = `Updated ${it.id}.`
        return f
      case 'remove':
        if (!it) return ((msg = `No item ${args.id}.`), f)
        f.items = f.items.filter(i => i !== it)
        msg = `Removed ${it.id}.`
        return f
      default:
        msg = args.action === 'list' ? '' : `Unknown action ${args.action}.`
        return f
    }
  })
  const mine = f.items.filter(i => i.project === cwd && i.status !== 'done')
  const list = mine.map(i => `${i.id} [${i.status}] ${line1(i.title, 60)}`).join('; ')
  return `${msg} List: ${list || 'nothing open'}`.trim()
}

// ---------- autopilot ----------

export type PilotContext = {
  cwd: string
  /** Needs-reply items open for this folder. */
  openReplies: number
  /** Why usage says stop, if it does. */
  usageBlock?: string
}

async function pause($: $T, cwd: string, why: string) {
  await mutate($, f => {
    f.lists[cwd] = { ...listOf(f, cwd), autopilot: false, runner: undefined, paused: why }
    return f
  })
  $.ui.toast(`To-do autopilot paused: ${why}`)
}

/** After a turn: if this session runs the folder's autopilot, start the next item or say why not. */
export async function autopilotAfterTurn($: $T, ctx: PilotContext) {
  await loadTodos($)
  const f = await read($, todos)
  const l = listOf(f, ctx.cwd)
  if (!l.autopilot || l.runner !== (await $.session.id())) return
  const mine = f.items.filter(i => i.project === ctx.cwd)
  const doing = mine.find(i => i.status === 'doing')
  if (doing) {
    await setNote($, `waiting: ${doing.id} is still doing (Claude marks it done when finished)`)
    return
  }
  const next_ = mine.filter(i => i.status === 'todo').sort((a, b) => a.createdAt - b.createdAt)[0]
  if (!next_) return pause($, ctx.cwd, 'the list is done')
  if (ctx.openReplies > 0) return pause($, ctx.cwd, 'Claude asked you something (see Needs reply)')
  if (ctx.usageBlock) return pause($, ctx.cwd, ctx.usageBlock)
  if (l.streak >= l.cap) return pause($, ctx.cwd, `finished ${l.streak} in a row: check in, then turn it on again`)
  await setNote($, '')
  await startItem($, next_.id, ctx.cwd, true)
}

async function setNote($: $T, text: string) {
  await update($, todoNote, () => text)
}

export async function setAutopilot($: $T, cwd: string, on: boolean, ctx: PilotContext) {
  const session = await $.session.id()
  const now = await $.clock.now()
  const f0 = await read($, todos)
  const cur = listOf(f0, cwd)
  if (on && cur.autopilot && cur.runner && cur.runner !== session && now - (cur.runnerAt ?? 0) < RUNNER_STALE_MS) {
    $.ui.toast('Autopilot already runs this list in another session.')
    return
  }
  await mutate($, f => {
    const l = listOf(f, cwd)
    f.lists[cwd] = on
      ? { ...l, autopilot: true, runner: session, runnerAt: now, streak: 0, paused: undefined }
      : { ...l, autopilot: false, runner: undefined }
    return f
  })
  if (on) await autopilotAfterTurn($, ctx)
}

async function setCap($: $T, cwd: string, cap: number) {
  await mutate($, f => {
    f.lists[cwd] = { ...listOf(f, cwd), cap }
    return f
  })
}

async function setStatus($: $T, id: string, status: Todo['status']) {
  const now = await $.clock.now()
  await mutate($, f => {
    const it = f.items.find(i => i.id === id)
    if (it) {
      it.status = status
      it.updatedAt = now
      if (status === 'done' && !it.doneNote) it.doneNote = 'ticked off by you'
    }
    return f
  })
}

async function addMine($: $T, cwd: string, title: string) {
  const t = title.trim()
  if (!t) return
  const now = await $.clock.now()
  await mutate($, f => {
    f.items.push({ id: newId(f), project: cwd, title: line1(t, 120), status: 'todo', by: 'you', createdAt: now, updatedAt: now })
    return f
  })
}

async function removeItem($: $T, id: string) {
  await mutate($, f => ({ ...f, items: f.items.filter(i => i.id !== id) }))
}

/** "3 open · autopilot on" for the section header. */
export async function todoCount($: $T, cwd: string): Promise<string> {
  const f = await read($, todos)
  const open = f.items.filter(i => i.project === cwd && i.status !== 'done').length
  const l = listOf(f, cwd)
  return `${open ? ` (${open} open)` : ''}${l.autopilot ? ' · autopilot on' : ''}`
}

// ---------- the section ----------

export async function todoBody($: $T, e: any, L: Look, ctx: PilotContext) {
  const { Box, Button, Text, Input, Select } = $.ui.resolve(e)
  const f = await read($, todos)
  const l = listOf(f, ctx.cwd)
  const note = await read($, todoNote)
  const mine = f.items.filter(i => i.project === ctx.cwd)
  const proposed = mine.filter(i => i.status === 'proposed')
  const active = mine.filter(i => i.status === 'doing' || i.status === 'todo').sort((a, b) => a.createdAt - b.createdAt)
  const done = mine.filter(i => i.status === 'done').sort((a, b) => b.updatedAt - a.updatedAt)
  const session = await $.session.id()
  const elsewhere = l.autopilot && l.runner && l.runner !== session

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        <Button
          key="todo-autopilot"
          plain
          variant={l.autopilot ? 'primary' : undefined}
          label={l.autopilot ? (elsewhere ? 'autopilot: on in another session' : 'autopilot: on') : 'autopilot: off'}
          onPress={() => setAutopilot($, ctx.cwd, !l.autopilot, ctx)}
        />
        <Select
          key="todo-cap"
          options={CAP_OPTIONS}
          value={String(l.cap)}
          onSelect={v => void setCap($, ctx.cwd, Number(v))}
        />
      </Box>
      {l.paused && !l.autopilot && <Text color={L.warn}>paused: {l.paused}</Text>}
      {note && l.autopilot && <Text {...dim(L)}>{note}</Text>}
      {active.length === 0 && proposed.length === 0 && <Text {...dim(L)}>Nothing to do. Add one below.</Text>}
      {active.map(it => (
        <Box flexDirection="row" gap={1} key={`todo-${it.id}`}>
          <Text color={it.status === 'doing' ? L.warn : L.accent}>{it.status === 'doing' ? '◐' : '○'}</Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              {it.title}
              <Text {...dim(L)}>{it.by === 'claude' ? ' · by Claude' : ''}</Text>
            </Text>
          </Box>
          {it.status === 'todo' && <Button key={`tstart-${it.id}`} plain label="▶" onPress={() => startItem($, it.id, ctx.cwd)} />}
          <Button key={`tdone-${it.id}`} plain label="✓" onPress={() => setStatus($, it.id, 'done')} />
          <Button key={`tdel-${it.id}`} plain label="×" onPress={() => removeItem($, it.id)} />
        </Box>
      ))}
      {proposed.length > 0 && <Text {...dim(L)}>Proposed by Claude:</Text>}
      {proposed.map(it => (
        <Box flexDirection="row" gap={1} key={`todo-${it.id}`}>
          <Text {...dim(L)}>?</Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">{it.title}</Text>
          </Box>
          <Button key={`tok-${it.id}`} plain variant="primary" label="approve" onPress={() => setStatus($, it.id, 'todo')} />
          <Button key={`tdel-${it.id}`} plain label="×" onPress={() => removeItem($, it.id)} />
        </Box>
      ))}
      <Input key="todo-add" label="Add" placeholder="something to do" submitLabel="add" onSubmit={v => addMine($, ctx.cwd, v)} />
      {done.slice(0, DONE_SHOWN).map(it => (
        <Text wrap="truncate-end" key={`tdone-row-${it.id}`}>
          <Text color={L.ok}>✓ </Text>
          <Text {...dim(L)}>
            {it.title}
            {it.doneNote ? ` · ${it.doneNote}` : ''}
          </Text>
        </Text>
      ))}
      {done.length > DONE_SHOWN && <Text {...dim(L)}>  … {done.length - DONE_SHOWN} more done</Text>}
      <Text {...dim(L)}>
        ▶ starts an item now. Autopilot starts the next one when Claude finishes, and pauses on a question, your usage
        warn line, or after the set number in a row.
      </Text>
    </Box>
  )
}
