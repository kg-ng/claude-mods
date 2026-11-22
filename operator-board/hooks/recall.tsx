import { atom, read, update } from 'claude-code'

import type { Ask, Look } from '../types'
import { dim } from './look'
import { dayTime, oneLine } from './util'
import type { $T } from './util'

/** Earlier questions and the answers they got, saved across sessions and searchable. */
const STORE_RECALL = 'recall-v1'
const RECALL_CAP = 500

const recallIndex = atom({ plugin: 'operator-board', key: 'recallIndex' } as const, [], {
  shape: 'recall-1',
})
const recallQuery = atom({ plugin: 'operator-board', key: 'recallQuery' } as const, '')
const recallPick = atom({ plugin: 'operator-board', key: 'recallPick' } as const, null)

/** Loads the saved index at session start. */
export async function loadRecall($: $T) {
  const stored = (await $.store.get(STORE_RECALL)) as Ask[] | undefined
  if (Array.isArray(stored)) await update($, recallIndex, () => stored)
}

/** Saves an answered question (replacing an earlier copy of it), keeping the newest RECALL_CAP. */
export async function saveRecall($: $T, entry: Ask) {
  const next_ = [...(await read($, recallIndex)).filter(a => a.id !== entry.id), entry].slice(-RECALL_CAP)
  await update($, recallIndex, () => next_)
  await $.store.set(STORE_RECALL, next_)
}

export async function recallCount($: $T): Promise<number> {
  return (await read($, recallIndex)).length
}

/** /recall <words>: search for them, back on the list. */
export async function setRecallQuery($: $T, q: string) {
  await update($, recallQuery, () => q)
  await update($, recallPick, () => null)
}

export function search(index: readonly Ask[], query: string): Ask[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const phrases: string[] = []
  const rest = q.replace(/"([^"]+)"/g, (_, p: string) => {
    phrases.push(p)
    return ' '
  })
  const words = rest.split(/\s+/).filter(Boolean)
  const terms = [...phrases, ...words]
  const scored: { ask: Ask; score: number }[] = []
  for (const ask of index) {
    const qText = ask.question.toLowerCase()
    const aText = (ask.answer ?? '').toLowerCase()
    if (!terms.every(t => qText.includes(t) || aText.includes(t))) continue
    const score = terms.filter(t => qText.includes(t)).length * 10 + ask.at / 1e13
    scored.push({ ask, score })
  }
  return scored.sort((a, b) => b.score - a.score).map(s => s.ask)
}

// ---------- the section ----------
export async function recallBody($: $T, e: any, L: Look) {
  const { Box, Button, Text, Input, Markdown } = $.ui.resolve(e)
  const index = await read($, recallIndex)
  const query = await read($, recallQuery)
  const pickId = await read($, recallPick)
  const picked = pickId ? index.find(a => a.id === pickId) : undefined
  const hits = search(index, query).slice(0, 30)

  return (
    <Box flexDirection="column" gap={1}>
      <Input
        key="recall-q"
        label="Find"
        placeholder='words, or "a phrase"'
        value={query}
        submitLabel="search"
        onSubmit={(v: string) => {
          void update($, recallPick, () => null)
          return update($, recallQuery, () => v)
        }}
      />
      {picked ? (
        <Box flexDirection="column" gap={1}>
          <Button key="recall-back" plain label="← back to list" onPress={() => update($, recallPick, () => null)} />
          <Text {...dim(L)}>{dayTime(picked.at)}</Text>
          <Text color={L.accent} bold>
            You asked
          </Text>
          <Text>{picked.question}</Text>
          <Text color={L.accent} bold>
            Answer
          </Text>
          <Markdown text={picked.answer ?? '(no answer recorded)'} />
        </Box>
      ) : (
        <Box flexDirection="column">
          {!query && (
            <Text {...dim(L)}>
              {index.length} saved question{index.length === 1 ? '' : 's'}. Type words to search.
            </Text>
          )}
          {query && (
            <Text {...dim(L)}>
              {hits.length} earlier question{hits.length === 1 ? '' : 's'} match "{query}"
            </Text>
          )}
          {hits.map(a => (
            <Button key={`hit-${a.id}`} plain onPress={() => update($, recallPick, () => a.id)}>
              <Text {...dim(L)}>{dayTime(a.at)}</Text> {oneLine(a.question, 90)}
            </Button>
          ))}
          {query && hits.length > 0 && (
            <Text {...dim(L)}>Picking a question shows it with the reply it got.</Text>
          )}
        </Box>
      )}
    </Box>
  )
}
