// test-cards' parser: reads a test run's summary from what the runner printed, for the runners
// people use most. Pure, so it's tested on real output samples.

export type Summary = {
  runner: string
  passed: number
  failed: number
  skipped: number
  /** As the runner printed it: `4.2s`, `812ms`. */
  duration?: string
  /** Names of failed tests, as printed, at most a few. */
  failures: string[]
}

const MAX_NAMES = 8
// Colour codes and the cursor moves some runners print, even into a pipe.
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '')
const num = (s: string | undefined) => (s ? Number(s) : 0)
const pick = (text: string, re: RegExp) => num(re.exec(text)?.[1])

function names(text: string, res: RegExp[]): string[] {
  const out: string[] = []
  for (const re of res)
    for (const m of text.matchAll(re)) {
      const n = m[1]!.trim()
      if (n && !out.includes(n)) out.push(n)
      if (out.length >= MAX_NAMES) return out
    }
  return out
}

/** The run's summary, or undefined when the output isn't a test run's. */
export function parse(raw: string): Summary | undefined {
  const text = strip(raw)

  // vitest: "      Tests  2 failed | 140 passed | 1 skipped (143)" then "   Duration  4.21s (...)"
  const vitest = /^\s*Tests\s+((?:\d+ \w+(?: \| )?)+)\s*\(\d+\)/m.exec(text)
  if (vitest) {
    const part = vitest[1]!
    return {
      runner: 'vitest',
      passed: pick(part, /(\d+) passed/),
      failed: pick(part, /(\d+) failed/),
      skipped: pick(part, /(\d+) (?:skipped|todo)/),
      duration: /^\s*Duration\s+([\d.]+m?s)/m.exec(text)?.[1],
      failures: names(text, [/^\s*(?:FAIL|×|✗)\s+(.+?)(?:\s+\d+m?s)?$/gm]),
    }
  }

  // jest: "Tests:       3 failed, 142 passed, 145 total" then "Time:        4.2 s"
  const jest = /^Tests:\s+(.+total)$/m.exec(text)
  if (jest) {
    const part = jest[1]!
    return {
      runner: 'jest',
      passed: pick(part, /(\d+) passed/),
      failed: pick(part, /(\d+) failed/),
      skipped: pick(part, /(\d+) (?:skipped|todo)/),
      duration: /^Time:\s+([\d.]+ ?m?s)/m.exec(text)?.[1]?.replace(' ', ''),
      failures: names(text, [/^\s*● (.+?)$/gm, /^\s*✕ (.+?)(?: \(\d+ ?m?s\))?$/gm]).filter(n => !/^Test suite failed/.test(n)),
    }
  }

  // pytest: "===== 3 failed, 142 passed, 2 skipped in 4.20s ====="
  const pytest = /^=+ ((?:\d+ \w+(?:, )?)+) in ([\d.]+s)(?: \([^)]*\))? =+$/m.exec(text)
  if (pytest) {
    const part = pytest[1]!
    return {
      runner: 'pytest',
      passed: pick(part, /(\d+) passed/),
      failed: pick(part, /(\d+) failed/) + pick(part, /(\d+) errors?/),
      skipped: pick(part, /(\d+) skipped/) + pick(part, /(\d+) xfailed/),
      duration: pytest[2],
      failures: names(text, [/^(?:FAILED|ERROR) (\S+)/gm]),
    }
  }

  // cargo: "test result: FAILED. 140 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.20s"
  const cargo = [...text.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored;.*?(?:finished in ([\d.]+s))?$/gm)]
  if (cargo.length) {
    const sum = (i: number) => cargo.reduce((n, m) => n + num(m[i]), 0)
    return {
      runner: 'cargo',
      passed: sum(1),
      failed: sum(2),
      skipped: sum(3),
      duration: cargo.at(-1)![4],
      failures: names(text, [/^test (\S+) \.\.\. FAILED$/gm]),
    }
  }

  // bun: " 142 pass\n 3 fail\nRan 145 tests across 4 files. [4.20s]"
  const bun = /^Ran \d+ tests? across \d+ files?\. \[([\d.]+m?s)\]/m.exec(text)
  if (bun)
    return {
      runner: 'bun',
      passed: pick(text, /^\s*(\d+) pass$/m),
      failed: pick(text, /^\s*(\d+) fail$/m),
      skipped: pick(text, /^\s*(\d+) skip$/m),
      duration: bun[1],
      failures: names(text, [/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm]),
    }

  // mocha: "  142 passing (4s)" and "  3 failing"
  const mocha = /^\s+(\d+) passing \(([^)]+)\)/m.exec(text)
  if (mocha)
    return {
      runner: 'mocha',
      passed: num(mocha[1]),
      failed: pick(text, /^\s+(\d+) failing$/m),
      skipped: pick(text, /^\s+(\d+) pending$/m),
      duration: mocha[2],
      failures: names(text, [/^\s+\d+\) (.+?):?$/gm]),
    }

  // go test: "--- FAIL: TestX (0.00s)", "ok  \tpkg\t0.01s", "FAIL\tpkg\t0.02s". Counts packages
  // unless -v printed each test.
  const goPkgs = [...text.matchAll(/^(ok|FAIL|---)\s+(\S+)\s+(?:([\d.]+s)|\[no test files\]|\(cached\))/gm)].filter(m => m[1] !== '---')
  const goPass = (text.match(/^\s*--- PASS: /gm) ?? []).length
  const goFail = names(text, [/^\s*--- FAIL: (\S+)/gm])
  if (goPkgs.length || goFail.length) {
    const failedPkgs = goPkgs.filter(m => m[1] === 'FAIL').length
    const verbose = goPass > 0 || goFail.length > 0
    return {
      runner: 'go',
      passed: verbose ? goPass : goPkgs.length - failedPkgs,
      failed: verbose ? (text.match(/^\s*--- FAIL: /gm) ?? []).length : failedPkgs,
      skipped: (text.match(/^\s*--- SKIP: /gm) ?? []).length,
      duration: goPkgs.at(-1)?.[3],
      failures: goFail.length ? goFail : goPkgs.filter(m => m[1] === 'FAIL').map(m => m[2]!),
    }
  }
}

/** `✓ 142 passed · ✗ 3 failed · 2 skipped · 4.2s`, as plain text. */
export function line(s: Summary): string {
  return [
    `✓ ${s.passed} passed`,
    ...(s.failed ? [`✗ ${s.failed} failed`] : []),
    ...(s.skipped ? [`${s.skipped} skipped`] : []),
    ...(s.duration ? [s.duration] : []),
  ].join(' · ')
}
