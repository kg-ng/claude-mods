import { expect, mock, test } from 'claude-code/testing'
import { line, parse } from '../hooks/parse'

const VITEST = `
 ✓ src/a.test.ts (12 tests) 8ms
 ❯ src/b.test.ts (3 tests | 2 failed) 12ms
   × b > adds numbers 4ms
   × b > keeps order 2ms
 FAIL  src/b.test.ts > b > adds numbers
 FAIL  src/b.test.ts > b > keeps order

 Test Files  1 failed | 3 passed (4)
      Tests  2 failed | 140 passed | 1 skipped (143)
   Start at  10:02:11
   Duration  4.21s (transform 120ms, setup 0ms)
`
const JEST = `
FAIL src/sum.test.js
  ● sum › adds 1 + 2

    expect(received).toBe(expected)

Tests:       1 failed, 41 passed, 42 total
Snapshots:   0 total
Time:        2.3 s
`
const PYTEST = `
FAILED tests/test_api.py::test_login - AssertionError: 401
FAILED tests/test_api.py::test_logout - KeyError
==================== 2 failed, 98 passed, 3 skipped in 4.20s ====================
`
const CARGO = `
test tests::adds ... ok
test tests::splits ... FAILED

test result: FAILED. 11 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.31s
`
const GO = `--- FAIL: TestParse (0.00s)
    parse_test.go:12: got 1, want 2
FAIL
FAIL\texample.com/app/parse\t0.012s
ok  \texample.com/app/util\t0.004s
`
const BUN = ` 30 pass
 2 fail
(fail) math > divides [0.12ms]
Ran 32 tests across 3 files. [118.00ms]
`
const MOCHA = `
  12 passing (40ms)
  1 failing

  1) Array
       #indexOf():
`

test('reads each runner’s summary and the failing names', () => {
  expect(parse(VITEST)).toEqual({
    runner: 'vitest', passed: 140, failed: 2, skipped: 1, duration: '4.21s',
    failures: ['b > adds numbers', 'b > keeps order', 'src/b.test.ts > b > adds numbers', 'src/b.test.ts > b > keeps order'],
  })
  expect(parse(JEST)).toEqual({ runner: 'jest', passed: 41, failed: 1, skipped: 0, duration: '2.3s', failures: ['sum › adds 1 + 2'] })
  expect(parse(PYTEST)).toEqual({
    runner: 'pytest', passed: 98, failed: 2, skipped: 3, duration: '4.20s',
    failures: ['tests/test_api.py::test_login', 'tests/test_api.py::test_logout'],
  })
  expect(parse(CARGO)).toEqual({ runner: 'cargo', passed: 11, failed: 1, skipped: 0, duration: '0.31s', failures: ['tests::splits'] })
  expect(parse(GO)?.failures).toEqual(['TestParse'])
  expect(parse(GO)?.failed).toBe(1)
  expect(parse(BUN)).toEqual({ runner: 'bun', passed: 30, failed: 2, skipped: 0, duration: '118.00ms', failures: ['math > divides'] })
  expect(parse(MOCHA)?.passed).toBe(12)
  expect(parse(MOCHA)?.failed).toBe(1)
  expect(parse('\x1b[32m      Tests  \x1b[1m5 passed\x1b[22m (5)\x1b[39m')?.passed).toBe(5)
})

test('ordinary output is not a test run', () => {
  for (const text of ['', 'total 12\ndrwxr-xr-x  4 me staff 128 .', 'Compiled successfully in 2.1s', 'Tests: see docs', 'npm ERR! missing script: test'])
    expect([text, parse(text)]).toEqual([text, undefined])
})

test('the one-line summary', () => {
  expect(line(parse(PYTEST)!)).toBe('✓ 98 passed · ✗ 2 failed · 3 skipped · 4.20s')
  expect(line({ runner: 'jest', passed: 5, failed: 0, skipped: 0, failures: [] })).toBe('✓ 5 passed')
})

const result = (id: string, stdout: string, extra: Record<string, unknown> = {}) => ({
  plugin: 'test-cards', component: 'ToolResult',
  props: { tool_use_id: id, tool: 'Bash', output: { stdout, stderr: '', interrupted: false }, isErrored: false, ...extra },
}) as any

for (const surface of ['terminal', 'desktop'] as const)
  test(`${surface}: a test run folds to its summary with failing names, and unfolds; other output and ctrl+o are left alone`, async ($, on) => {
    mock.store(on)
    on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
    let ui = await $.ui.mount({ ...result('t1', PYTEST), surface })
    expect(await ui.find({ type: 'Text', text: /98 passed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /✗ tests\/test_api.py::test_login/ })).toBeDefined()
    expect(await ui.find({ key: 'tests-t1', text: /show output/ })).toBeDefined()
    await ui.press({ key: 'tests-t1' })
    expect(await ui.find({ key: 'tests-t1', text: /hide output/ })).toBeDefined()
    await ui.unmount()
    // A failing run exits non-zero: errored, its output the error text.
    ui = await $.ui.mount({ ...result('t9', ''), props: { ...result('t9', '').props, isErrored: true, output: `Exit code 1\n${PYTEST}` }, surface })
    expect(await ui.find({ type: 'Text', text: /✗ 2 failed/ })).toBeDefined()
    await ui.unmount()
    for (const [props, why] of [
      [result('t2', 'hello world'), 'not a test run'],
      [result('t3', PYTEST, { isExpanded: true }), 'ctrl+o'],
      [{ ...result('t4', PYTEST), props: { ...result('t4', PYTEST).props, tool: 'Read' } }, 'not Bash'],
    ] as const) {
      ui = await $.ui.mount({ ...props, surface })
      expect([why, await ui.find({ key: `tests-${props.props.tool_use_id}` })]).toEqual([why, undefined])
      await ui.unmount()
    }
  })
