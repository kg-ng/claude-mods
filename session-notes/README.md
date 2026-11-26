# session-notes

`/handoff` writes a handoff note for the session, for a teammate or for you tomorrow:

```markdown
# Handoff: app (feat/login)

2026-11-26 · session of 1 h 35 min

## Asked
- add a login page

## Done
- a1b2c3d Add login page
- Claude edited 2 files: `src/login.tsx`, `src/auth.ts`

## Checks
- ✗ `npm test`

## Not committed
- `M src/auth.ts`

## Next
- Fix what fails: `npm test`.
- Commit or drop the uncommitted changes.
```

It's built from what happened: the prompts you typed (first line of each), commits since the session started, files Claude edited, the last result of each test, lint, typecheck or build command, and `git status`. No model call, so it's instant and free.

## Install

```sh
claude plugin marketplace add kg-ng/claude-mods
claude plugin install session-notes@claude-mods
```

Restart Claude Code.

operator-board's **checkpoint** saves a line or two to resume from. A handoff note is the longer record you share.

## Commands

| Command | What it does |
|---|---|
| `/handoff` | Shows the note |
| `/handoff save [path]` | Also writes it to a file, `.claude/handoff.md` by default |
| `/handoff pr` | Puts a request in the prompt box for Claude to write a PR title and description from the note. Nothing is sent until you press Enter |
