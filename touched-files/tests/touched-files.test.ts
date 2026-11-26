import { expect, mock, test } from 'claude-code/testing'
import { add, heatMap, hits } from '../hooks/heat'

test('which files a call touches', () => {
  expect(hits('Read', { file_path: '/w/src/a.ts' }, 4000)).toEqual([{ path: '/w/src/a.ts', kind: 'read', chars: 4000 }])
  expect(hits('Edit', { file_path: '/w/src/a.ts', old_string: 'ab', new_string: 'abcd' }, 10)).toEqual([{ path: '/w/src/a.ts', kind: 'edit', chars: 6 }])
  expect(hits('Write', { file_path: '/w/b.md', content: 'x'.repeat(80) }, 10)).toEqual([{ path: '/w/b.md', kind: 'edit', chars: 80 }])
  expect(hits('Bash', { command: 'sed -n 1,80p src/c.go' }, 1200)).toEqual([{ path: 'src/c.go', kind: 'read', chars: 1200 }])
  expect(hits('Bash', { command: 'cat a.ts b.ts' }, 1000).map(h => h.chars)).toEqual([500, 500])
  expect(hits('Bash', { command: 'head -50 README.md' }, 300)).toEqual([{ path: 'README.md', kind: 'read', chars: 300 }])
  for (const cmd of ['npm test', 'cat a.ts | grep x', 'cat > out.txt', 'echo hi'])
    expect([cmd, hits('Bash', { command: cmd }, 100)]).toEqual([cmd, []])
  expect(hits('Grep', { pattern: 'x' }, 100)).toEqual([])
})

test('the heat map: hottest first, a bar each, and what was only read', () => {
  let list = add([], [{ path: '/w/src/server.ts', kind: 'read', chars: 40_000 }], '/w')
  list = add(list, [{ path: '/w/src/server.ts', kind: 'edit', chars: 2000 }, { path: '/w/src/util.ts', kind: 'read', chars: 8000 }], '/w')
  list = add(list, [{ path: 'README.md', kind: 'read', chars: 400 }], '/w')
  expect(list.map(t => [t.path, t.reads, t.edits, t.tokens])).toEqual([
    ['src/server.ts', 1, 1, 10_500],
    ['src/util.ts', 1, 0, 2000],
    ['README.md', 1, 0, 100],
  ])
  const map = heatMap(list)
  expect(map.split('\n')).toEqual([
    'touched-files: 3 files, ~13k tokens of file content this session',
    '  ██████████   11k  src/server.ts  read 1 · edit 1',
    '  ██░░░░░░░░  2.0k  src/util.ts    read 1',
    '  █░░░░░░░░░   100  README.md      read 1',
    'Read but never edited: 2 files, ~2.1k tokens.',
  ])
  expect(heatMap([])).toMatch(/not read or edited a file/)
})

test('in a session: reads and edits are counted; /touched shows them and clear starts over', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_790_000_000_000 })
  on('command.register', () => ({ value: { command: 'touched' } }))
  on('session.root', () => ({ value: '/work/app' }))
  on('tool.call', (_: unknown, e: any) =>
    e.file_path?.endsWith('missing.ts') ? { isError: true, result: 'no', text: 'File does not exist.' } : { result: 'ok', text: 'x'.repeat(e.tool === 'Read' ? 8000 : 10) },
  )
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Read', file_path: '/work/app/src/a.ts' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/src/a.ts' } as any)
  await $.tool.call({ tool: 'Edit', file_path: '/work/app/src/a.ts', old_string: 'a', new_string: 'b' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/work/app/src/missing.ts' } as any)
  const shown: any = await $.command.run({ command: 'touched', args: '' } as any)
  expect(shown.text).toMatch(/1 file, ~4\.0k tokens/)
  expect(shown.text).toMatch(/src\/a\.ts {2}read 2 · edit 1/)
  await $.command.run({ command: 'touched', args: 'clear' } as any)
  const cleared: any = await $.command.run({ command: 'touched', args: '' } as any)
  expect(cleared.text).toMatch(/not read or edited/)
})
