// A touchscreen laptop, or a tablet with a trackpad: the mouse or trackpad is the primary pointer, so
// `pointer` reads fine, but a finger can still reach every control. The 44px touch targets therefore
// key on `any-pointer: coarse`. Chromium's CDP media emulation ignores the pointer features, so this
// browser starts with Blink's own pointer settings instead (bit flags: 2 coarse, 4 fine; 1 no hover,
// 2 hover): a fine primary pointer with hover, and a coarse one also available. Firefox takes the same
// from its pointer preferences (bit flags: 1 coarse, 2 fine, 4 hover). WebKit has no such setting.
// That needs its own browser, so these tests live in their own file.
import { test, expect, openApp, openView, chooseWords, completePassage } from './fixtures.js';

const args = ['--blink-settings=primaryPointerType=4,availablePointerTypes=6,primaryHoverType=2,availableHoverTypes=3'];
const pointers = {
  chromium: process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM, args } : { args },
  firefox: { firefoxUserPrefs: { 'ui.primaryPointerCapabilities': 6, 'ui.allPointerCapabilities': 7 } },
  webkit: {},
};
test.use({ launchOptions: [async ({ browserName }, use) => use(pointers[browserName]), { scope: 'worker' }] });
test.skip(({ browserName }) => browserName === 'webkit', 'WebKit can’t start with a coarse pointer beside a fine one');

const MIN = 44;

// Whole pixels along the row and the column through a control's centre where a tap still lands on it.
const hitArea = (locator) => locator.evaluate((el) => {
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const box = el.getBoundingClientRect();
  const x = Math.round(box.left + box.width / 2);
  const y = Math.round(box.top + box.height / 2);
  const owns = (px, py) => el.contains(document.elementFromPoint(px, py));
  const run = (dx, dy) => {
    let d = 1;
    while (d <= 64 && owns(x + dx * d, y + dy * d)) d += 1;
    return d - 1;
  };
  return owns(x, y) ? [run(-1, 0) + run(1, 0) + 1, run(0, -1) + run(0, 1) + 1] : [0, 0];
});

test('a fine primary pointer with a touchscreen beside it still gets 44px targets at desktop width', async ({ page }) => {
  await openApp(page);
  const media = await page.evaluate(() => Object.fromEntries(['(pointer: fine)', '(hover: hover)', '(pointer: coarse)', '(any-pointer: coarse)']
    .map((query) => [query, matchMedia(query).matches])));
  expect(media).toEqual({ '(pointer: fine)': true, '(hover: hover)': true, '(pointer: coarse)': false, '(any-pointer: coarse)': true });

  // The footer link: 34px of text and padding, grown to 50 by its transparent reach.
  expect((await hitArea(page.locator('#suggest-trigger')))[1], 'footer link height').toBeGreaterThanOrEqual(MIN);

  await chooseWords(page, 10);
  await completePassage(page);
  await openView(page, 'Progress');
  // A small button (34px tall with a mouse alone), the "View passage" disclosure and the chart points.
  expect((await hitArea(page.locator('#clear-history')))[1], 'Clear history height').toBeGreaterThanOrEqual(MIN);
  await page.locator('#run-history .run-summary').first().click();
  const passage = page.locator('#run-history .run-detail summary').first();
  await expect(passage).toHaveText('View passage');
  expect((await hitArea(passage))[1], 'View passage height').toBeGreaterThanOrEqual(MIN);
  const point = await page.locator('#progress-trend .trend-hit').first().evaluate((hit) => getComputedStyle(hit).ry);
  expect(point, 'chart point hit radius').toBe('24px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
