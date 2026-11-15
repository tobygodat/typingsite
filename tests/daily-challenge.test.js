import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyTileLine } from '../src/daily-challenge.js';

test('the Daily passage tile names the UTC day and whether it has been typed', () => {
  assert.equal(dailyTileLine('2026-11-15', false), 'Nov 15 · not typed');
  assert.equal(dailyTileLine('2026-11-15', true), 'Nov 15 · typed');
  assert.equal(dailyTileLine('2027-01-01', false), 'Jan 1 · not typed');
});
