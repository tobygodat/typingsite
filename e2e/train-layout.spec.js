// A run's result on Practice is one card: the score with its facts beside it (two to a row on a phone), the
// speed trace, the words typed, then Run again and the drill. Train (TOB-470) is a queue: the open
// step and the next three the learner queues, each with what it costs, the drilled steps folded under them, and the
// chosen step's detail beside them; a retest's comparison is the newest step drilled.
import { DEFAULT_POLICY } from '../src/learner.js';
import { test, expect, openApp, openView, chooseWords, completePassage, finishDrill, passageText, chooseSetting, closeSettings, chooseNavigation, phone } from './fixtures.js';
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
    const facts = await box(page, '#result-accuracy');
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
  const facts = await box(page, '#result-accuracy');
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

// 600px tall, so Run again's focus scrolls the page and the trace lies above it. The top bar covers the top of
// the page; the side bar covers none of it.
test('at 1440px tabbing from Run again back into the trace stops below the dock', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await openApp(page);
  await chooseNavigation(page, 'top');
  await chooseWords(page, 10);
  await completePassage(page);
  const word = await tabIntoTrace(page);
  const dock = await box(page, 'nav.dock');
  expect(word.top).toBeGreaterThanOrEqual(dock.y + dock.height);
  expect(word.bottom).toBeLessThanOrEqual(600);
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

  test('at 390px the card stacks: score and accuracy, the other facts, speed graph, words, then the drill', async ({ page }, testInfo) => {
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page, atPace);
    await expect(page.locator('#speed-graph svg')).toBeVisible();

    const wpm = await box(page, '#result-wpm');
    const accuracy = await box(page, '#result-accuracy');
    const facts = await box(page, '#result-consistency');
    const graph = await box(page, '#speed-graph');
    const words = await box(page, '#result-words');
    const drill = await box(page, '#result-drill');
    expect(accuracy.x).toBeGreaterThan(wpm.x + wpm.width);
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

// ── Train: the queue and the chosen step ─────────────────────────────────────────────────────────────────────

async function jumpToTrain(page) {
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('train');
  await page.keyboard.press('Enter');
  await expect(page.locator('#train-heading')).toBeFocused();
}

const costs = (page) => page.locator('#train-path > .queue-step .q-cost data').evaluateAll((nodes) => nodes.map((node) => Number(node.value)));
const cells = (page) => page.locator('.train-step .train-cells .cell').evaluateAll((nodes) => nodes.map((node) => [...node.querySelectorAll('.cell-label, .cell-figure, .cell-unit, .cell-note')].map((part) => part.textContent).join(' ')));

test('a new guest’s queue is the general drill alone, and its detail starts a drill with nothing after it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openView(page, 'Train');
  await expect(page.locator('#run-card')).toBeHidden();
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#train-heading')).toHaveClass(/sr-only/);
  await expect(page.locator('#train-current')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#train-unit')).toHaveText('General drill');
  await expect(page.getByRole('list', { name: 'queue' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('#train-current .q-row')).toHaveAttribute('aria-pressed', 'true');
  // Nothing drilled, nothing costed: no fold, no measures, no plot.
  await expect(page.locator('#train-drilled-toggle')).toHaveCount(0);
  await expect(page.locator('#train-path .q-cost')).toHaveCount(0);
  await expect(page.locator('.train-cells')).toHaveCount(0);
  await expect(page.locator('.timing-plot')).toHaveCount(0);
  await expect(page.locator('#comparison-panel')).toBeHidden();
  // No baseline yet, so no retest follows, and the button and the line beside it say so.
  await expect(page.locator('#start-drill')).toHaveText('Drill');
  await expect(page.locator('#train-starts')).toHaveText('30 s');
  await expect(page.locator('#train-evidence')).toBeHidden();
  // The detail still shows the drill's first words.
  await expect(page.locator('.train-preview span')).toHaveCount(6);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('after one short run the open step is a general drill, stated plainly, with nothing ahead, and it drills and retests', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#train-path > .is-ahead')).toHaveCount(0);
  await expect(page.locator('#start-drill')).toHaveText('Drill and retest');
  await expect(page.locator('#train-starts')).toHaveText('30 s + 10 words retest');
  await page.locator('#start-drill').click();
  await finishDrill(page);
  await completePassage(page);
  // The comparison is the newest step drilled, the general drill it ran.
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-unit')).toHaveText('General drill');
  await expect(page.locator('#comparison-status')).toBeFocused();
  await expect(page.locator('#train-drilled > .is-just .q-row')).toHaveAttribute('aria-pressed', 'true');
});

test('with history the queue opens on the learner’s target with its figures, the next three cost less, and the drilled steps fold under it, as Progress lists them', async ({ page, supabase }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await withHistory(page, supabase, 'path-history@stilltype.test');
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('Practice “th”');
  await expect(page.locator('#train-unit')).toHaveText('th');
  await expect(page.locator('.train-step-unit')).toHaveText('th');
  await expect(page.locator('#train-evidence')).toHaveText('90 ms slower than your pace, in 6 of 6 runs that timed it (48 clean intervals)');
  await expect(page.locator('#train-words')).toBeHidden();
  await expect(page.locator('#start-drill')).toHaveText('Drill “th”');
  await expect(page.locator('#train-starts')).toHaveText('30 s + 10 words retest');
  // The drill's first words, each holding the pair, marked.
  const preview = await page.locator('.train-preview span').allTextContents();
  expect(preview).toHaveLength(6);
  expect(preview.every((word) => word.includes('th'))).toBe(true);
  await expect(page.locator('.train-preview b').first()).toHaveText('th');

  // Four rows: the open step and the next three, each with why and what it costs, in the learner's order, so the
  // costs never rise down the queue.
  const ahead = await units(page, 'ahead');
  expect(ahead).toHaveLength(3);
  await expect(page.locator('#train-current .q-why')).toHaveText('slow');
  await expect(page.locator('#train-path > .is-ahead .q-why')).toHaveText(['missed', 'missed', 'missed']);
  const spent = await costs(page);
  expect(spent).toHaveLength(4);
  expect(spent.every((cost, i) => cost > 0 && (i === 0 || cost <= spent[i - 1]))).toBe(true);
  await expect(page.locator('#train-current .q-cost [data-speed-unit]')).toHaveText('wpm');

  // The open step's measures: its cost as the row has it, 90 ms over a 200 ms pace, and how often it comes up at the
  // person's median 62 wpm (310 letters a minute).
  const [cost, slower, frequency] = await cells(page);
  expect(cost).toMatch(/^cost ≈\d+(\.\d)? wpm$/);
  expect(cost).toContain(await page.locator('#train-current .q-cost data').textContent());
  expect(slower).toBe('slower 90 ms 290 vs 200');
  expect(frequency).toMatch(/^frequency \d+(\.\d)? \/min 1 in \d+ letters$/);
  // One dot for each of the six runs that timed it, the pace and the pair marked.
  await expect(page.locator('.train-timings .panel-note')).toHaveText('48 in 6 runs');
  await expect(page.locator('.timing-dots i')).toHaveCount(6);
  await expect(page.locator('.timing-mark.is-pace')).toHaveText('pace200');
  await expect(page.locator('.timing-mark.is-own')).toHaveText('th290');
  await expect(page.locator('.timing-plot')).toHaveAttribute('aria-label', 'th: 290 ms against your pace of 200 ms, one dot for each of 6 runs');

  // The drilled steps fold under the queue, with what they won back between them.
  const fold = page.locator('#train-drilled-toggle');
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(fold.locator('.q-count')).toHaveText('4');
  await expect(fold.locator('.q-cost')).toHaveText(/^(\+\d+(\.\d)?|<0\.1) wpm$/);
  await expect(page.locator('#train-drilled')).toBeHidden();
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  expect(await behindUnits(page)).toEqual(['qu', 'ck', 'ol', 'wh']);

  // Drilled after one retest; fixed only for the two whose runs since hold 20 clean tries, which the learner no longer
  // queues. Each says so in its state word, and its mark says it without colour: a check when fixed, a ring when drilled.
  await expect(page.locator('#train-drilled > .is-fixed .q-unit')).toHaveText(['qu', 'ck']);
  await expect(page.locator('#train-drilled > .is-drilled .q-unit')).toHaveText(['ol', 'wh']);
  await expect(page.locator('#train-drilled > .is-fixed .q-state')).toHaveText(['fixed', 'fixed']);
  await expect(page.locator('#train-drilled > .is-drilled .q-state')).toHaveText(['drilled', 'drilled']);
  await expect(page.locator('#train-drilled > .is-fixed .q-check')).toHaveCount(2);
  await expect(page.locator('#train-drilled > .is-drilled .q-ring')).toHaveCount(2);

  // A drilled step chosen: what it won back, its misses since the drill and before it, and the loop's read-back. The run
  // typed here is one of the runs since, and its passage may hold the pair, so the counts since are whatever that run
  // adds: "qu" has 36 clean tries before it.
  await page.locator('#train-drilled > [data-unit="qu"] .q-row').click();
  await expect(page.locator('#train-drilled > [data-unit="qu"] .q-row')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.train-step .train-cells .cell-label').first()).toHaveText('won back');
  await expect(page.locator('.train-step-head .cell-label')).toHaveText('fixed · pair');
  await expect(page.locator('#start-drill')).toHaveText('Drill “qu” again');
  const [won, missed, before] = await cells(page);
  expect(won).toMatch(/^won back (\+\d+(\.\d)?|<0\.1) wpm$/);
  expect(Number(missed.match(/^missed 0\/(\d+) since the drill$/)?.[1])).toBeGreaterThanOrEqual(36);
  expect(before).toBe('before 6/22');
  const qu = await page.locator('.train-step .path-line').allTextContents();
  expect(qu[0]).toBe('6 of 22 → 0 of 12 missed');
  expect(qu.slice(1)).toHaveLength(1);
  expect(Number(qu[1].match(/^0 of (\d+) missed since the drill$/)?.[1])).toBeGreaterThanOrEqual(36);
  await page.locator('#train-drilled > [data-unit="ol"] .q-row').click();
  const ol = await page.locator('.train-step .path-line').allTextContents();
  expect(ol[0]).toBe('6 of 22 → 1 of 12 missed');
  expect(ol.length).toBeLessThanOrEqual(2);
  expect(ol.slice(1).every((line) => /^1 of \d+ missed since the drill$/.test(line)), ol.join(' / ')).toBe(true);
});

test('in cpm every cost and what was won back read five times their wpm, and nothing is redrawn but the figures', async ({ page, supabase }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await withHistory(page, supabase, 'path-cpm@stilltype.test');
  await openView(page, 'Train');
  const wpm = await costs(page);
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('speed unit · cpm');
  await page.keyboard.press('Enter');
  await expect(page.locator('#train-current .q-cost [data-speed-unit]')).toHaveText('cpm');
  expect(await costs(page)).toEqual(wpm);
  const shown = await page.locator('#train-path > .queue-step .q-cost data').allTextContents();
  expect(shown.map((text, i) => (text === '<0.1' ? true : Math.abs(Number(text) - wpm[i] * 5) <= 0.05))).toEqual(wpm.map(() => true));
  await expect(page.locator('.train-cells .cell').first()).toHaveText(/^cost≈\d+(\.\d)?cpm$/);
  await expect(page.locator('#train-drilled-toggle .q-cost')).toHaveText(/ cpm$/);
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`under forced colours at ${width}px the chosen row, the fixed and the drilled steps still differ`, async ({ page, supabase }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ forcedColors: 'active' });
    await withHistory(page, supabase, `path-forced-${width}@stilltype.test`);
    await openView(page, 'Train');
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    await page.locator('#train-drilled-toggle').click();

    const look = (selector) => page.locator(selector).first().evaluate((el) => {
      const style = getComputedStyle(el);

      return { outline: style.outlineStyle, stroke: style.stroke, ring: style.borderTopStyle };
    });

    // The chosen row is outlined in a system colour; the others are not.
    expect((await look('#train-current .q-row')).outline).toBe('solid');
    expect((await look('#train-path > .is-ahead .q-row')).outline).toBe('none');
    // Fixed is a check drawn in the text colour, drilled a ring, and each says its state in words.
    expect((await look('#train-drilled > .is-fixed .q-check')).stroke).not.toBe('none');
    expect((await look('#train-drilled > .is-drilled .q-ring')).ring).toBe('solid');
    await expect(page.locator('#train-drilled > .is-fixed .q-state').first()).toHaveText('fixed');
    await expect(page.locator('#train-drilled > .is-drilled .q-state').first()).toHaveText('drilled');
  });
}

test('each focus opens its own target and queues its own steps, each on the basis it was ranked by', async ({ page, supabase }) => {
  await withHistory(page, supabase, 'path-focus@stilltype.test');

  for (const [focus, open, why, evidence] of [['balanced', 'th', /^(slow|missed)$/, /./], ['accuracy', 'an', /^missed$/, /^\d+ of \d+ missed in \d+ runs?$/], ['speed', 'th', /^slow$/, /^\d+ ms slower/]]) {
    await chooseSetting(page, 'train-focus', focus);
    await closeSettings(page);
    await openView(page, 'Train');
    await expect(page.locator('#train-unit')).toHaveText(open);

    for (const word of await page.locator('#train-path > .queue-step .q-why').allTextContents()) expect(word, focus).toMatch(why);

    // A step ahead chosen shows the learner's evidence of its kind.
    if (await page.locator('#train-path > .is-ahead').count()) {
      await page.locator('#train-path > .is-ahead .q-row').first().click();
      await expect(page.locator('.train-step .train-evidence p').first()).toHaveText(evidence);
    }
  }

  // Speed names only "th" here, so nothing waits ahead of it.
  await expect(page.locator('#train-path > .is-ahead')).toHaveCount(0);
  // Accuracy lists the person's missed words holding "an": the pair in the text colour, never coral.
  await chooseSetting(page, 'train-focus', 'accuracy');
  await closeSettings(page);
  await openView(page, 'Train');
  await expect(page.locator('#train-words span')).toHaveText(['another', 'than', 'and']);
  const [, missed] = await cells(page);
  expect(missed).toMatch(/^missed \d+\/\d+$/);
});

test('choosing a step ahead shows it, its button drills it, and its loop records the policy and focus that queued it', async ({ page, supabase }) => {
  const user = await withHistory(page, supabase, 'path-ahead@stilltype.test');
  await page.clock.install();
  await openView(page, 'Train');
  const choice = page.locator('#train-path > .is-ahead .q-row').first();
  const unit = await page.locator('#train-path > .is-ahead').first().getAttribute('data-unit');
  await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#train-current .q-row')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.train-step-unit')).toHaveText(unit);
  await expect(page.locator('.train-step-head .cell-label')).toHaveText('pair');
  await expect(page.locator('.train-step .train-evidence p').first()).toHaveText(/^\d+ (of \d+ missed in \d+ runs?|ms slower)/);
  // The open step is still the open step.
  await expect(page.locator('#train-unit')).toHaveText('th');
  await expect(page.locator('#start-drill')).toHaveText(`Drill “${unit}”`);
  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-title')).toHaveText(`Practice “${unit}”`);
  expect((await passageText(page)).split(' ').every((word) => word.includes(unit))).toBe(true);
  await finishDrill(page);
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect.poll(() => supabase.profileFor(user.email)?.loops?.at(-1)).toMatchObject({ target: unit, policy: DEFAULT_POLICY, focus: 'balanced', recommendationKind: 'manual' });
});

test('after a retest the queue moves on: the step just retested is chosen with its comparison, and the next one is open', async ({ page, supabase }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await withHistory(page, supabase, 'path-after@stilltype.test');
  await page.clock.install();
  await jumpToTrain(page);
  const ahead = await units(page, 'ahead');

  // Keyboard order: the queue's rows, the fold, then the chosen step's button.
  await page.keyboard.press('Tab');
  await expect(page.locator('#train-current .q-row')).toBeFocused();

  for (const unit of ahead) {
    await page.keyboard.press('Tab');
    await expect(page.locator(`#train-path > [data-unit="${unit}"] .q-row`)).toBeFocused();
  }

  await page.keyboard.press('Tab');
  await expect(page.locator('#train-drilled-toggle')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#start-drill')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-input')).toBeFocused();
  await finishDrill(page);
  await expect(page.locator('#typing-input')).toBeFocused();
  await completePassage(page);

  const panel = page.locator('#comparison-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-outcome', /^(improved|mixed|regressed|steady)$/);
  await expect(page.locator('#comparison-unit')).toHaveText('th');
  await expect(page.locator('#comparison-status')).toBeFocused();
  await expect(page.locator('#comparison-conditions')).toHaveText('fresh text · english 200 · 10 words');
  // The step just retested is the newest drilled, chosen, with the fold open.
  await expect(page.locator('#train-drilled-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#train-drilled > :last-child')).toHaveClass(/is-just/);
  await expect(page.locator('#train-drilled > .is-just .q-unit')).toHaveText('th');
  await expect(page.locator('#train-drilled > .is-just .q-row')).toHaveAttribute('aria-pressed', 'true');
  // The open step is the comparison's Next: the first unit queued after "th", and it is the next Tab stop.
  await expect(page.locator('#train-unit')).toHaveText(ahead[0]);
  await expect(page.locator('#comparison-next')).toHaveText(`Next: “${ahead[0]}”`);
  await expect(page.locator('#start-drill')).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(page.locator('#comparison-next')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#comparison-back')).toBeFocused();
  // "th" is nowhere else.
  expect([...await behindUnits(page), ...await units(page, 'ahead')]).not.toContain('th');

  // Opened again from the dock, the queue is drawn afresh at your settings, the open step chosen.
  await openView(page, 'Practice');
  await openView(page, 'Train');
  await expect(panel).toBeHidden();
  await expect(page.locator('#start-drill')).toBeVisible();
  await expect(page.locator('#train-current .q-row')).toHaveAttribute('aria-pressed', 'true');
});

test('eight drilled steps all list in the fold, by the date of their retests, and the page never scrolls sideways', async ({ page, supabase }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await withHistory(page, supabase, 'path-long@stilltype.test', 8);
  await openView(page, 'Train');
  await expect(page.locator('#train-drilled-toggle .q-count')).toHaveText('8');
  await page.locator('#train-drilled-toggle').click();
  // Retested on days 1, 2, 3, 4, 1, 2, 3, 4 in that order: oldest first, then by id.
  expect(await behindUnits(page)).toEqual(['qu', 'sp', 'ck', 'ly', 'ge', 'ol', 'bo', 'wh']);
  await page.locator('#train-drilled > .is-behind').last().scrollIntoViewIfNeeded();
  await expect(page.locator('#train-drilled > .is-behind').last()).toBeInViewport();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('under reduced motion nothing on Train moves as the comparison opens', async ({ page, supabase }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await withHistory(page, supabase, 'path-still@stilltype.test');
  await page.clock.install();
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await finishDrill(page);
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  const durations = await page.locator('#train-screen, #train-screen *').evaluateAll((items) => items.map((item) => getComputedStyle(item).animationDuration));
  // The stylesheet's reduced-motion rule holds every animation to a millisecond at most.
  expect(durations.every((duration) => parseFloat(duration) <= 0.001), JSON.stringify([...new Set(durations)])).toBe(true);
});

for (const [width, height] of [[390, 844], [320, 568]]) {
  test.describe(`phone ${width}`, () => {
    test.use({ viewport: { width, height }, ...phone });

    test(`at ${width}px the queue sits above the chosen step: its rows, the fold, then the open step with its button`, async ({ page, supabase }) => {
      await withHistory(page, supabase, `path-${width}@stilltype.test`);
      await openView(page, 'Train');
      await expect(page.locator('#train-unit')).toHaveText('th');
      await page.locator('#train-drilled-toggle').click();
      expect(await behindUnits(page)).toEqual(['qu', 'ck', 'ol', 'wh']);

      const [queue, title, button, plot] = [await box(page, '.train-queue'), await box(page, '.train-step-unit'), await box(page, '#start-drill'), await box(page, '.timing-plot')];

      expect(queue.y + queue.height).toBeLessThanOrEqual(title.y);
      expect(title.y + title.height).toBeLessThanOrEqual(button.y);
      expect(button.y + button.height).toBeLessThanOrEqual(plot.y);
      // The three measures keep one row.
      const tops = await page.locator('.train-cells .cell').evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: test.info().outputPath(`train-queue-${width}.png`), fullPage: true });
    });

    // With drills behind you, the open step's button opens clear of the dock, whatever the screen's height (TOB-448).
    // At 320 × 568 it once opened half under the dock.
    test(`at ${width}px the open step’s Drill button opens clear of the dock, full size, with nothing sideways`, async ({ page, supabase }) => {
      await withHistory(page, supabase, `dock-${width}@stilltype.test`);
      await openView(page, 'Train');
      await expect(page.locator('#train-unit')).toHaveText('th');
      const [button, dock] = [await box(page, '#start-drill'), await box(page, '.dock')];
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.y + button.height).toBeLessThanOrEqual(dock.y);
      expect(button.y).toBeGreaterThanOrEqual(0);
      // The open step's target is in view above it, and every row is a full touch target.
      const head = await box(page, '.train-step-unit');
      expect(head.y).toBeGreaterThanOrEqual(0);
      const rows = await page.locator('#train-path .q-row, #train-drilled-toggle').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
      expect(rows.every((height) => height >= 44), JSON.stringify(rows)).toBe(true);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.locator('#start-drill').click();
      await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
    });

    test(`at ${width}px a new guest’s queue is the one step`, async ({ page }) => {
      await openApp(page);
      await openView(page, 'Train');
      await expect(page.locator('#train-unit')).toHaveText('General drill');
      await expect(page.locator('#train-path > .queue-step')).toHaveCount(1);
      await expect(page.locator('#start-drill')).toBeInViewport();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });
}
