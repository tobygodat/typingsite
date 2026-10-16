import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, conditionKey, createAttempt } from '../src/typing.js';
import { runRecord } from '../src/insights.js';
import { test, expect, openApp, openView, passageText, typeInto, signInWithEmail, chooseMore } from './fixtures.js';

// Committed docs images are only rewritten on request (SCREENSHOTS=1); normal runs still take
// the shots, into the test's own output folder.
const shot = (testInfo, name) => process.env.SCREENSHOTS
  ? `docs/screenshots/missed-words-list/${name}.png`
  : testInfo.outputPath(`${name}.png`);

// Common words that recur from quote to quote, so the same word gets missed in more than one run.
const TARGETS = ['the', 'and', 'a', 'of', 'to', 'in', 'it', 'that', 'for', 'was'];
const bare = (raw) => raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();

// Types `text` at a human pace (`delay` ms a key), with one wrong-then-fixed lowercase letter in the
// first occurrence of each target word, and returns the words missed.
async function typeWithMisses(page, text, delay) {
  const words = text.split(' ');
  const missed = new Set();
  await page.locator('#typing-input').focus();
  for (const [index, raw] of words.entries()) {
    const typed = index < words.length - 1 ? `${raw} ` : raw;
    const word = bare(raw);
    // A lowercase letter, so the miss is recorded as the bare word (a capital would keep "The").
    const at = TARGETS.includes(word) && !missed.has(word) ? [...raw].findIndex((char) => /\p{Ll}/u.test(char)) : -1;
    if (at < 0) {
      await page.keyboard.type(typed, { delay });
      continue;
    }
    missed.add(word);
    await page.keyboard.type(typed.slice(0, at), { delay });
    await page.keyboard.type(typed[at] === 'x' ? 'z' : 'x', { delay });
    await page.keyboard.press('Backspace', { delay });
    await page.keyboard.type(typed.slice(at), { delay });
  }
  return missed;
}

const listRows = (page) => page.locator('#missed-words-list li').evaluateAll((rows) => rows.map((row) => [row.children[0].textContent, row.children[1].textContent]));

test('words missed across runs build a list in Training that starts an uncounted practice', async ({ page }, testInfo) => {
  // Several runs typed at a human pace.
  test.setTimeout(360_000);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await openApp(page);
  await openView(page, 'Train');
  await expect(page.locator('#missed-words-note')).toHaveText(/^Not enough evidence yet: no runs counted so far\./);
  await expect(page.locator('#practice-missed-list')).toBeHidden();
  await openView(page, 'Practice');
  // Short original quotes: real sentences, where common words recur from run to run.
  await page.locator('#mode-quote').click();
  await page.locator('#quote-length').selectOption('short');

  const tally = new Map();
  let runs = 0;
  const recurring = () => [...tally].filter(([, n]) => n >= 2);
  // At least three runs, so the counts can differ between words.
  while (runs < 3 || recurring().length < 2) {
    expect(runs, 'two target words recur within a few short quotes').toBeLessThan(6);
    if (runs) await page.locator('#run-again').click();
    // ~130 ms a key is a believable 70-100 wpm.
    for (const word of await typeWithMisses(page, await passageText(page), 130)) tally.set(word, (tally.get(word) || 0) + 1);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    runs += 1;
    const wpm = Number(await page.locator('#result-wpm').textContent());
    expect(wpm).toBeGreaterThanOrEqual(40);
    expect(wpm).toBeLessThanOrEqual(110);
    if (runs === 1) await expect(page.locator('#missed-words-note')).toHaveText(/^Not enough evidence yet: one run on a physical keyboard counted so far\./);
  }

  // Training is the results screen: the list sits below the recurring patterns.
  await openView(page, 'Train');
  const note = page.locator('#missed-words-note');
  await expect(note).toHaveText(`First-try misses in your last ${runs} complete tests, retests and new daily passages on a physical keyboard, all other test conditions together, up to 12 words a run. Word practice, custom text and drills aren’t counted.`);
  const rows = await listRows(page);
  expect(rows.length).toBe(Math.min(8, recurring().length));
  for (const [word, copy] of rows) expect(copy).toBe(`missed in ${tally.get(word)} of the last ${runs} runs`);
  // Ranked by the number of runs each word was missed in.
  const counts = rows.map(([, copy]) => Number(copy.match(/missed in (\d+)/)[1]));
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
  const action = page.locator('#practice-missed-list');
  await expect(action).toHaveText(`Practice these ${rows.length} words`);
  // The run card's own word practice is on screen too, so the names tell the two apart.
  await expect(action).toHaveAccessibleName(`Practice these ${rows.length} words you keep missing`);
  await expect(page.locator('#practice-words')).toBeVisible();
  await expect(page.locator('#practice-words')).not.toHaveAccessibleName(/keep missing/);
  // One hairline and 32px between the two sections, not the column's grid gap on top.
  const patternsEnd = await page.locator('section.training-memory').first().evaluate((node) => node.getBoundingClientRect().bottom);
  const listTop = await page.locator('section.missed-words').evaluate((node) => node.getBoundingClientRect().top);
  expect(listTop - patternsEnd).toBe(0);

  // The whole list down to its button, 32px above the fold, with the run card beside it.
  await action.evaluate((button) => window.scrollTo(0, button.getBoundingClientRect().bottom + window.scrollY + 32 - window.innerHeight));
  await page.mouse.move(1270, 790);
  await page.screenshot({ path: shot(testInfo, 'training-list-dark') });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: shot(testInfo, 'training-list-light') });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });

  await action.click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#session-kicker')).toHaveText('missed words');
  await expect(page.locator('#session-title')).toHaveText('Practice words you keep missing');
  await expect(page.locator('#condition-line')).toContainText('missed words · not counted · 40 words');
  const practice = (await passageText(page)).split(' ');
  expect(practice.length).toBe(40);
  for (const [word] of rows) expect(practice).toContain(word);
  // A little quicker than the quotes: short familiar words.
  await typeInto(page, practice.join(' '), '#typing-input', { delay: 115 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Word practice complete · not counted toward your best');
  const practiceWpm = Number(await page.locator('#result-wpm').textContent());
  expect(practiceWpm).toBeGreaterThanOrEqual(40);
  expect(practiceWpm).toBeLessThanOrEqual(110);
  // Out of the evidence: the list still counts the same runs. (#best says word practice isn't counted,
  // so the signed-in test checks the stored bests instead.)
  await expect(note).toContainText(`your last ${runs} complete tests`);
  expect(await listRows(page)).toEqual(rows);

  // Then the existing loop: the same practice again, or a fresh-text retest of the last quote run.
  await expect(page.locator('#recommendation-meta')).toHaveText('About 1 min, then a fresh short quote retest.');
  await expect(page.locator('#skip-to-retest')).toBeEnabled();
  await page.locator('#run-again').click();
  await expect(page.locator('#session-title')).toHaveText('Practice words you keep missing');
  expect((await passageText(page)).split(' ')).toEqual(practice);
  await openView(page, 'Train');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#session-description')).toHaveText('Fresh text, same conditions.');
});

const conditions = { mode: 'words', count: 25, duration: null, punctuation: false, quoteLength: null,
  difficulty: null, wordList: '1k', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
const TEXT = 'their house is near the river because their road runs along the river bank because it is quiet and their garden is small';

// A finished 25-word run at about 80 wpm, with a fixed miss on the second letter of each word in `missed`.
function trace(id, at, missed, kind = 'test') {
  const attempt = createAttempt({ id, text: TEXT, textId: id, kind, conditions });
  attempt.startedAt = 0;
  const misses = new Set();
  let start = 0;
  for (const word of TEXT.split(' ')) {
    if (missed.includes(word)) misses.add(start + 1);
    start += word.length + 1;
  }
  let t = 0;
  [...TEXT].forEach((char, position) => {
    if (misses.has(position)) attempt.events.push({ type: 'insert', text: 'x', position, offsetMs: (t += 150), accepted: true }, { type: 'delete', count: 1, offsetMs: (t += 150) });
    attempt.events.push({ type: 'insert', text: char, position, offsetMs: (t += 150), accepted: true });
  });
  return { ...completeAttempt(attempt, { endedAt: t }), at, fresh: true };
}

test('signed in, the list rides the synced run summaries, starts from the palette and clears with history', async ({ page, supabase }, testInfo) => {
  // The practice passage is typed at a human pace.
  test.setTimeout(120_000);
  const user = supabase.addUser('words@stilltype.test');
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const traces = [trace('a', day(3), ['their', 'because']), trace('b', day(2), ['their', 'river']), trace('c', day(1), ['their', 'because', 'river'])];
  // An older summary saved before missed words were recorded, and a practice run: neither counts.
  const { missedWords, ...legacy } = runRecord(trace('old', day(4), ['their', 'house']));
  const practice = { ...runRecord(trace('practice', day(1), ['house', 'garden'], 'missed')), missedWords: ['house', 'garden'] };
  // Settings and a best that match the seeded 25-word runs, as that person's account would hold.
  const top = traces.map((t) => runRecord(t)).reduce((a, b) => (b.score.wpm > a.score.wpm ? b : a));
  const bests = { [conditionKey(conditions)]: { wpm: top.score.wpm, attemptId: top.id, at: top.at } };
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { mode: 'words', count: 25, wordList: '1k' }, attempts: traces,
    runs: [legacy, ...traces.map((t) => runRecord(t)), practice], loops: [], seenTextIds: traces.map((t) => t.textId), bests,
    updatedAt: new Date(Date.now() - 60000).toISOString() } });
  expect(missedWords).toEqual(['their', 'house']);
  expect(top.score.wpm).toBeGreaterThanOrEqual(40);
  expect(top.score.wpm).toBeLessThanOrEqual(110);

  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Train');
  const expected = [['their', 'missed in 3 of the last 3 runs'], ['because', 'missed in 2 of the last 3 runs'], ['river', 'missed in 2 of the last 3 runs']];
  expect(await listRows(page)).toEqual(expected);
  const best = `Best · ${top.score.wpm} wpm`;
  await expect(page.locator('#best')).toHaveText(best);

  // The mobile layout: rows stack within the column, no sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.locator('section.missed-words').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: shot(testInfo, 'training-list-390') });
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1280, height: 800 });

  // The palette starts the same practice.
  await page.locator('#palette-trigger').click();
  await page.keyboard.type('keep missing');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('practice words you keep missing');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('3 words');
  await page.keyboard.press('Enter');
  await expect(page.locator('#session-title')).toHaveText('Practice words you keep missing');
  const passage = (await passageText(page)).split(' ');
  expect(new Set(passage)).toEqual(new Set(['their', 'because', 'river']));
  await typeInto(page, passage.join(' '), '#typing-input', { delay: 110 });
  await expect(page.locator('#result-delta')).toHaveText('Word practice complete · not counted toward your best');
  // With no run in this tab, the newest retained run is the retest baseline.
  await expect(page.locator('#recommendation-meta')).toHaveText('About 1 min, then a fresh 25-word retest.');
  await expect(page.locator('#skip-to-retest')).toBeEnabled();
  // Faster than the seeded runs, and still out of bests: word practice has no best of its own, and the
  // stored bests are unchanged (below).
  await expect(page.locator('#best')).toHaveText('Not counted');

  // Persisted on the account: a reload shows the same list, unchanged by the practice run.
  await expect.poll(() => supabase.profileFor(user.email)?.runs.length).toBe(6);
  expect(supabase.profileFor(user.email).bests).toEqual(bests);
  await page.reload();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openView(page, 'Train');
  expect(await listRows(page)).toEqual(expected);

  const clear = async () => {
    await openView(page, 'Progress');
    await page.locator('#clear-history').click();
    await page.locator('#confirm-clear-input').fill('clear');
    await page.locator('#confirm-clear').click();
  };
  // Start the practice, then clear history before typing it; Undo brings the list back.
  await page.locator('#practice-missed-list').click();
  await expect(page.locator('#session-title')).toHaveText('Practice words you keep missing');
  await clear();
  await page.locator('#undo-clear').click();
  await openView(page, 'Train');
  expect(await listRows(page)).toEqual(expected);

  await clear();
  await openView(page, 'Train');
  await expect(page.locator('#missed-words-note')).toHaveText(/^Not enough evidence yet: no runs counted so far\./);
  await expect(page.locator('#missed-words-list')).toBeHidden();
  await expect(page.locator('#practice-missed-list')).toBeHidden();
  // The cleared words are gone from Run again too: it starts a normal test.
  await page.locator('#run-again').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#session-title')).not.toHaveText('Practice words you keep missing');
  expect((await passageText(page)).split(' ')).toHaveLength(25);
});

test('custom text never feeds the list: its misses aren’t counted, as stored or as typed', async ({ page, supabase }) => {
  const user = supabase.addUser('custom@stilltype.test');
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const traces = [trace('a', day(3), ['their', 'because']), trace('b', day(2), ['their', 'because'])];
  // Custom-text summaries that carry missed words of their own (as a hand-edited copy might): never counted.
  const custom = { ...conditions, mode: 'custom', count: null, wordList: null, customOrder: 'as-written' };
  const customRun = (id) => ({ ...runRecord(trace(id, day(1), ['river', 'garden'], 'custom')), conditions: custom, missedWords: ['river', 'garden'] });
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { mode: 'words', count: 25, wordList: '1k' }, attempts: traces,
    runs: [...traces.map((t) => runRecord(t)), customRun('c1'), customRun('c2')], loops: [], seenTextIds: traces.map((t) => t.textId),
    bests: {}, updatedAt: new Date(Date.now() - 60000).toISOString() } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Train');
  const expected = [['because', 'missed in 2 of the last 2 runs'], ['their', 'missed in 2 of the last 2 runs']];
  expect(await listRows(page)).toEqual(expected);

  // A custom run typed here, missing "the", "and" and "it" on the first try, adds no evidence either.
  await openView(page, 'Practice');
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(TEXT);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  const missed = await typeWithMisses(page, await passageText(page), 20);
  expect([...missed].sort()).toEqual(['and', 'it', 'the']);
  await expect(page.locator('#result-delta')).toHaveText('Custom text complete · not counted toward your best');
  await openView(page, 'Train');
  expect(await listRows(page)).toEqual(expected);
  await expect(page.locator('#missed-words-note')).toContainText('your last 2 complete tests');
  await expect.poll(() => supabase.profileFor(user.email)?.runs.length).toBe(5);
  const stored = supabase.profileFor(user.email).runs.at(-1);
  expect(stored.kind).toBe('custom');
  expect(stored).not.toHaveProperty('missedWords');
});

// Holds the next account-row fetch until `release()`, as a slow network would. The page boots from
// its device copy, so Train draws the list before a newer row arrives; adopting that row redraws
// Progress but not Train, which leaves the list on screen out of date.
async function holdNextProfileFetch(page) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let asked;
  const fetched = new Promise((resolve) => { asked = resolve; });
  let held = false;
  await page.route(/supabase\.co\/rest\/v1\/profiles\?/, async (route) => {
    if (held || route.request().method() !== 'GET') return route.fallback();
    held = true;
    asked();
    await gate;
    return route.fallback();
  });
  return { fetched, release };
}

test('a list left stale by a sync is checked when pressed, and a clear elsewhere redraws it without losing focus', async ({ page, supabase }) => {
  const user = supabase.addUser('stale@stilltype.test');
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  // Saved as this build saves (mergeStamp), so copies merge rather than the later one replacing the other.
  const row = (traces, updatedAt, extra = {}) => ({ data: { version: 2, preferences: { mode: 'words', count: 25, wordList: '1k' }, attempts: traces,
    runs: traces.map((t) => runRecord(t)), loops: [], seenTextIds: traces.map((t) => t.textId), bests: {}, updatedAt, mergeStamp: updatedAt, ...extra } });
  const shownWords = async () => (await listRows(page)).map(([word]) => word).sort();
  supabase.profiles.set(user.id, row([trace('a', day(4), ['their', 'because']), trace('b', day(3), ['their', 'because'])], day(3)));
  await openApp(page);
  await signInWithEmail(page, user.email);

  // Reloads with the account row held back and draws Train from the device copy. Someone practises
  // the list and comes back to it (adopting a row over a plain test would reset it and switch to
  // Practice); then `traces`, saved meanwhile on another device, arrive. Focus waits on the button.
  const syncUnderList = async (shown, traces, extra = {}, { stale = true } = {}) => {
    const { fetched, release } = await holdNextProfileFetch(page);
    await page.reload();
    await fetched;
    await expect(page.locator('#text-display .char').first()).toBeVisible();
    await openView(page, 'Train');
    expect(await shownWords()).toEqual([...shown].sort());
    await page.locator('#practice-missed-list').click();
    await expect(page.locator('#session-title')).toHaveText('Practice words you keep missing');
    await openView(page, 'Train');
    await page.locator('#practice-missed-list').focus();
    const at = new Date().toISOString();
    supabase.profiles.set(user.id, row(traces, at, typeof extra === 'function' ? extra(at) : extra));
    release();
    await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
    // The precondition: the newer row is in, and Train still shows the old words.
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    if (stale) expect(await shownWords()).toEqual([...shown].sort());
  };

  // Different words now: the press practises the words the runs hold, not the stale ones. The other
  // device's runs merge with these, so all four recur.
  await syncUnderList(['their', 'because'], [trace('c', day(2), ['river', 'garden']), trace('d', day(1), ['river', 'garden'])]);
  await page.keyboard.press('Enter');
  await expect(page.locator('#session-title')).toHaveText('Practice words you keep missing');
  expect(new Set((await passageText(page)).split(' '))).toEqual(new Set(['river', 'garden', 'their', 'because']));

  // History cleared elsewhere: the clear applies as it arrives (with the training it removed), so the
  // list is redrawn at once; focus moves to the section rather than staying on the button it hid, and
  // Enter starts nothing.
  await syncUnderList(['river', 'garden', 'their', 'because'], [], (at) => ({ historyClearedAt: `${at}~elsewhere` }), { stale: false });
  await expect(page.locator('#missed-words-note')).toHaveText(/^Not enough evidence yet: no runs counted so far\./);
  await expect(page.locator('#missed-words-list')).toBeHidden();
  await expect(page.locator('#practice-missed-list')).toBeHidden();
  await expect(page.locator('#missed-words-heading')).toBeFocused();
  await page.keyboard.press('Enter');
  // Every session start switches to Practice, so staying on Train means nothing started.
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
});
