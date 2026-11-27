import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { setUp, tearDown, openApp, signInWithEmail, openView, setRaceName, openRaceLink } from './helpers.ts';

// Port of e2e/social.spec.js "a friend change waiting behind a slow friend-list read holds up only the friend controls" (TOB-195).

test('a friend change waiting behind a slow friend-list read holds up only the friend controls', async ({ browser, screen }) => {
  const supabase = await setUp(browser);
  const host = supabase.addUser('host@stilltype.test');
  await new Promise((resolve) => { supabase.races.handle(host.id, { p_action: 'befriend', p_data: { email: 'kim@stilltype.test' } }, resolve); });
  await openApp(browser);
  await signInWithEmail(browser, 'host@stilltype.test');
  await openView(browser, 'Challenge');
  await expect(browser.locator('.people-row').filter({ hasText: 'kim@stilltype.test' })).toBeVisible();
  // Coming back to Challenge reads the list again, and that read doesn't answer.
  const releaseRead = supabase.races.hold('friends');
  await openView(browser, 'Practice');
  await openView(browser, 'Challenge');
  await expect.poll(() => supabase.races.holds.has('friends')).toBe(false);
  await browser.locator('#people-add').click();
  const remove = screen.getByRole('button', { name: 'Remove kim from friends' });
  await remove.click();
  await expect(remove).toHaveAttribute('aria-disabled', 'true');
  // The removal waits its turn, and races don't wait for it.
  await expect(browser.locator('#create-online-race')).not.toHaveAttribute('aria-disabled');
  await browser.locator('#people-add-view [data-challenge-back]').click();
  await expect(screen.getByRole('button', { name: 'Race kim', exact: true })).not.toHaveAttribute('aria-disabled');
  await setRaceName(browser, 'Ada');
  await openRaceLink(browser);
  await expect(browser.locator('#online-room')).toBeVisible();
  expect(supabase.races.friendList(host.id)).toHaveLength(1);
  releaseRead();
  await expect.poll(() => supabase.races.friendList(host.id)).toEqual([]);
  await tearDown(browser, supabase);
});
