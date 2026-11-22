import { atom, read, update } from 'claude-code'
import type { UiPressArgument } from 'claude-code'

import type { Look, SessionRow, SessionsSnapshot } from '../types'
import { CHECKPOINT_ASK, allCheckpoints, latestFor, loadCheckpoints, setSuggestions } from './extras'
import { dim } from './look'
import { dayTime, hhmm, homeDir, oneLine, shellQuote } from './util'
import type { $T } from './util'

/** Earlier sessions, read from ~/.claude/history.jsonl: the Sessions section and the board's recent asks. */
const sessions = atom(
  { plugin: 'operator-board', key: 'sessions' } as const,
  { updatedAt: 0, items: [] },
  { shape: 'sessions-1' },
)
const SESSIONS_SHOWN = 8
const HISTORY_TAIL = 4000

export async function sessionRows($: $T): Promise<readonly SessionRow[]> {
  return (await read($, sessions)).items
}

export async function sessionsUpdatedAt($: $T): Promise<number> {
  return (await read($, sessions)).updatedAt
}

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
    const row: SessionRow & { said: { at: number; text: string }[] } =
      byId.get(id) ?? { id, project: '', last: '', at: 0, prompts: 0, name: '', recent: [], said: [] }
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
export async function refreshSessions($: $T) {
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

// ---------- the section ----------
export async function sessionsBody($: $T, e: any, L: Look) {
  const { Box, Button, Text } = $.ui.resolve(e)
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
                  onPress={async (press: UiPressArgument) => {
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
                onPress={async (press: UiPressArgument) => {
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
