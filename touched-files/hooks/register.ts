// touched-files: counts the files Claude reads and edits this session, and roughly how many tokens
// of context each took. /touched draws it as a heat map, hottest first.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { add, heatMap, hits } from './heat'

const files = atom({ plugin: 'touched-files', key: 'files' } as const, [], { shape: 'files-1' })
/** Files remembered, so a very long session's list stays small. */
const KEEP = 500

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'touched', description: 'Heat map of the files Claude read and edited this session', argumentHint: '[all|clear]' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const found = hits(String(e.tool), e as unknown as Record<string, unknown>, (ran.text ?? '').length)
    if (!found.length) return ran
    const root = (await $.session.root()).replace(/\/+$/, '')
    await update($, files, list => add(list, found, root).slice(-KEEP))
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'touched' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'clear') {
      await update($, files, () => [])
      return { text: 'touched-files: cleared. Counting again from here.' }
    }
    const list = await read($, files)
    return { text: heatMap(list, arg === 'all' ? list.length : 15) }
  })
}
