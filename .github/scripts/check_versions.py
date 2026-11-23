"""Fails a PR that changes a mod without raising its version and noting it in CHANGELOG.md.

`claude plugin update` only picks up a change when the mod's version in
.claude-plugin/plugin.json goes up, so a change without a bump never reaches anyone.

    python3 .github/scripts/check_versions.py <base ref>   # e.g. origin/main
"""
import json
import re
import subprocess
import sys

base = sys.argv[1]


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True, check=True).stdout


def version_at(ref, mod):
    try:
        return json.loads(git('show', f'{ref}:{mod}/.claude-plugin/plugin.json'))['version']
    except subprocess.CalledProcessError:
        return None  # a mod new in this PR


def as_tuple(v):
    return tuple(int(x) for x in re.findall(r'\d+', v))


# Changes that don't reach anyone who installs the mod, so they need no bump.
NO_BUMP = re.compile(r'(\.test\.tsx?$|/tests/|/README\.md$|/LICENSE$)')

mods = [p['source'].lstrip('./') for p in json.load(open('.claude-plugin/marketplace.json'))['plugins']]
changelog = open('CHANGELOG.md').read() if subprocess.run(['test', '-f', 'CHANGELOG.md']).returncode == 0 else ''
merge_base = git('merge-base', base, 'HEAD').strip()
problems = []
for mod in mods:
    changed = [f for f in git('diff', '--name-only', merge_base, 'HEAD', '--', f'{mod}/').split() if not NO_BUMP.search(f)]
    if not changed:
        continue
    before, after = version_at(merge_base, mod), version_at('HEAD', mod)
    if before and as_tuple(after) <= as_tuple(before):
        problems.append(f'{mod}: changed ({", ".join(changed[:3])}{"…" if len(changed) > 3 else ""}) '
                        f'but its version is still {after}. Raise "version" in {mod}/.claude-plugin/plugin.json.')
        continue
    section = changelog.split(f'## {mod}', 1)[1].split('\n## ', 1)[0] if f'## {mod}' in changelog else ''
    if not re.search(rf'^### {re.escape(after)}\b', section, re.M):
        problems.append(f'{mod}: version {after} has no entry in CHANGELOG.md. Add "### {after}" under "## {mod}".')
    else:
        print(f'{mod}: {before} → {after}, in CHANGELOG.md. OK')

if problems:
    print('\n'.join(problems))
    sys.exit(1)
print('Versions: OK')
