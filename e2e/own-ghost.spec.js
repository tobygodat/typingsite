// Racing your own best run (quick match with nobody waiting): it goes to nobody, so a run that can't be scored
// against it says it isn't compared, never that it wasn't sent.
import { test, expect, openApp, openView, signInWithEmail, typeInto, insertPlainText } from './fixtures.js';

test.setTimeout(120000);

// A 30-second run on the default setup, recorded on this device, then quick match with nobody waiting and
// Race your best run.
async function raceOwnBest(page, supabase) {
  supabase.addUser('ada@stilltype.test');
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  const passage = await page.locator('#accessible-passage').textContent();
  await typeInto(page, passage.slice(0, 120), '#typing-input', { delay: 60 });
  await page.clock.fastForward(31000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await openView(page, 'Challenge');
  await page.locator('#quick-match [data-quick="toggle"]').click();
  await expect.poll(() => supabase.requests.filter((entry) => entry.includes('quick_match')).length).toBeGreaterThan(3);
  await page.clock.fastForward(21000);
  await page.locator('#quick-match [data-quick="best"]').click();
  await expect(page.locator('#session-title')).toHaveText('Race your best run');

  return page.locator('#accessible-passage').textContent();
}

test('a touch run against your own best says it is not compared, and how to compare', async ({ page, supabase }) => {
  const text = await raceOwnBest(page, supabase);
  await page.locator('#typing-input').dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(page.locator('#condition-line')).toContainText('touch input');
  await page.keyboard.type(text.slice(0, 40), { delay: 60 });
  await page.clock.fastForward(31000);
  await expect(page.locator('#ghost-result-heading')).toHaveText('A different kind of input, so not compared.');
  await expect(page.locator('#ghost-result-status')).toHaveText('Race again on a physical keyboard to compare.');
  await expect(page.locator('#ghost-result-action')).toHaveText('Race again');
});

test('a character a ghost race can’t replay, against your own best, is not compared', async ({ page, supabase }) => {
  const text = await raceOwnBest(page, supabase);
  await typeInto(page, text.slice(0, 10), '#typing-input', { delay: 60 });
  await insertPlainText(page, '😀');
  await page.keyboard.type(text.slice(10, 30), { delay: 60 });
  await page.clock.fastForward(31000);
  await expect(page.locator('#ghost-result-heading')).toHaveText('A character a ghost race can’t replay, so not compared.');
  await expect(page.locator('#ghost-result-status')).toHaveText('Race again without emoji.');
});

test('a run with more keys than a ghost race replays, against your own best, is too long to replay', async ({ page, supabase }) => {
  test.setTimeout(240000);
  await raceOwnBest(page, supabase);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator('#typing-input').focus();

  // 6002 keys, past the 6000 a trace holds, all within the 30-second clock.
  for (let index = 0; index < 3001; index += 1) {
    await page.keyboard.press('x');
    await page.keyboard.press('Backspace');
  }

  await page.clock.runFor(31000);
  await expect(page.locator('#ghost-result-heading')).toHaveText('Too long to replay.');
  await expect(page.locator('#ghost-result-status')).toHaveText('Race again with fewer corrections.');
});
