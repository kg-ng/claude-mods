# dep-check

When Claude installs a package, dep-check looks it up first: version, license, weekly downloads and, on PyPI, how old it is. Claude reads what it found after the install:

```
dep-check: zod (3.23.8 · MIT · 12M downloads/week).
```

Some installs are stopped until you say so: a name one letter off a popular package (`expresss`, `reqeusts`), a package almost nobody downloads, or one first released in the last two weeks. Claude is told why and asks you. If it's the package you want, run `/deps allow <name>` and Claude can try again.

A name the registry doesn't have is flagged too. A made-up package name is one an attacker can register.

## Install

```sh
claude plugin marketplace add kg-ng/claude-mods
claude plugin install dep-check@claude-mods
```

Restart Claude Code.

## What it reads

| Commands | Registry |
|---|---|
| `npm install`, `npm i`, `pnpm add`, `yarn add`, `bun add` | npm (registry.npmjs.org, api.npmjs.org for downloads) |
| `pip install`, `python -m pip install`, `uv add`, `uv pip install`, `poetry add`, `pipx install` | PyPI (pypi.org, pypistats.org for downloads) |

A bare `npm install`, `-r requirements.txt`, local paths, git URLs and tarballs aren't looked up. Only the package names go to the registries, which the install itself would contact anyway. If a registry can't be reached in 6 seconds, the install goes ahead, and only the name is judged.

## Commands

| Command | What it does |
|---|---|
| `/deps allow <name>` | Lets that package install this session |
| `/deps` | Whether it's on, and what you allowed |
| `/deps off`, `/deps on` | Turns it off or on, remembered across sessions |

## Settings

| Setting | Default | What it does |
|---|---|---|
| Fewest weekly downloads | `500` | A package downloaded fewer times last week is stopped until you allow it |
