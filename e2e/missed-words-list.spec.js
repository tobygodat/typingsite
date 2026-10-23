import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, conditionKey, createAttempt } from '../src/typing.js';
import { runRecord } from '../src/insights.js';
import { test, expect, openApp, openView, passageText, typeInto, finishDrill, signInWithEmail, chooseMore, chooseQuoteFilter, recordedHere } from './fixtures.js';

// Common words that recur from quote to quote, so the same word gets missed in more than one run.
const TARGETS = ['the', 'and', 'a', 'of', 'to', 'in', 'it', 'that', 'for', 'was'];
const bare = (raw) => raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();

// Types `text` at `delay` ms a key, with one wrong-then-fixed lowercase letter in the
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

// "Words you keep missing" is a command palette entry: its hint counts the words, and it is left out of
// the palette with fewer than two. Returns the entry, with the palette open and the query typed.
async function keepMissing(page) {
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('#palette-trigger').click();
  await page.keyboard.type('practice words you keep missing');
  return page.locator('#palette-list .palette-option', { hasText: 'practice words you keep missing' });
}

async function keepMissingCount(page) {
  const option = await keepMissing(page);
  const count = await option.count() ? Number((await option.locator('.opt-hint').textContent()).match(/^(\d+) words$/)[1]) : 0;
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();
  return count;
}

async function practiseKeepMissing(page) {
  await expect(await keepMissing(page)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.locator('#session-title')).toHaveText('Practice words you keep missing');
}

test('words missed across runs build the palette’s list, which starts an uncounted practice', async ({ page }) => {
  await openApp(page);
  expect(await keepMissingCount(page)).toBe(0);
  // Short original quotes: real sentences, where common words recur from run to run.
  await page.locator('#mode-quote').click();
  await chooseQuoteFilter(page, 'length', 'short');

  const tally = new Map();
  let runs = 0;
  const recurring = () => [...tally].filter(([, n]) => n >= 2);
  // At least three runs, so the counts can differ between words.
  while (runs < 3 || recurring().length < 2) {
    expect(runs, 'two target words recur within a few short quotes').toBeLessThan(6);
    if (runs) await page.locator('#run-again').click();
    for (const word of await typeWithMisses(page, await passageText(page), 0)) tally.set(word, (tally.get(word) || 0) + 1);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    runs += 1;
    // One run is no list yet: no word has been missed twice.
    if (runs === 1) expect(await keepMissingCount(page)).toBe(0);
  }

  // Ranked by the number of runs each word was missed in, eight at most.
  const words = recurring().sort((a, b) => b[1] - a[1]);
  const count = Math.min(8, words.length);
  expect(await keepMissingCount(page)).toBe(count);
  // The trace's own word practice is still on the run card, with its own name.
  await expect(page.locator('#practice-words')).toBeVisible();
  await expect(page.locator('#practice-words')).not.toHaveAccessibleName(/keep missing/);

  await practiseKeepMissing(page);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#session-kicker')).toHaveText('missed words');
  await expect(page.locator('#condition-line')).toContainText('missed words · not counted · 40 words');
  const practice = (await passageText(page)).split(' ');
  expect(practice.length).toBe(40);
  // Past eight, words tied with the eighth may be left out; every word ranked above it is in.
  const cut = words.length > 8 ? words[7][1] : 0;
  for (const [word, n] of words) if (n > cut) expect(practice).toContain(word);
  await typeInto(page, practice.join(' '));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Word practice complete · not counted toward your best');
  // Out of the evidence: the list still counts the same words. (#best says word practice isn't counted,
  // so the signed-in test checks the stored bests instead.)
  expect(await keepMissingCount(page)).toBe(count);

  // Then the existing loop: the same practice again, or Train's drill and a fresh-text retest of the
  // last quote run.
  await expect(page.locator('#result-drill')).toBeVisible();
  await page.locator('#run-again').click();
  await expect(page.locator('#session-title')).toHaveText('Practice words you keep missing');
  expect((await passageText(page)).split(' ')).toEqual(practice);
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await expect(page.locator('#session-description')).toHaveText('Doesn’t count toward your best.');
  await finishDrill(page);
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

test('signed in, the list rides the synced run summaries, starts from the palette and clears with history', async ({ page, supabase }) => {
  const user = supabase.addUser('words@stilltype.test');
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const traces = [trace('a', day(3), ['their', 'because']), trace('b', day(2), ['their', 'river']), trace('c', day(1), ['their', 'because', 'river'])];
  // An older summary saved before missed words were recorded, and a practice run: neither counts.
  const { missedWords, ...legacy } = runRecord(trace('old', day(4), ['their', 'house']));
  const practice = { ...runRecord(trace('practice', day(1), ['house', 'garden'], 'missed')), missedWords: ['house', 'garden'] };
  // Settings and a best that match the seeded 25-word runs, as that person's account would hold.
  const top = traces.map((t) => runRecord(t)).reduce((a, b) => (b.score.wpm > a.score.wpm ? b : a));
  const bests = { [conditionKey(conditions)]: { wpm: top.score.wpm, attemptId: top.id, at: top.at } };
  const data = { version: 2, preferences: { mode: 'words', count: 25, wordList: '1k' }, attempts: traces,
    runs: [legacy, ...traces.map((t) => runRecord(t)), practice], loops: [], seenTextIds: traces.map((t) => t.textId), bests,
    updatedAt: new Date(Date.now() - 60000).toISOString() };
  supabase.profiles.set(user.id, { data });
  expect(missedWords).toEqual(['their', 'house']);
  expect(top.score.wpm).toBeGreaterThanOrEqual(40);
  expect(top.score.wpm).toBeLessThanOrEqual(110);

  await openApp(page);
  // Recorded on this device, so the newest recording is here to be the retest baseline.
  await recordedHere(page, user.id, data);
  await signInWithEmail(page, user.email);
  expect(await keepMissingCount(page)).toBe(3);
  const best = `Best · ${top.score.wpm} wpm`;
  await expect(page.locator('#best')).toHaveText(best);

  // The palette starts the practice of the words missed in two runs or more.
  await page.locator('#palette-trigger').click();
  await page.keyboard.type('keep missing');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('practice words you keep missing');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('3 words');
  await page.keyboard.press('Enter');
  await expect(page.locator('#session-title')).toHaveText('Practice words you keep missing');
  const passage = (await passageText(page)).split(' ');
  expect(new Set(passage)).toEqual(new Set(['their', 'because', 'river']));
  await typeInto(page, passage.join(' '));
  await expect(page.locator('#result-delta')).toHaveText('Word practice complete · not counted toward your best');
  // Faster than the seeded runs, and still out of bests: word practice has no best of its own, and the
  // stored bests are unchanged (below).
  await expect(page.locator('#best')).toHaveText('Not counted');

  // Persisted on the account: a reload shows the same list, unchanged by the practice run.
  await expect.poll(() => supabase.profileFor(user.email)?.runs.length).toBe(6);
  expect(supabase.profileFor(user.email).bests).toEqual(bests);

  // With no run in this tab, the newest retained run is the baseline: the drill it offers is retested
  // on fresh 25-word text.
  await page.locator('#result-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-description')).toHaveText('Doesn’t count toward your best.');
  await finishDrill(page);
  await expect(page.locator('#condition-line')).toContainText('25 words');

  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await page.reload();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  expect(await keepMissingCount(page)).toBe(3);

  const clear = async () => {
    await openView(page, 'Progress');
    await page.locator('#clear-history').click();
    await page.locator('#confirm-clear-input').fill('clear');
    await page.locator('#confirm-clear').click();
  };
  // Start the practice, then clear history before typing it; Undo brings the list back.
  await practiseKeepMissing(page);
  await clear();
  await page.locator('#undo-clear').click();
  expect(await keepMissingCount(page)).toBe(3);

  await clear();
  expect(await keepMissingCount(page)).toBe(0);
  // The cleared words are gone from Practice too: it starts a normal test.
  await openView(page, 'Practice');
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
  expect(await keepMissingCount(page)).toBe(2);

  // A custom run typed here, missing "the", "and" and "it" on the first try, adds no evidence either.
  await openView(page, 'Practice');
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(TEXT);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  const missed = await typeWithMisses(page, await passageText(page), 20);
  expect([...missed].sort()).toEqual(['and', 'it', 'the']);
  await expect(page.locator('#result-delta')).toHaveText('Custom text complete · not counted toward your best');
  expect(await keepMissingCount(page)).toBe(2);
  await practiseKeepMissing(page);
  expect(new Set((await passageText(page)).split(' '))).toEqual(new Set(['their', 'because']));
  await expect.poll(() => supabase.profileFor(user.email)?.runs.length).toBe(5);
  const stored = supabase.profileFor(user.email).runs.at(-1);
  expect(stored.kind).toBe('custom');
  expect(stored).not.toHaveProperty('missedWords');
});

// Holds the next account-row fetch until `release()`, as a slow network would. The page boots from
// its device copy, so the palette counts that copy's words until a newer row arrives.
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

test('the palette’s list follows a sync: runs from another device join it, and a clear from elsewhere empties it', async ({ page, supabase }) => {
  const user = supabase.addUser('stale@stilltype.test');
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  // Saved as this build saves (mergeStamp), so copies merge rather than the later one replacing the other.
  const row = (traces, updatedAt, extra = {}) => ({ data: { version: 2, preferences: { mode: 'words', count: 25, wordList: '1k' }, attempts: traces,
    runs: traces.map((t) => runRecord(t)), loops: [], seenTextIds: traces.map((t) => t.textId), bests: {}, updatedAt, mergeStamp: updatedAt, ...extra } });
  supabase.profiles.set(user.id, row([trace('a', day(4), ['their', 'because']), trace('b', day(3), ['their', 'because'])], day(3)));
  await openApp(page);
  // Recorded on this device (the runs saved meanwhile below come from another, recordings left there).
  await recordedHere(page, user.id, supabase.profiles.get(user.id).data);
  await signInWithEmail(page, user.email);

  // Reloads with the account row held back, so the palette counts the device copy's words; then
  // `traces`, saved meanwhile on another device, arrive.
  const syncUnderPalette = async (shown, traces, extra = {}) => {
    const { fetched, release } = await holdNextProfileFetch(page);
    await page.reload();
    await fetched;
    await expect(page.locator('#text-display .char').first()).toBeVisible();
    expect(await keepMissingCount(page)).toBe(shown);
    const at = new Date().toISOString();
    supabase.profiles.set(user.id, row(traces, at, typeof extra === 'function' ? extra(at) : extra));
    release();
    await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  };

  // Different words now: the palette practises the words the runs hold. The other device's runs merge
  // with these, so all four recur.
  await syncUnderPalette(2, [trace('c', day(2), ['river', 'garden']), trace('d', day(1), ['river', 'garden'])]);
  expect(await keepMissingCount(page)).toBe(4);
  await practiseKeepMissing(page);
  expect(new Set((await passageText(page)).split(' '))).toEqual(new Set(['river', 'garden', 'their', 'because']));

  // History cleared elsewhere: the clear applies as it arrives, so the palette has no words to offer.
  await syncUnderPalette(4, [], (at) => ({ historyClearedAt: `${at}~elsewhere` }));
  expect(await keepMissingCount(page)).toBe(0);
});
