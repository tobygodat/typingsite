// Fatigue-aware sittings: after eight practice tests under one condition set, a quiet line appears
// only when the last five all fall below the earlier runs' median, once per sitting, and a person
// can turn it off.
import { test, expect, openApp, passageText, typeInto, chooseWords, openSettings, openView } from './fixtures.js';

async function run(page, delay) {
  const text = await passageText(page);
  await typeInto(page, text, '#typing-input', { delay });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
}

async function again(page) {
  await page.locator('#run-again').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
}

// Committed docs images are rewritten only on request (SCREENSHOTS=1); a normal run keeps its
// capture in the test output folder.
const shotPath = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/fatigue-notice/${name}` : testInfo.outputPath(name));

// Three quick runs then five slower ones. The screenshot test passes realistic per-key delays
// (~100 ms is about 110 wpm, ~200 ms about 55 wpm) so the captured numbers look like a person's.
async function slowSitting(page, fast = 0, slow = 40) {
  await chooseWords(page, 10);
  for (let i = 0; i < 8; i += 1) {
    if (i) await again(page);
    await run(page, i < 3 ? fast : slow);
    if (i < 7) await expect(page.locator('#fatigue-notice')).toBeHidden();
  }
}

test('one run says nothing, and the settings toggle is on by default', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await run(page, 0);
  await expect(page.locator('#fatigue-notice')).toBeHidden();
  await openSettings(page);
  const toggle = page.locator('#fatigue-toggle');
  await expect(toggle).toBeChecked();
  await expect(page.locator('label[for="fatigue-toggle"]')).toContainText('break suggestions');
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
});

test('a slowing sitting shows the evidence once, and "don’t show this" turns it off', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await openApp(page);
  await slowSitting(page, 100, 200);
  const notice = page.locator('#fatigue-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/At these settings, your last 5 runs this session are below the median of the 3 before them \(\d+ wpm\)\. You might take a short break\./);
  // The taller print lets go of the viewport while the notice shows, so "don’t show this" stays reachable.
  await expect(page.locator('#run-card')).toHaveCSS('position', 'static');

  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.mouse.move(10, 10);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#run-card').screenshot({ path: shotPath(testInfo, `run-card-${scheme}.png`) });
  }

  await page.locator('#fatigue-dismiss').click();
  await expect(notice).toBeHidden();
  await expect(page.locator('#run-card')).toHaveCSS('position', 'sticky');
  await openSettings(page);
  await expect(page.locator('#fatigue-toggle')).not.toBeChecked();
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: shotPath(testInfo, `settings-${scheme}.png`) });
  }
});

test('once per sitting: a ninth slow run does not repeat the line', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await slowSitting(page);
  await expect(page.locator('#fatigue-notice')).toBeVisible();
  await again(page);
  await run(page, 40);
  await expect(page.locator('#fatigue-notice')).toBeHidden();
});

test('a change of exercise starts a fresh comparison, so harder settings never read as fatigue', async ({ page }) => {
  // Five 25-word runs typed at a steady pace; give a busy CI machine room.
  test.setTimeout(150_000);
  await openApp(page);
  await chooseWords(page, 10);
  for (let i = 0; i < 3; i += 1) {
    if (i) await again(page);
    await run(page, 0);
  }
  await again(page);
  await chooseWords(page, 25);
  for (let i = 0; i < 5; i += 1) {
    if (i) await again(page);
    await run(page, 40);
    await expect(page.locator('#fatigue-notice')).toBeHidden();
  }
});

// Custom text is never compared (metric contract): a slow custom run neither shows the line nor joins the
// sitting, so the eighth practice test still rests on the same three earlier runs.
test('a custom text run never joins the sitting or shows the break line', async ({ page }) => {
  test.setTimeout(150_000);
  await openApp(page);
  await chooseWords(page, 10);
  for (let i = 0; i < 7; i += 1) {
    if (i) await again(page);
    await run(page, i < 3 ? 0 : 40);
  }
  await expect(page.locator('#fatigue-notice')).toBeHidden();

  await openView(page, 'Practice');
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill('the quick brown fox jumps over the lazy dog');
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await run(page, 60);
  await expect(page.locator('#result-delta')).toContainText('not counted toward your best');
  await expect(page.locator('#fatigue-notice')).toBeHidden();

  await openView(page, 'Practice');
  await chooseWords(page, 10);
  await run(page, 40);
  await expect(page.locator('#fatigue-notice')).toContainText('your last 5 runs this session are below the median of the 3 before them');

  // A custom run after the line has shown takes it down rather than repeating it over a passage of your own.
  await openView(page, 'Practice');
  await page.locator('#mode-custom').click();
  await page.locator('#custom-use').click();
  await run(page, 60);
  await expect(page.locator('#fatigue-notice')).toBeHidden();
});

// Seven runs that would tip into a notice on the eighth slow one, then history is cleared.
async function clearedSitting(page) {
  await chooseWords(page, 10);
  for (let i = 0; i < 7; i += 1) {
    if (i) await again(page);
    await run(page, i < 3 ? 0 : 40);
  }
  await expect(page.locator('#fatigue-notice')).toBeHidden();
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#history-feedback')).toContainText('History cleared');
}

test('clearing history clears the sitting, so the next run says nothing', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await clearedSitting(page);
  await openView(page, 'Practice');
  await run(page, 40);
  await expect(page.locator('#fatigue-notice')).toBeHidden();
});

test('undoing a clear brings the sitting back with the history', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await clearedSitting(page);
  await page.locator('#undo-clear').click();
  await expect(page.locator('#history-feedback')).toContainText('History restored');
  await openView(page, 'Practice');
  await run(page, 40);
  await expect(page.locator('#fatigue-notice')).toBeVisible();
});

test('turning break suggestions off in settings takes a showing notice down', async ({ page }) => {
  test.setTimeout(90_000);
  // The print sticks only on screens taller than 1120px (it is static below that, notice or not),
  // so use a tall one to see the notice let go of the viewport and the print stick again.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await openApp(page);
  await slowSitting(page);
  const notice = page.locator('#fatigue-notice');
  await expect(notice).toBeVisible();
  await expect(page.locator('#run-card')).toHaveCSS('position', 'static');
  await openSettings(page);
  await page.locator('#fatigue-toggle').uncheck();
  await expect(notice).toBeHidden();
  await expect(page.locator('#run-card')).toHaveCSS('position', 'sticky');
});

test.describe('on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the dismiss link and the settings row each give a finger 44px', async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    await slowSitting(page);
    const notice = page.locator('#fatigue-notice');
    const dismiss = page.locator('#fatigue-dismiss');
    await expect(dismiss).toBeVisible();
    // The link still sits inside the sentence: its line is no taller than the notice's own lines.
    const lineHeight = await notice.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
    const lines = (await notice.boundingBox()).height / lineHeight;
    expect(Math.abs(lines - Math.round(lines))).toBeLessThan(0.05);
    await dismiss.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    const box = await dismiss.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    // The grown area is the button's own right up to its top edge, and a tap there lands.
    const x = box.x + box.width / 2;
    expect(await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.id, [x, box.y + 1])).toBe('fatigue-dismiss');
    await page.touchscreen.tap(x, box.y + 1);
    await expect(notice).toBeHidden();
    await openSettings(page);
    await expect(page.locator('#fatigue-toggle')).not.toBeChecked();
    // The whole row is the switch's label, so it is the target.
    expect((await page.locator('label[for="fatigue-toggle"]').boundingBox()).height).toBeGreaterThanOrEqual(44);
  });
});
