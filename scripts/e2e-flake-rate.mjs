#!/usr/bin/env node
// Runs e2e tests N times, optionally beside a fixed synthetic load, and prints each test's failure rate.
//
//   E2E_PORT=<port> node scripts/e2e-flake-rate.mjs [--repeat 30] [--workers 4] [--load 8] [--browser chromium] -- <spec[:line]> ...
//
// --load W loops `playwright test` over every other spec at W workers on E2E_PORT + 1 while the targets run,
// so a before and an after run are the same experiment. TRACE=1 keeps a trace of each failure.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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

const repeat = Number(flag('repeat', 30));
const workers = Number(flag('workers', 4));
const loadWorkers = Number(flag('load', 0));
const browser = flag('browser', 'chromium');
const port = Number(process.env.E2E_PORT);

if (!targets.length || !port) {
  console.error('usage: E2E_PORT=<port> node scripts/e2e-flake-rate.mjs [--repeat N] [--workers W] [--load W] [--browser name] -- <spec[:line]> ...');
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), 'flake-rate-'));
const playwright = (args, env, stdio) => spawn('npx', ['playwright', 'test', ...args], { env: { ...process.env, E2E_BROWSERS: browser, ...env }, stdio });
const exited = (child) => new Promise((resolve) => { child.on('exit', resolve); });

let loading = loadWorkers > 0;
let loadRuns = 0;
let loader;

function loop() {
  if (!loading) return;
  const busy = new Set(targets.map((target) => target.replace(/:\d+$/, '')));
  const others = readdirSync('e2e').filter((name) => name.endsWith('.spec.js')).map((name) => `e2e/${name}`).filter((spec) => !busy.has(spec));
  loader = playwright([...others, `--workers=${loadWorkers}`, '--reporter=dot', `--output=${join(scratch, 'load')}`], { E2E_PORT: String(port + 1) }, 'ignore');
  loader.on('exit', () => {
    loadRuns += 1;
    loop();
  });
}

loop();

const report = join(scratch, 'report.json');
const trace = process.env.TRACE ? ['--trace=retain-on-failure'] : [];
const run = playwright([...targets, `--repeat-each=${repeat}`, `--workers=${workers}`, '--reporter=json', `--output=${join(scratch, 'results')}`, ...trace], { PLAYWRIGHT_JSON_OUTPUT_NAME: report }, ['ignore', 'ignore', 'inherit']);

await exited(run);

loading = false;

if (loader?.exitCode === null) {
  const stopped = exited(loader);
  loader.kill('SIGINT');
  await stopped;
}

// Failures the machine caused, not the test: Chromium aborts loads in flight when a network interface changes
// (a container restarting), and a crashed page or a killed worker ends a test from outside.
const machineFault = (text) => ['ERR_NETWORK_CHANGED', 'Target crashed', 'Page crashed', 'signal=SIGKILL'].find((sign) => text.includes(sign));
const firstLines = (text) => stripVTControlCharacters(text).split('\n').slice(0, 3).join(' | ').slice(0, 220);
const tally = new Map();

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
      const key = `${spec.file}:${spec.line} ${[...path, spec.title].join(' › ')}`;
      const row = tally.get(key) ?? { runs: 0, failed: 0, machine: 0, errors: new Map() };

      for (const result of entry.results) count(row, result);
      tally.set(key, row);
    }
  }

  for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
}

for (const suite of JSON.parse(readFileSync(report, 'utf8')).suites) walk(suite);

if (!tally.size) {
  console.error(`no test matched ${targets.join(' ')}`);
  process.exit(1);
}

console.log(`${browser}, --repeat-each=${repeat} --workers=${workers}, load ${loadWorkers ? `${loadWorkers} workers (${loadRuns} loops finished)` : 'none'}`);

for (const [key, row] of tally) {
  console.log(`${row.failed}/${row.runs} failed${row.machine ? ` (${row.machine} by the machine)` : ''}  ${key}`);

  for (const [message, times] of row.errors) console.log(`    ${times}x ${message}`);
}

if (trace.length) console.log(`traces in ${join(scratch, 'results')}`);
else rmSync(scratch, { recursive: true, force: true });
