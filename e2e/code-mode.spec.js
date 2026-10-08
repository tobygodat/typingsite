import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage } from './fixtures.js';

test('code mode serves a python snippet and keeps the run out of bests', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-code').click();
  await page.locator('#duration-options [data-language="python"]').click();
  await expect(page.locator('#duration-options [data-language="python"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#condition-line')).toContainText('code · python');
  const text = await passageText(page);
  expect(text).toMatch(/[:(]/);
  expect(text).not.toMatch(/\n| {2}/);

  await typeInto(page, text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-conditions')).toHaveText(/^code · python · physical keyboard · (stop|continue) on error · corpus v\d+ · metric v1 · not counted toward bests$/);
  await expect(page.locator('#result-delta')).toHaveText('Code run complete · not counted toward your best');
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#best')).toHaveText('Code runs aren’t ranked');
});

test('code snippets stay inside the typing area at 320px with large text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openApp(page);
  await page.locator('#font-size').evaluate((select) => { select.value = '36'; select.dispatchEvent(new Event('change')); });
  await page.locator('#mode-code').click();
  for (const language of ['js', 'python', 'go', 'rust']) {
    await page.locator(`#duration-options [data-language="${language}"]`).click();
    for (let i = 0; i < 6; i += 1) {
      const clipped = await page.evaluate(() => {
        const area = document.getElementById('typing-wrap').getBoundingClientRect();
        // A space may hang past the edge at a line end, as in prose; letters may not.
        return [...document.querySelectorAll('#text-display .char')].filter((char) => char.textContent !== ' ')
          .filter((char) => { const box = char.getBoundingClientRect(); return box.left < area.left - 0.5 || box.right > area.right + 0.5; })
          .map((char) => char.textContent).join('');
      });
      expect(clipped, `${language}: ${await passageText(page)}`).toBe('');
      await page.locator('#typing-input').focus();
      await page.keyboard.press('Escape');
    }
  }
});

// Docs captures only refresh with SCREENSHOTS=1; normal runs write to the test output folder.
test('a code run clears the earlier practice baseline', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#skip-to-retest')).toBeEnabled();
  await page.locator('#run-again').click();
  await page.locator('#mode-code').click();
  await expect(page.locator('#condition-line')).toContainText('code ·');
  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText('Code run complete · not counted toward your best');
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#recommendation-meta')).toHaveText('A standalone drill. Code runs have no fresh-text retest.');
});

test('the palette hides punctuation and word lists in code mode', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const options = page.locator('#palette-list [role="option"]');
  const search = async (query, count) => {
    await page.locator('#palette-trigger').click();
    await page.keyboard.type(query);
    if (count) await expect(options.filter({ hasText: query })).not.toHaveCount(0);
    else await expect(options.filter({ hasText: query })).toHaveCount(0);
    await page.locator('#palette-input').fill('');
    await page.keyboard.press('Escape');
    await expect(page.locator('#palette')).toBeHidden();
  };
  await search('punctuation', true);
  await search('word list', true);
  await page.locator('#mode-code').click();
  await expect(page.locator('#condition-line')).toContainText('code ·');
  await search('punctuation', false);
  await search('word list', false);
});

test('code mode screenshots', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await page.locator('#mode-code').click();
    await page.locator('#duration-options [data-language="js"]').click();
    await expect(page.locator('#condition-line')).toContainText('code · js');
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    const name = `code-mode-${theme}.png`;
    await page.screenshot({ path: process.env.SCREENSHOTS ? `docs/screenshots/code-mode/${name}` : testInfo.outputPath(name) });
  }
});
