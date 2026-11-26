# secrets-guard

Before Claude writes a file, makes a commit or sends a PR body, secrets-guard looks for API keys, tokens and private keys in what's about to go out. If it finds one, it stops the call and tells Claude which line and what kind of key. It never repeats the value, not to Claude, not in a toast, not in `/secrets`.

```
secrets-guard: what you're writing to src/config.ts has line 3 (AWS access key).
Read the value from an environment variable or a gitignored file (.env) instead.
```

## Install

```sh
claude plugin marketplace add kg-ng/claude-mods
claude plugin install secrets-guard@claude-mods
```

Restart Claude Code.

## What it checks

| When | What it reads |
|---|---|
| Claude's `Edit`, `Write` and `NotebookEdit` | The text being written |
| `git commit` | What's staged (`git diff --cached`), plus tracked changes with `-a` |
| `gh pr/issue/release create, edit, comment`, `gh api`, `curl -d` | The command itself |

It knows private keys, AWS, GitHub, Anthropic, OpenAI, Stripe live, Slack, Google, npm, PyPI and SendGrid keys, passwords in URLs (`postgres://user:pass@host`), and long random values assigned to names like `api_key`, `secret`, `token` or `password`. Placeholders (`your-api-key`, `<TOKEN>`, `${{ secrets.X }}`, `process.env.X`) pass.

**Files git ignores pass** (with the default setting), since a key in `.env` never reaches a commit. A line with the comment `secrets-guard: allow` passes too, for a fake key in a test. Claude is told to add it only when you confirm the value is fake.

It's a seatbelt, not a scanner of record: it reads what Claude sends as written.

## Commands

| Command | What it does |
|---|---|
| `/secrets` | Whether it's on, and what it stopped this session (kind and place, no values) |
| `/secrets off` | Turns it off, remembered across sessions |
| `/secrets on` | Turns it back on |

## Settings

| Setting | Default | What it does |
|---|---|---|
| Allow gitignored files | on | Let Claude write keys into files git ignores, such as `.env` |
