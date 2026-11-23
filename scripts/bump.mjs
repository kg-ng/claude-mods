#!/usr/bin/env node
// Raises a mod's version in its .claude-plugin/plugin.json and adds the CHANGELOG.md entry,
// the two things the GitHub check wants for every mod change.
//
//   node scripts/bump.mjs <mod> [patch|minor|major] "What changed"
//
// patch is the default. Notes go in as one bullet; edit CHANGELOG.md to add more.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mods = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8')).plugins.map(p =>
  p.source.replace(/^\.\//, ''),
)

const args = process.argv.slice(2)
const mod = args.shift()
const level = ['patch', 'minor', 'major'].includes(args[0]) ? args.shift() : 'patch'
const note = args.join(' ').trim()
if (!mod || !mods.includes(mod) || !note) {
  console.error(`Usage: node scripts/bump.mjs <mod> [patch|minor|major] "What changed"\nMods: ${mods.join(', ')}`)
  process.exit(2)
}

const pluginPath = join(root, mod, '.claude-plugin/plugin.json')
const plugin = readFileSync(pluginPath, 'utf8')
const old = JSON.parse(plugin).version
const [major, minor, patch] = old.split('.').map(Number)
const next = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[level]

const changelogPath = join(root, 'CHANGELOG.md')
const changelog = readFileSync(changelogPath, 'utf8')
const heading = `\n## ${mod}\n`
const at = changelog.indexOf(heading)
if (at < 0) {
  console.error(`CHANGELOG.md has no "## ${mod}" section. Add one, then run this again.`)
  process.exit(1)
}
const insertAt = at + heading.length
const entry = `\n### ${next}\n\n- ${note}\n`

// Only the version string changes, so plugin.json keeps its formatting.
writeFileSync(pluginPath, plugin.replace(`"version": "${old}"`, `"version": "${next}"`))
writeFileSync(changelogPath, changelog.slice(0, insertAt) + entry + changelog.slice(insertAt))
console.log(`${mod}: ${old} → ${next}, with a CHANGELOG.md entry.`)
