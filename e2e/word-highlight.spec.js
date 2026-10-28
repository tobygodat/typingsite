// Word highlight: settings → word highlight (off, current, next) and its palette commands.
// A display preference: it tints one passage word, changes instantly and never enters the conditions.
import { test, expect, openApp, openView, openSettings, passageText, typeInto, signInWithEmail, chooseMore, chooseSetting, phone } from './fixtures.js';

// Committed docs screenshots are refreshed only with SCREENSHOTS=1; normal runs write to the test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/word-highlight/${name}.png` : testInfo.outputPath(`${name}.png`));

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const background = (locator) => locator.evaluate((node) => getComputedStyle(node).backgroundColor);

// Indexes of the words that actually paint a tint (it sits on their letters, skipping a miss).
const tinted = (page, display = '#text-display') => page.locator(`${display} .word`).evaluateAll((nodes) => nodes
  .filter((node) => [...node.children].some((char) => !char.classList.contains('wrong') && getComputedStyle(char).backgroundColor !== 'rgba(0, 0, 0, 0)'))
  .map((node) => Number(node.dataset.wordIndex)));

async function pickHighlight(page, mode) {
  await openSettings(page);
  await chooseSetting(page, 'word-highlight', mode);
  await expect(page.locator('body')).toHaveAttribute('data-word-highlight', mode);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
}

async function runPalette(page, label) {
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('#palette-trigger').click();
  await page.keyboard.type(label);
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText(label);
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
}

// The passage's first word, so a test can type it and then its space.
const firstWord = (text) => text.split(' ')[0];

test('nothing is tinted by default, and current tints the word being typed until its space, instantly and without motion', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('body')).toHaveAttribute('data-word-highlight', 'off');
  expect(await tinted(page)).toEqual([]);
  await openSettings(page);
  await expect(page.locator('#word-highlight input:checked')).toHaveValue('off');
  await expect(page.locator('#word-highlight').locator('..')).toContainText('word highlight');
  // No mode is named "current", the palette's hint for the active choice.
  expect(await page.locator('#word-highlight .setting-option span').allTextContents()).toEqual(['off', 'this word', 'next word']);
  await pickHighlight(page, 'current');
  expect(await tinted(page)).toEqual([0]);

  const text = await passageText(page);
  const first = firstWord(text);
  await typeInto(page, first.slice(0, 2), '#typing-input', { delay: 60 });
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  expect(await tinted(page)).toEqual([0]);
  // A letter state: no transition, before or during the run.
  const current = page.locator('#text-display .word.word-current > .char').first();
  expect(await current.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0s');
  expect(await background(current)).not.toBe(TRANSPARENT);

  // The finished word stays current while the caret sits on its space.
  await page.keyboard.type(first.slice(2), { delay: 60 });
  expect(await tinted(page)).toEqual([0]);
  await page.keyboard.type(' ');
  // Synchronous with the keystroke: no transition to wait for.
  expect(await tinted(page)).toEqual([1]);
  await page.keyboard.press('Backspace');
  expect(await tinted(page)).toEqual([0]);
});

test('a miss inside the highlighted word keeps exactly its own coral tint', async ({ page }) => {
  await openApp(page);
  await pickHighlight(page, 'current');
  const text = await passageText(page);
  const wrongKey = text[0] === 'x' ? 'z' : 'x';
  await typeInto(page, wrongKey);
  const miss = page.locator('#text-display .word.word-current > .char.wrong');
  await expect(miss).toHaveCount(1);

  // The word tint skips the miss, so it shows the plain danger-soft tint over whatever the passage
  // sits on (a theme may put it on a card), while the word's other letters keep the word tint.
  const colors = await miss.evaluate((node) => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    document.body.append(probe);
    probe.style.color = root.getPropertyValue('--danger');
    const danger = getComputedStyle(probe).color;
    probe.style.color = root.getPropertyValue('--danger-soft');
    const soft = getComputedStyle(probe).color;
    probe.remove();
    const others = [...node.parentElement.children].filter((char) => char !== node);

    return {
      color: getComputedStyle(node).color, danger, fill: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage, soft,
      othersTinted: others.every((char) => getComputedStyle(char).backgroundColor !== 'rgba(0, 0, 0, 0)'),
    };
  });

  expect(colors.color).toBe(colors.danger);
  expect(colors.fill).toBe(colors.soft);
  expect(colors.image).toBe('none');
  expect(colors.othersTinted).toBe(true);
});

test('next tints the word after the current one, and the palette switches modes', async ({ page }) => {
  await openApp(page);
  await runPalette(page, 'word highlight · next word');
  await expect(page.locator('body')).toHaveAttribute('data-word-highlight', 'next');
  expect(await tinted(page)).toEqual([1]);

  const text = await passageText(page);
  await typeInto(page, `${firstWord(text)} `, '#typing-input', { delay: 60 });
  expect(await tinted(page)).toEqual([2]);

  // The palette shows the current mode in its hint and turns it off again mid-session.
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('#palette-trigger').click();
  await page.keyboard.type('word highlight · next word');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('current');
  await page.keyboard.press('Escape');
  await runPalette(page, 'word highlight · off');
  expect(await tinted(page)).toEqual([]);
  await expect(page.locator('#word-highlight input:checked')).toHaveValue('off');
  // The word markers keep following the caret, so turning it back on is instant.
  await runPalette(page, 'word highlight · this word');
  expect(await tinted(page)).toEqual([1]);
});

test('a custom passage is tinted too, and changing the highlight keeps it', async ({ page }) => {
  const custom = 'the quick brown fox jumps over the lazy dog';
  await openApp(page);
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(custom);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  const conditionLine = await page.locator('#condition-line').textContent();
  await pickHighlight(page, 'current');
  await pickHighlight(page, 'next');
  expect(await passageText(page)).toBe(custom);
  await expect(page.locator('#condition-line')).toHaveText(conditionLine);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'custom');
  expect(await tinted(page)).toEqual([1]);
  await typeInto(page, 'the ', '#typing-input', { delay: 60 });
  expect(await tinted(page)).toEqual([2]);
});

// Every session typed against a text renders through the same passage, so each follows the setting.
test('the daily, the standard test, a lesson and the one-keyboard challenge follow the same setting', async ({ page }) => {
  await openApp(page);
  await pickHighlight(page, 'next');

  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  expect(await tinted(page)).toEqual([1]);
  await typeInto(page, `${firstWord(await passageText(page))} `, '#typing-input', { delay: 60 });
  expect(await tinted(page)).toEqual([2]);

  await openView(page, 'Practice');
  await chooseMore(page, 'mode-standard');
  await expect(page.locator('#mode-standard')).toHaveAttribute('aria-pressed', 'true');
  expect(await tinted(page)).toEqual([1]);

  await page.locator('#mode-time').click();
  await chooseMore(page, 'open-lessons');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'learn');
  await page.locator('#lesson-primary').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'lesson');
  expect(await tinted(page)).toEqual([1]);
  await typeInto(page, `${firstWord(await passageText(page))} `, '#typing-input', { delay: 60 });
  expect(await tinted(page)).toEqual([2]);

  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  await page.locator('#start-local-race').click();
  await expect(page.locator('#race-stage')).toBeVisible();
  expect(await tinted(page, '#race-text-display')).toEqual([1]);
  const race = await page.locator('#race-accessible-passage').textContent();
  await typeInto(page, `${firstWord(race)} `, '#race-input', { delay: 60 });
  expect(await tinted(page, '#race-text-display')).toEqual([2]);
});

test('an account keeps the pick; older or unknown saved values read as off', async ({ page, supabase }) => {
  const user = supabase.addUser('ada@stilltype.test');
  const updatedAt = new Date(Date.now() - 60000).toISOString();
  // Saved before the setting existed, with an unknown value and a kept text size.
  supabase.profiles.set(user.id, {
    data: { version: 2, profileId: 'saved', preferences: { fontSize: '22', wordHighlight: 'sparkle' }, attempts: [], runs: [], loops: [], seenTextIds: [], bests: {}, updatedAt },
    updated_at: updatedAt,
  });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '22');
  await expect(page.locator('body')).toHaveAttribute('data-word-highlight', 'off');

  await pickHighlight(page, 'current');
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences.wordHighlight, { timeout: 8000 }).toBe('current');
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-word-highlight', 'current');
  await expect(page.locator('#word-highlight input:checked')).toHaveValue('current');
  expect(await tinted(page)).toEqual([0]);
});

test.describe('screenshots', () => {
  // Mid-run shots at a realistic pace (under 100 wpm), with one miss in the word being typed.
  async function midRun(page, mode, theme) {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await pickHighlight(page, mode);
    const words = (await passageText(page)).split(' ');
    // The first word from the sixth on that is long enough to hold a miss and still have letters to go.
    const index = words.findIndex((word, i) => i >= 5 && word.length >= 3);
    const miss = words[index][1] === 'q' ? 'z' : 'q';
    await typeInto(page, `${words.slice(0, index).join(' ')} `, '#typing-input', { delay: 130 });
    await page.keyboard.type(`${words[index][0]}${miss}`, { delay: 130 });
    await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
    await expect(page.locator('#text-display .char.wrong')).toHaveCount(1);
    // Let the caret spring and the chrome fade settle before the shot.
    await page.waitForTimeout(400);

    return index;
  }

  for (const theme of ['dark', 'light']) {
    test(`current word, ${theme}`, async ({ page }, testInfo) => {
      test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
      const index = await midRun(page, 'current', theme);
      expect(await tinted(page)).toEqual([index]);
      await page.screenshot({ path: shot(testInfo, `current-${theme}`) });
    });

    test(`next word, ${theme}`, async ({ page }, testInfo) => {
      test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
      const index = await midRun(page, 'next', theme);
      expect(await tinted(page)).toEqual([index + 1]);
      await page.screenshot({ path: shot(testInfo, `next-${theme}`) });
    });
  }
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...phone });

  test('the settings row fits unclipped at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openApp(page);
    await openSettings(page);
    const row = page.locator('#word-highlight');
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeInViewport();
    const clipped = await row.locator('.setting-option span').evaluateAll((options) => options.some((option) => option.scrollWidth > option.clientWidth));
    expect(clipped).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test('settings row and current word at 390 px', async ({ page }, testInfo) => {
    test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await openSettings(page);
    await chooseSetting(page, 'word-highlight', 'current');
    await expect(page.locator('#word-highlight').locator('..')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.screenshot({ path: shot(testInfo, 'settings-mobile') });

    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-dialog')).toBeHidden();
    const words = (await passageText(page)).split(' ');
    await typeInto(page, `${words.slice(0, 2).join(' ')} ${words[2].slice(0, 1)}`, '#typing-input', { delay: 130 });
    expect(await tinted(page)).toEqual([2]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot(testInfo, 'current-mobile') });
  });
});
