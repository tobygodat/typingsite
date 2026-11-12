import { trainPath, aheadCopy, behindCopy, evidenceCopy, sinceCopy } from '../src/train-path.js';
import { DEFAULT_POLICY, keyboardOf, recommendFor } from '../src/learner.js';
// Train follows the history this tab holds (TOB-420): a merge, a clear or its undo, made here or in another tab,
// redraws the path and every other training surface, never mid-run, and never takes focus or scroll from someone
// using the page. Two tabs of one account share the device cache, so each hears the other's saves.
import { test, expect, openApp, openView, chooseWords, passageText, typeInto, finishDrill, completePassage } from './fixtures.js';
import { conditions, withHistory } from './train-fixtures.js';

// A seeded Math.random from `start`, so the other tab's passages are fixed.
const seedFrom = (start) => {
  let seed = start;
  Math.random = () => {
    seed = (seed * 16807) % 2147483647;

    return (seed - 1) / 2147483646;
  };
};

async function besideTab(page, context, supabase, email, { seed = null } = {}) {
  const errors = [];
  await withHistory(page, supabase, email);
  const other = await context.newPage();

  if (seed !== null) await other.addInitScript(seedFrom, seed);
  await supabase.attach(other);
  other.on('pageerror', (error) => errors.push(error.message));
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');

  return { other, errors };
}

// The path as drawn: each step behind you with its state and figures, the open step's title and evidence, and each
// step ahead with its evidence.
const drawn = (page) => page.evaluate(() => {
  const text = (node) => (node && !node.hidden ? node.textContent : '');
  const unit = (item) => item.querySelector('.path-unit').firstChild.textContent;
  const lines = (item) => [...item.querySelectorAll('.path-line')].map(text);
  const steps = [...document.querySelectorAll('#train-path > li:not([hidden])')];

  return {
    behind: steps.flatMap((item) => (item.matches('.is-behind:not(#comparison-panel)')
      ? [[unit(item), item.classList.contains('is-fixed') ? 'fixed' : 'drilled', ...lines(item)].join(' | ')] : [])),
    current: [document.querySelector('#train-heading').textContent, text(document.querySelector('#train-evidence')), text(document.querySelector('#train-last'))].join(' | '),
    ahead: steps.flatMap((item) => (item.matches('.is-ahead:not(.is-place)') ? [[unit(item), ...lines(item)].join(' | ')] : [])),
  };
});

// The path trainPath gives for the history stored on this device, at the run's conditions and the stored focus, in
// the same form.
const stored = async (page, after = null) => {
  const { data, now } = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith('stilltype-profile-v2:'));

    return { data: JSON.parse(localStorage.getItem(key)), now: Date.now() };
  });

  const { runs = [], loops = [], attempts = [], preferences = {} } = data;
  const source = conditions;
  const recommendation = recommendFor(DEFAULT_POLICY, { runs, loops, traces: attempts, source, now, focus: preferences.trainFocus || 'balanced' });
  const path = trainPath({ recommendation, loops, runs, keyboard: keyboardOf(source), after });
  const { current } = path;
  const since = sinceCopy(current.since);

  return {
    path: {
      behind: path.behind.map((step) => [step.unit, step.state, ...behindCopy(step)].join(' | ')),
      current: [current.title, current.unit ? evidenceCopy(current.was, { all: Boolean(since) }) : '', since].join(' | '),
      ahead: path.ahead.map((step) => [step.unit, aheadCopy(step.was)].join(' | ')),
    },
    queue: recommendation.queue.map((item) => item.unit),
  };
};

// Drawn as stored, once the merge has landed.
async function expectStoredPath(page, after = null) {
  await expect.poll(async () => JSON.stringify(await drawn(page)) === JSON.stringify((await stored(page, after)).path), { timeout: 10_000 }).toBe(true);
}

async function clearIn(page) {
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#undo-clear')).toBeVisible();
}

// A ten-word run that mistypes every "e", so the learner's evidence moves.
async function runWithMisses(page) {
  await openView(page, 'Practice');
  await chooseWords(page, 10);
  const passage = await passageText(page);
  await typeInto(page, passage.replaceAll('e', 'x'));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');

  return passage;
}

test('a clear in another tab and its undo redraw Train here, each time as the stored history gives it', async ({ page, context, supabase }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { other, errors } = await besideTab(page, context, supabase, 'follow-clear@stilltype.test');
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('Practice “th”');
  await expect(page.locator('#train-path > .is-fixed')).toHaveCount(2);

  await clearIn(other);
  await expectStoredPath(page);
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#train-path > .is-behind:not([hidden])')).toHaveCount(0);

  await other.locator('#undo-clear').click();
  await expectStoredPath(page);
  await expect(page.locator('#train-heading')).toHaveText('Practice “th”');
  await expect(page.locator('#train-path > .is-fixed')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('a run typed in another tab redraws the steps ahead here, and Patterns across runs on Progress', async ({ page, context, supabase }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // A random ten words can miss every pair the path shows (th, an, er, in and the drilled ones), and then nothing on
  // it changes. The other tab's passages are fixed, and the first holds "th".
  const { other, errors } = await besideTab(page, context, supabase, 'follow-run@stilltype.test', { seed: 7919 });
  await openView(page, 'Train');
  const before = await drawn(page);
  expect(before).toEqual((await stored(page)).path);

  expect(await runWithMisses(other)).toContain('th');
  await expect.poll(async () => JSON.stringify((await stored(page)).path), { timeout: 10_000 }).not.toBe(JSON.stringify(before));
  await expectStoredPath(page);

  await openView(page, 'Progress');
  await runWithMisses(other);
  await expect.poll(async () => {
    const rows = await page.locator('#training-targets .training-target h3').allTextContents();

    return JSON.stringify(rows) === JSON.stringify((await stored(page)).queue.slice(0, 8).map((unit) => `Practice “${unit}”`));
  }, { timeout: 10_000 }).toBe(true);
  expect(errors).toEqual([]);
});

test('a run typed in another tab mid-drill leaves the drill alone, and Train follows it once the retest ends', async ({ page, context, supabase }) => {
  const { other, errors } = await besideTab(page, context, supabase, 'follow-drill@stilltype.test');
  await page.clock.install();
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  const drill = await passageText(page);
  await typeInto(page, drill.slice(0, 4));

  await runWithMisses(other);
  // The merge waits: the drill keeps its passage, its place and its focus.
  await expect.poll(async () => (await stored(page)).queue.length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(await passageText(page)).toBe(drill);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#typing-input')).toBeFocused();

  await finishDrill(page);
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-unit')).toHaveText('th');
  await expectStoredPath(page, { trained: 'th' });
  expect(errors).toEqual([]);
});

test('a comparison on show whose runs another tab clears gives way, with no Next the history no longer holds', async ({ page, context, supabase }) => {
  const { other, errors } = await besideTab(page, context, supabase, 'follow-compared@stilltype.test');
  await page.clock.install();
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await finishDrill(page);
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-next')).toBeVisible();

  await clearIn(other);
  await expect(page.locator('#comparison-panel')).toBeHidden();
  await expect(page.locator('#comparison-next')).toBeHidden();
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#start-drill')).toBeVisible();
  await expectStoredPath(page);
  expect(errors).toEqual([]);
});

test('a redraw keeps focus on the step that has it, or gives it to the open step’s button when that step is gone', async ({ page, context, supabase }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { other, errors } = await besideTab(page, context, supabase, 'follow-focus@stilltype.test');
  await openView(page, 'Train');
  const ahead = page.locator('#train-path > .is-ahead .path-choose');
  const unit = await ahead.last().locator('.path-unit').evaluate((node) => node.firstChild.textContent);
  await ahead.last().focus();

  // Another tab types a run: if the step is still ahead it keeps focus, otherwise the open step's button takes it.
  await runWithMisses(other);
  await expectStoredPath(page);
  const still = (await drawn(page)).ahead.some((step) => step.startsWith(`${unit} |`));
  const focused = () => page.evaluate(() => document.activeElement.closest('.path-choose')?.querySelector('.path-unit').firstChild.textContent || document.activeElement.id);
  expect(await focused()).toBe(still ? unit : 'start-drill');

  // Cleared: no step ahead is left, so the open step's button has focus.
  await page.locator('#train-path > .is-ahead .path-choose').first().focus();
  await clearIn(other);
  await expectStoredPath(page);
  await expect(page.locator('#start-drill')).toBeFocused();

  // Restored while the open step's button has focus: it keeps it, and the page has not scrolled.
  const scrollY = await page.evaluate(() => window.scrollY);
  await other.locator('#undo-clear').click();
  await expectStoredPath(page);
  await expect(page.locator('#start-drill')).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  expect(errors).toEqual([]);
});

test('a long path scrolled back to its oldest steps stays there through a redraw', async ({ page, context, supabase }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { other, errors } = await besideTab(page, context, supabase, 'follow-scroll@stilltype.test');
  await openView(page, 'Train');
  const line = page.locator('#train-path');
  await expect(line).toHaveAttribute('tabindex', '0');
  await line.evaluate((element) => { element.scrollLeft = 0; });
  await line.focus();
  const first = page.locator('#train-path > .is-behind').first();
  await expect(first).toBeInViewport();

  await runWithMisses(other);
  await expectStoredPath(page);
  await expect(line).toBeFocused();
  expect(await line.evaluate((element) => element.scrollLeft)).toBe(0);
  expect(errors).toEqual([]);
});

// Any sequence of history changes, here and in the other tab: after each, Train draws what the stored history gives.
test('through a run of changes here and elsewhere, Train always draws the stored history', async ({ page, context, supabase }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  const { other, errors } = await besideTab(page, context, supabase, 'follow-model@stilltype.test');

  const steps = {
    'run there': () => runWithMisses(other),
    'clear there': () => clearIn(other),
    'undo there': () => other.locator('#undo-clear').click(),
    'run here': async () => { await runWithMisses(page); await openView(page, 'Train'); },
    'clear here': async () => { await clearIn(page); await openView(page, 'Train'); },
  };

  await openView(page, 'Train');

  for (const step of ['run there', 'clear there', 'undo there', 'run here', 'run there', 'clear here', 'run there', 'run here', 'clear there', 'undo there']) {
    await steps[step]();
    await expectStoredPath(page).catch((error) => { throw new Error(`after “${step}”: ${error.message}`); });
  }

  expect(errors).toEqual([]);
});
