#!/usr/bin/env node
// Copilot CLI status line: context use and AI credits from Copilot, plus this folder's board counts.
// Copilot runs it with the session status as JSON on stdin (see README for the statusLine setting).
import { counts, defaultDir, statusText } from './store.mjs'

const chunks = []
for await (const c of process.stdin) chunks.push(c)
let s = {}
try {
  s = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
} catch {
  s = {}
}
process.stdout.write(statusText(s, counts(defaultDir(), s.cwd || process.cwd())) + '\n')
