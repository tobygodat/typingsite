// Custom themes in settings → appearance → theme. Run with --signed-in for the whole flow (a guest stops
// after the editor, since only an account keeps a theme past the tab and can generate one).
// Shots: theme-row, editor, contrast-note, more-colours, saved, generated, generate-limit, reloaded.
// Checks: live preview, Escape reverts and keeps settings open, save adds a radio and wears the theme over
// dark or light, the pre-paint script wears it on reload without app.js, generate fills the editor unsaved.
const GENERATED = {
  name: 'Rainy Tokyo',
  mode: 'dark',
  colors: {
    ground: '#101422', text: '#e6e9f2', muted: '#9aa3b8', accent: '#ff5fa2', danger: '#ff8a6b',
    'accent-ink': '#1a0f14', warning: '#e0b565', ghost: '#7fd1ff',
  },
};

export default async ({ page, h, shot, check, note }) => {
  const token = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim(), name);
  const hex = (name) => page.locator(`#theme-hex-${name}`);

  await h.openApp();
  const signedIn = (await page.locator('#account').getAttribute('data-state')) === 'member';
  await h.openSettings('appearance');
  const before = await token('ground');
  await shot('theme-row');

  await page.locator('#theme-new').click();
  check(await page.locator('#theme-editor').isVisible(), 'new opens the editor');
  check(await hex('ground').inputValue() === before, 'the editor starts from the current theme');
  check(await page.locator('#theme-vibe').isDisabled() === !signedIn, `the vibe field is ${signedIn ? 'enabled' : 'disabled'}`);
  check((await page.locator('#theme-generate').textContent()) === (signedIn ? 'generate' : 'sign in'), 'generate offers sign-in to guests');
  await h.settle();
  await shot('editor');

  await hex('ground').fill('#2a1838');
  check(await token('ground') === '#2a1838', 'background previews live');
  check(await page.locator('html').getAttribute('data-theme') === 'dark', 'a dark background wears dark');
  await hex('text').fill('#4a3b55');
  const issue = (await page.locator('#theme-issue-text').textContent()).trim();
  note('text issue', issue);
  check(/needs 4\.5:1$/.test(issue), 'low text contrast is named at the token');
  await shot('contrast-note');

  await page.keyboard.press('Escape');
  check(await page.locator('#theme-editor').isHidden(), 'Escape closes the editor');
  check(await page.locator('#settings-dialog').isVisible(), 'and leaves settings open');
  check(await token('ground') === before, 'Escape reverts the preview');

  if (!signedIn) return;

  await page.locator('#theme-new').click();
  await page.locator('#theme-name').fill('Plum');
  await hex('ground').fill('#f3ecf6');
  await hex('text').fill('#2b1d33');
  await hex('muted').fill('#6a5a73');
  await hex('accent').fill('#7b3fa0');
  await hex('danger').fill('#b0302a');
  check(await page.locator('html').getAttribute('data-theme') === 'light', 'a light background wears light');
  await page.locator('.theme-more summary').click();
  await hex('accent-ink').fill('#ffffff');
  check(await hex('accent-soft').getAttribute('placeholder') !== '', 'a derived tint shows what it derives to');
  await h.settle();
  await shot('more-colours');
  await page.locator('#theme-save').click();
  const plum = page.locator('#theme-select label:has-text("Plum") input');
  check(await plum.isChecked(), 'the saved theme is a checked theme option');
  check(await page.locator('#theme-edit').isVisible(), 'edit shows for a custom theme');
  check(await page.locator('html').getAttribute('data-custom') !== null, 'the custom colours are worn');
  await h.settle();
  await shot('saved');

  await page.route('**/functions/v1/generate-theme', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme: GENERATED }) }));
  await page.locator('#theme-new').click();
  await page.locator('#theme-vibe').fill('rainy tokyo night');
  await page.locator('#theme-generate').click();
  await page.waitForFunction(() => document.querySelector('#theme-name').value === 'Rainy Tokyo');
  check(await hex('accent').inputValue() === '#ff5fa2', 'generate fills the editor');
  check(await token('accent') === '#ff5fa2', 'and previews it');
  check(await page.locator('#theme-select label:has-text("Rainy Tokyo")').count() === 0, 'nothing is saved until save');
  await h.settle();
  await shot('generated');
  await page.unroute('**/functions/v1/generate-theme');
  await page.route('**/functions/v1/generate-theme', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'That’s 20 themes today. Try again tomorrow.', code: 'limit' }) }));
  await page.locator('#theme-generate').click();
  await page.locator('#theme-generate-status:not(:empty)').waitFor();
  note('limit line', await page.locator('#theme-generate-status').textContent());
  await shot('generate-limit');
  await page.locator('#theme-cancel').click();
  check(await page.locator('#theme-select label:has-text("Plum") input').isChecked(), 'cancel keeps the saved theme');

  // The pre-paint script alone (app.js blocked) wears the saved theme: no flash on load.
  await page.waitForTimeout(2000);
  await page.route('**/src/app.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.reload();
  check(await page.locator('[data-custom-option]').count() === 0, 'app.js did not run');
  check(await page.locator('html').getAttribute('data-custom') !== null, 'pre-paint wears the custom theme');
  check(await token('accent') === '#7b3fa0', 'with its colours');
  check(await page.locator('html').getAttribute('data-theme') === 'light', 'over light');
  await page.unroute('**/src/app.js');
  await h.openApp();
  await h.settle();
  await shot('reloaded');
};
