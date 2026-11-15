import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ambiguities, split, testKey, testsInReport } from '../scripts/e2e-shards.mjs';

const make = (count, file = 'a.spec.js') => Array.from({ length: count }, (_, i) => ({ project: 'chromium', file, titles: [`test ${i}`] }));

test('every test lands in exactly one shard, whatever the durations', () => {
  const tests = [...make(40, 'a.spec.js'), ...make(25, 'b.spec.js')];
  const durations = Object.fromEntries(tests.slice(0, 30).map((t, i) => [testKey(t), (i * 7919) % 5000]));

  for (const total of [1, 2, 6, 64, 100]) {
    const shards = split(tests, durations, total);
    const placed = shards.flatMap((shard) => shard.tests.map(testKey));

    assert.equal(shards.length, total);
    assert.equal(placed.length, tests.length);
    assert.deepEqual(new Set(placed), new Set(tests.map(testKey)));
  }
});

test('the split is the same however the tests arrive, so every job agrees', () => {
  const tests = make(50);
  const durations = Object.fromEntries(tests.map((t, i) => [testKey(t), 100 + (i % 7) * 100]));
  const keys = (shards) => shards.map((shard) => shard.tests.map(testKey).sort());

  assert.deepEqual(keys(split(tests, durations, 6)), keys(split([...tests].reverse(), durations, 6)));
});

test('slow tests that sit together in one file are spread across the shards', () => {
  const slow = make(12, 'slow.spec.js');
  const fast = make(60, 'fast.spec.js');
  const durations = Object.fromEntries([...slow.map((t) => [testKey(t), 30000]), ...fast.map((t) => [testKey(t), 1000])]);
  const shards = split([...slow, ...fast], durations, 6);

  for (const shard of shards) {
    assert.equal(shard.tests.filter((t) => t.file === 'slow.spec.js').length, 2);
    assert.equal(shard.ms, 70000);
  }
});

test('a test with no recorded duration counts as the median one', () => {
  const tests = make(4);
  const durations = { [testKey(tests[0])]: 100, [testKey(tests[1])]: 200, [testKey(tests[2])]: 900 };
  const shards = split(tests, durations, 1);

  assert.equal(shards[0].ms, 100 + 200 + 900 + 200);
  assert.equal(split(make(3), {}, 3).every((shard) => shard.tests.length === 1), true);
});

test('a --test-list line that could match the wrong tests is caught', () => {
  assert.deepEqual(ambiguities(make(5)), []);

  const describeNamedLikeATest = [
    { project: 'chromium', file: 'a.spec.js', titles: ['opens'] },
    { project: 'chromium', file: 'a.spec.js', titles: ['opens', 'and closes'] },
  ];

  assert.equal(ambiguities(describeNamedLikeATest).length, 1);
  assert.equal(ambiguities([...make(1), ...make(1)]).length, 1);
  assert.equal(ambiguities([{ project: 'chromium', file: 'a.spec.js', titles: ['a › b'] }]).length, 1);
  assert.equal(ambiguities([{ project: 'chromium', file: 'a.spec.js', titles: [' padded'] }]).length, 1);
  assert.equal(ambiguities([{ project: 'chromium', file: 'a.spec.js', titles: ['two\nlines'] }]).length, 1);
  // The same title in two engines is two tests, not a collision.
  assert.deepEqual(ambiguities([...make(1), { ...make(1)[0], project: 'webkit' }]), []);
});

test('a report gives each test its file, title path below the file and last attempt', () => {
  const report = {
    suites: [{
      title: 'a.spec.js',
      specs: [{ title: 'top', file: 'a.spec.js', tests: [{ projectName: 'chromium', results: [{ duration: 900 }, { duration: 300 }] }] }],
      suites: [{ title: 'group', specs: [{ title: 'inner', file: 'a.spec.js', tests: [{ projectName: 'chromium', results: [] }] }] }],
    }],
  };

  assert.deepEqual(testsInReport(report), [
    { project: 'chromium', file: 'a.spec.js', titles: ['top'], duration: 300 },
    { project: 'chromium', file: 'a.spec.js', titles: ['group', 'inner'] },
  ]);
});

test('the recorded durations are whole milliseconds keyed by test', () => {
  const durations = JSON.parse(readFileSync(new URL('../scripts/e2e-durations.json', import.meta.url), 'utf8'));

  for (const [key, ms] of Object.entries(durations)) {
    assert.match(key, /\.spec\.js › /);
    assert.ok(Number.isInteger(ms) && ms >= 0, `${key}: ${ms}`);
  }
});

test('no spec runs its tests as one ordered group, which a split by single tests would scatter across shards', () => {
  const dir = new URL('../e2e/', import.meta.url);
  const specs = readdirSync(dir).filter((file) => file.endsWith('.spec.js'));
  const grouped = specs.filter((file) => /describe\.serial|mode:\s*['"](?:serial|default)['"]/.test(readFileSync(new URL(file, dir), 'utf8')));

  assert.deepEqual(grouped, [], 'scripts/e2e-shards.mjs must keep these groups in one shard before they can run in CI');
});
