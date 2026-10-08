// Progress › Keys: per-key miss-rate heatmap and the "Pairs to watch" table from saved pattern memory.
import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, createAttempt } from '../src/typing.js';
import { runRecord } from '../src/insights.js';
import { test, expect, openApp, openView, signInWithEmail } from './fixtures.js';

const conditions = { mode: 'words', count: 25, duration: null, punctuation: false, quoteLength: null,
  difficulty: null, wordList: '1k', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

// Every other "o" is mistyped and slow to reach; every third "u" is mistyped.
function trace(id, at) {
  const text = Array(12).fill('the quick brown fox jumps over the lazy dog').join(' ');
  const attempt = createAttempt({ id, text, textId: id, conditions });
  attempt.startedAt = 0;
  let o = 0; let u = 0; let t = 0;
  attempt.events = [...text].map((char, position) => {
    let typed = char;
    if (char === 'o' && o++ % 2 === 0) typed = 'p';
    if (char === 'u' && u++ % 3 === 0) typed = 'y';
    t += char === 'o' ? 260 : 120;
    return { type: 'insert', text: typed, position, offsetMs: t, accepted: true };
  });
  return { ...completeAttempt(attempt, { endedAt: t + 120 }), at, fresh: true };
}

test('Progress shows a per-key miss heatmap and ranked pairs with sample counts', async ({ page, supabase }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  const user = supabase.addUser('keys@stilltype.test');
  const traces = [trace('keys-a', '2026-09-28T12:00:00Z'), trace('keys-b', '2026-09-29T12:00:00Z')];
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: traces,
    runs: traces.map((t) => runRecord(t)), loops: [], seenTextIds: traces.map((t) => t.textId), bests: {}, updatedAt: '2026-09-29T12:00:00Z' } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');

  const heatmap = page.locator('#key-heatmap');
  await expect(heatmap.locator('.key')).toHaveCount(26);
  await expect(heatmap.locator('.key').filter({ hasText: /^o$/ })).toHaveAttribute('data-heat', '3');
  await expect(heatmap.locator('.key').filter({ hasText: /^o$/ })).toHaveAttribute('title', 'o: 33.3% miss · 72 samples');
  await expect(heatmap.locator('.key').filter({ hasText: /^h$/ })).toHaveAttribute('data-heat', '0');
  await expect(heatmap.locator('.key').filter({ hasText: /^q$/ })).toHaveAttribute('title', 'q: not enough samples (0)');
  await expect(heatmap.locator('.key').filter({ hasText: /^q$/ })).toHaveAttribute('data-heat', 'none');
  await expect(page.locator('#key-note')).toContainText('2 saved runs');

  const rows = page.locator('#pairs-table tbody tr');
  await expect(page.locator('#pairs-table')).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);
  expect(await rows.count()).toBeLessThanOrEqual(8);
  await expect(rows.first().locator('td').last()).toHaveText(/^\d+$/);
  await expect(page.locator('#pairs-table')).toContainText('“ro”');

  const section = page.locator('section[aria-labelledby="keys-heading"]');
  await section.scrollIntoViewIfNeeded();
  await page.emulateMedia({ colorScheme: 'dark' });
  await section.screenshot({ path: 'docs/screenshots/key-heatmap/keys-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await section.screenshot({ path: 'docs/screenshots/key-heatmap/keys-light.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: 'docs/screenshots/key-heatmap/keys-mobile-dark.png' });
});
