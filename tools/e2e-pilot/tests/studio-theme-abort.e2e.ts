import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { setUp, tearDown, openApp, signInWithEmail } from './helpers.ts';

// Port of e2e/studio-chrome.spec.js "leaving a theme being generated (…) aborts its request and shows no error" (TOB-533).
// Not the same assertion: Playwright waits for the network's requestfailed event, which e2e.com doesn't expose. This
// watches the page's own fetch of the request instead and waits for it to reject.

for (const leave of ['edit', 'escape']) {
  test(`leaving a theme being generated (${leave}) aborts its request and shows no error`, async ({ browser }) => {
    const supabase = await setUp(browser);
    await browser.addInitScript(() => {
      const send = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const request = send(input, init);

        if (String(input instanceof Request ? input.url : input).includes('/functions/v1/generate-theme')) {
          request.catch((error) => { window.themeFailure = `${error.name}: ${error.message}`; });
        }

        return request;
      };
    });
    const user = supabase.addUser('ranked@stilltype.test');
    supabase.races.quick.ratings.set(user.id, { rating: 1920, races: 18 });
    await openApp(browser);
    await signInWithEmail(browser, 'ranked@stilltype.test');
    await expect(browser.locator('#rank-pill')).toBeVisible();

    let held = 0;
    let release = () => {};
    const released = new Promise<void>((resolve) => { release = resolve; });
    await browser.route('**/functions/v1/generate-theme', async (route) => {
      held += 1;
      await released;
      await route.abort().catch(() => {});
    });

    await browser.keyboard.press('Control+k');
    await browser.locator('#palette-input').fill('vibe warm kyoto matcha');
    await browser.keyboard.press('Enter');
    await expect(browser.locator('#palette-theme')).toHaveAttribute('data-status', 'generating');
    await expect.poll(() => held).toBe(1);

    if (leave === 'edit') await browser.locator('#palette-input').fill('vibe cold harbour');
    else await browser.keyboard.press('Escape');

    // Well inside the request's own 15-second timeout, which would fail it anyway.
    const outcome = await browser.evaluate(() => new Promise<string>((resolve) => {
      const until = Date.now() + 2000;

      const look = () => {
        const failure = window.themeFailure;

        if (failure) resolve(failure);
        else if (Date.now() > until) resolve('still open');
        else setTimeout(look, 10);
      };

      look();
    }));

    release();
    expect(outcome).not.toBe('still open');
    expect(outcome).toBeTruthy();
    await expect(browser.locator('#palette-theme')).toHaveAttribute('data-status', 'idle');
    await expect.poll(() => browser.evaluate(() => document.querySelector<HTMLDialogElement>('#palette')!.open)).toBe(true);
    await tearDown(browser, supabase);
  });
}
