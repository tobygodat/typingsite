// Practice's readout cells and the run card's notes (TOB-470): the average a run is set against, the words
// missed and typed, and the trace's range.
import { test, expect, openApp, passageText, typeInto, chooseWords, chooseSetting } from './fixtures.js';

const number = (text) => Number(text.replace('−', '-').replaceAll(/[^\d.-]/g, ''));

// A 10-word run at a person's pace, with one letter missed and fixed when asked. Ten words can be under 40
// characters, so 90 ms a key keeps every run past the 3 s that consistency and the range need.
async function run(page, { miss = false } = {}) {
  const text = await passageText(page);
  const at = text.indexOf(' ') + 1;

  if (miss) {
    await typeInto(page, text.slice(0, at) + (text[at] === 'x' ? 'z' : 'x'), '#typing-input', { delay: 90 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text.slice(at), { delay: 90 });
  } else await typeInto(page, text, '#typing-input', { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
}

test('the readouts and the card agree on the average, measured before the run just finished', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const cells = page.locator('#live-stats > .cell');
  await expect(cells.locator('.cell-label')).toHaveText(['words', 'wpm', 'accuracy', 'avg · best']);
  await expect(page.locator('#live-standing .cell-figure')).toHaveText('—');

  await run(page);
  const first = number(await page.locator('#result-wpm').textContent());
  // A first run has nothing to compare with.
  await expect(page.locator('#result-versus')).toHaveCount(0);

  await page.locator('#run-again').click();
  await expect(page.locator('#live-standing .cell-figure')).toHaveText(`${Math.round(first)} · ${Math.round(first)}`);

  await run(page, { miss: true });
  const second = number(await page.locator('#result-wpm').textContent());
  const versus = await page.locator('#result-versus').textContent();
  expect(versus).toMatch(/^[+−]?\d+(\.\d)? vs avg \d+$/);
  // Against the first run alone, not an average that already holds this one.
  expect(number(versus.split(' vs avg ')[1])).toBe(Math.round(first));
  expect(number(versus.split(' vs avg ')[0])).toBeCloseTo(second - Math.round(first), 1);
  await expect(page.locator('#result-versus .is-up, #result-versus .is-down')).toHaveClass(second >= Math.round(first) ? 'is-up' : 'is-down');

  // Back on Practice, the readout's average holds this run too.
  const average = Math.round((first + second) / 2);
  await page.locator('#run-again').click();
  await expect(page.locator('#live-standing .cell-figure')).toHaveText(`${average} · ${Math.round(Math.max(first, second))}`);
});

test('the card notes the words missed, the words typed and the trace\'s range', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await run(page, { miss: true });

  const missed = await page.locator('#result-words .word-miss').count();
  expect(missed).toBe(1);
  await expect(page.locator('#result-accuracy-fact .cell-note')).toHaveText(`${missed} missed`);
  await expect(page.locator('#result-time').locator('xpath=..').locator('.cell-note')).toHaveText(`${await page.locator('#result-words [role="option"]').count()} words`);
  await expect(page.locator('#result-range')).toHaveText(/^\d+–\d+ wpm$/);
  const [low, high] = (await page.locator('#result-range').textContent()).match(/\d+/g).map(Number);
  expect(low).toBeLessThanOrEqual(high);
});

test('a run under three seconds has no range, as it has no consistency', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-consistency')).toHaveText('—');
  await expect(page.locator('#result-range')).toHaveCount(0);
});

test('with live metrics off, wpm and accuracy keep their cells and show no live number', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 25);
  const wpmCell = page.locator('#live-stats .live-stat').nth(1);
  const before = await wpmCell.boundingBox();
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 30), '#typing-input', { delay: 60 });
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await expect(page.locator('#live-wpm')).toBeHidden();
  await expect(page.locator('#live-accuracy')).toBeHidden();
  expect(await wpmCell.evaluate((cell) => getComputedStyle(cell.querySelector('.cell-value'), '::before').content)).toBe('"—"');
  expect(await wpmCell.boundingBox()).toEqual(before);

  await page.keyboard.press('Escape');
  await chooseSetting(page, 'live-toggle', 'true');
  await typeInto(page, (await passageText(page)).slice(0, 30), '#typing-input', { delay: 60 });
  await expect(page.locator('#live-wpm')).toHaveText(/^\d+$/);
  await expect(page.locator('#live-accuracy')).toHaveText(/^\d+$/);
});
