// check-on-edit: after each edit Claude makes, runs the project's own linter (and, if you turn it
// on, typechecker) on that file, and hands what it finds back to Claude in the same turn.
import type { EngineInterface, Register } from 'claude-code'

import { checkersFor, problems, report } from './checkers'
import type { Toolbox } from './checkers'

type $T = EngineInterface

const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const STORE_ON = 'on-v1'

async function which($: $T, name: string, cwd: string): Promise<string[] | undefined> {
  const r = await $.process.run(['which', name], { cwd, timeoutMs: 3000 }).catch(() => undefined)
  return r?.exitCode === 0 && r.stdout.trim() ? [r.stdout.trim()] : undefined
}

async function anyExists($: $T, root: string, names: string[]) {
  for (const n of names) if (await $.fs.exists(`${root}/${n}`)) return true
  return false
}

/** What the project has, looked up once per session root. */
async function findTools($: $T, root: string): Promise<Toolbox> {
  const box: Toolbox = {}
  const bin = (n: string) => `${root}/node_modules/.bin/${n}`
  if ((await $.fs.exists(bin('biome'))) && (await anyExists($, root, ['biome.json', 'biome.jsonc']))) box.biome = [bin('biome')]
  if (
    (await $.fs.exists(bin('eslint'))) &&
    (await anyExists($, root, ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml']))
  )
    box.eslint = [bin('eslint')]
  if ((await $.fs.exists(bin('tsc'))) && (await $.fs.exists(`${root}/tsconfig.json`))) box.tsc = [bin('tsc')]
  if (await anyExists($, root, ['pyproject.toml', 'ruff.toml', '.ruff.toml', 'setup.py', 'requirements.txt'])) {
    box.ruff = (await $.fs.exists(`${root}/.venv/bin/ruff`)) ? [`${root}/.venv/bin/ruff`] : await which($, 'ruff', root)
    box.mypy = (await $.fs.exists(`${root}/.venv/bin/mypy`)) ? [`${root}/.venv/bin/mypy`] : await which($, 'mypy', root)
  }
  if (await $.fs.exists(`${root}/go.mod`)) {
    box.gofmt = await which($, 'gofmt', root)
    box.govet = await which($, 'go', root)
  }
  box.shellcheck = await which($, 'shellcheck', root)
  for (const k of Object.keys(box) as (keyof Toolbox)[]) if (!box[k]) delete box[k]
  return box
}

const found = new Map<string, Promise<Toolbox>>()

/** The project's tools, found once per root this session. */
function toolbox($: $T, root: string) {
  if (!found.has(root)) found.set(root, findTools($, root))
  return found.get(root)!
}

export const register: Register = (on, options) => {
  const typecheck = options.typecheck === true
  const custom = String(options.command ?? '').trim() || undefined
  let isOn = true
  let last = ''

  on('session.start', async ($, e, next) => {
    if ((await $.store.get(STORE_ON)) === false) isOn = false
    await $.command.register({ name: 'checks', description: 'check-on-edit on, off, or what it found last', argumentHint: '[on|off]' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (!isOn || !EDIT_TOOLS.includes(tool)) return next(e)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const input = e as unknown as { file_path?: string; notebook_path?: string }
    const abs = String(input.file_path ?? input.notebook_path ?? '')
    const root = (await $.session.cwd()).replace(/\/+$/, '')
    if (!abs.startsWith(root + '/') || abs.includes('/node_modules/')) return ran
    const file = abs.slice(root.length + 1)
    const checks = checkersFor(file, await toolbox($, root), { typecheck, custom })
    if (!checks.length) return ran
    const results = await Promise.all(
      checks.map(async c => {
        const r = await $.process.run(c.argv, { cwd: root, timeoutMs: c.timeoutMs }).catch(() => undefined)
        return { name: c.name, lines: r ? problems(c.name, file, r) : [] }
      }),
    )
    const note = report(file, results)
    const total = results.reduce((n, f) => n + f.lines.length, 0)
    last = note ?? `${file}: ${checks.map(c => c.name).join(', ')} clean.`
    $.ui.status(total ? `checks: ${total} problem${total === 1 ? '' : 's'} in ${file.split('/').at(-1)}` : undefined)
    if (!note) return ran
    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'checks' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      isOn = arg === 'on'
      await $.store.set(STORE_ON, isOn)
      if (!isOn) $.ui.status(undefined)
      return { text: isOn ? 'check-on-edit is on.' : 'check-on-edit is off until /checks on.' }
    }
    const box = await toolbox($, (await $.session.cwd()).replace(/\/+$/, ''))
    const have = custom ? `your command: ${custom}` : Object.keys(box).join(', ') || 'none found in this project'
    return { text: [`check-on-edit is ${isOn ? 'on' : 'off'}. Checks: ${have}${typecheck ? ' (typecheck on)' : ''}.`, ...(last ? ['Last:', last] : [])].join('\n') }
  })
}
