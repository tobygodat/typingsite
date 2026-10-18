import { test, expect, openApp, openView, typeInto, chooseSetting, closeSettings } from './fixtures.js';

test('two players type the same hidden-then-revealed passage', async ({ page }) => {
  await openApp(page);
  // Stop on error is captured when the challenge starts, so a wrong last letter must be fixed.
  await closeSettings(page);
  await chooseSetting(page, 'correction-select', 'mandatory');
  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();

  await page.locator('#player-one-name').fill('Ada');
  await page.locator('#player-two-name').fill('Lin');
  await page.locator('#start-local-race').click();
  await expect(page.locator('#race-stage')).toBeVisible();
  await expect(page.locator('#race-player')).toHaveText('Ada');
  await expect(page.locator('#race-status')).toHaveText('Player 1 of 2');
  await expect(page.locator('#race-input')).toBeFocused();
  const text = await page.locator('#race-accessible-passage').textContent();
  expect(text.length).toBeGreaterThan(100);

  const last = text.at(-1);
  await typeInto(page, text.slice(0, -1) + (last === 'x' ? 'z' : 'x'), '#race-input');
  await expect(page.locator('#race-stage')).toBeVisible();
  await expect(page.locator('#race-progress')).toHaveAttribute('aria-valuenow', '100');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(last);

  // The handoff hides the passage behind a blur until the next player reveals it.
  await expect(page.locator('#race-stage')).toBeHidden();
  await expect(page.locator('#race-handoff')).toBeVisible();
  await expect(page.locator('#handoff-name')).toHaveText('Lin');
  await expect(page.locator('#handoff-veil')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#handoff-veil')).toHaveCSS('filter', /blur\(\d+px\)/);

  await page.locator('#start-next-player').click();
  await expect(page.locator('#race-stage')).toBeVisible();
  await expect(page.locator('#race-player')).toHaveText('Lin');
  await expect(page.locator('#race-accessible-passage')).toHaveText(text);
  await typeInto(page, text, '#race-input');

  await expect(page.locator('#race-leaderboard')).toBeVisible();
  await expect(page.locator('#race-winner')).toHaveText(/^(Ada leads\.|Lin leads\.|It’s a tie\.)$/);
  const rows = page.locator('.race-result-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(/\d+ wpm/);
  await expect(page.locator('#best')).toHaveText('No best yet');
});
