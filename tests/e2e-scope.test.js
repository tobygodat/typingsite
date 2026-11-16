import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { e2eScope } from '../scripts/e2e-scope.mjs';

const present = (...files) => (file) => files.includes(file);

test('a change no browser test can see runs none of them', () => {
  assert.deepEqual(e2eScope(['docs/CONVENTIONS.md', 'docs/adr/0018-ci-on-hosted-runners.md'], present()), { kind: 'none' });
  assert.deepEqual(e2eScope(['tests/e2e-shards.test.js', 'README.md', 'AGENTS.md'], present()), { kind: 'none' });
  assert.deepEqual(e2eScope(['design/ash/index.html', '.claude/skills/x/SKILL.md', 'supabase/migrations/1.sql', 'scripts/e2e-durations.json'], present()), { kind: 'none' });
});

test('a change to specs alone runs only those specs, sorted and once each', () => {
  const exists = present('e2e/typing.spec.js', 'e2e/layout.spec.js');

  assert.deepEqual(e2eScope(['e2e/typing.spec.js'], exists), { kind: 'specs', files: ['e2e/typing.spec.js'] });
  assert.deepEqual(e2eScope(['e2e/typing.spec.js', 'docs/x.md', 'e2e/layout.spec.js', 'e2e/typing.spec.js'], exists), { kind: 'specs', files: ['e2e/layout.spec.js', 'e2e/typing.spec.js'] });
});

test('a spec with a source file runs everything', () => {
  const scope = e2eScope(['e2e/typing.spec.js', 'src/typing.ts'], present('e2e/typing.spec.js', 'src/typing.ts'));

  assert.equal(scope.kind, 'all');
  assert.match(scope.reason, /src\/typing\.ts/);
});

test('a deleted or renamed-away spec drops out', () => {
  const exists = present('e2e/new-name.spec.js');

  assert.deepEqual(e2eScope(['e2e/gone.spec.js'], exists), { kind: 'none' });
  assert.deepEqual(e2eScope(['e2e/old-name.spec.js', 'e2e/new-name.spec.js'], exists), { kind: 'specs', files: ['e2e/new-name.spec.js'] });
});

test('a path no rule knows, or an e2e helper, runs everything', () => {
  for (const file of ['tools/oxlint/plugin.js', 'e2e/fixtures.js', 'e2e/fake-supabase.js', 'e2e/sub/README.md', 'scripts/e2e-shards.mjs', 'package-lock.json', '.github/workflows/ci.yml', 'index.html', 'docs', 'src/README.md']) {
    assert.equal(e2eScope([file], present(file)).kind, 'all', file);
  }
});

test('an empty list runs none', () => {
  assert.deepEqual(e2eScope([], present()), { kind: 'none' });
});

test('each spec in the tree runs alone, and each other e2e file runs everything', () => {
  const files = readdirSync(new URL('../e2e/', import.meta.url)).map((file) => `e2e/${file}`);

  for (const file of files) assert.equal(e2eScope([file]).kind, file.endsWith('.spec.js') ? 'specs' : 'all', file);
});
