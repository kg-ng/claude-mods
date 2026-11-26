# check-on-edit

After each edit Claude makes, check-on-edit runs your project's own linter on that file and hands what it finds back to Claude in the same turn. Claude fixes a lint error right away, instead of finding it three turns later in CI.

```
check-on-edit: after this edit, eslint reports 1 problem in src/a.ts:
[eslint] src/a.ts:3:7: 'x' is assigned a value but never used. [Error/no-unused-vars]
```

The status line shows `checks: 1 problem in a.ts` until a clean run clears it.

## Install

```sh
claude plugin marketplace add kg-ng/claude-mods
claude plugin install check-on-edit@claude-mods
```

Restart Claude Code.

## What it runs

Only tools your project already has, and only ones that report: none of them rewrites the file, so Claude's next edit finds it as it left it.

| Files | Check | Runs when |
|---|---|---|
| `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` | biome lint, else eslint | `node_modules/.bin/biome` and a `biome.json`, or `node_modules/.bin/eslint` and an eslint config |
| `.ts` `.tsx` | tsc (errors in the edited file only) | **Typecheck too** is on, and there's a `tsconfig.json` |
| `.py` | ruff check | ruff in `.venv` or on your PATH, in a Python project |
| `.py` | mypy | **Typecheck too** is on |
| `.go` | gofmt -l, go vet on the package | a `go.mod` |
| `.sh` `.bash` | shellcheck | shellcheck is installed |

Files outside the project and in `node_modules` are skipped. Linters report the whole file, so Claude is told to leave problems that were there before its edit.

## Commands

| Command | What it does |
|---|---|
| `/checks` | Whether it's on, which checks it found, and the last result |
| `/checks off` | Turns it off, remembered across sessions |
| `/checks on` | Turns it back on |

## Settings

| Setting | Default | What it does |
|---|---|---|
| Typecheck too | off | Also run tsc or mypy after each edit. Slower on big projects |
| Your own check | empty | A command to run instead, with `{file}` for the edited file, e.g. `npx eslint {file}` |
