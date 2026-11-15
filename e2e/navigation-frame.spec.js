// The frame (TOB-470): navigation in a side bar from 960px or a bar across the top, by a saved preference, and a
// bar at the bottom of a phone. The side bar hides and comes back, per device.
import { test, expect, openApp, openView, chooseWords, passageText, typeInto, signInWithEmail, chooseNavigation, phone } from './fixtures.js';

const html = (page) => page.locator('html');
const sideBar = (page) => page.locator('#side-bar');
const toggle = (page) => page.locator('#side-bar-toggle');
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function runCommand(page, query) {
  await page.locator('#palette-trigger').click();
  await page.locator('#palette-input').fill(query);
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
}

test('the setting moves navigation between the side bar and the top bar, and a signed-in profile keeps it', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');

  // The side bar: a column down the left, the page beside it.
  await expect(html(page)).toHaveAttribute('data-navigation', 'side');
  const column = await sideBar(page).boundingBox();
  expect(column).toMatchObject({ x: 0, y: 0, height: page.viewportSize().height });
  expect((await page.locator('#main-content').boundingBox()).x).toBeGreaterThanOrEqual(column.width);
  await expect(sideBar(page).locator('.site-footer')).toBeVisible();

  await chooseNavigation(page, 'top');
  // The top bar: the navigation across the top, the corner at its end, the footer at the foot of the page.
  expect(await sideBar(page).boundingBox()).toBeNull();
  const bar = await page.locator('nav.dock').boundingBox();
  const corner = await page.locator('.corner').boundingBox();
  expect(bar).toMatchObject({ x: 0, y: 0 });
  expect(corner.y).toBe(0);
  expect(Math.round(bar.width + corner.width)).toBe(page.viewportSize().width);
  await expect(page.locator('#main-content + .site-footer')).toBeVisible();
  await expect(toggle(page)).toBeHidden();
  // The pill sits on the screen shown, in the row.
  const pill = await page.locator('.dock-nav .glide-pill').boundingBox();
  const practice = await page.locator('.dock-nav [data-nav="practice"]').boundingBox();
  expect(Math.abs(pill.x - practice.x) + Math.abs(pill.y - practice.y)).toBeLessThan(1);

  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences?.navigation).toBe('top');
  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-navigation', 'top');
  expect(await sideBar(page).boundingBox()).toBeNull();

  // The palette swaps it back.
  await runCommand(page, 'navigation · side bar');
  await expect(html(page)).toHaveAttribute('data-navigation', 'side');
  await expect(sideBar(page)).toBeVisible();
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences?.navigation).toBe('side');
});

test('the side bar hides and comes back by its button and by the palette', async ({ page }) => {
  await openApp(page);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page)).toHaveAttribute('aria-controls', 'side-bar');
  const pageLeft = (await page.locator('#main-content').boundingBox()).x;

  await toggle(page).click();
  await expect(html(page)).toHaveAttribute('data-side-bar', 'hidden');
  await expect(toggle(page)).toHaveAccessibleName('Show side bar');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  // Out of the tab order and the accessibility tree, the toggle left at the top left of the page.
  await expect(nav.getByRole('button', { name: 'train' })).toBeHidden();
  await expect(page.locator('#settings-trigger')).toBeHidden();
  await expect(toggle(page)).toBeVisible();
  const away = await toggle(page).boundingBox();
  expect(away.x).toBeLessThan(24);
  expect((await page.locator('#main-content').boundingBox()).x).toBeLessThan(pageLeft);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await toggle(page).click();
  await expect(html(page)).toHaveAttribute('data-side-bar', 'shown');
  await expect(toggle(page)).toHaveAccessibleName('Hide side bar');
  await expect(nav.getByRole('button', { name: 'train' })).toBeVisible();

  await runCommand(page, 'hide side bar');
  await expect(html(page)).toHaveAttribute('data-side-bar', 'hidden');
  await expect(page.locator('#typing-input')).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('show side bar');
  await page.keyboard.press('Enter');
  await expect(html(page)).toHaveAttribute('data-side-bar', 'shown');
  await expect(nav.getByRole('button', { name: 'train' })).toBeVisible();

  // A guest's choice lasts for the tab only.
  await toggle(page).click();
  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-side-bar', 'shown');
});

test('a hidden side bar stays hidden for a signed-in person on this device, and means nothing in the top bar', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await toggle(page).click();
  await expect(html(page)).toHaveAttribute('data-side-bar', 'hidden');

  // Restored before first paint: the bar never shows on the way in.
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') window.sideBarAtParse = document.documentElement.dataset.sideBar;
    });
  });
  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  expect(await page.evaluate(() => window.sideBarAtParse)).toBe('hidden');
  await expect(sideBar(page)).toBeHidden();
  // Device state, never a preference: the profile doesn't carry it.
  expect(supabase.profileFor('ada@stilltype.test')?.preferences ?? {}).not.toHaveProperty('sideBar');

  // Its commands and settings are in the hidden bar, so the keyboard's palette moves it.
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('navigation · top bar');
  await page.keyboard.press('Enter');
  await expect(html(page)).toHaveAttribute('data-navigation', 'top');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'train' })).toBeVisible();
  await expect(toggle(page)).toBeHidden();
  expect((await page.locator('#main-content').boundingBox()).width).toBeGreaterThan(900);
});

for (const placement of ['side', 'top']) {
  test(`the ${placement} bar fades while typing, takes no pointer and hides in focus mode`, async ({ page }) => {
    await openApp(page);

    if (placement === 'top') await chooseNavigation(page, 'top');
    await chooseWords(page, 10);
    await page.mouse.move(600, 400);
    const text = await passageText(page);
    await typeInto(page, text.slice(0, 3));
    await expect(page.locator('body')).toHaveAttribute('data-running', 'true');

    for (const selector of placement === 'side' ? ['#side-bar'] : ['nav.dock', '.corner', '.site-footer']) {
      await expect(page.locator(selector)).toHaveCSS('opacity', '0');
    }

    await expect(page.locator('nav.dock')).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('#text-display')).toHaveCSS('opacity', '1');

    await page.mouse.move(80, 80);
    await expect(page.locator('body')).toHaveAttribute('data-running', 'false');
    await expect(page.locator('nav.dock')).toHaveCSS('opacity', '1');

    await page.locator('#palette-trigger').click();
    await page.locator('#palette-input').fill('focus mode');
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'true');
    await expect(page.locator('nav.dock')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('.corner')).toHaveCSS('visibility', 'hidden');

    // Even a hidden side bar's toggle steps back in focus mode.
    if (placement === 'side') {
      await page.evaluate(() => { document.documentElement.dataset.sideBar = 'hidden'; });
      await expect(toggle(page)).toHaveCSS('visibility', 'hidden');
    }
  });
}

test('beside the side bar the page never scrolls sideways, on any screen', async ({ page }) => {
  for (const width of [960, 1000, 1100]) {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page);
    await expect(sideBar(page)).toBeVisible();

    for (const view of ['Practice', 'Train', 'Progress', 'Challenge']) {
      await openView(page, view);
      expect(await overflow(page), `${view} at ${width}`).toBeLessThanOrEqual(0);
    }
  }
});

test('below 960px a chosen side bar falls back to the top bar', async ({ page }) => {
  await page.setViewportSize({ width: 959, height: 800 });
  await openApp(page);
  await expect(html(page)).toHaveAttribute('data-navigation', 'side');
  expect(await sideBar(page).boundingBox()).toBeNull();
  expect((await page.locator('nav.dock').boundingBox()).y).toBe(0);
  await expect(toggle(page)).toBeHidden();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('the footer is read where it is seen: after the page below 960px, in the side bar from 960px', async ({ page }) => {
  // Tab order: the footer's first link comes after the page's last control, or before the page from the side bar.
  const footerAfterPage = () => page.evaluate(() => {
    const footer = document.querySelector('.site-footer');

    return Boolean(footer && document.querySelector('#main-content').compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING);
  });

  await page.setViewportSize({ width: 959, height: 800 });
  await openApp(page);
  await expect(page.locator('#main-content + .site-footer')).toBeVisible();
  await expect(sideBar(page).locator('.site-footer')).toHaveCount(0);
  expect(await footerAfterPage()).toBe(true);

  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(sideBar(page).locator('.site-footer')).toBeVisible();
  expect(await footerAfterPage()).toBe(false);

  await page.setViewportSize({ width: 959, height: 800 });
  await expect(page.locator('#main-content + .site-footer')).toBeVisible();
});

test('on a short window the side bar scrolls inside itself, its foot in reach', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 420 });
  await openApp(page);
  await expect(sideBar(page)).toBeVisible();

  // The foot (the account and the footer) stays inside the window; the screens and commands scroll above it.
  for (const foot of [page.locator('#account-trigger'), sideBar(page).locator('#release-trigger')]) {
    const box = await foot.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(420);
  }

  const dock = page.locator('nav.dock');
  expect(await dock.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.locator('#settings-trigger').focus();
  await expect(page.locator('#settings-trigger')).toBeInViewport();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('hiding the side bar in one tab hides it in the same person\'s other tabs', async ({ page, context, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  const other = await context.newPage();
  await supabase.attach(other);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'member');

  await toggle(page).click();
  await expect(html(other)).toHaveAttribute('data-side-bar', 'hidden');
  await expect(toggle(other)).toHaveAccessibleName('Show side bar');
  await toggle(other).click();
  await expect(html(page)).toHaveAttribute('data-side-bar', 'shown');
  await other.close();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 320, height: 568 }, ...phone });

  for (const placement of ['side', 'top']) {
    test(`with the ${placement} bar chosen the navigation sits at the bottom, with 44px targets and no sideways scroll`, async ({ page }) => {
      await openApp(page);

      if (placement === 'top') await chooseNavigation(page, 'top');
      const dock = await page.locator('nav.dock').boundingBox();
      expect(Math.round(dock.y + dock.height)).toBe(568);
      expect(dock.width).toBe(320);
      await expect(toggle(page)).toBeHidden();

      for (const control of await page.locator('nav.dock :is(.nav-item, .dock-command), .corner-trigger').filter({ visible: true }).all()) {
        const box = await control.boundingBox();
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
      }

      for (const view of ['Practice', 'Train', 'Progress', 'Challenge']) {
        await openView(page, view);
        expect(await overflow(page), view).toBeLessThanOrEqual(0);
      }
    });
  }
});
