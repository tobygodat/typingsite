// How quick matches settle, each case between two fresh accounts with both racers' results saved
// (QUICK_MATCH_OTHER names the folder; each shot is <case>.<racer>.png): a normal rated race, a pasted run
// against an honest one, a forfeit right after the start where the racer who stays finishes alone and wins, the
// same where the stayer leaves too, a fourth race between the same pair in a day, and a passage typed to its end
// before the clock. QUICK_MATCH_CASES picks some (comma separated); QUICK_MATCH_SECONDS sets the race clock of
// every case but the last, which races the standard 30 seconds.
import path from 'node:path';

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export default async ({ page, shot, note, check, fake, url }) => {
  const cases = (process.env.QUICK_MATCH_CASES || 'rated,paster,forfeit,both-leave,repeat,to-the-end').split(',');
  const seconds = Number(process.env.QUICK_MATCH_SECONDS || 6);
  const browser = page.context().browser();
  const colorScheme = await page.evaluate(() => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  const viewport = page.viewportSize();
  const mobile = viewport.width < 600;
  let n = 0;
  await shot('start');

  async function racer(name) {
    n += 1;
    const email = `${name.toLowerCase()}${n}@stilltype.test`;
    fake.addUser(email);
    const context = await browser.newContext({ baseURL: url, viewport, colorScheme, serviceWorkers: 'block', ...(mobile && { isMobile: true, hasTouch: true }) });
    const other = await context.newPage();
    await fake.attach(other);
    await other.goto('/');
    await other.locator('#text-display .char').first().waitFor();
    await other.locator('#account-trigger').click();
    await other.locator('#account-signin').click();
    await other.locator('#account-email-input').fill(email);
    await other.locator('#account-password').fill('correct horse battery');
    await Promise.all([other.waitForEvent('load'), other.locator('#account-submit').click()]);
    await other.locator('#account[data-state="member"]').waitFor();
    await other.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Challenge' }).click();
    await other.locator('#online-name').fill(name);

    return { name, context, page: other };
  }

  const save = async (label, ...racers) => {
    for (const r of racers) {
      if (process.env.QUICK_MATCH_OTHER) await r.page.screenshot({ path: path.join(process.env.QUICK_MATCH_OTHER, `${label}.${r.name.toLowerCase()}.png`), fullPage: true });
    }
  };

  async function match(a, b) {
    await a.page.locator('#quick-match [data-quick="toggle"]').click();
    await b.page.locator('#quick-match [data-quick="toggle"]').click();
    await a.page.locator('#online-input:enabled').waitFor({ timeout: 15000 });
    await b.page.locator('#online-input:enabled').waitFor({ timeout: 15000 });

    return a.page.locator('#online-accessible-passage').textContent();
  }

  async function typeUntilClosed(r, text, delay) {
    const input = r.page.locator('#online-input');
    await input.focus();

    for (const char of text) {
      if (await input.isDisabled()) return;
      await r.page.keyboard.type(char);
      await pause(delay);
    }
  }

  async function read(r) {
    await r.page.locator('#online-rating-change:not([hidden])').waitFor({ timeout: 45000 });
    const result = {
      line: (await r.page.locator('#online-rating-change').textContent()).replaceAll(' ', ' '),
      mine: await r.page.locator('#online-duel-mine').getAttribute('data-outcome'),
      theirs: await r.page.locator('#online-duel-theirs').getAttribute('data-outcome'),
      tally: await r.page.locator('#online-tally').getAttribute('aria-label'),
    };
    note(`${r.name}`, JSON.stringify(result));

    return result;
  }

  const quickStatus = async (r) => (await r.page.locator('#quick-match [data-quick-part="status"]').textContent()).replaceAll(' ', ' ');
  const run = { rated, paster, forfeit, 'both-leave': bothLeave, repeat, 'to-the-end': toTheEnd };

  for (const name of cases) {
    fake.races.quick.duration = name === 'to-the-end' ? 30 : seconds;
    fake.races.quick.countdownMs = 2000;
    const toby = await racer('Toby');
    const mara = await racer('Mara');

    try {
      await run[name](toby, mara);
    } finally {
      await toby.context.close();
      await mara.context.close();
    }
  }

  async function rated(toby, mara) {
    const passage = await match(toby, mara);
    await Promise.all([typeUntilClosed(toby, passage, 110), typeUntilClosed(mara, passage, 170)]);
    const [t, m] = [await read(toby), await read(mara)];
    check(t.line.startsWith('Rated win.') && t.mine === 'won' && t.tally === 'You 1, Mara 0', 'rated: Toby wins in the cards, the tally and the rating');
    check(m.line.startsWith('Rated loss.') && m.theirs === 'won' && m.tally === 'You 0, Toby 1', 'rated: Mara sees the same winner');
    await save('rated', toby, mara);
  }

  async function paster(toby, mara) {
    const passage = await match(toby, mara);
    await toby.page.locator('#online-input').focus();
    await Promise.all([toby.page.keyboard.type(passage.slice(0, 150)), typeUntilClosed(mara, passage.slice(0, 60), 100)]);
    const [t, m] = [await read(toby), await read(mara)];
    check(t.mine === 'unchecked' && t.theirs === 'won' && t.tally === 'You 0, Mara 1' && t.line.startsWith('Rated loss: your run couldn’t be checked.'), 'paster: Toby\'s pasted run is unchecked and Mara won');
    check(m.mine === 'won' && m.theirs === 'unchecked' && m.tally === 'You 1, Toby 0' && m.line.startsWith('Rated win: Toby’s run couldn’t be checked.'), 'paster: Mara sees the same winner');
    await save('paster', toby, mara);
  }

  async function forfeit(toby, mara) {
    const passage = await match(toby, mara);
    await mara.page.locator('#online-leave').click();
    await toby.page.locator('#online-room-status', { hasText: 'Mara left the race. Finish your run to win.' }).waitFor();
    await save('forfeit-racing', toby);
    await typeUntilClosed(toby, passage, 120);
    const t = await read(toby);
    const left = await quickStatus(mara);
    note('Mara after leaving', left);
    check(t.mine === 'won' && t.theirs === 'unchecked' && t.tally === 'You 1, Mara 0' && t.line.startsWith('Rated win: Mara left the race.'), 'forfeit: Toby finishes alone and wins, rated');
    check(left.startsWith('Rated loss: you left the race.'), 'forfeit: Mara\'s leaving is a rated loss');
    await save('forfeit', toby, mara);
  }

  async function bothLeave(toby, mara) {
    await match(toby, mara);
    await mara.page.locator('#online-leave').click();
    await toby.page.locator('#online-room-status', { hasText: 'Mara left the race.' }).waitFor();
    await toby.page.locator('#online-leave').click();
    await toby.page.locator('#quick-match [data-quick-part="status"]', { hasText: 'Not rated' }).waitFor();
    const [t, m] = [await quickStatus(toby), await quickStatus(mara)];
    note('Toby', t);
    note('Mara', m);
    check(t === 'Not rated: neither racer finished with a run that could be checked. You left the race.', 'both leave: Toby, who stayed and then left, is unrated and told so');
    check(m.startsWith('Rated loss: you left the race.'), 'both leave: Mara still takes the rated loss for leaving first');
    check((await toby.page.locator('#quick-match [data-quick-part="rating"]').textContent()).replaceAll(' ', ' ') === 'Race rating 1500 · 0 rated races · provisional', 'both leave: Toby\'s rating is unmoved');
    await save('both-leave', toby, mara);
  }

  async function repeat(toby, mara) {
    for (let race = 1; race <= 4; race += 1) {
      const passage = await match(toby, mara);
      // They take turns winning, so their ratings stay within the pairing gap.
      const [fast, slow] = race % 2 ? [toby, mara] : [mara, toby];
      await Promise.all([typeUntilClosed(fast, passage, 110), typeUntilClosed(slow, passage, 170)]);
      const [t, m] = [await read(toby), await read(mara)];

      if (race < 4) check(t.line.startsWith('Rated') && m.line.startsWith('Rated'), `repeat: race ${race} is rated`);
      else {
        check(t.line === 'Not rated: you and Mara have raced each other too often today.' && t.mine === 'lost' && t.tally === 'You 2, Mara 2', 'repeat: the fourth race shows its result and tells Toby it didn\'t count');
        check(m.line === 'Not rated: you and Toby have raced each other too often today.' && m.mine === 'won', 'repeat: and tells Mara');
        await save('repeat-fourth', toby, mara);
      }

      for (const r of [toby, mara]) await r.page.locator('#online-leave').click();
    }
  }

  async function toTheEnd(toby, mara) {
    const passage = await match(toby, mara);
    note('passage length', String(passage.length));
    // Toby types the whole passage at 25 ms a key, about 480 wpm, so it ends before the 30-second clock; Mara types
    // honestly to the clock.
    const started = Date.now();
    const honest = typeUntilClosed(mara, passage, 170);
    await toby.page.locator('#online-input').focus();
    await toby.page.keyboard.type(passage, { delay: 25 });
    note('Toby finished after', `${Date.now() - started} ms`);
    note('Toby on finishing', await toby.page.locator('#online-help').textContent());
    await save('to-the-end-complete', toby);
    await honest;
    const [t, m] = [await read(toby), await read(mara)];
    check(t.mine === 'unchecked' && m.mine === 'won' && t.line.startsWith('Rated loss: your run couldn’t be checked.'), 'to the end: a passage finished before the clock is over the cap, so it is not checked, and the honest run wins');
    await save('to-the-end', toby, mara);
  }
};
