import test from 'node:test';
import assert from 'node:assert/strict';
import { closureAt, decide, importsOf } from '../scripts/learner-eval-scope.mjs';

test('importsOf reads static, type-only, side-effect, re-export and literal dynamic imports, and skips packages', () => {
  const source = `import { a,
  b } from './a.js';
import type { T } from "../src/t.js";
import './side.js';
export * from './again.js';
const lazy = await import('./lazy.js');
import { Effect } from 'effect';
import { readFileSync } from 'node:fs';`;

  assert.deepEqual(importsOf(source), ['./a.js', '../src/t.js', './side.js', './again.js', './lazy.js']);
});

test("the committed evaluation's closure reaches the learner's transitive imports, and stops short of the app", () => {
  const closure = closureAt('HEAD');
  assert.ok(closure, 'every import resolves at HEAD');

  for (const file of ['scripts/evaluate-let-go.mjs', 'scripts/evaluate-let-go-v3.mjs', 'scripts/evaluate-learner.mjs', 'src/learner.ts', 'src/train-path.ts', 'src/typing.ts', 'src/insights.ts', 'src/domain-history.ts', 'src/profile-types.ts']) {
    assert.ok(closure.has(file), file);
  }

  assert.ok(!closure.has('src/app.tsx'));
});

test('a PR runs Learner eval when it changes a loaded file at its head or base, an always-run file, or the graph breaks', () => {
  const head = new Set(['src/learner.ts']);
  const base = new Set(['src/learner.ts', 'src/old.ts']);

  assert.equal(decide(['src/learner.ts'], [head, base]).run, true);
  assert.equal(decide(['src/old.ts'], [head, base]).run, true, 'a file only the base loads');
  assert.equal(decide(['docs/adr/0019-evaluation.json'], [head, base]).run, true);
  assert.equal(decide(['bun.lock'], [head, base]).run, true);
  assert.equal(decide(['package.json'], [head, base]).run, true);
  assert.equal(decide(['tsconfig.json'], [head, base]).run, true);
  assert.equal(decide(['scripts/evaluate-new.mjs'], [head, base]).run, true);
  assert.equal(decide(['docs/ARCHITECTURE.md', 'src/app.tsx'], [head, base]).run, false);
  assert.equal(decide(['docs/ARCHITECTURE.md'], [null, base]).run, true, 'an import that does not resolve');
});
