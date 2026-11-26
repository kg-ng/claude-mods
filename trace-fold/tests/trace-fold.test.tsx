import { expect, mock, test } from 'claude-code/testing'
import { fold } from '../hooks/frames'

const NODE = `TypeError: Cannot read properties of undefined (reading 'id')
    at getUser (/work/app/src/users.ts:14:22)
    at Layer.handle [as handle_request] (/work/app/node_modules/express/lib/router/layer.js:95:5)
    at next (/work/app/node_modules/express/lib/router/route.js:149:13)
    at Route.dispatch (/work/app/node_modules/express/lib/router/route.js:119:3)
    at Layer.handle [as handle_request] (/work/app/node_modules/express/lib/router/layer.js:95:5)
    at /work/app/node_modules/express/lib/router/index.js:284:15
    at Function.process_params (/work/app/node_modules/express/lib/router/index.js:346:12)
    at handler (/work/app/src/server.ts:30:5)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)`

const PYTHON = `Traceback (most recent call last):
  File "/work/app/app/main.py", line 8, in <module>
    run()
  File "/work/app/.venv/lib/python3.12/site-packages/click/core.py", line 1157, in __call__
    return self.main(*args, **kwargs)
  File "/work/app/.venv/lib/python3.12/site-packages/click/core.py", line 1078, in main
    rv = self.invoke(ctx)
  File "/work/app/.venv/lib/python3.12/site-packages/click/core.py", line 783, in invoke
    return __callback(*args, **kwargs)
  File "/work/app/app/cli.py", line 21, in run
    total = 1 / 0
            ~~^~~
ZeroDivisionError: division by zero`

const JAVA = `java.lang.IllegalStateException: boom
\tat com.acme.Orders.place(Orders.java:42)
\tat java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)
\tat java.base/java.lang.reflect.Method.invoke(Method.java:580)
\tat org.junit.platform.commons.util.ReflectionUtils.invokeMethod(ReflectionUtils.java:728)
\tat com.acme.OrdersTest.places(OrdersTest.java:12)`

test('folds runs of library frames and keeps yours', () => {
  const n = fold(NODE)
  expect(n.text.split('\n')).toEqual([
    "TypeError: Cannot read properties of undefined (reading 'id')",
    '    at getUser (/work/app/src/users.ts:14:22)',
    '    … 6 library frames (express)',
    '    at handler (/work/app/src/server.ts:30:5)',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
  ])
  expect(n.hidden).toBe(6)

  const py = fold(PYTHON)
  expect(py.text).toMatch(/File "\/work\/app\/app\/main.py", line 8, in <module>\n    run\(\)\n  … 3 library frames \(click\)\n  File "\/work\/app\/app\/cli.py"/)
  expect(py.text).toMatch(/ZeroDivisionError/)
  expect(py.hidden).toBe(3)

  const j = fold(JAVA)
  expect(j.text).toMatch(/Orders\.place\(Orders\.java:42\)\n\t… 3 library frames/)
  expect(j.text).toMatch(/OrdersTest\.places/)
})

test('a short run, or output with no trace, is left as it is', () => {
  const two = 'Error: x\n    at a (/w/src/a.ts:1:1)\n    at b (/w/node_modules/x/b.js:1:1)\n    at c (/w/node_modules/x/c.js:1:1)'
  expect(fold(two)).toEqual({ text: two, hidden: 0, groups: 0 })
  for (const text of ['', 'build ok in 2.1s', 'meet at noon (lunch)'])
    expect(fold(text)).toEqual({ text, hidden: 0, groups: 0 })
})

const result = (id: string, output: unknown, extra: Record<string, unknown> = {}) => ({
  plugin: 'trace-fold', component: 'ToolResult',
  props: { tool_use_id: id, tool: 'Bash', output, isErrored: false, ...extra },
}) as any

for (const surface of ['terminal', 'desktop'] as const)
  test(`${surface}: a trace draws folded, unfolds on press; output with none is left alone`, async ($, on) => {
    mock.store(on)
    on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
    let ui = await $.ui.mount({ ...result('t1', `Exit code 1\n${NODE}`, { isErrored: true }), surface })
    expect(await ui.find({ type: 'Text', text: /6 library frames folded/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /… 6 library frames \(express\)/ })).toBeDefined()
    await ui.press({ key: 'trace-t1' })
    expect(await ui.find({ key: 'trace-t1', text: /fold again/ })).toBeDefined()
    await ui.unmount()
    ui = await $.ui.mount({ ...result('t2', { stdout: 'all good', stderr: '', interrupted: false }), surface })
    expect(await ui.find({ key: 'trace-t2' })).toBeUndefined()
    await ui.unmount()
  })
