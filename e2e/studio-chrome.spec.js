// The studio chrome against the fake Supabase: the rank pill's card and who may see it, the inked mode row when the
// app's type changes, and a theme generation dropped mid-request.
import { test, expect, openApp, chooseWords, chooseSetting, closeSettings, passageText, signInWithEmail } from './fixtures.js';

const EMAIL = 'ranked@stilltype.test';

async function signInRanked(page, supabase) {
  const user = supabase.addUser(EMAIL);
  supabase.races.quick.ratings.set(user.id, { rating: 1920, races: 18 });
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await expect(page.locator('#rank-pill')).toBeVisible();
}

// How far the ink window is from the chosen segment, and the chosen label's copy from the label, in px.
const inkOff = (page, group) => page.locator(group).evaluate((row) => {
  const ink = row.querySelector(':scope > .glide-ink');
  const chosen = row.querySelector(':scope > [aria-pressed="true"]');
  const box = ink.getBoundingClientRect();
  const target = chosen.getBoundingClientRect();
  const [top, right, bottom, left] = getComputedStyle(ink).clipPath.match(/inset\(([-\d.]+)px ([-\d.]+)px ([-\d.]+)px ([-\d.]+)px/).slice(1).map(Number);
  const index = [...row.querySelectorAll(':scope > :is(button, details)')].indexOf(chosen);
  const range = document.createRange();
  range.selectNodeContents(chosen);
  const text = range.getBoundingClientRect();
  range.selectNodeContents(ink.children[index]);
  const copy = range.getBoundingClientRect();

  return Math.max(
    Math.abs(box.left + left - target.left), Math.abs(box.right - right - target.right), Math.abs(box.top + top - target.top), Math.abs(box.bottom - bottom - target.bottom),
    Math.abs(text.left - copy.left), Math.abs(text.top - copy.top), Math.abs(text.width - copy.width),
  );
});

test('Escape puts away the rank card opened with the mouse, and gives the pill focus', { tag: '@compat' }, async ({ page, supabase }) => {
  await signInRanked(page, supabase);
  const card = page.locator('#rank-popover');

  await page.locator('#rank-pill').click();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.locator('#rank-pill')).toBeFocused();
  await expect(page.locator('#rank-pill')).toHaveAttribute('aria-expanded', 'false');

  await page.locator('#rank-pill').focus();
  await page.keyboard.press('Enter');
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  await page.locator('#rank-pill').click();
  await page.mouse.click(10, (page.viewportSize()?.height ?? 600) - 10);
  await expect(card).toHaveCount(0);
});

test('a sign-out in another tab mid-run takes the rank pill away for the rest of the run and after it', async ({ page, context, supabase }) => {
  await signInRanked(page, supabase);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await page.locator('#typing-input').focus();
  await page.keyboard.type(text.slice(0, 3));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');

  const other = await context.newPage();
  await supabase.attach(other);
  await openApp(other);
  await other.locator('#account-trigger').click();
  await Promise.all([other.waitForEvent('load'), other.locator('#account-signout').click()]);
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');

  await expect(page.locator('#rank-pill')).toHaveCount(0);
  await page.mouse.move(40, 40);
  await page.mouse.move(400, 300);
  await expect(page.locator('#rank-pill')).toHaveCount(0);
  await page.keyboard.type(text.slice(3));
  await expect(page.locator('#rank-pill')).toHaveCount(0);
});

test('the ink window and its label follow a change of app font without a resize', { tag: '@compat' }, async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await expect(page.locator('html')).toHaveAttribute('data-app-font', 'inter');
  await expect.poll(() => inkOff(page, '.practice-rail .mode-options')).toBeLessThan(0.5);

  await chooseSetting(page, 'app-font', 'source-serif');
  await closeSettings(page);
  await expect(page.locator('html')).toHaveAttribute('data-app-font', 'source-serif');
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => inkOff(page, '.practice-rail .mode-options')).toBeLessThan(0.5);
  await expect.poll(() => inkOff(page, '#duration-options')).toBeLessThan(0.5);
});

for (const leave of ['edit', 'escape']) {
  test(`leaving a theme being generated (${leave}) aborts its request and shows no error`, { tag: '@compat' }, async ({ page, supabase }) => {
    await signInRanked(page, supabase);
    let held = 0;
    await page.route('**/functions/v1/generate-theme', () => { held += 1; });
    const failed = page.waitForEvent('requestfailed', (request) => request.url().includes('/functions/v1/generate-theme'));

    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill('vibe warm kyoto matcha');
    await page.keyboard.press('Enter');
    await expect(page.locator('#palette-theme')).toHaveAttribute('data-status', 'generating');
    await expect.poll(() => held).toBe(1);

    if (leave === 'edit') await page.locator('#palette-input').fill('vibe cold harbour');
    else await page.keyboard.press('Escape');

    // Well inside the request's own 15-second timeout, which would fail it anyway.
    const outcome = await Promise.race([failed.then((request) => request.failure()?.errorText), new Promise((resolve) => { setTimeout(() => resolve('still open'), 2000); })]);
    expect(outcome).not.toBe('still open');
    expect(outcome).toBeTruthy();
    await expect(page.locator('#palette-theme')).toHaveAttribute('data-status', 'idle');
    await expect(page.locator('#palette')).toHaveJSProperty('open', true);
  });
}
