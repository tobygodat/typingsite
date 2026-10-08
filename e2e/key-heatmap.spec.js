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

// Committed docs images are only rewritten on request (SCREENSHOTS=1); normal runs keep them in test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/key-heatmap/${name}` : testInfo.outputPath(name));

// A summary saved before per-letter counts existed: pairs only.
const legacy = ({ keys, keysVersion, ...rest }) => rest;

test('Progress shows a per-key miss heatmap and ranked pairs with sample counts', async ({ page, supabase }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  const user = supabase.addUser('keys@stilltype.test');
  const traces = [trace('keys-a', '2026-09-28T12:00:00Z'), trace('keys-b', '2026-09-29T12:00:00Z')];
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: traces,
    runs: [legacy(runRecord(traces[0])), runRecord(traces[1])], loops: [], seenTextIds: traces.map((t) => t.textId), bests: {}, updatedAt: '2026-09-29T12:00:00Z' } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');

  const heatmap = page.locator('#key-heatmap');
  const key = (letter) => heatmap.locator('.key').filter({ hasText: new RegExp(`^${letter}$`) });
  await expect(heatmap.locator('.key')).toHaveCount(26);
  // New run: all 48 "o" presses (24 missed), including word-initial "over". Older run: 36 mid-word presses (12 missed).
  await expect(key('o')).toHaveAttribute('data-heat', '3');
  await expect(key('o')).toHaveAttribute('title', 'o: 42.9% miss · 84 samples');
  await expect(key('h')).toHaveAttribute('data-heat', '0');
  // Every "q" starts a word ("quick"): only the run with per-letter counts sees them.
  await expect(key('q')).toHaveAttribute('title', 'q: 0.0% miss · 12 samples');
  await expect(key('q')).toHaveAttribute('data-heat', '0');
  await expect(page.locator('#key-note')).toContainText('2 saved runs');
  await expect(page.locator('#key-note')).toContainText('1 older run counts only letters typed after another letter');

  const rows = page.locator('#pairs-table tbody tr');
  await expect(page.locator('#pairs-table')).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);
  expect(await rows.count()).toBeLessThanOrEqual(8);
  await expect(rows.first().locator('td').last()).toHaveText(/^\d+$/);
  await expect(page.locator('#pairs-table')).toContainText('“ro”');
  // Every "ro" is mistyped, so no run has clean intervals for it: slow runs are unknown, not "0 of 2".
  const pairRow = (pair) => rows.filter({ has: page.locator('td').first().filter({ hasText: `“${pair}”` }) });
  await expect(pairRow('ro').locator('td').nth(2)).toHaveText(/^—/);
  await expect(pairRow('ro').locator('td').nth(2)).toHaveAttribute('title', 'No run has 10 clean intervals for this pair yet');
  await expect(pairRow('do').locator('td').nth(2)).toHaveText('2 of 2');

  // The heatmap is one tab stop; arrow keys move between keys and the line below shows the numbers.
  const detail = page.locator('#key-detail');
  await expect(detail).toHaveText('Select a key to see its miss rate and sample count.');
  await expect(heatmap.locator('[tabindex="0"]')).toHaveCount(1);
  await page.locator('#keys-heading').evaluate((heading) => { heading.tabIndex = -1; heading.focus(); });
  await page.keyboard.press('Tab');
  await expect(key('q')).toBeFocused();
  await expect(detail).toHaveText('“q”: 0.0% first-try misses (0 of 12 samples).');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect(key('o')).toBeFocused();
  await expect(detail).toHaveText('“o”: 42.9% first-try misses (36 of 84 samples).');
  await page.keyboard.press('ArrowDown');
  await expect(key('l')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(key('o')).toBeFocused();
  await expect(heatmap.locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.closest('#key-heatmap'))).toBeNull();
  await page.keyboard.press('Shift+Tab');
  await expect(key('o')).toBeFocused();
  await expect(key('o')).toHaveAttribute('data-selected', 'true');
  // A tap or click shows the same line.
  await key('u').click();
  await expect(key('u')).toBeFocused();
  await expect(detail).toContainText('“u”: ');
  await expect(detail).toContainText('first-try misses');

  const section = page.locator('section[aria-labelledby="keys-heading"]');
  await section.scrollIntoViewIfNeeded();
  await page.emulateMedia({ colorScheme: 'dark' });
  await section.screenshot({ path: shot(testInfo, 'keys-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await section.screenshot({ path: shot(testInfo, 'keys-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: shot(testInfo, 'keys-mobile-dark.png') });
});
