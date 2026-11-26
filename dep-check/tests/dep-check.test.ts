import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { distance, judge, lookalike, wanted } from '../hooks/rules'

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]

const NOW = 1_790_000_000_000
const DAY = 86_400_000

test('reads the packages an install adds, and nothing else', () => {
  expect(wanted('npm install react@18 @types/react -D')).toEqual([
    { eco: 'npm', name: 'react' },
    { eco: 'npm', name: '@types/react' },
  ])
  expect(wanted('cd web && pnpm add zod && bun add -d vitest@^2')).toEqual([
    { eco: 'npm', name: 'zod' },
    { eco: 'npm', name: 'vitest' },
  ])
  expect(wanted('pip install "requests>=2" flask[async]==3.0 -r requirements.txt')).toEqual([
    { eco: 'pypi', name: 'requests' },
    { eco: 'pypi', name: 'flask' },
  ])
  expect(wanted('python3 -m pip install -U httpx')).toEqual([{ eco: 'pypi', name: 'httpx' }])
  expect(wanted('uv add ruff && poetry add pydantic')).toEqual([
    { eco: 'pypi', name: 'ruff' },
    { eco: 'pypi', name: 'pydantic' },
  ])
  for (const cmd of ['npm install', 'npm ci', 'pnpm i --frozen-lockfile', 'pip install -e .', 'pip install -r requirements.txt', 'npm install ./pkg.tgz', 'npm i github:me/repo', 'npm test', 'echo pip'])
    expect([cmd, wanted(cmd)]).toEqual([cmd, []])
})

test('names one letter off a popular package look like it; real packages and scoped ones do not', () => {
  expect(distance('reqeusts', 'requests')).toBe(1)
  expect(lookalike('pypi', 'reqeusts')).toBe('requests')
  expect(lookalike('pypi', 'request')).toBe('requests')
  expect(lookalike('npm', 'expresss')).toBe('express')
  expect(lookalike('npm', 'lodahs')).toBe('lodash')
  expect(lookalike('npm', 'axois')).toBe('axios')
  for (const [eco, name] of [['npm', 'react'], ['npm', 'mysql2'], ['npm', '@types/react'], ['npm', '@nestjs/core'], ['npm', 'vite'], ['pypi', 'Flask'], ['pypi', 'python_dotenv'], ['npm', 'left-pad']] as const)
    expect([name, lookalike(eco, name)]).toEqual([name, undefined])
})

test('what is stopped and what is said', () => {
  const ok = judge({ eco: 'npm', name: 'zod' }, { version: '3.23.8', license: 'MIT', weekly: 12_400_000 }, NOW, { minWeekly: 500 })
  expect(ok).toEqual({ block: false, line: 'zod (3.23.8 · MIT · 12M downloads/week)' })
  expect(judge({ eco: 'npm', name: 'lodahs' }, { version: '1.0.0', weekly: 40 }, NOW, { minWeekly: 500 })).toEqual({
    block: true,
    line: 'lodahs (1.0.0 · no license given · 40 downloads/week) looks like a misspelling of the popular `lodash`.',
  })
  expect(judge({ eco: 'npm', name: 'tiny-thing' }, { version: '0.1.0', license: 'MIT', weekly: 12 }, NOW, { minWeekly: 500 }).block).toBe(true)
  expect(judge({ eco: 'pypi', name: 'fresh' }, { version: '0.0.1', license: 'MIT', weekly: 9000, firstRelease: NOW - 3 * DAY }, NOW, { minWeekly: 500 }).line).toMatch(/first released 3 days ago\) is brand new/)
  expect(judge({ eco: 'npm', name: 'nope-xyz' }, { missing: true }, NOW, { minWeekly: 500 })).toEqual({
    block: false,
    line: 'nope-xyz: not on npm. Check the name: a made-up name is one an attacker can register.',
  })
  // The registry can't be reached: only the name can be judged.
  expect(judge({ eco: 'npm', name: 'zod' }, undefined, NOW, { minWeekly: 500 })).toEqual({ block: false, line: 'zod' })
  expect(judge({ eco: 'npm', name: 'expresss' }, undefined, NOW, { minWeekly: 500 }).block).toBe(true)
})

const REGISTRY: Record<string, { status: number; body?: unknown }> = {
  'https://registry.npmjs.org/zod/latest': { status: 200, body: { version: '3.23.8', license: 'MIT' } },
  'https://api.npmjs.org/downloads/point/last-week/zod': { status: 200, body: { downloads: 12_400_000 } },
  'https://registry.npmjs.org/expresss/latest': { status: 200, body: { version: '0.0.1' } },
  'https://api.npmjs.org/downloads/point/last-week/expresss': { status: 200, body: { downloads: 31 } },
}

async function boot($: T$, on: TOn, ran: any[]) {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'deps' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('http.fetch', (_: unknown, e: any) => {
    const r = REGISTRY[e.url] ?? { status: 404 }
    return { value: { status: r.status, ok: r.status < 400, headers: {}, text: JSON.stringify(r.body ?? {}) } }
  })
  on('tool.call', (_: unknown, e: any) => (ran.push(e), { result: { stdout: 'added 1 package', stderr: '', interrupted: false } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
}

test('in a session: a good package installs with a note for Claude; a lookalike is stopped until /deps allow', async ($, on) => {
  const ran: any[] = []
  await boot($, on, ran)

  const good: any = await $.tool.call({ tool: 'Bash', command: 'npm install zod' } as any)
  expect(ran.length).toBe(1)
  expect(good.context?.[0]).toBe('dep-check: zod (3.23.8 · MIT · 12M downloads/week).')

  const bad: any = await $.tool.call({ tool: 'Bash', command: 'npm install expresss' } as any)
  expect(bad.deny ?? bad.text).toMatch(/misspelling of the popular `express`.*\/deps allow expresss/)
  expect(ran.length).toBe(1)

  await $.command.run({ command: 'deps', args: 'allow expresss' } as any)
  await $.tool.call({ tool: 'Bash', command: 'npm install expresss' } as any)
  expect(ran.length).toBe(2)

  const plain: any = await $.tool.call({ tool: 'Bash', command: 'npm test' } as any)
  expect(plain.context).toBeUndefined()
})
