// A run's result on Practice is one card: the score with its facts beside it (under it on a phone), the
// speed trace, the words typed, then Run again and the drill under a hairline. Train is a path (TOB-420): the
// targets drilled behind you, the open one, and the next three the learner queues; a retest's comparison is the
// newest step behind you.
import { DEFAULT_POLICY } from '../src/learner.js';
import { test, expect, openProgressDetail, openApp, openView, chooseWords, completePassage, finishDrill, passageText, chooseSetting, closeSettings, phone } from './fixtures.js';
import { withHistory, units, behindUnits } from './train-fixtures.js';

const box = (page, selector) => page.locator(selector).boundingBox();

// Instant typing scores five-digit speeds that no run reaches, and those widen the run card; a fast
// person's pace keeps the score to three digits.
const atPace = { delay: 25 };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

async function tabIntoTrace(page) {
  await expect(page.locator('#run-again')).toBeFocused();
  // Run again's focus brought it into view below the score, so the page has scrolled and the trace lies above it.
  expect(await page.evaluate(() => scrollY), 'focus scrolled the page').toBeGreaterThan(0);
  const inWords = () => page.evaluate(() => !!document.activeElement.closest('#result-words'));

  for (let presses = 0; presses < 6 && !(await inWords()); presses++) await page.keyboard.press('Shift+Tab');
  expect(await inWords(), 'a trace word has focus').toBe(true);

  return page.evaluate(() => {
    const word = document.activeElement.getBoundingClientRect();

    return { top: word.top, bottom: word.bottom };
  });
}

for (const width of [901, 800]) {
  test(`at ${width}px a run fits the width as one card, the facts beside the score and the actions last`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page, atPace);
    await expect(page.locator('#speed-graph svg')).toBeVisible();

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const card = await box(page, '#run-card');
    const wpm = await box(page, '#result-wpm');
    const facts = await box(page, '.run-card-facts');
    const trace = await box(page, '#speed-graph');
    const words = await box(page, '#result-words');
    const actions = await box(page, '.result-actions');
    expect(facts.x).toBeGreaterThanOrEqual(wpm.x + wpm.width);
    expect(facts.y).toBeLessThan(wpm.y + wpm.height);
    expect(wpm.y + wpm.height).toBeLessThanOrEqual(trace.y);
    expect(trace.y + trace.height).toBeLessThanOrEqual(words.y);
    expect(words.y + words.height).toBeLessThanOrEqual(actions.y);
    expect(actions.y + actions.height).toBeLessThanOrEqual(card.y + card.height);
  });
}

test('at 1440px the facts share the score\'s row, the trace spans the card and the drill sits in its last row', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page, atPace);
  await expect(page.locator('#speed-graph svg')).toBeVisible();

  const card = await box(page, '#run-card');
  const wpm = await box(page, '#result-wpm');
  const facts = await box(page, '.run-card-facts');
  expect(facts.x).toBeGreaterThan(wpm.x + wpm.width);
  expect(facts.y + facts.height).toBeLessThanOrEqual(wpm.y + wpm.height + 4);
  const trace = await box(page, '#speed-graph');
  expect(trace.width).toBeGreaterThan(card.width * 0.85);
  const words = await box(page, '#result-words');
  const drill = await box(page, '#result-drill');
  expect(drill.y).toBeGreaterThan(Math.max(trace.y + trace.height, words.y + words.height));
  expect(drill.y + drill.height).toBeLessThanOrEqual(card.y + card.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('train-1440.png'), fullPage: true });
});

// 700px tall, so Run again's focus scrolls the page and the trace lies above it.
test('at 1440px tabbing from Run again back into the trace stops below the dock', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  const word = await tabIntoTrace(page);
  const dock = await box(page, 'nav.dock');
  expect(word.top).toBeGreaterThanOrEqual(dock.y + dock.height);
  expect(word.bottom).toBeLessThanOrEqual(700);
});

// Focus goes to the next step only when it fits on screen with the score; otherwise to the result heading,
// so the score never scrolls away. The restart key works from either.
test('after a run Run again takes focus when it fits under the score, and the heading does when it can’t', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#results-heading')).toBeFocused();
  // A counted run's heading is visually hidden (a clipped 1px box), so check where it sits rather than what shows.
  const heading = await box(page, '#results-heading');
  expect(heading.y).toBeGreaterThanOrEqual(0);
  expect(heading.y + heading.height).toBeLessThanOrEqual(480);
  await expect(page.locator('#result-wpm')).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await completePassage(page);
  await expect(page.locator('#results-heading')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');

  await page.setViewportSize({ width: 1280, height: 1100 });
  await completePassage(page);
  await expect(page.locator('#run-again')).toBeFocused();
  await expect(page.locator('#run-again')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#result-wpm')).toBeInViewport({ ratio: 1 });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...phone });

  test('at 390px Run again takes focus under the score, and on a short phone the heading does; the score stays in view', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page);
    await expect(page.locator('#run-again')).toBeFocused();
    await expect(page.locator('#run-again')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#result-wpm')).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');

    await page.setViewportSize({ width: 390, height: 560 });
    await completePassage(page);
    await expect(page.locator('#results-heading')).toBeFocused();
    await expect(page.locator('#result-wpm')).toBeInViewport({ ratio: 1 });
  });

  test('at 390px the card stacks: score, facts, speed graph, words, then the drill', async ({ page }, testInfo) => {
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page, atPace);
    await expect(page.locator('#speed-graph svg')).toBeVisible();

    const wpm = await box(page, '#result-wpm');
    const facts = await box(page, '.run-card-facts');
    const graph = await box(page, '#speed-graph');
    const words = await box(page, '#result-words');
    const drill = await box(page, '#result-drill');
    expect(wpm.y + wpm.height).toBeLessThan(facts.y);
    expect(facts.y + facts.height).toBeLessThan(graph.y);
    expect(graph.y + graph.height).toBeLessThan(words.y);
    expect(words.y + words.height).toBeLessThan(drill.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('train-390.png'), fullPage: true });
  });

  // Chromium centres a focused element it scrolls to; Safari scrolls only as far as it must, which
  // would park a word under the bottom dock. A nearest scroll stands in for Safari's focus scroll.
  test('at 390px a word scrolled up from below the fold stops above the dock', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 560 });
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page);

    const word = await page.locator('#result-words [role="option"]').first().evaluate((node) => {
      window.scrollTo(0, 0);
      node.scrollIntoView({ block: 'nearest' });

      return { bottom: node.getBoundingClientRect().bottom, scrolled: scrollY };
    });

    const dock = await box(page, 'nav.dock');
    expect(word.scrolled, 'the word started below the fold').toBeGreaterThan(0);
    expect(word.bottom).toBeLessThanOrEqual(dock.y);
  });
});

test('the conditions show at once; no metric notes, and the counts behind accuracy and consistency sit in their tooltips', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);

  await expect(page.locator('#result-conditions')).toBeVisible();
  await expect(page.locator('#run-card .metric-note')).toHaveCount(0);
  await expect(page.locator('#run-card details')).toHaveCount(0);
  await expect(page.locator('#result-accuracy-fact')).toHaveAttribute('title', /^0 first-try errors · final c\/i\/e\/m \d+\/0\/0\/0$/);
  await expect(page.locator('.run-card-facts > div', { has: page.locator('#result-consistency') })).toHaveAttribute('title', /^100 minus the variation/);
});

// ── Train's path ──────────────────────────────────────────────────────────────────────────────────────────────

async function jumpToTrain(page) {
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('train');
  await page.keyboard.press('Enter');
  await expect(page.locator('#train-heading')).toBeFocused();
}

test('a new guest’s path is one open step, the general drill, on a line that runs on to empty places', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openView(page, 'Train');
  await expect(page.locator('#run-card')).toBeHidden();
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#train-heading')).toHaveClass(/sr-only/);
  await expect(page.locator('#train-current')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#train-unit')).toHaveText('General drill');
  await expect(page.locator('#train-path > .is-behind')).toHaveCount(1);
  await expect(page.locator('#comparison-panel')).toBeHidden();
  // The empty places are drawn, not announced: nothing ahead is named.
  await expect(page.locator('#train-path > .is-place')).toHaveCount(3);
  await expect(page.locator('#train-path > .is-place[aria-hidden="true"]')).toHaveCount(3);
  await expect(page.getByRole('list', { name: 'Path' }).getByRole('listitem')).toHaveCount(1);
  // No baseline yet, so no retest follows, and the button and the line under it say so.
  await expect(page.locator('#start-drill')).toHaveText('Drill');
  await expect(page.locator('#train-starts')).toHaveText('30 s');
  await expect(page.locator('#train-evidence')).toBeHidden();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('after one short run the open step is a general drill, stated plainly, with nothing ahead, and it drills and retests', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#train-path > .is-ahead:not(.is-place)')).toHaveCount(0);
  await expect(page.locator('#start-drill')).toHaveText('Drill and retest');
  await expect(page.locator('#train-starts')).toHaveText('30 s, then 10 words on fresh text');
  await page.locator('#start-drill').click();
  await finishDrill(page);
  await completePassage(page);
  // The comparison is the newest step behind you, the general drill it ran.
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-unit')).toHaveText('General drill');
  await expect(page.locator('#comparison-status')).toBeFocused();
});

test('with history the path shows each drill behind you, the learner’s target open and the next three it queues, as Progress lists them', async ({ page, supabase }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await withHistory(page, supabase, 'path-history@stilltype.test');
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('Practice “th”');
  await expect(page.locator('#train-unit')).toHaveText('th');
  await expect(page.locator('#train-evidence')).toHaveText('90 ms slower than your pace, in 6 of 6 runs that timed it (48 clean intervals)');
  await expect(page.locator('#train-words')).toBeHidden();
  await expect(page.locator('#start-drill')).toHaveText('Drill “th”');
  await expect(page.locator('#train-starts')).toHaveText('30 s, then 10 words on fresh text');
  expect(await behindUnits(page)).toEqual(['qu', 'ck', 'ol', 'wh']);
  const ahead = await units(page, 'ahead');
  expect(ahead).toHaveLength(3);
  await expect(page.locator('#train-path > .is-ahead .path-line').first()).toHaveText(/^\d+ of \d+ missed$/);

  // Drilled after one retest; fixed only for the two whose runs since hold 20 clean tries, which the learner no longer queues.
  // Each says so in a status word beside its target.
  await expect(page.locator('#train-path > .is-fixed .path-unit')).toHaveText(['qu, fixed', 'ck, fixed']);
  await expect(page.locator('#train-path > .is-drilled .path-unit')).toHaveText(['ol, drilled', 'wh, drilled']);
  await expect(page.locator('#train-path > .is-fixed .path-status')).toHaveText(['fixed', 'fixed']);
  await expect(page.locator('#train-path > .is-drilled .path-status')).toHaveText(['drilled', 'drilled']);
  // The read-back, then what the runs since the drill hold. The run typed here is one of those runs, and its passage
  // may hold the pair, so the counts since are whatever that run adds: "qu" has 36 clean tries before it, and "ol",
  // whose read-back is from its retest alone, gains a since-line only when the passage holds "ol".
  const qu = await page.locator('#train-path > .is-fixed').first().locator('.path-line').allTextContents();
  expect(qu[0]).toBe('6 of 22 → 0 of 12 missed');
  expect(qu.slice(1)).toHaveLength(1);
  expect(Number(qu[1].match(/^0 of (\d+) missed since the drill$/)?.[1])).toBeGreaterThanOrEqual(36);
  const ol = await page.locator('#train-path > .is-drilled').first().locator('.path-line').allTextContents();
  expect(ol[0]).toBe('6 of 22 → 1 of 12 missed');
  expect(ol.length).toBeLessThanOrEqual(2);
  expect(ol.slice(1).every((line) => /^1 of \d+ missed since the drill$/.test(line)), ol.join(' / ')).toBe(true);

  // The shapes say it without colour: a disc when fixed, a ring when drilled, a larger ring for the open step, a smaller one ahead.
  const node = (selector) => page.locator(`#train-path ${selector} .path-node`).first().evaluate((el) => ({ size: el.getBoundingClientRect().width,
    filled: getComputedStyle(el).backgroundColor === getComputedStyle(el).borderTopColor }));

  expect(await node('> .is-fixed')).toMatchObject({ filled: true, size: 16 });
  expect(await node('> .is-drilled')).toMatchObject({ filled: false, size: 16 });
  expect((await node('#train-current')).size).toBe(24);
  expect((await node('> .is-ahead')).size).toBe(12);

  // Progress's Patterns across runs lists the same queue: its first row is open here, the next three ahead.
  await openView(page, 'Progress');
  await openProgressDetail(page, 'keys');
  const rows = await page.locator('#training-targets .training-target h3').allTextContents();
  expect(rows.slice(0, 4)).toEqual(['th', ...ahead].map((unit) => `Practice “${unit}”`));
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`under forced colours at ${width}px the four steps and the two halves of the line still differ`, async ({ page, supabase }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ forcedColors: 'active' });
    await withHistory(page, supabase, `path-forced-${width}@stilltype.test`);
    await openView(page, 'Train');
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);

    const node = (selector) => page.locator(`#train-path ${selector} .path-node`).first().evaluate((el) => {
      const style = getComputedStyle(el);

      return { size: Math.round(el.getBoundingClientRect().width), fill: style.backgroundColor, ring: style.borderTopColor, dot: style.boxShadow };
    });

    const [drilled, fixed, open, ahead] = [await node('> .is-drilled'), await node('> .is-fixed'), await node('#train-current'), await node('> .is-ahead')];
    // Drilled is a ring, fixed a disc of the ring's colour, the open step a larger ring of another colour holding a dot,
    // and ahead a smaller ring of a third.
    expect(drilled.fill).not.toBe(drilled.ring);
    expect(fixed.fill).toBe(fixed.ring);
    expect(open.size).toBeGreaterThan(drilled.size);
    expect(open.ring).not.toBe(drilled.ring);
    expect(open.dot).toContain(open.ring);
    expect(ahead.size).toBeLessThan(drilled.size);
    expect(ahead.ring).not.toBe(drilled.ring);
    expect(ahead.ring).not.toBe(open.ring);

    // The line: solid behind you, dashed from the open step on, drawn with a column's ::before from 901px and a step's
    // ::before below.
    const line = (selector) => page.locator(selector).first().evaluate((el) => {
      const style = getComputedStyle(el, '::before');

      return { color: style.backgroundColor, image: style.backgroundImage };
    });

    const [done, todo] = width > 900
      ? [await line('#train-path > .is-behind .path-head'), await line('#train-current > .path-head')]
      : [await line('#train-path > .is-behind:not([data-early])'), await line('#train-current')];

    expect(done.image).toBe('none');
    expect(done.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(todo.image).toContain('repeating-linear-gradient');
    // And each step behind you says its state in words.
    await expect(page.locator('#train-path > .is-behind:not([data-early]) .path-status').first()).toBeVisible();
  });
}

test('each focus opens its own target and queues its own steps ahead, each with evidence of its kind', async ({ page, supabase }) => {
  await withHistory(page, supabase, 'path-focus@stilltype.test');

  for (const [focus, open, pattern] of [['balanced', 'th', /./], ['accuracy', 'an', /^\d+ of \d+ missed$/], ['speed', 'th', /^\d+ ms slower$/]]) {
    await chooseSetting(page, 'train-focus', focus);
    await closeSettings(page);
    await openView(page, 'Train');
    await expect(page.locator('#train-unit')).toHaveText(open);

    for (const line of await page.locator('#train-path > .is-ahead .path-line').allTextContents()) expect(line, focus).toMatch(pattern);
  }

  // Speed names only "th" here, so nothing waits ahead of it.
  await expect(page.locator('#train-path > .is-ahead')).toHaveCount(0);
  // Accuracy lists the person's missed words holding "an": the pair in the text colour, never coral.
  await chooseSetting(page, 'train-focus', 'accuracy');
  await closeSettings(page);
  await openView(page, 'Train');
  await expect(page.locator('#train-words span')).toHaveText(['another', 'than', 'and']);
});

test('choosing a step ahead drills it, and its loop records the policy and focus that queued it', async ({ page, supabase }) => {
  const user = await withHistory(page, supabase, 'path-ahead@stilltype.test');
  await page.clock.install();
  await openView(page, 'Train');
  const choice = page.locator('#train-path > .is-ahead .path-choose').first();
  const unit = (await choice.locator('.path-unit').textContent());
  await expect(choice).toHaveAccessibleName(new RegExp(`^Drill ${unit}, \\d+ (of \\d+ missed|ms slower)$`));
  await choice.click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-title')).toHaveText(`Practice “${unit}”`);
  expect((await passageText(page)).split(' ').every((word) => word.includes(unit))).toBe(true);
  await finishDrill(page);
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect.poll(() => supabase.profileFor(user.email)?.loops?.at(-1)).toMatchObject({ target: unit, policy: DEFAULT_POLICY, focus: 'balanced', recommendationKind: 'manual' });
});

test('after a retest the path moves on: the step just drilled is behind you with its comparison, and the next one is open', async ({ page, supabase }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await withHistory(page, supabase, 'path-after@stilltype.test');
  await page.clock.install();
  await jumpToTrain(page);
  const ahead = await units(page, 'ahead');

  // Keyboard order: the line, which scrolls here, then the open step's button, then the steps ahead.
  await page.keyboard.press('Tab');
  await expect(page.locator('#train-path')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#start-drill')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#train-path > .is-ahead .path-choose').first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-input')).toBeFocused();
  await finishDrill(page);
  await expect(page.locator('#typing-input')).toBeFocused();
  await page.evaluate(() => document.addEventListener('animationstart', (event) => { window.pathMoved ||= event.animationName === 'path-advance'; }));
  await completePassage(page);

  const panel = page.locator('#comparison-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-outcome', /^(improved|mixed|regressed|steady)$/);
  await expect(page.locator('#comparison-unit')).toHaveText('th');
  await expect(page.locator('#comparison-status')).toBeFocused();
  await expect(page.locator('#comparison-conditions')).toHaveText('fresh text · english 200 · 10 words');
  // The open step is the comparison's Next: the first unit queued after "th", and it is the next Tab stop.
  await expect(page.locator('#train-unit')).toHaveText(ahead[0]);
  await expect(page.locator('#comparison-next')).toHaveText(`Next: “${ahead[0]}”`);
  await expect(page.locator('#start-drill')).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(page.locator('#comparison-next')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#comparison-back')).toBeFocused();
  // The comparison is the newest step behind you, the open step just after it; "th" is nowhere else on the path.
  const order = await page.locator('#train-path > li:not([hidden])').evaluateAll((items) => items.map((item) => item.id || item.className));
  expect(order.indexOf('train-current')).toBe(order.indexOf('comparison-panel') + 1);
  expect([...await behindUnits(page), ...await units(page, 'ahead')]).not.toContain('th');
  // The path moved on one step as the comparison opened, and the motion has finished.
  await expect.poll(() => page.evaluate(() => window.pathMoved)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.animationName?.startsWith('path-') && a.playState === 'running').length)).toBe(0);

  // Opened again from the dock, the path is drawn afresh at your settings.
  await openView(page, 'Practice');
  await openView(page, 'Train');
  await expect(panel).toBeHidden();
  await expect(page.locator('#start-drill')).toBeVisible();
});

test('a long path scrolls along its line, opening at its end, and the keyboard can scroll it back', async ({ page, supabase }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await withHistory(page, supabase, 'path-long@stilltype.test', 8);
  await openView(page, 'Train');
  const line = page.locator('#train-path');
  expect(await behindUnits(page)).toHaveLength(8);
  await expect(line).toHaveAttribute('tabindex', '0');
  const scroll = () => line.evaluate((el) => ({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth }));
  const start = await scroll();
  expect(start.max).toBeGreaterThan(0);
  expect(start.left).toBeGreaterThanOrEqual(start.max - 1);
  await expect(page.locator('#train-current .path-head')).toBeInViewport();
  await line.focus();

  for (let press = 0; press < 40; press += 1) await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await scroll()).left).toBe(0);
  await expect(page.locator('#train-path > .is-behind').first()).toBeInViewport();
  // The page itself never scrolls sideways.
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('under reduced motion the path moves on at once', async ({ page, supabase }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await withHistory(page, supabase, 'path-still@stilltype.test');
  await page.clock.install();
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await finishDrill(page);
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  const durations = await page.locator('#train-path > li:not([hidden]), #train-next').evaluateAll((items) => items.map((item) => getComputedStyle(item).animationDuration));
  // The stylesheet's reduced-motion rule holds every animation to a millisecond at most.
  expect(durations.every((duration) => parseFloat(duration) <= 0.001), JSON.stringify(durations)).toBe(true);
});

for (const [width, height] of [[390, 844], [320, 568]]) {
  test.describe(`phone ${width}`, () => {
    test.use({ viewport: { width, height }, ...phone });

    test(`at ${width}px the path runs down the page: the two newest steps behind you, the open step with its details, then those ahead`, async ({ page, supabase }) => {
      await withHistory(page, supabase, `path-${width}@stilltype.test`);
      await openView(page, 'Train');
      await expect(page.locator('#train-unit')).toHaveText('th');
      expect(await units(page, 'behind')).toEqual(['ol', 'wh']);

      const box = (selector) => page.locator(selector).first().boundingBox();

      const [wh, open, button, next] = [await page.locator('#train-path > .is-drilled').last().boundingBox(), await box('#train-current .path-head'), await box('#start-drill'),
        await box('#train-path > .is-ahead')];

      expect(wh.y + wh.height).toBeLessThanOrEqual(open.y);
      expect(open.y + open.height).toBeLessThanOrEqual(button.y);
      expect(button.y + button.height).toBeLessThanOrEqual(next.y);

      // The node sits left of its target, in one column with the others.
      const nodes = await page.locator('#train-path .path-node').evaluateAll((items) => items.filter((n) => n.offsetParent).map((n) => {
        const r = n.getBoundingClientRect();

        return Math.round(r.left + r.width / 2);
      }));

      expect(new Set(nodes).size).toBe(1);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: test.info().outputPath(`train-path-${width}.png`), fullPage: true });
    });

    test(`at ${width}px a new guest’s path is the one open step`, async ({ page }) => {
      await openApp(page);
      await openView(page, 'Train');
      await expect(page.locator('#train-unit')).toHaveText('General drill');
      await expect(page.locator('#train-path > .is-place').first()).toBeHidden();
      await expect(page.locator('#start-drill')).toBeInViewport();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });
}
