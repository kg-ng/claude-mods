# claude-mods

Local Claude Code mods, installed from this folder as a plugin marketplace.

| Mod | What it does |
|---|---|
| `operator-board` | One side pane: board (needs-reply, pending, shared across sessions), to-do list with autopilot, usage meter, git, sessions with resume and checkpoints, quick prompts, PRs, recall. |
| `persona` | Themes for the terminal, chat and panels: colours, tool icons, spinner frames and an animated scene while Claude works. 24 built-ins; make your own with `/persona new` or by asking Claude. |

## Install

```sh
claude plugin marketplace add ~/dev/project/claude-mods
claude plugin install operator-board@claude-mods
claude plugin install persona@claude-mods
```

After editing a mod, bump its `version` in `.claude-plugin/plugin.json`, then:

```sh
claude plugin marketplace update claude-mods
claude plugin update <mod>@claude-mods   # restart Claude Code to load it
```

## Test

```sh
cd operator-board && claude plugin test . && claude plugin validate .
cd persona && claude plugin test . && claude plugin validate .
```
