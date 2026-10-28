// The command palette's rows line up: the highlight sits on the selected row, with the label, bullet and
// hint centred in it, and the search row shares the list's columns. The bug: the highlight was measured
// from the list but positioned from the scroll box, so it sat one padding above every row, and the label
// looked low inside it.
import { test, expect, openApp, signInWithEmail } from './fixtures.js';

test.use({ reducedMotion: 'reduce' });

function measure() {
  const rect = (el) => el.getBoundingClientRect();
  const middle = (r) => r.top + r.height / 2;
  const highlight = rect(document.querySelector('.palette-highlight'));
  const row = document.querySelector('#palette-list [aria-selected="true"]');
  const hint = row.querySelector('.opt-hint');
  return {
    name: row.querySelector('.opt-text').textContent,
    top: highlight.top - rect(row).top,
    label: middle(rect(row.querySelector('.opt-text'))) - middle(highlight),
    mark: middle(rect(row.querySelector('.opt-mark'))) - middle(highlight),
    hint: hint ? middle(rect(hint)) - middle(highlight) : 0,
  };
}

function columns() {
  // The ring's geometric edge (stroke centre), the same in every engine: Firefox's client rect includes the stroke.
  const circleLeft = () => {
    const svg = document.querySelector('.palette-search svg');
    return svg.getBoundingClientRect().left + svg.querySelector('circle').getBBox().x * (svg.getBoundingClientRect().width / svg.viewBox.baseVal.width);
  };
  const rect = (el) => el.getBoundingClientRect();
  const textLeft = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().left;
  };
  const all = (selector, edge) => [...document.querySelectorAll(selector)].map(edge);
  return {
    marks: [circleLeft(), ...all('.palette-group', (heading) => textLeft(heading)), ...all('.opt-mark', (mark) => rect(mark).left)],
    text: [rect(document.querySelector('#palette-input')).left, ...all('.opt-text', (text) => rect(text).left)],
    ends: [rect(document.querySelector('.palette-search kbd')).right, ...all('.opt-hint', (hint) => rect(hint).right)],
    groups: all('.palette-group', (heading) => heading.textContent),
  };
}

const spread = (values) => Math.max(...values) - Math.min(...values);

test('every selected row is centred in its highlight, and the palette keeps one grid', async ({ page, supabase }) => {
  supabase.addUser('ada@example.com');
  await openApp(page);
  await signInWithEmail(page, 'ada@example.com');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-input')).toBeFocused();

  const grid = await page.evaluate(columns);
  expect(spread(grid.marks), `search icon, headings and bullets share a left edge: ${grid.marks}`).toBeLessThanOrEqual(1);
  expect(spread(grid.text), `search text and labels share a left edge: ${grid.text}`).toBeLessThanOrEqual(1);
  expect(spread(grid.ends), `hints end where the esc key does: ${grid.ends}`).toBeLessThanOrEqual(1);
  expect(grid.groups).toEqual([...new Set(grid.groups)]);

  const count = await page.locator('#palette-list [role="option"]').count();
  for (let index = 0; index < count; index += 1) {
    if (index) await page.keyboard.press('ArrowDown');
    await expect(page.locator(`#palette-option-${index}`)).toHaveAttribute('aria-selected', 'true');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const row = await page.evaluate(measure);
    for (const part of ['top', 'label', 'mark', 'hint']) {
      expect(Math.abs(row[part]), `${part} of "${row.name}" (row ${index})`).toBeLessThanOrEqual(1);
    }
  }
});
