// Operator board for GitHub Copilot CLI: the board, to-do and checkpoint tools of the Claude Code mod,
// sharing its files in ~/.claude/operator-board, plus /board, /todo and /savepoint.
import { joinSession } from '@github/copilot-sdk/extension'

import {
  BOARD_DESCRIPTION,
  BOARD_SCHEMA,
  CHECKPOINT_DESCRIPTION,
  CHECKPOINT_SCHEMA,
  TODO_DESCRIPTION,
  TODO_SCHEMA,
  addUserTodo,
  applyBoard,
  applyTodo,
  approveTodo,
  defaultDir,
  folderSummary,
  oneLine,
  saveCheckpoint,
} from './store.mjs'

const dir = defaultDir()
let cwd = process.cwd()
let sessionId = ''

const ctx = () => ({ cwd, session: sessionId, now: Date.now() })
const guard = fn => async (args, inv) => {
  if (inv?.sessionId) sessionId = inv.sessionId
  try {
    return fn(args ?? {})
  } catch (e) {
    return `operator-board error: ${e?.message ?? e}`
  }
}

const track = (input, inv) => {
  if (input?.workingDirectory) cwd = input.workingDirectory
  if (inv?.sessionId) sessionId = inv.sessionId
}

// The board goes to the model once per extension process: at session start, or on the first prompt.
let contextSent = false
const startContext = () => {
  if (contextSent) return
  contextSent = true
  const summary = folderSummary(dir, cwd)
  if (!summary) return
  return {
    additionalContext: `Operator board for ${cwd} (shared with the user's Claude Code sessions; keep it current with board_update, todo_update and checkpoint_save):\n${summary}`,
  }
}

const CHECKPOINT_ASK =
  'Save a checkpoint with the checkpoint_save tool: one or two lines on where this session stands and the next step.'

const session = await joinSession({
  tools: [
    {
      name: 'board_update',
      description: BOARD_DESCRIPTION,
      parameters: BOARD_SCHEMA,
      skipPermission: true,
      handler: guard(args => applyBoard(dir, args, ctx())),
    },
    {
      name: 'todo_update',
      description: TODO_DESCRIPTION,
      parameters: TODO_SCHEMA,
      skipPermission: true,
      handler: guard(args => applyTodo(dir, args, ctx())),
    },
    {
      name: 'checkpoint_save',
      description: CHECKPOINT_DESCRIPTION,
      parameters: CHECKPOINT_SCHEMA,
      skipPermission: true,
      handler: guard(args => {
        if (!args.note?.trim()) return 'checkpoint_save needs a note.'
        const cp = saveCheckpoint(dir, args.note, ctx())
        void session.log(`Checkpoint saved: ${oneLine(cp.note, 60)}`, { ephemeral: true })
        return `Saved checkpoint ${cp.id}.`
      }),
    },
  ],
  commands: [
    {
      name: 'board',
      description: "Show this folder's board, to-dos and latest checkpoint",
      handler: async () => {
        await session.log(folderSummary(dir, cwd) || 'Operator board: nothing for this folder.')
      },
    },
    {
      name: 'todo',
      description: 'Add a to-do: /todo <title>, or approve one Copilot proposed: /todo approve <id>',
      handler: async ({ args }) => {
        const text = args.trim()
        const m = /^approve\s+(\S+)$/i.exec(text)
        if (m) return void (await session.log(approveTodo(dir, m[1], ctx())))
        if (!text) return void (await session.log(folderSummary(dir, cwd) || 'No to-dos for this folder.'))
        await session.log(`Added ${addUserTodo(dir, text, ctx())}: ${oneLine(text, 70)}`)
      },
    },
    {
      name: 'savepoint',
      description: 'Save a checkpoint of this session: /savepoint [note]',
      handler: async ({ args, sessionId: id }) => {
        if (id) sessionId = id
        const note = args.trim()
        if (!note) return void (await session.send(CHECKPOINT_ASK))
        saveCheckpoint(dir, note, ctx())
        await session.log(`Checkpoint saved: ${oneLine(note, 80)}`)
      },
    },
  ],
  hooks: {
    onSessionStart: async (input, inv) => {
      track(input, inv)
      return startContext()
    },
    // An extension that joins a running session (after /clear, a reload) may never see onSessionStart:
    // every prompt carries the folder, and the first one carries the board.
    onUserPromptSubmitted: async (input, inv) => {
      track(input, inv)
      return startContext()
    },
  },
})
