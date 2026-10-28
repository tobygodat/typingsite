import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, createAttempt } from '../src/typing.js';
import { runRecord } from '../src/insights.js';
import { test, expect, openApp, openView, passageText, typeInto, chooseWords, completePassage, signInWithEmail, chooseMore, chooseSetting } from './fixtures.js';

const codeConditions = { mode: 'code', codeLanguage: 'js', duration: null, count: null, punctuation: true, numbers: false,
  quoteLength: null, difficulty: null, wordList: null, inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

// A finished code run that mistypes every "th", so two of them make a recurring target.
function codeErrorTrace(id, at) {
  const text = Array(25).fill('the').join(' ');
  const attempt = createAttempt({ id, text, textId: id, conditions: codeConditions });
  attempt.startedAt = 0;
  attempt.events = [...text].map((char, position) => ({ type: 'insert', text: position % 4 === 1 ? 'x' : char,
    position, offsetMs: position * 100, accepted: true }));

  return { ...completeAttempt(attempt, { endedAt: text.length * 100 }), at, fresh: true };
}

test('code mode serves a python snippet and keeps the run out of bests', async ({ page }) => {
  await openApp(page);
  await chooseMore(page, 'mode-code');
  await page.locator('#code-options [data-language="python"]').click();
  await expect(page.locator('#code-options [data-language="python"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#condition-line')).toContainText('code · python');
  const text = await passageText(page);
  expect(text).toMatch(/[:(]/);
  expect(text).not.toMatch(/\n| {2}/);

  await typeInto(page, text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-conditions')).toHaveText(/^code · python · physical keyboard · (stop|continue) on error · not counted toward bests$/);
  await expect(page.locator('#result-delta')).toHaveText('Code run complete · not counted toward your best');
  await expect(page.locator('#best')).toHaveText('Code runs aren’t ranked');
  // A code run is no baseline, so its drill has no retest after it.
  await page.locator('#result-drill').click();
  await expect(page.locator('#session-description')).toHaveText('A standalone drill. Code runs have no fresh-text retest.');
});

test('code snippets stay inside the typing area at 320px with large text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openApp(page);
  await chooseSetting(page, 'font-size', '36');
  await chooseMore(page, 'mode-code');

  for (const language of ['js', 'python', 'go', 'rust']) {
    await page.locator(`#code-options [data-language="${language}"]`).click();

    for (let i = 0; i < 6; i += 1) {
      const clipped = await page.evaluate(() => {
        const area = document.getElementById('typing-wrap').getBoundingClientRect();

        // A space may hang past the edge at a line end, as in prose; letters may not.
        return [...document.querySelectorAll('#text-display .char')].filter((char) => char.textContent !== ' ')
          .filter((char) => {
            const box = char.getBoundingClientRect();

            return box.left < area.left - 0.5 || box.right > area.right + 0.5;
          })
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
  await page.locator('#run-again').click();
  await chooseMore(page, 'mode-code');
  await expect(page.locator('#condition-line')).toContainText('code ·');
  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText('Code run complete · not counted toward your best');
  // The code run dropped the prose baseline, so the drill it offers has no retest after it.
  await page.locator('#result-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-description')).toHaveText('A standalone drill. Code runs have no fresh-text retest.');
});

test('practising a code target keeps the prose punctuation, numbers and word list', async ({ page, supabase }) => {
  const user = supabase.addUser('code-target@stilltype.test');
  const traces = [codeErrorTrace('code-a', '2026-09-28T12:00:00Z'), codeErrorTrace('code-b', '2026-09-29T12:00:00Z')];
  supabase.profiles.set(user.id, { data: { version: 2,
    preferences: { mode: 'time', duration: 30, punctuation: false, numbers: true, wordList: '5k', codeLanguage: 'js' },
    attempts: traces, runs: traces.map((t) => runRecord(t)), loops: [], seenTextIds: traces.map((t) => t.textId), bests: {},
    updatedAt: '2026-09-29T12:00:00Z' } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await expect(page.locator('#punctuation-toggle')).not.toBeChecked();
  await expect(page.locator('#numbers-toggle input[value="true"]')).toBeChecked();

  await openView(page, 'Progress');
  await expect(page.locator('#training-conditions')).toContainText('code · js');
  await page.locator('#training-targets').getByRole('button', { name: 'Practice “th” again' }).click();
  await expect(page.locator('#session-title')).toHaveText('Practice “th”');
  await expect(page.locator('#session-description')).toHaveText('A standalone drill. Code runs have no fresh-text retest.');

  // Back to prose: code's locked punctuation and numbers never become the person's own settings.
  await openView(page, 'Practice');
  await page.locator('#mode-time').click();
  await expect(page.locator('#condition-line')).toContainText('english 5k · 30 s · plain · numbers');
  await expect(page.locator('#punctuation-toggle')).not.toBeChecked();
  await expect(page.locator('#numbers-toggle input[value="true"]')).toBeChecked();
  await expect(page.locator('#word-list input:checked')).toHaveValue('5k');
});

test('the palette hides punctuation, numbers and word lists in code mode', async ({ page }) => {
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
  await search('numbers', true);
  await search('word list', true);
  await chooseMore(page, 'mode-code');
  await expect(page.locator('#condition-line')).toContainText('code ·');
  await search('punctuation', false);
  await search('numbers', false);
  await search('word list', false);
});

test('custom text over code mode keeps its own conditions, and code closes the custom editor', async ({ page, supabase }) => {
  const user = supabase.addUser('code-custom@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseMore(page, 'mode-code');
  await expect(page.locator('#condition-line')).toContainText('code ·');

  const text = 'the quick brown fox jumps over the lazy dog';
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mode-code')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#code-options')).toBeHidden();
  await expect(page.locator('#best')).toHaveText('Not counted');
  await typeInto(page, text);
  await expect(page.locator('#result-delta')).toHaveText('Custom text complete · not counted toward your best');

  // The code language underneath never reaches the custom run: its conditions are master's custom shape.
  await expect.poll(() => supabase.profileFor(user.email)?.runs?.length).toBe(1);
  const [run] = supabase.profileFor(user.email).runs;
  expect(run.kind).toBe('custom');
  expect(run.conditions).toMatchObject({ mode: 'custom', punctuation: false, numbers: false, wordList: null });
  expect(run.conditions).not.toHaveProperty('codeLanguage');
  expect(supabase.profileFor(user.email).bests).toEqual({});

  // Choosing code again closes the custom editor and drops the custom mark.
  await page.locator('.nav-item[data-nav="practice"]').click();
  await chooseMore(page, 'mode-custom');
  await expect(page.locator('#custom-options')).toBeVisible();
  await chooseMore(page, 'mode-code');
  await expect(page.locator('#custom-options')).toBeHidden();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mode-code')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#code-options')).toBeVisible();
  await expect(page.locator('#duration-options')).toBeHidden();
  await expect(page.locator('#condition-line')).toContainText('code ·');
  await expect(page.locator('#best')).toHaveText('Code runs aren’t ranked');
});

test('code mode screenshots', async ({ page }, testInfo) => {
  test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
  await page.setViewportSize({ width: 1280, height: 800 });

  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await chooseMore(page, 'mode-code');
    await page.locator('#code-options [data-language="js"]').click();
    await expect(page.locator('#condition-line')).toContainText('code · js');
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    const name = `code-mode-${theme}.png`;
    await page.screenshot({ path: process.env.SCREENSHOTS ? `docs/screenshots/code-mode/${name}` : testInfo.outputPath(name) });
  }
});
