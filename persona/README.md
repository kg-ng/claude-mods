# persona

Give your Claude Code terminal a persona: Claude's replies, tool rows, spinner words and the terminal's own colours (all 16, plus background, text and cursor), all in one editor theme. Pick from ten built-ins, or make your own and share it as a file.

## Install

```
/plugin install persona --marketplace <owner>/<repo>
```

Answer `y` to add the marketplace, then pick a scope. Type `/persona` to pick one.

## What it changes

| Part | What you see |
|---|---|
| Replies | Headings, bold, inline code, links, lists, task ticks, `> [!NOTE]` boxes, tables and highlighted code blocks in the persona's colours |
| Tool rows | A coloured icon per kind: ◇ read, ✎ edit, ▶ shell, ⌕ search, ◎ web, ◆ MCP; amber while running, red on failure |
| Spinner and footer | The persona's words: `Brooding…`, `Risen for 12s` |
| Band | The persona's name and swatches above the prompt |
| Terminal colours | The 16 ANSI colours, background, text and cursor of the terminal running Claude Code. Apple Terminal: a `Persona <name>` profile built from your current one (font and window kept). iTerm2, Windows Terminal, kitty, WezTerm, Ghostty, Alacritty, VS Code, GNOME, xterm: standard OSC colour codes. `/persona terminal off` puts your own back |

Built-ins: `tokyo-night`, `dracula`, `catppuccin`, `rose-pine`, `nord`, `gruvbox`, `kanagawa`, `everforest`, `one-dark`, `noir`.

## Commands

| Command | What it does |
|---|---|
| `/persona` | Picker: ↑/↓ previews, Enter picks, Esc closes |
| `/persona <name>` | Switch |
| `/persona list` · `show [name]` | Every persona · one persona's colours and their contrast |
| `/persona new <name> <bg> [fg] [accent …]` | Make one from a few colours; the rest are derived |
| `/persona new <name> from <persona>` | Copy one to edit |
| `/persona set <key> <colour> …` | Repaint the current persona (a built-in is copied to `my-<name>` first) |
| `/persona words a, b, c` · `done a, b` · `label <text>` | Spinner words, footer words, display name |
| `/persona delete <name>` | Delete one of yours |
| `/persona export [name]` · `import <file or JSON>` | Share a persona |
| `/persona reload` | Re-read the personas folder |
| `/persona off\|on` · `replies off\|on` · `terminal off\|on` | Band, replies, Terminal tab colours |
| `/persona help` | All of the above |

Keys: `bg` (background), `fg` (text), `muted`, `read`, `write`, `run`, `search`, `web` (main accent), `mcp`, `other`, `ok`, `warn`, `err`.

**Readable by default.** Every colour is checked against the background: text at 4.5:1 or more, everything else at 3:1. A colour that falls short is nudged until it reads, and the command says what moved.

**Ask Claude.** Say "make me a persona that feels like a sunset" or "match my brand, #ff5a1f". The mod gives Claude a `design` tool, so it builds the persona and switches to it.

## Personas as files

Every `.json` file in `~/.claude/personas/` is loaded as a persona, so you can keep them in your dotfiles or a team repo. `/persona export` writes one there. Only `name` and `palette.bg` are required; missing colours are derived:

```json
{
  "name": "sunset",
  "label": "Sunset",
  "palette": { "bg": "#2d1b2f", "fg": "#fbe3b8", "web": "#f2a65a", "err": "#ff6b6b" },
  "spinner": ["Glowing", "Fading"],
  "done": ["Set"]
}
```

See `examples/sunset.json` for a fuller one.

## Settings

Set these when you install, or later in `/config`:

| Setting | Default | |
|---|---|---|
| Default persona | `tokyo-night` | Used until you pick one |
| Draw replies in the persona | on | |
| Paint the Terminal tab | on | Any terminal that takes colour codes |
| Show the band | on | |
| Personas folder | `~/.claude/personas` | |

What you choose with `/persona` is remembered across sessions and wins over these defaults.

## Notes

- Apple Terminal: the first time, macOS asks whether Claude Code may control Terminal. Adding a persona's profile opens and closes one Terminal window; profiles are kept under Terminal → Settings → Profiles and in `~/.claude/persona-profiles`.
- Windows (PowerShell, cmd): the colours go through the console. Windows Terminal takes all of them; the classic console window may take only some. Untested so far.
- tmux: needs `set -g allow-passthrough on` for the colours to reach the outer terminal.
- The Linux text console and `TERM=dumb` have no colour settings: replies, tool rows, the band and words still change there.
- Only the drawing changes. The stored conversation and what the model reads are untouched.
- Personas are dark-first. A light `bg` works too: contrast is checked in either direction.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

MIT licensed.
