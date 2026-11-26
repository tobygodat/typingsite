#!/usr/bin/env node
// Prints each e2e test's failure rate, from one of two sources.
//
//   E2E_PORT=<port> node scripts/e2e-flake-rate.mjs [--repeat 30] [--workers 4] [--load 8] [--browser chromium] -- <spec[:line]> ...
//   node scripts/e2e-flake-rate.mjs --ci [--days 7]
//
// The first runs the given tests N times, optionally beside a fixed synthetic load. --load W loops `playwright test`
// over every other spec at W workers on E2E_PORT + 1 while the targets run, so a before and an after run are the same
// experiment. TRACE=1 keeps a trace of each failure.
//
// --ci reads the Playwright reports that ci.yml's e2e jobs uploaded (e2e-timings-*, kept 7 days) for every finished
// run in the last --days days, through `gh`. It prints only the tests that failed an attempt, those that passed on
// retry first, and each shard's wall time, slowest first. .github/workflows/e2e-hygiene.yml runs it weekly.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const split = process.argv.indexOf('--');
const flags = process.argv.slice(2, split === -1 ? undefined : split);
const targets = split === -1 ? [] : process.argv.slice(split + 1);

const flag = (name, fallback) => {
  const at = flags.indexOf(`--${name}`);

  return at === -1 ? fallback : flags[at + 1];
};

const ci = flags.includes('--ci');
const days = Number(flag('days', 7));
const repeat = Number(flag('repeat', 30));
const workers = Number(flag('workers', 4));
const loadWorkers = Number(flag('load', 0));
const browser = flag('browser', 'chromium');
const port = Number(process.env.E2E_PORT);

if (ci ? !(days > 0) : !targets.length || !port) {
  console.error('usage: E2E_PORT=<port> node scripts/e2e-flake-rate.mjs [--repeat N] [--workers W] [--load W] [--browser name] -- <spec[:line]> ...');
  console.error('       node scripts/e2e-flake-rate.mjs --ci [--days N]');
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), 'flake-rate-'));
const trace = process.env.TRACE ? ['--trace=retain-on-failure'] : [];

async function runTargets() {
  const playwright = (args, env, stdio) => spawn('npx', ['playwright', 'test', ...args], { env: { ...process.env, E2E_BROWSERS: browser, ...env }, stdio });
  const exited = (child) => new Promise((resolve) => { child.on('exit', resolve); });
  let loading = loadWorkers > 0;
  let loadRuns = 0;
  let loader;

  const loop = () => {
    if (!loading) return;
    const busy = new Set(targets.map((target) => target.replace(/:\d+$/, '')));
    const others = readdirSync('e2e').filter((name) => name.endsWith('.spec.js')).map((name) => `e2e/${name}`).filter((spec) => !busy.has(spec));
    loader = playwright([...others, `--workers=${loadWorkers}`, '--reporter=dot', `--output=${join(scratch, 'load')}`], { E2E_PORT: String(port + 1) }, 'ignore');
    loader.on('exit', () => {
      loadRuns += 1;
      loop();
    });
  };

  loop();

  const report = join(scratch, 'report.json');
  const run = playwright([...targets, `--repeat-each=${repeat}`, `--workers=${workers}`, '--reporter=json', `--output=${join(scratch, 'results')}`, ...trace], { PLAYWRIGHT_JSON_OUTPUT_NAME: report }, ['ignore', 'ignore', 'inherit']);

  await exited(run);

  loading = false;

  if (loader?.exitCode === null) {
    const stopped = exited(loader);
    loader.kill('SIGINT');
    await stopped;
  }

  return { heading: `${browser}, --repeat-each=${repeat} --workers=${workers}, load ${loadWorkers ? `${loadWorkers} workers (${loadRuns} loops finished)` : 'none'}`,
    reports: [{ shard: null, path: report }] };
}

function ciReports() {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const listed = execFileSync('gh', ['run', 'list', '--workflow', 'ci.yml', '--created', `>=${since}`, '--status', 'completed', '--limit', '1000', '--json', 'databaseId'], { encoding: 'utf8' });
  const runs = JSON.parse(listed).map((run) => String(run.databaseId));

  // A run whose e2e jobs had nothing to test uploaded no report, so `gh` finds nothing to download and fails.
  for (const run of runs) spawnSync('gh', ['run', 'download', run, '--pattern', 'e2e-timings-*', '--dir', join(scratch, run)], { stdio: 'ignore' });

  const reports = runs.filter((run) => existsSync(join(scratch, run))).flatMap((run) => readdirSync(join(scratch, run))
    .map((name) => ({ shard: name.replace(/^e2e-timings-/, ''), path: join(scratch, run, name, 'results.json') })).filter((report) => existsSync(report.path)));

  return { heading: `ci.yml runs finished since ${since}: ${runs.length}, with ${reports.length} e2e reports`, reports };
}

// Failures the machine caused, not the test: Chromium aborts loads in flight when a network interface changes
// (a container restarting), and a crashed page or a killed worker ends a test from outside.
const machineFault = (text) => ['ERR_NETWORK_CHANGED', 'Target crashed', 'Page crashed', 'signal=SIGKILL'].find((sign) => text.includes(sign));
const firstLines = (text) => stripVTControlCharacters(text).split('\n').slice(0, 3).join(' | ').slice(0, 220);
const tally = new Map();
const shards = new Map();

function count(row, result) {
  row.runs += 1;

  if (result.status === 'passed' || result.status === 'skipped') return;
  const machine = machineFault(result.errors.map((error) => error.message ?? '').join('\n'));
  const message = `${machine ? `[machine: ${machine}] ` : ''}${firstLines(result.error?.message ?? result.status)}`;
  row.failed += 1;
  row.machine += machine ? 1 : 0;
  row.errors.set(message, (row.errors.get(message) ?? 0) + 1);
}

function walk(suite, path = []) {
  for (const spec of suite.specs ?? []) {
    for (const entry of spec.tests) {
      const titles = [...path, spec.title];
      const key = JSON.stringify([spec.file, entry.projectName, ...titles]);
      const label = `${spec.file}:${spec.line} [${entry.projectName}] ${titles.join(' › ')}`;
      const row = tally.get(key) ?? { label, runs: 0, failed: 0, retried: 0, machine: 0, errors: new Map() };

      for (const result of entry.results) count(row, result);
      row.retried += entry.status === 'flaky' ? 1 : 0;
      tally.set(key, row);
    }
  }

  for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
}

let heading;
try {
  const result = ci ? ciReports() : await runTargets();
  heading = result.heading;

  for (const { shard, path } of result.reports) {
    const report = JSON.parse(readFileSync(path, 'utf8'));

    for (const suite of report.suites) walk(suite);

    if (shard) shards.set(shard, [...(shards.get(shard) ?? []), report.stats.duration]);
  }
} finally {
  if (ci || !trace.length) rmSync(scratch, { recursive: true, force: true });
}

if (!ci && !tally.size) {
  console.error(`no test matched ${targets.join(' ')}`);
  process.exit(1);
}

console.log(heading);

// From CI, tests that passed on retry come first: a test that failed every attempt is more often a red PR than a flake.
const failing = [...tally.values()].filter((row) => !ci || row.failed > 0).sort((a, b) => (ci ? b.retried - a.retried || b.failed - a.failed : 0));

if (ci) console.log(`\n${tally.size} tests, ${failing.length} failed an attempt, ${failing.filter((row) => row.retried).length} passed on retry`);

for (const row of failing) {
  const notes = [row.machine && `${row.machine} by the machine`, row.retried && `${row.retried} passed on retry`].filter(Boolean);
  console.log(`${row.failed}/${row.runs} failed${notes.length ? ` (${notes.join(', ')})` : ''}  ${row.label}`);

  for (const [message, times] of row.errors) console.log(`    ${times}x ${message}`);
}

if (shards.size) {
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const seconds = (ms) => `${(ms / 1000).toFixed(0)}s`;
  console.log('\nshard wall time, slowest median first: median, slowest, reports');

  for (const [shard, times] of [...shards].sort(([, a], [, b]) => median(b) - median(a))) {
    console.log(`  ${shard.padEnd(16)} ${seconds(median(times)).padStart(5)} ${seconds(Math.max(...times)).padStart(5)} ${String(times.length).padStart(4)}`);
  }
}

if (trace.length && !ci) console.log(`traces in ${join(scratch, 'results')}`);
