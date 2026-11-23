// node --test copilot/
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  addUserTodo,
  applyBoard,
  applyTodo,
  approveTodo,
  counts,
  folderSummary,
  readBoard,
  readCheckpoints,
  readTodos,
  saveCheckpoint,
  statusText,
} from './store.mjs'

const fresh = () => mkdtempSync(join(tmpdir(), 'ob-copilot-'))
const ctx = { cwd: '/p', session: 's1', now: 1000 }

test('todo: proposed items need approval before they start', () => {
  const dir = fresh()
  assert.match(applyTodo(dir, { action: 'add', title: 'write docs' }, ctx), /Added t1 as proposed/)
  assert.match(applyTodo(dir, { action: 'start', id: 't1' }, ctx), /still proposed/)
  assert.equal(approveTodo(dir, 't1', ctx), 'Approved t1.')
  assert.match(applyTodo(dir, { action: 'start', id: 't1' }, ctx), /t1 is doing/)
  assert.match(applyTodo(dir, { action: 'done', id: 't1' }, ctx), /needs a note/)
  assert.match(applyTodo(dir, { action: 'done', id: 't1', note: 'tests pass' }, ctx), /t1 is done\. List: nothing open/)
  const it = readTodos(dir).items[0]
  assert.equal(it.status, 'done')
  assert.equal(it.doneNote, 'tests pass')
  assert.equal(it.source, 'copilot')
})

test('todo: keeps lists and items written by the Claude Code mod', () => {
  const dir = fresh()
  const claude = {
    v: 1,
    lists: { '/p': { autopilot: true, cap: 3, streak: 1 } },
    items: [{ id: 't1', project: '/other', title: 'theirs', status: 'todo', by: 'you', createdAt: 1, updatedAt: 1 }],
  }
  writeFileSync(join(dir, 'todos.json'), JSON.stringify(claude))
  addUserTodo(dir, 'mine', ctx)
  const f = JSON.parse(readFileSync(join(dir, 'todos.json'), 'utf8'))
  assert.deepEqual(f.lists, claude.lists)
  assert.deepEqual(f.items.map(i => i.id), ['t1', 't2'])
  // Items in another folder are invisible here.
  assert.match(applyTodo(dir, { action: 'remove', id: 't1' }, ctx), /No item t1/)
})

test('todo: a failed call does not create the file', () => {
  const dir = fresh()
  applyTodo(dir, { action: 'done', id: 't9', note: 'x' }, ctx)
  assert.throws(() => readFileSync(join(dir, 'todos.json')))
})

test('board: add, update, clear only this folder', () => {
  const dir = fresh()
  applyBoard(dir, { action: 'add', kind: 'reply', title: 'ship it?' }, ctx)
  applyBoard(dir, { action: 'add', title: 'wait on CI', section: 'CI' }, { ...ctx, cwd: '/q' })
  assert.match(applyBoard(dir, { action: 'update', id: 'r1', reply: 'yes' }, ctx), /Updated r1/)
  assert.equal(readBoard(dir).find(i => i.id === 'r1').reply, 'yes')
  applyBoard(dir, { action: 'clear' }, ctx)
  assert.deepEqual(readBoard(dir).map(i => i.id), ['p2'])
})

test('checkpoints: append, capped, newest wins in the summary', () => {
  const dir = fresh()
  saveCheckpoint(dir, 'first', { ...ctx, now: 1 })
  saveCheckpoint(dir, 'second', { ...ctx, now: 2 })
  assert.equal(readCheckpoints(dir).length, 2)
  assert.match(folderSummary(dir, '/p', 60_002), /Latest checkpoint \(1m ago, from copilot\): second/)
  for (let i = 0; i < 210; i++) saveCheckpoint(dir, `n${i}`, { ...ctx, now: 10 + i })
  assert.equal(readCheckpoints(dir).length, 200)
})

test('summary and status line', () => {
  const dir = fresh()
  assert.equal(folderSummary(dir, '/p'), '')
  addUserTodo(dir, 'a', ctx)
  applyTodo(dir, { action: 'add', title: 'b' }, ctx)
  applyBoard(dir, { action: 'add', kind: 'reply', title: 'which one?' }, ctx)
  assert.match(folderSummary(dir, '/p'), /Open to-dos:\n {2}t1 \[todo\] a\n {2}t2 \[proposed\] b\nWaiting on the user:\n {2}r1 which one\?/)
  const s = { context_window: { current_context_used_percentage: 41.6 }, ai_used: { formatted: '1.2' } }
  assert.equal(statusText(s, counts(dir, '/p')), 'ctx 42% · AI 1.2 · 1 needs reply · 1 to-do · 1 proposed')
  assert.equal(statusText({}, counts(dir, '/nowhere')), '')
})
