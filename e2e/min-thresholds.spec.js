// Minimum accuracy and speed to continue: practice-only settings, judged on the timing tick after a
// grace period, ending a run as interrupted with its reason and keeping it out of bests.
import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage, openSettings, openView } from './fixtures.js';

const shot = (page, testInfo, name) => page.screenshot({
  path: process.env.SCREENSHOTS ? `docs/screenshots/min-thresholds/${name}.png` : testInfo.outputPath(`${name}.png`),
});

// Every sixth key is a miss: about 83% accuracy, typed through (continue on error is the default).
const withMisses = (text) => [...text].map((char, i) => (i % 6 === 5 ? (char === 'x' ? 'z' : 'x') : char)).join('');

// With the page clock paused, it moves only when the test moves it, so the pace is exact however
// busy the machine is: 200 ms a key is 60 wpm.
async function typeAtPace(page, text, msPerKey = 200) {
  await page.locator('#typing-input').focus();
  for (const char of text) {
    await page.keyboard.type(char);
    await page.clock.runFor(msPerKey);
  }
}

async function runCommand(page, query) {
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-input')).toBeFocused();
  await page.keyboard.type(query);
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
}

test('falling below the minimum accuracy stops the run as interrupted, with its reason', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.clock.install();
  await openApp(page);
  await openSettings(page);
  await expect(page.locator('#min-accuracy')).toHaveValue('0');
  await expect(page.locator('#min-wpm')).toHaveValue('0');
  await expect(page.locator('#minimum-note')).toBeHidden();
  await page.locator('#min-accuracy').selectOption('95');
  await expect(page.locator('#minimum-note')).toHaveText('min 95% accuracy');
  await expect(page.locator('#condition-line')).toContainText('continue on error · corpus v5 · metric v1 · min 95% accuracy');
  await page.keyboard.press('Escape');

  // Thirty-nine keys in 7.8 s: past five seconds, but a 95% minimum waits for 40 characters, so
  // the opening misses can't decide it on their own. The run is still going.
  const text = await passageText(page);
  const keys = withMisses(text.slice(0, 52));
  await page.clock.pauseAt(Date.now() + 1000);
  await typeAtPace(page, keys.slice(0, 39));
  await expect(page.locator('#typing-status')).toHaveText('In progress');

  // The fortieth key lands at 7.8 s and the tick at 8 s stops the run mid-word. The typist keeps
  // going at the same pace, spaces and Enter included: none of it reaches Run again.
  await typeAtPace(page, keys.slice(39));
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-comparison-note')).toHaveText('Stopped: accuracy fell below 95%, so it isn’t counted.');
  await page.clock.resume();
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
  await expect(page.locator('#result-comparison-note')).toHaveText('Stopped: accuracy fell below 95%, so it isn’t counted.');
  await expect(page.locator('#recommendation-title')).toHaveText('Restart for a counted run');
  await expect(page.locator('#recommendation-evidence')).toHaveText('Runs under your minimums aren’t counted. Change them in settings.');
  await expect(page.locator('#announcement')).toHaveText(/^Stopped: accuracy fell below 95%\. \d+ wpm, 8\d% accuracy\.$/);
  await expect(page.locator('#result-conditions')).toContainText('min 95% accuracy');
  expect(Number(await page.locator('#result-accuracy').textContent())).toBeLessThan(95);
  // 34 of 40 keys right in 8 s.
  await expect(page.locator('#result-accuracy')).toHaveText('85');
  await expect(page.locator('#result-wpm')).toHaveText('51');
  await expect(page.locator('#result-time')).toHaveText('8.0 s');
  await expect(page.locator('#start-drill')).toBeDisabled();
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#run-again')).toBeFocused();
  await expect(page.locator('#best')).toHaveText('No best yet');
  await expect(page.locator('#typing-status')).toHaveText('Interrupted');
  await expect(page.locator('#typing-status')).toHaveClass(/badge-warning/);

  await page.mouse.move(1270, 790);
  await page.waitForTimeout(600);
  await shot(page, testInfo, 'stopped-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.waitForTimeout(450);
  await shot(page, testInfo, 'stopped-light');

  // Once the typist has paused, Enter on Run again starts a fresh run that still carries the minimum.
  await expect(page.locator('#run-again')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  await expect(page.locator('#minimum-note')).toHaveText('min 95% accuracy');
});

test('the grace period forgives an early miss, and a run that ends above the minimum counts', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#min-accuracy').selectOption('90');
  await page.keyboard.press('Escape');
  const text = await passageText(page);

  // Two misses in the first twelve keys: 83%, under the minimum for the ticks inside the grace.
  // From twenty keys on, two misses can't take accuracy under 90%, however fast the machine types.
  const opening = [...text.slice(0, 12)].map((char, i) => ([1, 3].includes(i) ? (char === 'x' ? 'z' : 'x') : char)).join('');
  await typeInto(page, opening, '#typing-input', { delay: 100 });
  await page.waitForTimeout(1200);
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await page.keyboard.type(text.slice(12), { delay: 60 });

  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
  expect(Number(await page.locator('#result-accuracy').textContent())).toBeGreaterThanOrEqual(90);
  await expect(page.locator('#result-conditions')).toContainText('10 words · plain · physical keyboard · continue on error');
  await expect(page.locator('#result-conditions')).toContainText('min 90% accuracy');
  const best = await page.locator('#best').textContent();
  expect(best).toMatch(/^Best · \d+ wpm$/);

  // The minimum is a label, not a condition: switching it off keeps the same best.
  await openSettings(page);
  await page.locator('#min-accuracy').selectOption('0');
  await expect(page.locator('#best')).toHaveText(best);
  await page.keyboard.press('Escape');
  await page.locator('#run-again').click();
  await expect(page.locator('#minimum-note')).toBeHidden();
  await expect(page.locator('#condition-line')).not.toContainText('min');
});

test('a run that reaches its end under the minimum isn’t counted either, so every counted run met it', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#min-accuracy').selectOption('98');
  await page.keyboard.press('Escape');
  // Finished well inside the grace period, so only the final check can catch it.
  const text = await passageText(page);
  await typeInto(page, withMisses(text));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Under your minimum · not counted');
  await expect(page.locator('#result-comparison-note')).toHaveText('Finished under your 98% minimum accuracy, so it isn’t counted.');
  await expect(page.locator('#announcement')).toHaveText(/^Finished under your 98% minimum accuracy\. \d+ wpm, \d+% accuracy\.$/);
  await expect(page.locator('#best')).toHaveText('No best yet');
});

test('the palette sets a minimum speed, which stops a slow run and resets for a guest', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await page.locator('#typing-input').focus();
  await runCommand(page, 'minimum speed · 60');
  await expect(page.locator('#min-wpm')).toHaveValue('60');
  await expect(page.locator('#minimum-note')).toHaveText('min 60 wpm');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-input')).toBeFocused();
  await page.keyboard.type('minimum speed · 60');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('current');
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();
  await runCommand(page, 'minimum accuracy · 80');
  await expect(page.locator('#minimum-note')).toHaveText('min 80% accuracy · min 60 wpm');

  // 22 keys by five seconds is about 53 wpm: under 60 once the grace is over.
  const text = await passageText(page);
  await page.clock.pauseAt(Date.now() + 1000);
  await typeAtPace(page, text.slice(0, 22));
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await page.clock.runFor(1000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.clock.resume();
  await expect(page.locator('#result-comparison-note')).toHaveText('Stopped: speed fell below 60 wpm, so it isn’t counted.');
  expect(Number(await page.locator('#result-wpm').textContent())).toBeLessThan(60);
  await expect(page.locator('#best')).toHaveText('No best yet');

  // A guest keeps settings only for the tab.
  await page.reload();
  await expect(page.locator('#min-wpm')).toHaveValue('0');
  await expect(page.locator('#minimum-note')).toBeHidden();
});

test('custom text has no minimums: the note stands aside and a run under them still finishes', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await openSettings(page);
  await page.locator('#min-accuracy').selectOption('95');
  await page.locator('#min-wpm').selectOption('100');
  await page.keyboard.press('Escape');
  await expect(page.locator('#minimum-note')).toHaveText('min 95% accuracy · min 100 wpm');
  // Custom text is never counted, so it runs to the end like a drill: no note while Custom is on.
  await page.locator('#mode-custom').click();
  await expect(page.locator('#minimum-note')).toBeHidden();
  const text = 'the quick brown fox jumps over the lazy dog and runs back home';
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await expect(page.locator('#condition-line')).not.toContainText('min ');
  await expect(page.locator('#minimum-note')).toBeHidden();

  // Every sixth key a miss at 60 wpm: under both minimums, well past the grace, and never stopped.
  await page.clock.pauseAt(Date.now() + 1000);
  await typeAtPace(page, withMisses(text));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.clock.resume();
  await expect(page.locator('#result-delta')).toHaveText('Custom text complete · not counted toward your best');
  await expect(page.locator('#result-comparison-note')).toHaveText('');
  await expect(page.locator('#result-conditions')).not.toContainText('min ');
  expect(Number(await page.locator('#result-accuracy').textContent())).toBeLessThan(95);

  // Back on a test, the minimums apply again.
  await page.locator('.nav-item[data-nav="practice"]').click();
  await expect(page.locator('#session-kicker')).toHaveText('practice');
  await expect(page.locator('#minimum-note')).toHaveText('min 95% accuracy · min 100 wpm');
  await expect(page.locator('#condition-line')).toContainText('min 95% accuracy · min 100 wpm');
});

test('a retest carries its baseline’s minimums, and the daily challenge has none', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#min-wpm').selectOption('20');
  await page.keyboard.press('Escape');
  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');

  // The retest passes the same filter as its baseline (min 20 wpm), not today's setting, so both
  // sides of the comparison were selected alike.
  await openSettings(page);
  await page.locator('#min-wpm').selectOption('100');
  await page.keyboard.press('Escape');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#condition-line')).toContainText('min 20 wpm');
  await expect(page.locator('#condition-line')).not.toContainText('min 100 wpm');
  const retest = await passageText(page);
  await page.clock.pauseAt(Date.now() + 1000);
  await typeAtPace(page, retest.slice(0, 22));
  await page.clock.runFor(2000);
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await page.clock.resume();
  await page.keyboard.type(retest.slice(22));
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-status')).not.toHaveText('Retest complete.');

  // A retest under the baseline's minimum stops, and no comparison is made from it.
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  const slow = await passageText(page);
  // The page clock ran ahead of this process while paused, so pause from the page's own time.
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
  await typeAtPace(page, slow.slice(0, 21), 1000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.clock.resume();
  await expect(page.locator('#result-comparison-note')).toHaveText('Stopped: speed fell below 20 wpm, so it isn’t counted.');
  await expect(page.locator('#comparison-status')).toHaveText('Retest complete.');
  await expect(page.locator('#comparison-caveat')).toHaveText('The retest fell under the baseline’s minimums, so no comparison is made.');
  // None of the stopped run's numbers reach the panel, keystroke counts included.
  for (const id of ['#comparison-accuracy', '#comparison-wpm', '#comparison-timing']) await expect(page.locator(id)).toHaveText('—');
  await expect(page.locator('#comparison-sample')).toHaveText('timing not compared');

  await runCommand(page, 'daily challenge');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  await expect(page.locator('#condition-line')).not.toContainText('min');
});

// However a run ends under its minimum (its last character or its timer), the keys already on their
// way can't discard the result: Space and Enter on Run again wait until the typist pauses.
for (const end of ['last character', 'timer']) {
  test(`a run that ends under the minimum on its ${end} holds Run again until the typist pauses`, async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    if (end === 'timer') await page.locator('#duration-options [data-length="15"]').click();
    else await chooseWords(page, 10);
    await openSettings(page);
    await page.locator('#min-accuracy').selectOption('98');
    await page.keyboard.press('Escape');
    await expect(page.locator('#condition-line')).toContainText(end === 'timer' ? '15 s' : '10 words');

    // About 83% accuracy at 60 wpm. A 98% minimum waits for 100 characters on the tick, which
    // neither run reaches, so only the end of the run can judge it.
    const text = await passageText(page);
    await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
    if (end === 'timer') {
      // Seventy-five keys fill the 15 s; the typist keeps going for five more, then Enter.
      await typeAtPace(page, withMisses(text.slice(0, 80)));
    } else {
      await typeAtPace(page, withMisses(text));
      await page.keyboard.press(' ');
    }
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    await expect(page.locator('#result-delta')).toHaveText('Under your minimum · not counted');
    await expect(page.locator('#result-comparison-note')).toHaveText('Finished under your 98% minimum accuracy, so it isn’t counted.');
    await expect(page.locator('#run-again')).toBeFocused();
    if (end === 'timer') await expect(page.locator('#result-time')).toHaveText('15.0 s');

    // Once the typist has paused, Enter starts the next run.
    await page.clock.runFor(700);
    await page.keyboard.press('Enter');
    await expect(page.locator('#typing-status')).toHaveText('Ready');
    await page.clock.resume();
  });
}

// The duration is the end of a timed run. Under a 60 wpm minimum, 190 ms a key stays above it on
// every tick while the typist types; then they pause. 74 keys read 59 wpm at 15 s, the buzzer itself:
// the run finished under its minimum. 66 keys read 57 wpm at 14 s: the run is stopped there.
for (const [keys, ending] of [[74, 'at the buzzer'], [66, 'a second before it']]) {
  test(`a 15 s run that falls under the minimum ${ending}`, async ({ page }) => {
    await page.clock.install();
    await openApp(page);
    await page.locator('#duration-options [data-length="15"]').click();
    await openSettings(page);
    await page.locator('#min-wpm').selectOption('60');
    await page.keyboard.press('Escape');
    await expect(page.locator('#condition-line')).toContainText('15 s');
    const text = await passageText(page);
    await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
    await typeAtPace(page, text.slice(0, keys), 190);
    await expect(page.locator('#typing-status')).toHaveText('In progress');
    await page.clock.runFor(3000);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    await page.clock.resume();
    if (keys === 74) {
      await expect(page.locator('#result-time')).toHaveText('15.0 s');
      await expect(page.locator('#result-wpm')).toHaveText('59');
      await expect(page.locator('#result-delta')).toHaveText('Under your minimum · not counted');
      await expect(page.locator('#result-comparison-note')).toHaveText('Finished under your 60 wpm minimum speed, so it isn’t counted.');
    } else {
      await expect(page.locator('#result-time')).toHaveText('14.0 s');
      await expect(page.locator('#result-wpm')).toHaveText('57');
      await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
      await expect(page.locator('#result-comparison-note')).toHaveText('Stopped: speed fell below 60 wpm, so it isn’t counted.');
    }
    await expect(page.locator('#best')).toHaveText('No best yet');
  });
}

test('a last key that misses just past a whole second finishes the run under its minimum', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#min-accuracy').selectOption('90');
  await page.keyboard.press('Escape');
  await expect(page.locator('#condition-line')).toContainText('continue on error');
  const text = await passageText(page);
  // Every sixth key and the last one miss. Everything but the last key lands inside the first five
  // seconds, where no tick judges the run, so only the last key's check sees it under 90%.
  const keys = `${withMisses(text.slice(0, -1))}${text.at(-1) === 'x' ? 'z' : 'x'}`;
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
  await page.clock.runFor(1);
  const pace = Math.floor(4900 / (keys.length - 1));
  await typeAtPace(page, keys.slice(0, -1), pace);
  await page.clock.runFor(4950 - (keys.length - 1) * pace);
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  // The tick due at 5 s is late, as on a busy main thread: the last key lands at 5.005 s, before it.
  await page.evaluate(() => {
    const clockNow = performance.now.bind(performance);
    performance.now = () => clockNow() + 55;
  });
  await page.keyboard.type(keys.at(-1));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.clock.resume();
  await expect(page.locator('#result-time')).toHaveText('5.0 s');
  expect(Number(await page.locator('#result-accuracy').textContent())).toBeLessThan(90);
  await expect(page.locator('#result-delta')).toHaveText('Under your minimum · not counted');
  await expect(page.locator('#result-comparison-note')).toHaveText('Finished under your 90% minimum accuracy, so it isn’t counted.');
  await expect(page.locator('#best')).toHaveText('No best yet');
});

test('a retest stopped under its baseline’s minimum shows no timing for the drilled pair', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#min-wpm').selectOption('20');
  await page.keyboard.press('Escape');
  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');

  await page.locator('#manual-heading').click();
  await page.locator('#manual-target-input').fill('th');
  await page.locator('#apply-manual-target').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await typeInto(page, (await passageText(page)).slice(0, 12));
  await page.clock.fastForward(60_000);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#condition-line')).toContainText('min 20 wpm');

  // 21 keys a second apart: about 12 wpm, under the baseline's 20 once the grace is over.
  const slow = await passageText(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
  await typeAtPace(page, slow.slice(0, 21), 1000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.clock.resume();
  await expect(page.locator('#result-comparison-note')).toHaveText('Stopped: speed fell below 20 wpm, so it isn’t counted.');
  await expect(page.locator('#comparison-panel')).toHaveAttribute('data-outcome', 'unavailable');
  for (const id of ['#comparison-accuracy', '#comparison-wpm', '#comparison-timing']) await expect(page.locator(id)).toHaveText('—');
  await expect(page.locator('#comparison-sample')).toHaveText('th · timing not compared');
  await expect(page.locator('#comparison-caveat')).toHaveText('The retest fell under the baseline’s minimums, so no comparison is made.');

  // Progress keeps the baseline and records no drill-and-retest comparison.
  await openView(page, 'Progress');
  await expect(page.locator('.run-row')).toHaveCount(1);
  await expect(page.locator('#history-list')).toBeHidden();
  await expect(page.locator('#history-empty')).toBeVisible();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('the settings rows and practice label fit', async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openApp(page);
      await openSettings(page);
      await page.locator('#min-accuracy').selectOption('95');
      await page.locator('#min-wpm').selectOption('40');
      await expect(page.locator('#minimum-note')).toHaveText('min 95% accuracy · min 40 wpm');
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflow()).toBeLessThanOrEqual(0);
      const popover = await page.locator('.preferences-popover').boundingBox();
      for (const id of ['#min-accuracy', '#min-wpm']) {
        const box = await page.locator(id).boundingBox();
        expect(box.x + box.width, id).toBeLessThanOrEqual(popover.x + popover.width);
      }
      // Both minimums share one row, so the popover grows by one row, not two.
      const [accuracyBox, wpmBox] = [await page.locator('#min-accuracy').boundingBox(), await page.locator('#min-wpm').boundingBox()];
      expect(Math.abs(accuracyBox.y - wpmBox.y)).toBeLessThanOrEqual(1);
      // At 390 × 844 focus mode stays in view without scrolling the popover. At 320 × 568 the popover
      // scrolls now that the pace caret has a row too, so there focus mode only has to be reachable in it.
      const focus = page.locator('label[for="focus-toggle"]');
      if (viewport.width === 320) await focus.scrollIntoViewIfNeeded();
      const focusRow = await focus.boundingBox();
      const shown = await page.locator('.preferences-popover').boundingBox();
      expect(focusRow.y).toBeGreaterThanOrEqual(shown.y);
      expect(focusRow.y + focusRow.height).toBeLessThanOrEqual(shown.y + shown.height);
      // The label sits under every control, lengths included, never between the rows.
      const lengths = await page.locator('#duration-options').boundingBox();
      const note = await page.locator('#minimum-note').boundingBox();
      expect(note.y).toBeGreaterThanOrEqual(lengths.y + lengths.height);
      if (viewport.width === 390) await shot(page, testInfo, 'settings-mobile');
      await page.locator('details.preferences > summary').click();
      await expect(page.locator('.preferences-popover')).toBeHidden();
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  });
}

test('desktop settings and the practice label, dark and light', async ({ page }, testInfo) => {
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await openSettings(page);
    await page.locator('#min-accuracy').selectOption('95');
    await page.locator('#min-wpm').selectOption('40');
    await page.locator('#min-wpm').focus();
    await shot(page, testInfo, `settings-${scheme}`);
    await page.locator('details.preferences > summary').click();
    await expect(page.locator('.preferences-popover')).toBeHidden();
    await expect(page.locator('#minimum-note')).toBeVisible();
    // The label takes its own line, so the controls stay centred under the dock.
    const first = await page.locator('.practice-controls .segmented').first().boundingBox();
    const last = await page.locator('.practice-controls .compact-switch').boundingBox();
    const dock = await page.locator('.dock').boundingBox();
    expect(Math.abs((first.x + last.x + last.width) / 2 - (dock.x + dock.width / 2))).toBeLessThanOrEqual(2);
    expect((await page.locator('#minimum-note').boundingBox()).y).toBeGreaterThanOrEqual(last.y + last.height);
    await page.mouse.move(1270, 790);
    await shot(page, testInfo, `practice-${scheme}`);
  }
});
