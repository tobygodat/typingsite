// Which browser tests a CI run needs, from the files it changes. The unit job runs it once per run and
// passes the answer to every e2e job (.github/workflows/ci.yml).
//
//   node scripts/e2e-scope.mjs   in CI: write scope, specs and summary to $GITHUB_OUTPUT
//
// A pull_request run compares its merge commit with the base it merges into. Every other run, and any
// run whose changed files can't be listed, tests everything.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// First match wins. A file no rule matches can change what the e2e jobs serve or run, so it runs everything.
// Nothing outside src/, index.html, manifest.webmanifest, icons/, scripts/ and e2e/ is read by the build
// (scripts/build-static.mjs), served, or imported by a spec; e2e fakes Supabase (e2e/fake-supabase.js).
export const RULES = [
  { pattern: /^e2e\/.+\.spec\.js$/, effect: 'spec' },
  { pattern: /^docs\//, effect: 'none' },
  { pattern: /^[^/]+\.md$/, effect: 'none' },
  { pattern: /^tests\//, effect: 'none' },
  { pattern: /^design\//, effect: 'none' },
  { pattern: /^\.(?:entire|claude|agents)\//, effect: 'none' },
  { pattern: /^scripts\/e2e-durations\.json$/, effect: 'none' },
  { pattern: /^supabase\//, effect: 'none' },
];

const effectOf = (file) => RULES.find((rule) => rule.pattern.test(file))?.effect ?? 'all';

const listed = (files) => (files.length > 5 ? `${files.slice(0, 5).join(', ')} and ${files.length - 5} more` : files.join(', '));

// changedFiles: repo-relative paths, old and new sides of every rename. exists: whether a path is still
// in the tree, so a deleted or renamed spec drops out instead of naming a file Playwright can't find.
export function e2eScope(changedFiles, exists = existsSync) {
  const all = changedFiles.filter((file) => effectOf(file) === 'all');

  if (all.length) return { kind: 'all', reason: `${listed(all)} can change the app or the e2e harness` };

  const files = [...new Set(changedFiles.filter((file) => effectOf(file) === 'spec' && exists(file)))].sort();

  return files.length ? { kind: 'specs', files } : { kind: 'none' };
}

function changedInPullRequest() {
  // actions/checkout's pull_request HEAD is the merge commit; its first parent is the base it merges into.
  const parents = execFileSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], { encoding: 'utf8' }).trim().split(' ');

  if (parents.length !== 3) throw new Error(`HEAD ${parents[0]} is not a merge commit`);

  return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', 'HEAD^1', 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

function decide(event) {
  if (event !== 'pull_request') return { scope: { kind: 'all', reason: `a ${event || 'local'} run tests everything` }, changed: [] };

  try {
    const changed = changedInPullRequest();

    return { scope: e2eScope(changed), changed };
  } catch (error) {
    return { scope: { kind: 'all', reason: `the changed files couldn't be listed (${error.message.split('\n')[0]})` }, changed: [] };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { scope, changed } = decide(process.env.GITHUB_EVENT_NAME);

  const summary = {
    none: `No change can affect the browser tests: ${listed(changed)}`,
    specs: `Only e2e specs changed, so the run tests ${listed(scope.files ?? [])}`,
    all: `Every browser test runs: ${scope.reason}`,
  }[scope.kind];

  console.log(summary);

  const output = { scope: scope.kind, specs: JSON.stringify(scope.files ?? []), summary: JSON.stringify(summary) };

  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(output).map(([key, value]) => `${key}=${value}\n`).join(''));
}
