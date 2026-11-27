#!/usr/bin/env bun
// One local proof for a branch: typecheck, lint, build, unit tests, then browser tests. It stops at the first step
// that fails and exits with that step's code.
import { spawnSync } from 'node:child_process';

const USAGE = `usage: bun run verify [-- --quick | --no-e2e]

  (no option)  typecheck, lint, build, unit tests, then the e2e specs this branch changes against origin/master
  --quick      the quick e2e set (test:e2e:quick) in place of the changed specs
  --no-e2e     stop after the unit tests
  --help       print this message

Browser steps read CHROMIUM and E2E_PORT (docs/CONVENTIONS.md).`;

const options = new Set(process.argv.slice(2).filter((arg) => arg !== '--'));
const unknown = [...options].filter((option) => !['--quick', '--no-e2e', '--help', '-h'].includes(option));

if (options.has('--help') || options.has('-h')) {
  console.log(USAGE);
  process.exit(0);
}

if (unknown.length || (options.has('--quick') && options.has('--no-e2e'))) {
  console.error(unknown.length ? `unknown option: ${unknown.join(' ')}` : '--quick and --no-e2e conflict');
  console.error(USAGE);
  process.exit(2);
}

const bun = (script) => ['bun', 'run', script];

// The browser steps serve the dist/ the build step made, instead of compiling their own.
const prebuilt = { E2E_PREBUILT: '1' };

const BROWSER = {
  changed: [{ name: 'fetch origin/master', command: ['git', 'fetch', '--quiet', 'origin', 'master'] }, { name: 'e2e changed', command: bun('test:e2e:changed'), env: prebuilt }],
  quick: [{ name: 'e2e quick', command: bun('test:e2e:quick'), env: prebuilt }],
  none: [],
};

// build:dist, not build, because the typecheck step has already run.
const steps = [
  { name: 'typecheck', command: bun('typecheck') },
  { name: 'lint', command: bun('lint') },
  { name: 'build', command: bun('build:dist') },
  { name: 'unit', command: bun('test:unit') },
  ...BROWSER[options.has('--no-e2e') ? 'none' : options.has('--quick') ? 'quick' : 'changed'],
];

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;
const width = Math.max(...steps.map((step) => step.name.length));
const done = [];
const started = performance.now();

function summary(verdict) {
  console.log(`\nverify ${verdict} in ${seconds(performance.now() - started)}`);

  for (const step of done) console.log(`  ${step.ok ? 'pass' : 'FAIL'}  ${step.name.padEnd(width)}  ${seconds(step.ms)}`);
}

for (const step of steps) {
  console.log(`\n> ${step.name}: ${step.command.join(' ')}`);
  const at = performance.now();
  const result = spawnSync(step.command[0], step.command.slice(1), { stdio: 'inherit', env: { ...process.env, ...step.env } });
  const ok = result.status === 0;
  done.push({ name: step.name, ok, ms: performance.now() - at });

  if (!ok) {
    if (result.error) console.error(result.error.message);
    summary(`failed at ${step.name}`);
    process.exit(result.status || 1);
  }
}

summary('passed');
