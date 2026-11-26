// dep-check's rules: which packages an install command adds, whether a name looks like a typo of a
// popular package, and what to make of what the registry says. Pure, so tested in a table.

export type Ecosystem = 'npm' | 'pypi'
export type Wanted = { eco: Ecosystem; name: string }

/** What the registry said about a package; `missing` when it has none of that name. */
export type Info = { missing?: true; version?: string; license?: string; weekly?: number; firstRelease?: number }

const NPM_POPULAR = [
  'react', 'react-dom', 'next', 'vue', 'svelte', 'angular', 'express', 'fastify', 'koa', 'lodash', 'underscore',
  'axios', 'node-fetch', 'request', 'chalk', 'commander', 'yargs', 'debug', 'dotenv', 'moment', 'dayjs', 'date-fns',
  'uuid', 'nanoid', 'zod', 'yup', 'joi', 'ajv', 'typescript', 'ts-node', 'tsx', 'esbuild', 'vite', 'webpack', 'rollup',
  'parcel', 'babel-core', 'eslint', 'prettier', 'jest', 'vitest', 'mocha', 'chai', 'sinon', 'cypress', 'playwright',
  'puppeteer', 'redux', 'zustand', 'jotai', 'mobx', 'rxjs', 'graphql', 'apollo-server', 'prisma', 'sequelize',
  'mongoose', 'mongodb', 'mysql', 'mysql2', 'pg', 'redis', 'ioredis', 'sqlite3', 'knex', 'typeorm', 'drizzle-orm',
  'socket.io', 'ws', 'cors', 'helmet', 'body-parser', 'cookie-parser', 'jsonwebtoken', 'bcrypt', 'bcryptjs',
  'passport', 'multer', 'sharp', 'jimp', 'cheerio', 'jsdom', 'marked', 'markdown-it', 'highlight.js', 'tailwindcss',
  'postcss', 'autoprefixer', 'sass', 'less', 'styled-components', 'classnames', 'clsx', 'immer', 'ramda', 'bluebird',
  'async', 'glob', 'rimraf', 'mkdirp', 'fs-extra', 'chokidar', 'nodemon', 'pm2', 'concurrently', 'cross-env', 'semver',
  'minimist', 'inquirer', 'ora', 'execa', 'got', 'superagent', 'qs', 'colors', 'electron', 'openai', 'stripe',
]
const PYPI_POPULAR = [
  'requests', 'urllib3', 'numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn', 'scikit-learn', 'torch', 'tensorflow',
  'keras', 'flask', 'django', 'fastapi', 'uvicorn', 'gunicorn', 'starlette', 'pydantic', 'sqlalchemy', 'alembic',
  'psycopg2', 'psycopg2-binary', 'pymysql', 'redis', 'celery', 'boto3', 'botocore', 'click', 'typer', 'rich', 'tqdm',
  'pyyaml', 'toml', 'tomli', 'python-dotenv', 'jinja2', 'markupsafe', 'pillow', 'opencv-python', 'beautifulsoup4',
  'lxml', 'selenium', 'playwright', 'scrapy', 'httpx', 'aiohttp', 'pytest', 'pytest-cov', 'mock', 'black', 'ruff',
  'flake8', 'pylint', 'mypy', 'isort', 'setuptools', 'wheel', 'pip', 'virtualenv', 'poetry', 'cryptography',
  'pyjwt', 'bcrypt', 'paramiko', 'openai', 'anthropic', 'langchain', 'transformers', 'datasets', 'jupyter',
  'ipython', 'notebook', 'colorama', 'six', 'attrs', 'python-dateutil', 'pytz', 'arrow', 'certifi', 'idna', 'chardet',
]

/** Edit distance with swaps counting one (Damerau, optimal string alignment). */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1)
    }
  return d[a.length]![b.length]!
}

const norm = (eco: Ecosystem, n: string) => (eco === 'pypi' ? n.toLowerCase().replace(/[-_.]+/g, '-') : n.toLowerCase())

/** The popular package `name` is one or two letters off from, when it isn't that package itself. */
export function lookalike(eco: Ecosystem, name: string): string | undefined {
  // A scoped name (`@types/react`, `@nestjs/core`) is its owner's, not a lookalike.
  if (name.startsWith('@')) return
  const n = norm(eco, name)
  const list = eco === 'npm' ? NPM_POPULAR : PYPI_POPULAR
  if (list.some(p => norm(eco, p) === norm(eco, name))) return
  for (const p of list) {
    const q = norm(eco, p)
    if (q.length < 4) continue
    const d = distance(n, q)
    // One letter off for most names; two for long ones.
    if (d >= 1 && d <= (q.length >= 8 ? 2 : 1)) return p
    // `react-dom-js`, `requests2`: the popular name with a bit added.
    if (n !== q && (n === `${q}js` || n === `${q}-js` || n === `${q}2` || n === `${q}-dev` || n === `py${q}` || n === `python-${q}`))
      return p
  }
}

const words = (cmd: string) => cmd.split(/\s+/).filter(Boolean)

/** The packages an install command adds, by registry. A bare `npm install` adds none. */
export function wanted(cmd: string): Wanted[] {
  const out: Wanted[] = []
  for (const seg of cmd.split(/&&|\|\||;|\n|\|/)) {
    const w = words(seg).filter(x => !/^\w+=/.test(x))
    while (w[0] === 'sudo' || w[0] === 'npx' || w[0] === 'time') w.shift()
    const [a, b, c] = w
    let eco: Ecosystem | undefined
    let rest: string[] = []
    if ((a === 'npm' || a === 'pnpm' || a === 'bun' || a === 'yarn') && ['install', 'i', 'add'].includes(b ?? '')) {
      eco = 'npm'
      rest = w.slice(2)
    } else if (/^pip3?$/.test(a ?? '') && b === 'install') {
      eco = 'pypi'
      rest = w.slice(2)
    } else if (/^python3?$/.test(a ?? '') && b === '-m' && /^pip3?$/.test(c ?? '') && w[3] === 'install') {
      eco = 'pypi'
      rest = w.slice(4)
    } else if ((a === 'uv' && b === 'pip' && c === 'install') || (a === 'uv' && b === 'add') || (a === 'poetry' && b === 'add') || (a === 'pipx' && b === 'install')) {
      eco = 'pypi'
      rest = w.slice(a === 'uv' && b === 'pip' ? 3 : 2)
    }
    if (!eco) continue
    for (let i = 0; i < rest.length; i++) {
      const x = rest[i]!
      // Options that take a value, so the value isn't a package.
      if (/^(?:-r|--requirement|-c|--constraint|-e|--editable|-i|--index-url|--extra-index-url|-f|--find-links|--target|-t|--prefix|--registry|--tag|--filter|-w|--workspace)$/.test(x)) {
        i++
        continue
      }
      if (x.startsWith('-')) continue
      // Paths, URLs, git and tarballs aren't registry names.
      if (/^(?:\.|\/|~|file:|git\+|git:|https?:|github:|link:|workspace:)|\.(?:tgz|tar\.gz|whl|zip)$/.test(x)) continue
      const name =
        eco === 'npm'
          ? x.startsWith('@')
            ? x.split('@').slice(0, 2).join('@')
            : x.split('@')[0]!
          : x.replace(/['"]/g, '').split(/[\[<>=!~;@ ]/)[0]!
      if (name && /^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) && !out.some(o => o.eco === eco && o.name === name)) out.push({ eco, name })
    }
  }
  return out
}

export type Verdict = { block: boolean; line: string }

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
const DAY = 86_400_000

/** What to say about one package, and whether that's enough to stop the install until the user says so. */
export function judge(w: Wanted, info: Info | undefined, now: number, opts: { minWeekly: number }): Verdict {
  const like = lookalike(w.eco, w.name)
  if (info?.missing)
    return { block: false, line: `${w.name}: not on ${w.eco === 'npm' ? 'npm' : 'PyPI'}. Check the name: a made-up name is one an attacker can register.` }
  const facts = [
    info?.version,
    info?.license ? info.license : info ? 'no license given' : undefined,
    info?.weekly !== undefined ? `${fmt(info.weekly)} downloads/week` : undefined,
    info?.firstRelease ? `first released ${Math.max(0, Math.round((now - info.firstRelease) / DAY))} days ago` : undefined,
  ].filter(Boolean)
  const about = `${w.name}${facts.length ? ` (${facts.join(' · ')})` : ''}`
  if (like && (info?.weekly === undefined || info.weekly < 100_000))
    return { block: true, line: `${about} looks like a misspelling of the popular \`${like}\`.` }
  if (info?.weekly !== undefined && info.weekly < opts.minWeekly)
    return { block: true, line: `${about} is barely used.` }
  if (info?.firstRelease && now - info.firstRelease < 14 * DAY) return { block: true, line: `${about} is brand new.` }
  return { block: false, line: about }
}
