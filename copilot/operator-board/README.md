# operator-board for GitHub Copilot CLI

A port of the [operator-board](../../operator-board) mod's core to [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/copilot-cli) extensions. It **shares its files with the Claude Code mod** (`~/.claude/operator-board/`), so to-dos, board items and checkpoints you make in one tool show up in the other.

| Piece | Copilot CLI | Claude Code mod |
|---|---|---|
| `board_update`, `todo_update`, `checkpoint_save` tools | ✅ same names, same files | ✅ |
| Open to-dos, needs-reply items and the latest checkpoint given to the model at session start | ✅ | ✅ |
| `/board`, `/todo <title>`, `/todo approve <id>`, `/savepoint [note]` | ✅ | pane buttons and `/savepoint` |
| Status line: context %, AI credits, to-dos, needs reply | ✅ via `statusLine.command` | the pane's Usage section |
| Side pane, hotkeys, run buttons, PRs, Git, alerts, to-do autopilot | ❌ Copilot extensions have no pane | ✅ |

Items written from Copilot carry `"source": "copilot"`.

## Requirements

- Copilot CLI with extensions, an experimental feature: start it with `copilot --experimental` (the `experimental` setting should also work). Built against 1.0.105.
- Node (Copilot runs extensions with its own).

## Install

```sh
git clone https://github.com/kg-ng/claude-mods
sh claude-mods/copilot/operator-board/install.sh
```

This copies the extension to `~/.copilot/extensions/operator-board/`. Start a new Copilot session (or `/clear`). The first time it loads, Copilot should ask you to allow the extension; allow it (in `-p` prompt mode it can't ask, so the extension stays off there). Then check:

```
/board
```

For the status line, run the command `install.sh` prints:

```sh
copilot config statusLine.command "node ~/.copilot/extensions/operator-board/statusline.mjs"
```

To update, pull and run `install.sh` again. To uninstall, delete `~/.copilot/extensions/operator-board/` and run `copilot config --rm statusLine.command` if you set it.

## Develop

```sh
node --test copilot/        # storage, to-dos, board, checkpoints, status line
```

`store.mjs` holds everything that reads or writes the shared files and has no Copilot imports. `extension.mjs` wires it into `joinSession`. Keep the file shapes in step with `operator-board/hooks/todo.tsx`, `board.tsx` and `extras.tsx`.
