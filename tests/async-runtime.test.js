import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { AsyncLifetime, abortable, within, WorkCancelled } from '../src/async-runtime.js';

const turn = () => new Promise((resolve) => setImmediate(resolve));

function stalled() {
  let observed;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const program = abortable((signal) => {
    observed = signal;
    started();
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }, (cause) => cause);
  return { program, ready, signal: () => observed };
}

test('scope disposal aborts underlying work and rejects its result', async () => {
  const page = new AsyncLifetime();
  const work = stalled();
  const pending = page.run(work.program);
  const rejected = assert.rejects(pending, WorkCancelled);
  await work.ready;
  await page.close();
  await rejected;
  assert.equal(work.signal().aborted, true);
  await assert.rejects(page.run(Effect.succeed('stale')), WorkCancelled);
});

test('a caller abort interrupts its scoped request without closing sibling work', async () => {
  const page = new AsyncLifetime();
  const work = stalled();
  const caller = new AbortController();
  const pending = page.run(work.program, caller.signal);
  const rejected = assert.rejects(pending, WorkCancelled);
  await work.ready;
  caller.abort();
  await rejected;
  await turn();
  assert.equal(work.signal().aborted, true);
  assert.equal(await page.run(Effect.succeed('alive')), 'alive');
  await page.close();
});

test('Effect deadline aborts work and preserves the exact typed failure', async () => {
  const page = new AsyncLifetime();
  const work = stalled();
  const failure = new Error('deadline');
  await assert.rejects(page.run(within(work.program, 15, () => failure)), (error) => error === failure);
  assert.equal(work.signal().aborted, true);
  await page.close();
});

test('closing an account interrupts child requests while the page remains usable', async () => {
  const page = new AsyncLifetime();
  const account = new AsyncLifetime(page);
  const work = stalled();
  const pending = account.run(work.program);
  const rejected = assert.rejects(pending, WorkCancelled);
  await work.ready;
  await account.close();
  await rejected;
  assert.equal(work.signal().aborted, true);
  assert.equal(await page.run(Effect.succeed('guest')), 'guest');
  await page.close();
});
