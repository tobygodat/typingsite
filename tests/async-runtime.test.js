import test from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { readdirSync, readFileSync } from 'node:fs';
import { AsyncLifetime, abortable, anySignal, deadline, within, WorkCancelled } from '../src/async-runtime.js';

const turn = () => new Promise((resolve) => { setImmediate(resolve); });

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


test('disposing an account releases the shared deadline signal and its in-flight request', async () => {
  const account = new AsyncLifetime();
  let signal;

  const pending = account.run(deadline((received) => {
    signal = received;

    return new Promise((resolve, reject) => { received.addEventListener('abort', () => reject(received.reason), { once: true }); });
  }, 30000, (cause) => cause));

  const rejected = assert.rejects(pending, WorkCancelled);
  await turn();
  await account.close();
  await rejected;
  assert.equal(signal.aborted, true);
});

test('the Promise boundary preserves an Effect defect instead of reporting it as cancellation', async () => {
  const page = new AsyncLifetime();
  const defect = new Error('unexpected failure');
  await assert.rejects(page.run(Effect.die(defect)), (error) => error === defect);
  await page.close();
});

test('anySignal aborts with the first source to abort, and an aborted source aborts it at once', () => {
  const first = new AbortController();
  const second = new AbortController();
  const merged = anySignal(first.signal, second.signal);
  assert.equal(merged.aborted, false);
  second.abort('left');
  first.abort('later');
  assert.equal(merged.aborted, true);
  assert.equal(merged.reason, 'left');

  const gone = new AbortController();
  gone.abort('gone');
  assert.equal(anySignal(new AbortController().signal, gone.signal).reason, 'gone');
});

// WebKit can collect the signal AbortSignal.any returns while a fetch waits on it, so the abort is lost (TOB-533).
test('no source merges signals with AbortSignal.any', () => {
  const sources = readdirSync('src', { recursive: true }).filter((name) => /\.tsx?$/.test(name));
  assert.deepEqual(sources.filter((name) => readFileSync(`src/${name}`, 'utf8').includes('AbortSignal.any(')), []);
});
