// Quick match on a slow link: the faster racer's race requests each arrive late by a set delay, so its last
// progress lands after the race clock and its finish, with the keystroke record, lands after that. Each run
// pairs two fresh accounts and types until the clock closes the input. Both runs must be checked and the faster
// racer must win, rated. QUICK_MATCH_LATENCIES (ms, comma separated, default 0,50,100,200,300,600), QUICK_MATCH_RUNS
// (default 3) and QUICK_MATCH_SECONDS (the race clock, default 6) set the sweep; QUICK_MATCH_OTHER names a folder
// for both racers' results on the last run at each delay.
import path from 'node:path';

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function racer(browser, url, fake, email, name, viewport, colorScheme) {
  const context = await browser.newContext({ baseURL: url, viewport, colorScheme, serviceWorkers: 'block' });
  const page = await context.newPage();
  await fake.attach(page);
  await page.goto('/');
  await page.locator('#text-display .char').first().waitFor();
  await page.locator('#account-trigger').click();
  await page.locator('#account-signin').click();
  await page.locator('#account-email-input').fill(email);
  await page.locator('#account-password').fill('correct horse battery');
  await Promise.all([page.waitForEvent('load'), page.locator('#account-submit').click()]);
  await page.locator('#account[data-state="member"]').waitFor();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Challenge' }).click();
  await page.locator('#people-setup').click();
  await page.locator('#online-name').fill(name);
  await page.locator('#online-setup-done').click();

  return { context, page };
}

// Types the passage a key at a time until the race clock closes the input.
async function typeUntilClosed(page, text, delay) {
  const input = page.locator('#online-input');

  for (const char of text) {
    if (await input.isDisabled()) return;
    await page.keyboard.type(char);
    await pause(delay);
  }
}

export default async ({ page, shot, note, check, fake, url }) => {
  await shot('start');
  const latencies = (process.env.QUICK_MATCH_LATENCIES || '0,50,100,200,300,600').split(',').map(Number);
  const runs = Number(process.env.QUICK_MATCH_RUNS || 3);
  fake.races.quick.duration = Number(process.env.QUICK_MATCH_SECONDS || 6);
  fake.races.quick.countdownMs = 2000;
  const browser = page.context().browser();
  const colorScheme = await page.evaluate(() => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  const viewport = page.viewportSize();
  const table = [];
  let n = 0;

  for (const latency of latencies) {
    for (let run = 1; run <= runs; run += 1) {
      n += 1;
      const fast = `fast${n}@stilltype.test`;
      const slow = `slow${n}@stilltype.test`;
      fake.addUser(fast);
      fake.addUser(slow);
      const a = await racer(browser, url, fake, fast, 'Toby', viewport, colorScheme);
      const b = await racer(browser, url, fake, slow, 'Mara', viewport, colorScheme);

      try {
        // Only the faster racer's race requests are slow to arrive; the reply comes straight back.
        await a.page.route('**/rest/v1/rpc/race_action', async (route) => { await pause(latency); await route.fallback(); });
        await a.page.locator('#quick-match [data-quick="toggle"]').click();
        await b.page.locator('#quick-match [data-quick="toggle"]').click();
        await a.page.locator('#online-input:enabled').waitFor({ timeout: 15000 });
        await b.page.locator('#online-input:enabled').waitFor({ timeout: 15000 });
        const passage = await a.page.locator('#online-accessible-passage').textContent();
        await Promise.all([typeUntilClosed(a.page, passage, 110), typeUntilClosed(b.page, passage, 170)]);
        await a.page.locator('#online-rating-change:not([hidden])').waitFor({ timeout: 30000 });
        await b.page.locator('#online-rating-change:not([hidden])').waitFor({ timeout: 10000 });
        const line = await a.page.locator('#online-rating-change').textContent();
        const other = await b.page.locator('#online-rating-change').textContent();
        const room = [...fake.races.rooms.values()].filter((r) => r.quick).at(-1);
        const [verdict, slower] = ['Toby', 'Mara'].map((name) => room.players.find((p) => p.name === name).verdict);
        const mine = await a.page.locator('#online-duel-mine').getAttribute('data-outcome');
        const pass = verdict === 'ok' && slower === 'ok' && line.startsWith('Rated win.') && other.startsWith('Rated loss.') && mine === 'won';
        table.push({ latency, run, verdict, slower, mine, pass });
        note(`${latency} ms run ${run}`, `verdicts ${verdict}/${slower}; Toby: ${line} | Mara: ${other} | Toby's card ${mine}`);

        if (process.env.QUICK_MATCH_OTHER && run === runs) {
          await a.page.screenshot({ path: path.join(process.env.QUICK_MATCH_OTHER, `toby.latency-${latency}ms.png`) });
          await b.page.screenshot({ path: path.join(process.env.QUICK_MATCH_OTHER, `mara.latency-${latency}ms.png`) });
        }
      } finally {
        await a.context.close();
        await b.context.close();
      }
    }
  }

  note('sweep', JSON.stringify(table));
  check(table.every((row) => row.pass), 'at every delay both honest runs are checked and the faster racer wins, rated');
};
