# test-cards

A test run's output in the transcript folds to one line, with the failing tests named under it:

```
⏺ Bash(npm test)
  ✓ 140 passed · ✗ 2 failed · 1 skipped · 4.21s · vitest  show output ▾
    ✗ src/b.test.ts > b > adds numbers
    ✗ src/b.test.ts > b > keeps order
```

**show output** unfolds the runner's own output, and **hide output** folds it again. Only the drawing changes: Claude still reads every line. The ctrl+o transcript shows everything as it was.

## Install

```sh
claude plugin marketplace add kg-ng/claude-mods
claude plugin install test-cards@claude-mods
```

Restart Claude Code.

## Runners

It reads the summary each runner prints, so it works however you start them (`npm test`, `npx vitest`, `make test`):

| Runner | Reads |
|---|---|
| vitest | `Tests  2 failed \| 140 passed (142)`, `Duration`, `FAIL` and `×` lines |
| jest | `Tests: 3 failed, 142 passed, 145 total`, `Time:`, `●` lines |
| pytest | `=== 2 failed, 98 passed in 4.20s ===`, `FAILED` lines |
| go test | `--- FAIL:` lines, `ok` and `FAIL` package lines |
| cargo test | `test result:` lines, `... FAILED` lines |
| bun test | `30 pass`, `2 fail`, `Ran 32 tests`, `(fail)` lines |
| mocha | `12 passing (40ms)`, `1 failing` |

Output that isn't a test run, and background commands, are left alone.
