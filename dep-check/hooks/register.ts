// dep-check: when Claude installs a package (npm, pnpm, yarn, bun, pip, uv, poetry), looks it up
// first: version, license, weekly downloads, how new it is. A name one letter off a popular
// package, a barely used one, or a brand new one is stopped until the user says /deps allow.
import type { EngineInterface, Register } from 'claude-code'

import { judge, wanted } from './rules'
import type { Info, Wanted } from './rules'

type $T = EngineInterface

const STORE_ON = 'on-v1'
const MAX_LOOKUPS = 6
const LOOKUP_MS = 6000

async function json($: $T, url: string): Promise<{ status: number; body?: any }> {
  const r = await $.http.fetch(url, { headers: { accept: 'application/json' } })
  if (!r.ok) return { status: r.status }
  return { status: r.status, body: JSON.parse(r.text) }
}

const licenseOf = (l: unknown) =>
  typeof l === 'string' ? l : l && typeof l === 'object' && 'type' in l ? String((l as { type: unknown }).type) : undefined

async function npm($: $T, name: string): Promise<Info> {
  const [latest, dl] = await Promise.all([
    json($, `https://registry.npmjs.org/${name}/latest`),
    json($, `https://api.npmjs.org/downloads/point/last-week/${name}`).catch(() => ({ status: 0, body: undefined })),
  ])
  if (latest.status === 404) return { missing: true }
  return {
    version: latest.body?.version,
    license: licenseOf(latest.body?.license),
    weekly: typeof dl.body?.downloads === 'number' ? dl.body.downloads : undefined,
  }
}

async function pypi($: $T, name: string): Promise<Info> {
  const [meta, stats] = await Promise.all([
    json($, `https://pypi.org/pypi/${name}/json`),
    json($, `https://pypistats.org/api/packages/${name.toLowerCase()}/recent`).catch(() => ({ status: 0, body: undefined })),
  ])
  if (meta.status === 404) return { missing: true }
  const info = meta.body?.info ?? {}
  const classifier = (info.classifiers ?? []).find((c: string) => c.startsWith('License :: '))?.split(' :: ').at(-1)
  const raw = info.license_expression || (info.license && String(info.license).split('\n')[0]!.length <= 40 ? info.license : '') || classifier
  let first: number | undefined
  for (const files of Object.values(meta.body?.releases ?? {}) as { upload_time_iso_8601?: string }[][])
    for (const f of files) {
      const t = f.upload_time_iso_8601 ? Date.parse(f.upload_time_iso_8601) : NaN
      if (!Number.isNaN(t) && (first === undefined || t < first)) first = t
    }
  return {
    version: info.version,
    license: raw || undefined,
    weekly: typeof stats.body?.data?.last_week === 'number' ? stats.body.data.last_week : undefined,
    firstRelease: first,
  }
}

/** What the registry says, or undefined when it can't be reached in time. */
async function lookup($: $T, w: Wanted): Promise<Info | undefined> {
  const ask = (w.eco === 'npm' ? npm($, w.name) : pypi($, w.name)).catch(() => undefined)
  const late = $.clock.sleep(LOOKUP_MS).then(() => undefined)
  return Promise.race([ask, late])
}

export const register: Register = (on, options) => {
  const minWeekly = Math.max(0, Number(options.minWeekly ?? 500))
  let isOn = true
  const allowed = new Set<string>()

  on('session.start', async ($, e, next) => {
    if ((await $.store.get(STORE_ON)) === false) isOn = false
    await $.command.register({ name: 'deps', description: 'dep-check: allow a package, or turn it on or off', argumentHint: '[allow <name>|on|off]' })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isOn) return next(e)
    const asks = wanted(String(e.command ?? '')).filter(w => !allowed.has(w.name.toLowerCase()))
    if (!asks.length) return next(e)
    const now = await $.clock.now()
    const shown = asks.slice(0, MAX_LOOKUPS)
    const infos = await Promise.all(shown.map(w => lookup($, w)))
    const verdicts = shown.map((w, i) => ({ w, ...judge(w, infos[i], now, { minWeekly }) }))
    const stopped = verdicts.filter(v => v.block)
    if (stopped.length) {
      $.ui.toast(`dep-check stopped installing ${stopped.map(v => v.w.name).join(', ')}`)
      return {
        deny:
          `dep-check stopped this install: ${stopped.map(v => v.line).join(' ')} ` +
          `Ask the user whether this is the package they want. If it is, they can run \`/deps allow ${stopped[0]!.w.name}\` and you can try again; if not, use the right name.`,
      }
    }
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const note = `dep-check: ${verdicts.map(v => v.line).join('; ')}${asks.length > shown.length ? `; and ${asks.length - shown.length} more not looked up` : ''}.`
    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'deps' }, async ($, e) => {
    const [verb, ...names] = e.args.trim().split(/\s+/).filter(Boolean)
    if (verb === 'allow' && names.length) {
      for (const n of names) allowed.add(n.toLowerCase())
      return { text: `dep-check will let ${names.join(', ')} install this session.` }
    }
    if (verb === 'on' || verb === 'off') {
      isOn = verb === 'on'
      await $.store.set(STORE_ON, isOn)
      return { text: isOn ? 'dep-check is on.' : 'dep-check is off until /deps on.' }
    }
    return {
      text: `dep-check is ${isOn ? 'on' : 'off'}. Allowed this session: ${[...allowed].join(', ') || 'none'}. Use /deps allow <name> to let a stopped package install.`,
    }
  })
}
