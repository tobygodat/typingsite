#!/usr/bin/env node
// Decides whether a PR runs "Learner eval". It does when the PR changes a file the let-go evaluation loads, found by
// walking the static imports from the two evaluation scripts at both the PR's head and its base, so a file renamed or
// deleted out of the graph still counts. An import that doesn't resolve means run.
//
//   node scripts/learner-eval-scope.mjs [<base> <head>]   (default HEAD^1 HEAD; writes run= to $GITHUB_OUTPUT in CI)
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const ENTRIES = ['scripts/evaluate-let-go.mjs', 'scripts/evaluate-let-go-v3.mjs', 'scripts/evaluate-learner.mjs'];

// Read at run time, or decide how the job runs, so outside the import graph.
const ALWAYS = [/^scripts\/evaluate-[^/]*\.mjs$/, /^scripts\/learner-eval-scope\.mjs$/, /^docs\/adr\/0019-evaluation\.json$/,
  /^bun\.lock$/, /^package\.json$/, /^tsconfig\.json$/, /^\.github\/workflows\/ci\.yml$/];

const IMPORT = /\b(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// The relative specifiers a module imports, statically or by a literal dynamic import.
export const importsOf = (source) => [...source.matchAll(IMPORT)].map((match) => match[1] ?? match[2]);

// tsx loads a .ts or .tsx file for a .js specifier, as Vite does.
function resolve(from, specifier, files) {
  const path = posix.normalize(posix.join(posix.dirname(from), specifier.replace(/\?.*$/, '')));

  return [path, path.replace(/\.js$/, '.ts'), path.replace(/\.js$/, '.tsx')].find((candidate) => files.has(candidate));
}

// Every file the evaluation scripts load at `rev`, or null when one of their imports doesn't resolve there.
export function closureAt(rev) {
  const files = new Set(git('ls-tree', '-r', '--name-only', rev).split('\n'));
  const loaded = new Set();
  const queue = ENTRIES.filter((entry) => files.has(entry));

  while (queue.length) {
    const file = queue.pop();

    if (loaded.has(file)) continue;
    loaded.add(file);

    if (!/\.(?:m?js|tsx?)$/.test(file)) continue;

    for (const specifier of importsOf(git('show', `${rev}:${file}`))) {
      const target = resolve(file, specifier, files);

      if (!target) return null;
      queue.push(target);
    }
  }

  return loaded;
}

export function decide(changed, closures) {
  const hits = changed.filter((file) => ALWAYS.some((rule) => rule.test(file)) || closures.some((closure) => closure?.has(file)));

  if (hits.length) return { run: true, why: `The PR changes what the learner evaluation loads: ${hits.join(', ')}.` };

  if (closures.includes(null)) return { run: true, why: "An import of the learner evaluation doesn't resolve, so this run checks the learner." };

  return { run: false, why: 'The PR changes nothing the learner evaluation loads, so there is nothing to check.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base = 'HEAD^1', head = 'HEAD'] = process.argv.slice(2);
  let decision;

  try {
    const changed = git('diff', '--name-only', '--no-renames', base, head).split('\n').filter(Boolean);
    decision = decide(changed, [closureAt(head), closureAt(base)]);
  } catch (error) {
    decision = { run: true, why: `Can't read the PR's changes (${String(error.message).split('\n')[0]}), so this run checks the learner.` };
  }

  console.log(decision.why);
  console.log(`run=${decision.run}`);

  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${decision.run}\n`);
}
