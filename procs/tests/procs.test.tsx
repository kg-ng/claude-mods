import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { age, cwds, listeners, portInUse } from '../hooks/lsof'

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]

const LSOF = ['p501', 'cnode', 'f23', 'n*:3000', 'f24', 'n[::1]:3000', 'p777', 'cpostgres', 'f5', 'n127.0.0.1:5432', 'p902', 'cvite', 'f30', 'n127.0.0.1:5173', ''].join('\n')
const CWD = ['p501', 'fcwd', 'n/work/app', 'p777', 'fcwd', 'n/opt/homebrew/var/postgres', 'p902', 'fcwd', 'n/work/app/web', ''].join('\n')

test('reads lsof listeners and working folders', () => {
  expect(listeners(LSOF)).toEqual([
    { pid: 501, command: 'node', port: 3000 },
    { pid: 902, command: 'vite', port: 5173 },
    { pid: 777, command: 'postgres', port: 5432 },
  ])
  expect(cwds(CWD).get(902)).toBe('/work/app/web')
  expect(listeners('')).toEqual([])
})

test('finds the port in the usual "in use" errors', () => {
  expect(portInUse('Error: listen EADDRINUSE: address already in use :::3000')).toBe(3000)
  expect(portInUse('OSError: [Errno 48] Address already in use: port 8000')).toBe(8000)
  expect(portInUse('Port 5173 is in use, trying another one...')).toBe(5173)
  expect(portInUse('listen tcp 127.0.0.1:8080: bind: address already in use')).toBe(8080)
  expect(portInUse('all good on port 3000')).toBeUndefined()
  expect(age(42_000)).toBe('42s')
  expect(age(4 * 60_000)).toBe('4m')
  expect(age(125 * 60_000)).toBe('2h 5m')
})

async function boot($: T$, on: TOn, calls: { stopped: string[]; killed: string[] }, surface: 'terminal' | 'desktop' = 'terminal') {
  mock.store(on)
  mock.clock(on, { now: 1_790_000_000_000 })
  on('command.register', () => ({ value: { command: 'procs' } }))
  on('session.root', () => ({ value: '/work/app' }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_: unknown, e: any) => {
    const argv: string[] = e.argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'kill') return calls.killed.push(argv[1]!), out('')
    if (argv.includes('-iTCP')) return out(calls.killed.length ? '' : LSOF)
    return out(CWD)
  })
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool === 'TaskStop') return calls.stopped.push(e.task_id), { result: { message: 'stopped', task_id: e.task_id, task_type: 'local_bash' } }
    if (String(e.command).includes('&& npm start')) return { isError: true, result: 'x', text: 'Exit code 1\nError: listen EADDRINUSE: address already in use :::3000' }
    if (e.run_in_background) return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bash_7' } }
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  on('classic.Stop', () => ({}))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
}

for (const surface of ['terminal', 'desktop'] as const)
  test(`${surface}: the band lists background commands and project ports, with stop and kill`, async ($, on) => {
    const calls = { stopped: [] as string[], killed: [] as string[] }
    await boot($, on, calls, surface)
    await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as any)
    const band = { plugin: 'procs', component: 'AbovePrompt', surface, props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 100 } } as any
    const ui = await $.ui.mount(band)
    expect(await ui.find({ type: 'Text', text: /Running · 1 background · 2 ports/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'npm run dev' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ':3000' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ':5432' })).toBeUndefined() // postgres runs outside the project
    await ui.press({ key: 'stop-bash_7' })
    expect(calls.stopped).toEqual(['bash_7'])
    await ui.press({ key: 'kill-501-3000' })
    expect(calls.killed).toEqual(['501'])
    await ui.unmount()
  })

test('a port-in-use failure tells Claude who holds it; Stop drops tasks that ended', async ($, on) => {
  const calls = { stopped: [] as string[], killed: [] as string[] }
  await boot($, on, calls)
  const failed: any = await $.tool.call({ tool: 'Bash', command: 'cd api && npm start' } as any)
  expect(failed.context?.[0]).toMatch(/port 3000 is held by node \(pid 501\)/)

  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as any)
  let list: any = await $.command.run({ command: 'procs', args: '' } as any)
  expect(list.text).toMatch(/bg bash_7: npm run dev/)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as any)
  list = await $.command.run({ command: 'procs', args: '' } as any)
  expect(list.text).not.toMatch(/bash_7/)
})
