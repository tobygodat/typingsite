import { test, expect, openApp, openView, signInWithEmail, typeInto, setRaceName, inviteByEmail } from './fixtures.js';

test.setTimeout(90000);

// Ada hosts a race (a quote race, which ends with its passage rather than on the clock, unless `setup` picks another
// practice setup first) and invites Lin's account; both ready, and the race is on.
async function pairInRace(page, browser, supabase, setup = () => page.locator('#mode-quote').click()) {
  supabase.addUser('ada@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await setup();
  await openView(page, 'Challenge');
  await setRaceName(page, 'Ada');
  await inviteByEmail(page, 'lin@stilltype.test');
  await expect(page.locator('#online-room')).toBeVisible();
  const context = await browser.newContext();
  const lin = await context.newPage();
  await supabase.attach(lin);
  await openApp(lin);
  await signInWithEmail(lin, 'lin@stilltype.test');
  await openView(lin, 'Challenge');
  await setRaceName(lin, 'Lin');
  await lin.locator('[data-accept-invite]').click();
  await expect(lin.locator('#online-room')).toBeVisible();
  await page.locator('#online-ready').click();
  await lin.locator('#online-ready').click();
  await expect(page.locator('#online-input')).toBeEnabled({ timeout: 12000 });
  await expect(lin.locator('#online-input')).toBeEnabled();

  return { context, lin, passage: await page.locator('#online-accessible-passage').textContent() };
}

// Both type the whole passage, Ada first, so Ada wins.
async function typeBoth(page, lin, passage) {
  await typeInto(page, passage, '#online-input', { delay: 20 });
  await typeInto(lin, passage, '#online-input', { delay: 5 });
  await expect(page.locator('#online-results')).toBeVisible({ timeout: 10000 });
  await expect(lin.locator('#online-results')).toBeVisible({ timeout: 10000 });
}

// A quote race between Ada and Lin, raced to its end.
async function racePair(page, browser, supabase) {
  const { context, lin, passage } = await pairInRace(page, browser, supabase);
  await typeBoth(page, lin, passage);

  return { context, lin, passage };
}

test('under the results, Graph shows both racers\' speed and Replay plays the passage with both carets', async ({ page, browser, supabase }) => {
  const { context, lin, passage } = await racePair(page, browser, supabase);

  try {
    // Graph is the default: one chart, your line in the accent and theirs in the text colour.
    await expect(page.locator('#online-review')).toBeVisible();
    await expect(page.locator('#online-show-graph')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#online-duel-graph')).toBeVisible();
    await expect(page.locator('#online-duel-replay')).toBeHidden();
    const lines = page.locator('#online-duel-graph path.graph-line');
    await expect(lines).toHaveCount(2);
    const colours = await lines.evaluateAll((paths) => paths.map((path) => getComputedStyle(path).stroke));

    const [accent, text] = await page.evaluate(() => ['--accent', '--text'].map((name) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();

      return colour;
    }));

    expect(colours.sort()).toEqual([accent, text].sort());
    await expect(page.locator('#online-duel-graph path.graph-line-theirs')).toHaveCSS('stroke', text);

    // Replay: the passage, your spring caret and their ghost caret, each named, with Play, 1× and Restart.
    await page.locator('#online-show-replay').click();
    await expect(page.locator('#online-show-replay')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#online-duel-graph')).toBeHidden();
    await expect(page.locator('#online-duel-replay')).toBeVisible();
    await expect(page.locator('#online-replay-display .word').first()).toHaveText(passage.split(' ')[0]);
    await expect(page.locator('#online-replay-display .caret .caret-tag')).toHaveText('You');
    await expect(page.locator('#online-replay-display .ghost-caret .caret-tag')).toHaveText('Lin');
    await expect(page.locator('#online-replay-display .ghost-caret')).not.toHaveClass(/is-hidden/);
    await expect(page.locator('#online-replay-toggle')).toHaveText('Pause');
    // It plays in real time: the letters either racer reached turn to the text colour as it goes.
    await expect.poll(() => page.locator('#online-replay-display .char.correct').count()).toBeGreaterThan(0);
    await page.locator('#online-replay-toggle').click();
    await expect(page.locator('#online-replay-toggle')).toHaveText('Play');
    const paused = await page.locator('#online-replay-display .char.correct').count();
    await page.waitForTimeout(500);
    expect(await page.locator('#online-replay-display .char.correct').count()).toBe(paused);
    await page.locator('#online-replay-speed').click();
    await expect(page.locator('#online-replay-speed')).toHaveText('2×');
    await page.locator('#online-replay-restart').click();
    await expect(page.locator('#online-replay-toggle')).toHaveText('Pause');
    // The replay ends on the whole passage, reached by Ada first.
    await expect.poll(() => page.locator('#online-replay-display .char.correct').count(), { timeout: 15000 }).toBe(passage.length);
    await expect(page.locator('#online-replay-toggle')).toHaveText('Play');

    // Lin sees the same race from the other side: Lin's caret is the named "You".
    await expect(lin.locator('#online-review')).toBeVisible();
    await lin.locator('#online-show-replay').click();
    await expect(lin.locator('#online-replay-display .ghost-caret .caret-tag')).toHaveText('Ada');
    await page.locator('#online-show-graph').click();
    await expect(page.locator('#online-duel-graph path.graph-line')).toHaveCount(2);
  } finally { await context.close(); }
});

test('reduced motion opens the replay on its last frame, still, with Play left to the person', async ({ page, browser, supabase }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { context, passage } = await racePair(page, browser, supabase);

  try {
    await page.locator('#online-show-replay').click();
    await expect(page.locator('#online-replay-toggle')).toHaveText('Play');
    await expect(page.locator('#online-replay-display .char.correct')).toHaveCount(passage.length);
  } finally { await context.close(); }
});

test('a race without both traces, such as one from before them, shows no Graph or Replay', async ({ page, browser, supabase }) => {
  supabase.races.dropTraces = true;
  const { context, lin } = await racePair(page, browser, supabase);

  try {
    await expect(page.locator('#online-duel-mine')).toHaveAttribute('data-outcome', 'won');
    await page.waitForTimeout(1500);
    await expect(page.locator('#online-review')).toBeHidden();
    await expect(lin.locator('#online-review')).toBeHidden();
  } finally { await context.close(); }
});

// A timed race between Ada and Lin, each with the passage's first 20 keys on the service.
async function twentyKeysEach(page, browser, supabase) {
  const race = await pairInRace(page, browser, supabase, async () => {
    await page.locator('#mode-time').click();
    await page.locator('#duration-options [data-length="15"]').click();
  });

  const room = [...supabase.races.rooms.values()].at(-1);
  await typeInto(page, race.passage.slice(0, 20), '#online-input', { delay: 20 });
  await typeInto(race.lin, race.passage.slice(0, 20), '#online-input', { delay: 20 });
  // Both racers' 20 keys have reached the service, so the next progress Ada's tab sends is for a key typed after this.
  await expect.poll(() => room.players.map((player) => player.typed.length)).toEqual([20, 20]);

  return { ...race, room, clockOut: Date.parse(room.startAt) + room.duration * 1000 };
}

const isProgress = (request) => request.url().includes('/rpc/race_action') && request.postDataJSON()?.p_action === 'progress';

// On a slow link a racer's last progress can reach the service after its clock. The service finishes the racer on the
// keys that progress carried, and it carries no trace, so neither racer had Graph or Replay. The racer's tab now sends
// the trace of exactly those keys, which the service keeps.
test('progress that reaches the service after a timed race’s clock still leaves both traces, so Graph and Replay show', async ({ page, browser, supabase }) => {
  const { context, lin, passage, room, clockOut } = await twentyKeysEach(page, browser, supabase);

  try {
    // Ada's 21st key goes in a few seconds before the clock, and its progress waits on its way to the service until
    // the service's clock has run out: short enough that her tab's request is still waiting for its answer.
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    await page.route('**/rest/v1/rpc/race_action', async (route) => {
      if (isProgress(route.request())) await gate;
      await route.fallback();
    });
    await expect.poll(() => Date.now() > clockOut - 3000, { timeout: 20000 }).toBe(true);
    const held = page.waitForRequest(isProgress);
    await page.keyboard.type(passage[20]);
    expect((await held).postDataJSON().p_data).toMatchObject({ typed: passage.slice(0, 21), finished: false });
    await expect.poll(() => Date.now() > clockOut + 500, { timeout: 10000 }).toBe(true);
    open();

    await expect(page.locator('#online-results')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#online-review')).toBeVisible({ timeout: 10000 });
    await expect(lin.locator('#online-review')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#online-duel-graph path.graph-line')).toHaveCount(2);
    expect(room.players.map((player) => player.trace?.k.length)).toEqual([21, 20]);
  } finally { await context.close(); }
});

// The same late progress, but this time Ada's tab never hears the answer: the service applied it, finishing her on its
// keys, and her request failed (as one does after 15 s, or when the connection drops). The tab then sends its own
// finish with every key it holds, more than the service settled on, so the service can't keep that trace. It still
// sends the trace of the keys the service settled on: after its next sends fail too, and again when that send is lost.
for (const { name, failing = 0, dropTrace = false } of [
  { name: 'its answer never arrives' },
  { name: 'its answer never arrives and the next four sends fail', failing: 4 },
  { name: 'its answer never arrives and the first trace sent for it is lost', dropTrace: true },
]) {
  test(`when the service finishes a racer on progress whose ${name.slice(4)}, the tab still sends the trace of those keys`, async ({ page, browser, supabase }) => {
    const { context, lin, passage, room, clockOut } = await twentyKeysEach(page, browser, supabase);
    const ada = supabase.users.get('ada@stilltype.test').id;

    try {
      let open;
      const gate = new Promise((resolve) => { open = resolve; });
      let lost = 1;
      let failed = failing;
      let dropped = dropTrace ? 1 : 0;
      const sent = [];
      await page.route('**/rest/v1/rpc/race_action', async (route) => {
        if (!isProgress(route.request())) return route.fallback();
        const body = route.request().postDataJSON();
        sent.push([body.p_data.typed.length, body.p_data.trace?.k.length ?? null]);

        if (lost) {
          lost = 0;
          await gate;
          // The service takes the progress; the answer never reaches the tab.
          await supabase.races.handle(ada, body, () => {});

          return route.abort('failed');
        }

        if (failed) {
          failed -= 1;

          return route.abort('failed');
        }

        // The trace for the keys the service settled on, lost on its way once.
        if (dropped && body.p_data.trace?.k.length === 21) {
          dropped = 0;

          return route.abort('failed');
        }

        return route.fallback();
      });
      await expect.poll(() => Date.now() > clockOut - 3000, { timeout: 20000 }).toBe(true);
      const held = page.waitForRequest(isProgress);
      await page.keyboard.type(passage[20]);
      await held;
      // A 22nd key, typed while that request waits, goes into the tab's own finish but not into what the service settles.
      await page.keyboard.type(passage[21]);
      await expect.poll(() => Date.now() > clockOut + 500, { timeout: 10000 }).toBe(true);
      open();

      await expect(page.locator('#online-results')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#online-review')).toBeVisible({ timeout: 10000 });
      await expect(lin.locator('#online-review')).toBeVisible({ timeout: 10000 });
      expect(room.players.map((player) => [player.typed.length, player.trace?.k.length])).toEqual([[21, 21], [20, 20]]);
      // The tab's own finish (all 22 keys) went first, as many times as it failed and once more, then the settled trace.
      expect(sent.slice(1, 2 + failing)).toEqual(Array(1 + failing).fill([22, 22]));
      expect(sent.filter(([, keys]) => keys === 21)).toHaveLength(dropTrace ? 2 : 1);
    } finally { await context.close(); }
  });
}

// A rematch's join reply that lands late carries the service's time from when it answered, so a tab that took that
// time as now ran its race clock seconds behind the service's: it counted down while the other racer typed, and the
// service finished it before its own clock ran out. Each later reply bounds the start again, and the earliest counts.
test('a rematch joined late races on the service’s clock, and both results still show Graph and Replay', async ({ page, browser, supabase }) => {
  const { context, lin } = await racePair(page, browser, supabase);

  try {
    await expect(page.locator('#online-review')).toBeVisible();
    await lin.locator('#online-rematch').click();
    await expect(page.locator('#online-their-rematch')).toHaveAttribute('data-state', 'chosen');

    // Ada picks second, so her tab joins the rematch at once; the service answers that join only after the
    // rematch's countdown, which Lin's tab, joining on time, sees end.
    const release = supabase.races.hold('join', supabase.users.get('ada@stilltype.test').id);
    await page.locator('#online-rematch').click();
    await expect(lin.locator('#online-input')).toBeEnabled({ timeout: 12000 });
    release();

    await expect(page.locator('#online-input')).toBeEnabled({ timeout: 10000 });
    const left = async (racer) => Number((await racer.locator('#online-timer').textContent()).match(/\d+/)[0]);
    const [ada, theirs] = await Promise.all([left(page), left(lin)]);
    expect(Math.abs(ada - theirs)).toBeLessThanOrEqual(1);

    const passage = await page.locator('#online-accessible-passage').textContent();
    await typeBoth(page, lin, passage);
    await expect(page.locator('#online-review')).toBeVisible({ timeout: 10000 });
    await expect(lin.locator('#online-review')).toBeVisible({ timeout: 10000 });
  } finally { await context.close(); }
});
