#!/usr/bin/env node
// Runs what the GitHub check runs, locally, for every mod in .claude-plugin/marketplace.json
// (or only the ones named). No dependencies: plain Node and the claude CLI.
//
//   node scripts/mods.mjs list
//   node scripts/mods.mjs validate [mod...]
//   node scripts/mods.mjs test [mod...]
//   node scripts/mods.mjs check [mod...]     # validate + test, like CI
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'))

const all = readJson('.claude-plugin/marketplace.json').plugins.map(p => p.source.replace(/^\.\//, ''))
const [cmd = 'check', ...names] = process.argv.slice(2)
const unknown = names.filter(n => !all.includes(n))
if (unknown.length) {
  console.error(`Unknown mod: ${unknown.join(', ')}. Mods: ${all.join(', ')}`)
  process.exit(2)
}
const mods = names.length ? names : all

function run(args, cwd) {
  const r = spawnSync('claude', args, { cwd, encoding: 'utf8' })
  if (r.error) {
    console.error(`Could not run claude: ${r.error.message}`)
    process.exit(2)
  }
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` }
}

function validate(mod) {
  const { ok, out } = run(['plugin', 'validate', mod], root)
  // CI fails on warnings too: "passed with warnings" covers type errors.
  if (ok && out.includes('passed with warnings')) return { ok: false, out: `${out}\n(validation has warnings)` }
  return { ok, out }
}

const test = mod => run(['plugin', 'test', '.'], join(root, mod))

if (cmd === 'list') {
  for (const mod of all) {
    const { version, description = '' } = readJson(`${mod}/.claude-plugin/plugin.json`)
    console.log(`${mod.padEnd(16)} ${version.padEnd(9)} ${description}`)
  }
  process.exit(0)
}

const steps = { validate: [validate], test: [test], check: [validate, test] }[cmd]
if (!steps) {
  console.error(`Unknown command ${cmd}. Use list, validate, test or check.`)
  process.exit(2)
}

const failed = []
for (const mod of mods) {
  for (const step of steps) {
    const { ok, out } = step(mod)
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${mod} ${step.name}`)
    if (!ok) {
      console.log(out.trim().replace(/^/gm, '     '))
      failed.push(`${mod} ${step.name}`)
      break
    }
  }
}
if (failed.length) {
  console.log(`\nFailed: ${failed.join(', ')}`)
  process.exit(1)
}
console.log(`\nAll ${mods.length} mod(s) passed.`)
