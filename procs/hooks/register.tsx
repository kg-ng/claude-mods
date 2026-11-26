// procs: a band above the prompt for what's left running. Claude's background shell commands, with
// stop, and the ports held by processes running in this project (found with lsof), with kill.
// When a command fails with "address already in use", Claude is told who holds the port.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Port, Task } from '../types'
import { age, cwds, listeners, portInUse } from './lsof'

type $T = EngineInterface

const tasks = atom({ plugin: 'procs', key: 'tasks' } as const, [], { shape: 'tasks-1' })
const ports = atom({ plugin: 'procs', key: 'ports' } as const, [], { shape: 'ports-1' })
const isHidden = atom({ plugin: 'procs', key: 'isHidden' } as const, false)
const REFRESH_MS = 20_000
const MAX_ROWS = 6

/** Re-reads which ports processes in the project hold. Leaves the list as it was when lsof can't run. */
async function refreshPorts($: $T) {
  const root = (await $.session.root()).replace(/\/+$/, '')
  const run = (argv: string[]) => $.process.run(argv, { timeoutMs: 5000 }).catch(() => undefined)
  const all = await run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'])
  if (!all) return
  const found = listeners(all.stdout)
  let mine: Port[] = []
  if (found.length) {
    const pids = [...new Set(found.map(f => f.pid))]
    const where = await run(['lsof', '-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn'])
    const dirs = cwds(where?.stdout ?? '')
    mine = found.filter(f => {
      const d = dirs.get(f.pid)
      return d !== undefined && (d === root || d.startsWith(root + '/'))
    })
  }
  // Unchanged lists aren't written, so the band isn't redrawn for nothing.
  await update($, ports, old => (JSON.stringify(old) === JSON.stringify(mine) ? old : mine))
}

/** The timer's refresh: only while something runs and the band shows. Stop and /procs refresh anyway. */
async function poll($: $T) {
  const [hidden, t, p] = await Promise.all([read($, isHidden), read($, tasks), read($, ports)])
  if (!hidden && (t.length || p.length)) await refreshPorts($)
}

async function stopTask($: $T, id: string) {
  const r = await $.tool.call({ tool: 'TaskStop', task_id: id }).catch(() => undefined)
  await update($, tasks, list => list.filter(t => t.id !== id))
  if (r && r.deny !== undefined) $.ui.toast(`procs: couldn't stop it: ${r.deny.slice(0, 80)}`)
  await refreshPorts($)
}

async function killPid($: $T, pid: number) {
  const r = await $.process.run(['kill', String(pid)], { timeoutMs: 3000 }).catch(() => undefined)
  if (!r || r.exitCode !== 0) $.ui.toast(`procs: kill ${pid} failed${r?.stderr ? `: ${r.stderr.trim().slice(0, 60)}` : ''}`)
  // Ends with SIGTERM; one that takes a moment to exit drops off at the next refresh.
  await refreshPorts($)
}

function listText(t: Task[], p: Port[], now: number): string {
  if (!t.length && !p.length) return 'procs: nothing left running in this project.'
  return [
    ...t.map(x => `  bg ${x.id}: ${x.command.split('\n')[0]!.slice(0, 80)} (${age(now - x.startedAt)})`),
    ...p.map(x => `  :${x.port} ${x.command} (pid ${x.pid})`),
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'procs', description: 'What is still running: background commands and ports', argumentHint: '[show|hide]' })
    const r = await next(e)
    await refreshPorts($)
    $.clock.every(REFRESH_MS, () => poll($))
    return r
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const out = (ran.result ?? {}) as { backgroundTaskId?: string; stdout?: string; stderr?: string }
    if (!ran.isError && typeof out === 'object' && out.backgroundTaskId) {
      const id = out.backgroundTaskId
      const now = await $.clock.now()
      await update($, tasks, list => (list.some(t => t.id === id) ? list : [...list, { id, command: String(e.command ?? ''), startedAt: now }]))
      // Its port, once a server binds one, shows at the next refresh or when the turn stops.
      return ran
    }
    const text = ran.text ?? `${out.stdout ?? ''}\n${out.stderr ?? ''}`
    const port = portInUse(text)
    if (port === undefined) return ran
    await refreshPorts($)
    const holder = (await read($, ports)).find(p => p.port === port)
    const task = holder ? undefined : (await read($, tasks)).at(-1)
    const note = holder
      ? `procs: port ${port} is held by ${holder.command} (pid ${holder.pid}), running in this project. If it's a server you started earlier, reuse it or stop it (TaskStop for your own background task); otherwise ask the user before killing it.`
      : `procs: port ${port} is taken, but not by a process in this project${task ? `. Your background task ${task.id} (${task.command.slice(0, 60)}) is still running` : ''}. Pick another port, or ask the user.`
    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const id = String(e.task_id ?? e.shell_id ?? '')
    if (ran.deny === undefined && !ran.isError && id) await update($, tasks, list => list.filter(t => t.id !== id))
    return ran
  }).catch(($, e, next) => next(e))

  // When a turn stops, the engine lists what's still in flight: anything not in it has ended.
  on('classic.Stop', async ($, e, next) => {
    const live = (e.background_tasks ?? []).filter(t => t.type === 'shell' || t.command !== undefined)
    if (e.background_tasks) {
      const now = await $.clock.now()
      await update($, tasks, list => [
        ...list.filter(t => live.some(l => l.id === t.id)),
        ...live.filter(l => !list.some(t => t.id === l.id)).map(l => ({ id: l.id, command: l.command ?? l.description, startedAt: now })),
      ])
    }
    await refreshPorts($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [hidden, t, p, now] = await Promise.all([read($, isHidden), read($, tasks), read($, ports), $.clock.now()])
    if (hidden || (!t.length && !p.length)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns - 24)
    const rows = [
      ...t.map(x => (
        <Box key={`task-${x.id}`} flexDirection="row" gap={1}>
          <Text dimColor>bg</Text>
          <Text wrap="truncate-end">{x.command.split('\n')[0]!.slice(0, width)}</Text>
          <Text dimColor>{age(now - x.startedAt)}</Text>
          <Button key={`stop-${x.id}`} plain label="stop" onPress={() => stopTask($, x.id)} />
        </Box>
      )),
      ...p.map(x => (
        <Box key={`port-${x.pid}-${x.port}`} flexDirection="row" gap={1}>
          <Text color="success">{`:${x.port}`}</Text>
          <Text>{x.command}</Text>
          <Text dimColor>{`pid ${x.pid}`}</Text>
          <Button key={`kill-${x.pid}-${x.port}`} plain label="kill" onPress={() => killPid($, x.pid)} />
        </Box>
      )),
    ]
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>{['Running', t.length && `${t.length} background`, p.length && `${p.length} port${p.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</Text>
          <Button key="procs-hide" plain label="hide" onPress={() => update($, isHidden, () => true)} />
        </Box>
        {rows.slice(0, MAX_ROWS)}
        {rows.length > MAX_ROWS ? <Text dimColor>{`… ${rows.length - MAX_ROWS} more: /procs`}</Text> : null}
      </Box>
    )
  })

  on('command.run', { command: 'procs' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'hide' || arg === 'show') {
      await update($, isHidden, () => arg === 'hide')
      return { text: arg === 'hide' ? 'procs band hidden until /procs show.' : 'procs band shown.' }
    }
    await refreshPorts($)
    const [t, p, now] = await Promise.all([read($, tasks), read($, ports), $.clock.now()])
    return { text: listText(t, p, now) }
  })
}
