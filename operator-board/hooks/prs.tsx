import { atom, read, update } from 'claude-code'

import type { Look, Pr, PrSnapshot } from '../types'
import { alert } from './extras'
import { dim } from './look'
import { age, hhmm, oneLine } from './util'
import type { $T } from './util'

/** Your open PRs: fetched with gh, shown in the PRs section and counted on the band. */
export const PR_EVERY_MS = 3 * 60 * 1000

// Change a shape tag when that value's fields change.
const prs = atom(
  { plugin: 'operator-board', key: 'prs' } as const,
  { updatedAt: 0, items: [] },
  { shape: 'prs-1' },
)

/** What the band and the pane header need: how many PRs, how many red, when last fetched. */
export async function prStats($: $T) {
  const snap = await read($, prs)
  return {
    total: snap.items.length,
    red: snap.items.filter(p => p.status === 'red').length,
    toReview: snap.toReview?.length ?? 0,
    updatedAt: snap.updatedAt,
  }
}

/** `repo:branch` of each of your open PRs: Git's "open PR" step hides for a branch that has one. */
export async function openPrKeys($: $T): Promise<Set<string>> {
  return new Set((await read($, prs)).items.map(p => `${p.repo}:${p.branch ?? ''}`))
}

const PR_QUERY = `query($q:String!){ search(query:$q, type:ISSUE, first:30){ nodes{ ... on PullRequest {
  number title url isDraft createdAt repository{nameWithOwner} headRefOid headRefName reviewDecision
  reviewThreads(first:100){nodes{isResolved}}
  commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){nodes{
    __typename ... on CheckRun{name status conclusion} ... on StatusContext{context state}
  }}}}}}
} } } }`

type GqlCtx = {
  __typename: string
  name?: string
  status?: string
  conclusion?: string | null
  context?: string
  state?: string
}

function toPr(n: any): Pr {
  const ctxs: GqlCtx[] =
    n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  const ci = { passed: 0, failed: 0, running: 0, skipped: 0, failedNames: [] as string[] }
  for (const c of ctxs) {
    const name = c.name ?? c.context ?? '?'
    const verdict =
      c.__typename === 'CheckRun'
        ? c.status !== 'COMPLETED'
          ? 'PENDING'
          : (c.conclusion ?? 'PENDING')
        : (c.state ?? 'PENDING')
    if (verdict === 'SUCCESS') ci.passed += 1
    else if (verdict === 'SKIPPED' || verdict === 'NEUTRAL') ci.skipped += 1
    else if (verdict === 'PENDING' || verdict === 'EXPECTED' || verdict === 'QUEUED')
      ci.running += 1
    else {
      ci.failed += 1
      ci.failedNames.push(name)
    }
  }
  const openThreads = (n.reviewThreads?.nodes ?? []).filter(
    (t: { isResolved: boolean }) => !t.isResolved,
  ).length
  const status: Pr['status'] =
    ci.failed > 0
      ? 'red'
      : ci.running > 0
        ? 'running'
        : openThreads > 0 || n.reviewDecision === 'CHANGES_REQUESTED'
          ? 'attention'
          : n.isDraft
            ? 'draft'
            : 'ready'
  return {
    repo: n.repository?.nameWithOwner ?? '?',
    number: n.number,
    title: n.title,
    url: n.url,
    isDraft: !!n.isDraft,
    createdAt: n.createdAt,
    head: String(n.headRefOid ?? '').slice(0, 7),
    branch: n.headRefName ?? undefined,
    reviewDecision: n.reviewDecision ?? null,
    openThreads,
    ci,
    status,
  }
}

const ORDER: Record<Pr['status'], number> = {
  red: 0,
  attention: 1,
  running: 2,
  draft: 3,
  ready: 4,
}

/** Runs one PR search through gh; the PRs it finds, or the error. */
async function searchPrs($: $T, q: string): Promise<{ list: Pr[] } | { error: string }> {
  const out = await $.process.run(['gh', 'api', 'graphql', '-f', `query=${PR_QUERY}`, '-f', `q=${q}`], {
    timeoutMs: 30000,
  })
  if (out.exitCode !== 0) return { error: oneLine(out.stderr || 'gh failed', 160) }
  const nodes = JSON.parse(out.stdout)?.data?.search?.nodes ?? []
  return { list: nodes.filter((n: any) => n && n.number).map(toPr) }
}

/** CI that finished green on the same commit it was running or failing on. */
export function ciJustPassed(before: Pr | undefined, now: Pr): boolean {
  if (!before || before.head !== now.head) return false
  const wasPending = before.ci.running > 0 || before.ci.failed > 0
  return wasPending && now.ci.running === 0 && now.ci.failed === 0 && now.ci.passed > 0
}

let refreshing = false
export async function refreshPrs($: $T) {
  if (refreshing) return
  refreshing = true
  try {
    const mine = await searchPrs($, 'is:pr is:open author:@me archived:false')
    const now = await $.clock.now()
    if ('error' in mine) {
      const error = mine.error
      await update($, prs, p => ({ ...p, error })).catch(() => undefined)
      return
    }
    const list = mine.list.sort((a: Pr, b: Pr) => ORDER[a.status] - ORDER[b.status])
    // Asked for your review: a separate search; a failure here leaves your own PRs showing.
    const asked = await searchPrs($, 'is:pr is:open review-requested:@me archived:false').catch(() => ({ list: [] }))
    const toReview = 'list' in asked ? asked.list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)) : []
    const before = await read($, prs)
    await update($, prs, (): PrSnapshot => ({ updatedAt: now, items: list, toReview }))
    if (before.updatedAt > 0) {
      for (const pr of list.filter(x => x.status === 'red'))
        await alert($, `pr-red-${pr.repo}-${pr.number}-${pr.head}`, `CI failed: #${pr.number} ${oneLine(pr.title, 50)}`)
      for (const pr of list) {
        const was = before.items.find(b => b.repo === pr.repo && b.number === pr.number)
        if (ciJustPassed(was, pr))
          await alert($, `ci-pass-${pr.repo}-${pr.number}-${pr.head}`, `CI passed: #${pr.number} ${oneLine(pr.title, 50)}`)
      }
    }
  } catch (err) {
    const error = oneLine(String(err), 160)
    // The session may be gone by now (a refresh outliving it): nothing left to tell.
    await update($, prs, p => ({ ...p, error })).catch(() => undefined)
  } finally {
    refreshing = false
  }
}

/** The one-click next step for a PR that needs work, as a prompt to fill in. */
export function prAction(p: Pr): { label: string; text: string } | undefined {
  const ref = `${p.repo}#${p.number} (${p.url})`
  if (p.status === 'red')
    return {
      label: 'fix CI',
      text: `Fix the failing CI on ${ref}. Failing checks: ${p.ci.failedNames.join(', ') || 'unknown'}.`,
    }
  if (p.status === 'attention')
    return {
      label: p.openThreads ? 'address threads' : 'address review',
      text: p.openThreads
        ? `Address the ${p.openThreads} open review thread${p.openThreads > 1 ? 's' : ''} on ${ref}.`
        : `Address the requested changes on ${ref}.`,
    }
  return undefined
}

/** A PR's second row: what's wrong first, then CI when it's a separate problem, then age. */
export function prStatusLine(p: Pr, now: number): string {
  const { passed, failed, running, skipped, failedNames } = p.ci
  const total = passed + failed + running + skipped
  const names = failedNames.slice(0, 2).join(', ') + (failedNames.length > 2 ? ` +${failedNames.length - 2}` : '')
  const ci = failed
    ? `CI red: ${names || `${failed} failed`}`
    : running
      ? `CI ${total - running}/${total}`
      : total
        ? 'CI green'
        : 'no checks'
  const parts =
    p.status === 'attention'
      ? [p.openThreads ? `${p.openThreads} thread${p.openThreads > 1 ? 's' : ''}` : 'changes requested', ci]
      : p.status === 'draft'
        ? ['draft', ci]
        : [ci]
  return [...parts, age(p.createdAt, now)].filter(Boolean).join(' · ')
}

// ---------- the section ----------
/** The prompt a review button fills: /code-review for this repo's PRs, a request naming another repo's. */
export function reviewPrompt(p: Pr, currentRepo: string): string {
  return p.repo === currentRepo ? `/code-review ${p.number}` : `Review ${p.repo}#${p.number} (${p.url}).`
}

export async function prsBody($: $T, e: any, L: Look, currentRepo: string) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const snap = await read($, prs)
  const now = await $.clock.now()
  const color = (s: Pr['status']) =>
    s === 'red' ? L.err : s === 'running' || s === 'attention' ? L.warn : L.ok
  const openUrl = (url: string) => $.process.run(['open', url])
  const full = snap.items.filter(p => p.status !== 'ready')
  const ready = snap.items.filter(p => p.status === 'ready')
  const toReview = snap.toReview ?? []

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2}>
        <Text {...dim(L)}>
          {snap.updatedAt ? `updated ${hhmm(snap.updatedAt)}` : 'loading…'}
        </Text>
        <Button key="pr-refresh" plain label="refresh" onPress={() => refreshPrs($)} />
      </Box>
      {snap.error && <Text color={L.err}>{snap.error}</Text>}
      {snap.updatedAt > 0 && snap.items.length === 0 && (
        <Text {...dim(L)}>No open PRs authored by you.</Text>
      )}
      {full.map(p => {
        const act = prAction(p)
        return (
          <Box flexDirection="column" key={`pr-${p.repo}-${p.number}`}>
            <Button key={`open-${p.repo}-${p.number}`} plain onPress={() => openUrl(p.url)}>
              <Text wrap="truncate-end">
                <Text color={L.accent} bold>
                  #{p.number} {p.title}
                </Text>
                <Text {...dim(L)}> {p.repo.split('/').pop()}</Text>
              </Text>
            </Button>
            <Box flexDirection="row" gap={1}>
              <Box flexGrow={1}>
                <Text wrap="truncate-end" color={color(p.status)}>
                  {'  '}
                  {prStatusLine(p, now)}
                </Text>
              </Box>
              {act && (
                <Button
                  key={`pract-${p.repo}-${p.number}`}
                  plain
                  variant="primary"
                  label={act.label}
                  onPress={() => $.prompt.fill({ text: act.text, mode: 'replace' })}
                />
              )}
            </Box>
          </Box>
        )
      })}
      {ready.length > 0 && (
        <Box flexDirection="column">
          <Text color={L.ok} bold>
            Ready ({ready.length})
          </Text>
          {ready.map(p => (
            <Box flexDirection="row" gap={1} key={`ready-row-${p.repo}-${p.number}`}>
              <Box flexGrow={1}>
                <Button key={`ready-${p.repo}-${p.number}`} plain onPress={() => openUrl(p.url)}>
                  <Text wrap="truncate-end">
                    <Text color={L.ok}>✓</Text> #{p.number} {oneLine(p.title, 60)}{' '}
                    <Text {...dim(L)}>{p.repo.split('/').pop()}</Text>
                  </Text>
                </Button>
              </Box>
              <Button
                key={`merge-${p.repo}-${p.number}`}
                plain
                variant="primary"
                label="merge"
                onPress={() =>
                  $.prompt.fill({ text: `Merge ${p.repo}#${p.number} (${p.url}).`, mode: 'replace' })
                }
              />
            </Box>
          ))}
        </Box>
      )}
      {toReview.length > 0 && (
        <Box flexDirection="column">
          <Text color={L.accent} bold>
            To review ({toReview.length})
          </Text>
          {toReview.map(p => (
            <Box flexDirection="row" gap={1} key={`rev-row-${p.repo}-${p.number}`}>
              <Box flexGrow={1}>
                <Button key={`rev-${p.repo}-${p.number}`} plain onPress={() => openUrl(p.url)}>
                  <Text wrap="truncate-end">
                    #{p.number} {oneLine(p.title, 60)}{' '}
                    <Text {...dim(L)}>
                      {p.repo.split('/').pop()} · {age(p.createdAt, now)}
                    </Text>
                  </Text>
                </Button>
              </Box>
              <Button
                key={`review-${p.repo}-${p.number}`}
                plain
                variant="primary"
                label="review"
                onPress={() => $.prompt.fill({ text: reviewPrompt(p, currentRepo), mode: 'replace' })}
              />
            </Box>
          ))}
        </Box>
      )}
      <Text {...dim(L)}>Click a PR to open it in the browser.</Text>
    </Box>
  )
}
