import test from 'node:test';
import assert from 'node:assert/strict';
import { SHARE, workersFor } from '../scripts/e2e-workers.mjs';

test('a run takes the idle cores, at most two thirds of the machine and never fewer than the floor', () => {
  // Idle machine: two thirds, as '67%' gave before.
  assert.equal(workersFor(24, 0.5), 16);
  // 16 idle cores.
  assert.equal(workersFor(24, 8), 16);
  // 11 idle cores.
  assert.equal(workersFor(24, 12.2), 11);
  // 4 idle cores.
  assert.equal(workersFor(24, 19.9), 4);
  // Overloaded: the floor.
  assert.equal(workersFor(24, 30), 4);
  // Small machine: two thirds.
  assert.equal(workersFor(4, 0), 3);
  // A ceiling below the floor wins.
  assert.equal(workersFor(2, 0), 1);
  // Never zero.
  assert.equal(workersFor(1, 0), 1);
});

test('the worker count is always a whole number between 1 and two thirds of the cores', () => {
  for (let cores = 1; cores <= 64; cores += 1) {
    const ceiling = Math.round(cores * SHARE);

    for (let load = 0; load <= 80; load += 0.5) {
      const workers = workersFor(cores, load);

      assert.ok(Number.isInteger(workers), `${cores} cores, load ${load}: ${workers} is not an integer`);
      assert.ok(workers >= 1, `${cores} cores, load ${load}: ${workers} is below 1`);
      assert.ok(workers <= ceiling, `${cores} cores, load ${load}: ${workers} is above ${ceiling}`);
    }
  }
});
