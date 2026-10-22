// Custom themes: settings → appearance → theme → new / edit, and generating one from a vibe
// (supabase/functions/generate-theme, stood in for here by a routed reply).
import { test, expect, openApp, openSettings, signInWithEmail } from './fixtures.js';

const EMAIL = 'themes@stilltype.test';
const GENERATED = {
  name: 'Rainy Tokyo',
  mode: 'dark',
  colors: { ground: '#101422', text: '#e6e9f2', muted: '#9aa3b8', accent: '#ff5fa2', danger: '#ff8a6b', 'accent-ink': '#1a0f14', warning: '#e0b565', ghost: '#7fd1ff' },
};
const token = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim(), name);
const hex = (page, name) => page.locator(`#theme-hex-${name}`);
const generateReply = (page, status, body) => page.route('**/functions/v1/generate-theme', (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));

test('the editor previews live, notes low contrast at the token, and Escape puts the theme back', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await openSettings(page, 'appearance');
  await page.locator('#theme-new').click();
  await expect(page.locator('#theme-editor')).toBeVisible();
  await expect(page.locator('#theme-name')).toHaveValue('dark copy');
  await expect(hex(page, 'ground')).toHaveValue('#0f0f0e');
  // A derived tint shows what it derives to and stores nothing.
  await expect(hex(page, 'accent-soft')).toHaveValue('');

  await hex(page, 'ground').fill('#f4f1eb');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-custom', '');
  expect(await token(page, 'ground')).toBe('#f4f1eb');
  await expect(page.locator('#theme-issue-text')).toHaveText(/:1, needs 4\.5:1$/);
  await hex(page, 'text').fill('#1b1a19');
  await expect(page.locator('#theme-issue-text')).toHaveText('');
  await expect(page.locator('#theme-save')).toBeEnabled();

  // Guests can't generate: the field waits, and the button signs in.
  await expect(page.locator('#theme-vibe')).toBeDisabled();
  await expect(page.locator('#theme-generate')).toHaveText('sign in');

  await hex(page, 'text').press('Escape');
  await expect(page.locator('#theme-editor')).toBeHidden();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-custom', '');
  await expect(page.locator('#theme-new')).toBeFocused();
});

test('a saved theme is another theme: it syncs, wears before app.js on reload, and can be deleted', async ({ page, browser, supabase }) => {
  supabase.addUser(EMAIL);
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await openSettings(page, 'appearance');
  await page.locator('#theme-new').click();
  await page.locator('#theme-name').fill('Plum');
  for (const [name, value] of [['ground', '#f3ecf6'], ['text', '#2b1d33'], ['muted', '#6a5a73'], ['accent', '#7b3fa0'], ['danger', '#b0302a']]) await hex(page, name).fill(value);
  await page.locator('#theme-save').click();
  // A light background makes it a light theme: system mode shows it while the system is light.
  const plum = page.locator('#light-theme label:has-text("Plum") input');
  await expect(plum).toBeChecked();
  await expect(page.locator('#theme-select input[value="system"]')).toBeChecked();
  await expect(page.locator('#dark-theme label:has-text("Plum")')).toHaveCount(0);
  await expect(page.locator('#theme-edit')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-custom', '');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-custom', '');
  await expect(page.locator('#theme-edit')).toBeHidden();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-custom', '');
  await expect.poll(() => supabase.profileFor(EMAIL)?.preferences?.lightTheme).toMatch(/^custom-/);
  await expect.poll(() => supabase.profileFor(EMAIL)?.preferences?.customThemes ?? '').toContain('"Plum"');

  // On reload the inline script alone wears it: app.js never runs here.
  await page.route('**/src/app.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-custom', '');
  expect(await token(page, 'accent')).toBe('#7b3fa0');
  await page.unroute('**/src/app.js');

  // Another device signed in to the account gets it.
  const other = await browser.newContext();
  const second = await other.newPage();
  await supabase.attach(second);
  await openApp(second);
  await signInWithEmail(second, EMAIL);
  await expect(second.locator('html')).toHaveAttribute('data-custom', '');
  expect(await token(second, 'accent')).toBe('#7b3fa0');
  await other.close();

  await openApp(page);
  await openSettings(page, 'appearance');
  await page.locator('#theme-edit').click();
  await expect(page.locator('#theme-name')).toHaveValue('Plum');
  await page.locator('#theme-delete').click();
  await expect(page.locator('#light-theme label:has-text("Plum")')).toHaveCount(0);
  await expect(page.locator('#theme-select input[value="system"]')).toBeChecked();
  await expect(page.locator('#light-theme input[value="light"]')).toBeChecked();
  await expect(page.locator('html')).not.toHaveAttribute('data-custom', '');
});

test('generate fills the editor unsaved, and each failure is one line', async ({ page, supabase }) => {
  supabase.addUser(EMAIL);
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await openSettings(page, 'appearance');
  await page.locator('#theme-new').click();
  await expect(page.locator('#theme-vibe')).toBeEnabled();

  await generateReply(page, 200, { theme: GENERATED });
  await page.locator('#theme-vibe').fill('rainy tokyo night');
  await page.locator('#theme-vibe').press('Enter');
  await expect(page.locator('#theme-name')).toHaveValue('Rainy Tokyo');
  await expect(hex(page, 'accent')).toHaveValue('#ff5fa2');
  expect(await token(page, 'accent')).toBe('#ff5fa2');
  await expect(page.locator('[data-custom-option]:has-text("Rainy Tokyo")')).toHaveCount(0);
  expect(supabase.profileFor(EMAIL)?.preferences?.customThemes ?? '').not.toContain('Rainy');

  for (const [status, body] of [
    [429, { error: 'That’s 20 themes today. Try again tomorrow.', code: 'limit' }],
    [422, { error: 'Couldn’t make a theme from that. Try other words.', code: 'refused' }],
    [504, { error: 'That took too long. Try again.', code: 'timeout' }],
  ]) {
    await page.unroute('**/functions/v1/generate-theme');
    await generateReply(page, status, body);
    await page.locator('#theme-generate').click();
    await expect(page.locator('#theme-generate-status')).toHaveText(body.error);
    await expect(page.locator('#theme-generate')).toBeEnabled();
  }
  // The draft from before the failures is still there to save.
  await expect(hex(page, 'accent')).toHaveValue('#ff5fa2');
  await page.locator('#theme-save').click();
  // A dark theme saved while the system is light becomes the dark pick, and waits for dark mode.
  await expect(page.locator('#dark-theme label:has-text("Rainy Tokyo") input')).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).not.toHaveAttribute('data-custom', '');
  await page.locator('#theme-select input[value="dark"]').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-custom', '');
  expect(await token(page, 'accent')).toBe('#ff5fa2');
  await expect(page.locator('#theme-edit')).toBeVisible();
});
