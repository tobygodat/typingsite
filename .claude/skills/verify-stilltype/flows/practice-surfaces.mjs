// The other Practice surfaces inside the Instrument layout (TOB-470): custom text, a custom length being typed,
// quote and book filters, the on-screen keyboard, focus mode, composing, the Learn screen and a lesson.
export default async ({ page, h, shot }) => {
  const setting = async (id, value) => {
    await h.openSettings();
    await page.evaluate(([field, choice]) => document.querySelector(`#${field} input[value="${choice}"]`).click(), [id, value]);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#settings-dialog').open);
  };

  await h.openApp();
  await h.chooseMore('mode-custom');
  await page.locator('#custom-options').waitFor();
  await shot('custom-text');

  await page.locator('#mode-time').click();
  await page.locator('#custom-length').click();
  await page.keyboard.type('45');
  await shot('custom-length');
  await page.keyboard.press('Escape');

  await page.locator('#mode-quote').click();
  await page.locator('#quote-length').click();
  await h.settle();
  await shot('quote-filter-open');
  await page.keyboard.press('Escape');

  await h.chooseMore('mode-book');
  await h.settle();
  await shot('book');

  await page.locator('#mode-time').click();
  await setting('keyboard-toggle', 'true');
  await shot('keyboard');
  await setting('keyboard-toggle', 'false');

  await setting('focus-toggle', 'true');
  await h.type((await h.passage()).slice(0, 12));
  await shot('focus-mid-run');
  await page.keyboard.press('Escape');
  await setting('focus-toggle', 'false');

  await h.chooseMore('mode-compose');
  await page.locator('#compose-form').waitFor();
  await h.settle();
  await shot('compose');

  await h.chooseMore('open-lessons');
  await page.locator('#lesson-primary').waitFor();
  await h.settle();
  await shot('learn');
  await page.locator('#lesson-primary').click();
  await h.attr('#typing-screen', 'data-session', 'lesson');
  await shot('lesson');
};
