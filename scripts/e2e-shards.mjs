// Splits the e2e tests one CI job would run into shards of about equal recorded duration, where
// Playwright's --shard cuts them into equal counts in file order and leaves the slow specs together.
//
//   node scripts/e2e-shards.mjs <current>/<total> <file>   write shard <current>'s tests to <file>,
//                                                          then: bunx playwright test --test-list <file>
//                                                          E2E_SPECS='["e2e/a.spec.js"]' keeps only those
//                                                          files' tests (scripts/e2e-scope.mjs)
//   node scripts/e2e-shards.mjs --refresh <dir>...         rewrite scripts/e2e-durations.json from the
//                                                          e2e-timings artifacts of a Chromium run
//
// Every job lists the same tests (same commit and E2E_* env) and reads the same durations, so every
// job computes the same split, and each test lands in exactly one shard. A test with no recorded
// duration counts as the median one. Anything that could drop or repeat a test stops the job. It splits
// single tests, so it would scatter a serial group; tests/e2e-shards.test.js fails if a spec adds one.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DURATIONS = fileURLToPath(new URL('./e2e-durations.json', import.meta.url));
const SEPARATOR = ' › ';

// A test's key in e2e-durations.json and its line in a --test-list file, less the project.
export const testKey = (test) => [test.file, ...test.titles].join(SEPARATOR);

// The tests in a Playwright JSON report or listing: project, file (relative to testDir), title path
// below the file, and the duration of its last attempt when it ran.
export function testsInReport(report) {
  const tests = [];

  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const last = test.results?.at(-1);
        tests.push({ project: test.projectName, file: spec.file, titles: [...titles, spec.title], ...(last && { duration: last.duration }) });
      }
    }

    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };

  for (const file of report.suites ?? []) walk(file, []);

  return tests;
}

// Why a --test-list line could match a test other than the one it names, or none (Playwright splits
// the line on ›, trims each title, and matches title-path prefixes). Empty when every line is exact.
export function ambiguities(tests) {
  const problems = [];
  const seen = new Set();

  for (const test of tests) {
    const key = `[${test.project}]${SEPARATOR}${testKey(test)}`;

    if (seen.has(key)) problems.push(`two tests are named ${key}`);
    seen.add(key);

    if (test.titles.some((title) => /[›\n]/.test(title) || title !== title.trim() || !title)) problems.push(`${key} has a title with ›, a line break, edge spaces or nothing`);
  }

  for (const test of tests) {
    const prefix = `[${test.project}]${SEPARATOR}${testKey(test)}${SEPARATOR}`;

    if ([...seen].some((key) => key.startsWith(prefix))) problems.push(`[${test.project}]${SEPARATOR}${testKey(test)} is also the start of a longer title path`);
  }

  return problems;
}

// Longest first, each into the shard with the least recorded time so far (ties: the lower shard).
export function split(tests, durations, total) {
  const known = tests.map((test) => durations[testKey(test)]).filter((ms) => typeof ms === 'number').sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 1000;
  const weighed = tests.map((test) => ({ test, ms: durations[testKey(test)] ?? median }));

  const order = ({ test }) => `${test.project}${SEPARATOR}${testKey(test)}`;

  weighed.sort((a, b) => b.ms - a.ms || (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));

  const shards = Array.from({ length: total }, () => ({ tests: [], ms: 0 }));

  for (const { test, ms } of weighed) {
    const lightest = shards.reduce((best, shard) => (shard.ms < best.ms ? shard : best));

    lightest.tests.push(test);
    lightest.ms += ms;
  }

  return shards;
}

function playwright(args) {
  const result = spawnSync('npx', ['playwright', 'test', ...args, '--reporter=json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

  if (result.status !== 0) throw new Error(`playwright test ${args.join(' ')} exited ${result.status}\n${result.stderr}`);

  return testsInReport(JSON.parse(result.stdout));
}

const report = (count) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tests=${count}\n`);
};

function writeShard(spec, file) {
  const [current, total] = spec.split('/').map(Number);

  if (!(Number.isInteger(current) && Number.isInteger(total) && current >= 1 && current <= total)) throw new Error(`shard must be <current>/<total>, got ${spec}`);

  const specs = process.env.E2E_SPECS ? JSON.parse(process.env.E2E_SPECS).map((file) => path.relative('e2e', file)) : null;
  const tests = playwright(['--list']).filter((test) => !specs || specs.includes(test.file));
  const problems = ambiguities(tests);

  const unlisted = specs?.filter((file) => !tests.some((test) => test.file === file)) ?? [];

  if (unlisted.length) throw new Error(`E2E_SPECS names files Playwright lists no tests in: ${unlisted.join(', ')}`);

  if (!tests.length) throw new Error('playwright listed no tests');

  if (problems.length) throw new Error(`a --test-list file can't name these tests exactly:\n${problems.join('\n')}`);

  const durations = JSON.parse(readFileSync(DURATIONS, 'utf8'));
  const shards = split(tests, durations, total);
  const mine = shards[current - 1];

  if (!mine.tests.length && tests.length >= total) throw new Error(`shard ${spec} is empty`);

  mkdirSync(path.dirname(file), { recursive: true });

  // Fewer tests than shards: this shard has nothing to run, which the workflow reads from tests=0.
  if (!mine.tests.length) {
    writeFileSync(file, '');
    report(0);
    console.log(`Shard ${spec}: no tests. The run selects ${tests.length} tests for ${total} shards`);

    return;
  }

  writeFileSync(file, mine.tests.map((test) => `[${test.project}]${SEPARATOR}${testKey(test)}`).join('\n') + '\n');

  // Playwright's own reading of the file must select exactly the planned tests, no more and no fewer.
  const planned = new Set(mine.tests.map((test) => `${test.project}${SEPARATOR}${testKey(test)}`));
  const selected = playwright(['--list', '--test-list', file]).map((test) => `${test.project}${SEPARATOR}${testKey(test)}`);

  if (selected.length !== planned.size || selected.some((key) => !planned.has(key))) {
    throw new Error(`--test-list ${file} selects ${selected.length} tests that differ from the ${planned.size} planned`);
  }

  const seconds = (ms) => `${Math.round(ms / 1000)}s`;

  report(mine.tests.length);
  console.log(`Shard ${spec}: ${mine.tests.length} of ${tests.length} tests, ${seconds(mine.ms)} recorded. All shards: ${shards.map((shard) => seconds(shard.ms)).join(' ')}`);
}

function refresh(dirs) {
  const reports = dirs.flatMap(function find(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);

      return entry.isDirectory() ? find(full) : entry.name === 'results.json' ? [full] : [];
    });
  });

  const samples = {};

  for (const report of reports) {
    for (const test of testsInReport(JSON.parse(readFileSync(report, 'utf8')))) {
      if (test.project === 'chromium' && typeof test.duration === 'number') (samples[testKey(test)] ??= []).push(test.duration);
    }
  }

  const durations = Object.fromEntries(Object.keys(samples).sort().map((key) => {
    const sorted = samples[key].sort((a, b) => a - b);

    return [key, sorted[Math.floor(sorted.length / 2)]];
  }));

  if (!Object.keys(durations).length) throw new Error(`no Chromium results.json under ${dirs.join(', ')}`);

  writeFileSync(DURATIONS, JSON.stringify(durations, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(durations).length} test durations from ${reports.length} reports to ${path.relative(process.cwd(), DURATIONS)}`);
}

if (process.argv[1] === import.meta.filename) {
  const [first, ...rest] = process.argv.slice(2);

  if (first === '--refresh' && rest.length) refresh(rest);
  else if (first && rest.length === 1) writeShard(first, rest[0]);
  else {
    console.error('usage: node scripts/e2e-shards.mjs <current>/<total> <file> | --refresh <dir>...');
    process.exit(2);
  }
}
