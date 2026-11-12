import { test, expect, openApp, openView, signInWithEmail, typeInto, setRaceName, inviteByEmail } from './fixtures.js';

test.setTimeout(90000);

// Playwright's clock on a racer's page, installed before it loads, set to now and running at real speed: the race runs
// on the same time as the fake service, which keeps real time, and a spec moves a page's clock on only once the service
// has closed the room, when nothing it decides depends on time any more. AbortSignal.timeout runs on the browser's own
// timer, which the clock doesn't reach, so it is made here from the clock's setTimeout, as the browser makes it: aborted
// with a TimeoutError after `ms`. That is the 15 s after which `request` (src/account.js) gives up. The page also counts
// its trace reads, started and settled.
async function onTestClock(page) {
  await page.clock.install();
  await page.addInitScript(() => {
    AbortSignal.timeout = (ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);

      return controller.signal;
    };

    const send = window.fetch;
    window.traceReads = { started: 0, settled: 0 };
    window.fetch = (input, init) => {
      const read = String(input).includes('/rpc/race_action') && JSON.parse(init?.body || '{}').p_action === 'traces';

      if (!read) return send(input, init);
      window.traceReads.started += 1;

      return send(input, init).finally(() => { window.traceReads.settled += 1; });
    };
  });
}

const traceReads = (page) => page.evaluate(() => window.traceReads);

// Moves a page's clock on by `ms`, 2 s at a time, letting each trace read that starts finish before the next step.
async function advance(page, ms) {
  for (let moved = 0; moved < ms; moved += 2000) {
    await page.clock.runFor(2000);
    await expect.poll(async () => {
      const reads = await traceReads(page);

      return reads.started - reads.settled;
    }).toBe(0);
  }
}

// Ada hosts a race (a quote race, which ends with its passage rather than on the clock, unless `setup` picks another
// practice setup first) and invites Lin's account; both ready, and the race is on. With `clock`, both pages run on
// Playwright's clock (onTestClock).
async function pairInRace(page, browser, supabase, setup = () => page.locator('#mode-quote').click(), { clock = false } = {}) {
  supabase.addUser('ada@stilltype.test');
  supabase.addUser('lin@stilltype.test');

  if (clock) await onTestClock(page);
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

  if (clock) await onTestClock(lin);
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
async function racePair(page, browser, supabase, options) {
  const { context, lin, passage } = await pairInRace(page, browser, supabase, undefined, options);
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

// The usual race: both traces are on the service when the results show, so each side reads them once, as before, and
// reads no more.
test('a race whose traces are both there reads them once on each side', async ({ page, browser, supabase }) => {
  const { context, lin } = await racePair(page, browser, supabase, { clock: true });

  try {
    await expect(page.locator('#online-review')).toBeVisible();
    await expect(lin.locator('#online-review')).toBeVisible();
    await expect(page.locator('#online-review-wait')).toBeHidden();
    await advance(page, 60000);
    await advance(lin, 60000);
    expect(await traceReads(page)).toEqual({ started: 1, settled: 1 });
    expect(await traceReads(lin)).toEqual({ started: 1, settled: 1 });
  } finally { await context.close(); }
});

// Neither trace ever comes, as in a race from before them. Both results wait in Graph and Replay's place, at their
// size, and read the traces less and less often for a minute (nine reads); then they say the keystrokes never came, and
// read no more. Close race ends the reads at once, as does the next race.
test('a race whose traces never come says so once the reads run out, and leaving ends the reads', async ({ page, browser, supabase }) => {
  supabase.races.dropTraces = true;
  const { context, lin } = await racePair(page, browser, supabase, { clock: true });
  const room = [...supabase.races.rooms.values()].at(-1);

  try {
    expect(room.status).toBe('finished');
    const note = (racer) => racer.locator('#online-review-wait');
    await expect(note(page)).toHaveText('Graph and Replay appear when both racers’ keystrokes arrive.');
    await expect(note(lin)).toHaveText('Graph and Replay appear when both racers’ keystrokes arrive.');
    await expect(page.locator('#online-review')).toBeHidden();

    // The note holds Graph and Replay's height, so nothing below it moves when they come.
    const height = (await note(page).boundingBox()).height;

    // Lin waits the minute out; Ada leaves after ten seconds.
    await advance(page, 10000);
    const readsAtLeave = (await traceReads(page)).started;
    await page.locator('#online-leave').click();
    await advance(page, 60000);
    expect((await traceReads(page)).started).toBe(readsAtLeave);

    await advance(lin, 60000);
    await expect(note(lin)).toHaveText('No Graph or Replay for this race: neither racer’s keystrokes arrived.');
    await expect(note(lin)).toHaveAttribute('data-state', 'none');
    expect((await note(lin).boundingBox()).height).toBeCloseTo(height, 0);
    expect(await traceReads(lin)).toEqual({ started: 9, settled: 9 });
    await advance(lin, 60000);
    expect((await traceReads(lin)).started).toBe(9);
    await expect(lin.locator('#online-review')).toBeHidden();
  } finally { await context.close(); }
});

test('a rematch while the last race’s traces are awaited ends those reads', async ({ page, browser, supabase }) => {
  supabase.races.dropTraces = true;
  const { context, lin } = await racePair(page, browser, supabase, { clock: true });

  try {
    await expect(lin.locator('#online-review-wait')).toHaveText('Graph and Replay appear when both racers’ keystrokes arrive.');
    await advance(lin, 4000);
    await page.locator('#online-rematch').click();
    await lin.locator('#online-rematch').click();
    await expect(lin.locator('#online-countdown')).toContainText('Starting in');
    await expect(lin.locator('#online-review-wait')).toBeHidden();
    const reads = (await traceReads(lin)).started;
    await advance(lin, 60000);
    expect((await traceReads(lin)).started).toBe(reads);
  } finally { await context.close(); }
});

// A timed race between Ada and Lin, each with the passage's first 20 keys on the service.
async function twentyKeysEach(page, browser, supabase, options) {
  const race = await pairInRace(page, browser, supabase, async () => {
    await page.locator('#mode-time').click();
    await page.locator('#duration-options [data-length="15"]').click();
  }, options);

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

// As above, but the way it happens: the service applies Ada's late progress and its answer never comes, so her tab
// waits out the 15 s `request` (src/account.js) allows before it sends its finish and the trace of the settled keys,
// which can then be lost on the way and sent again, 2 s apart. Lin's results were shown long before. Both racers still
// get Graph and Replay: Lin's reads go on while Ada's trace is missing, and say whose keystrokes they wait for.
for (const lost of [0, 1, 2]) {
  test(`after a 15 s timeout${lost ? ` and ${lost} lost ${lost === 1 ? 'send' : 'sends'} of the settled trace` : ''}, both racers still get Graph and Replay`, async ({ page, browser, supabase }) => {
    const { context, lin, passage, room, clockOut } = await twentyKeysEach(page, browser, supabase, { clock: true });
    const ada = supabase.users.get('ada@stilltype.test').id;

    try {
      // Before any jump, both pages' clocks are the service's (real) time.
      for (const racer of [page, lin]) expect(Math.abs(await racer.evaluate(() => Date.now()) - Date.now())).toBeLessThan(1000);
      let open;
      const gate = new Promise((resolve) => { open = resolve; });
      let unanswered = 1;
      let dropping = lost;
      await page.route('**/rest/v1/rpc/race_action', async (route) => {
        if (!isProgress(route.request())) return route.fallback();
        const body = route.request().postDataJSON();

        if (unanswered) {
          unanswered = 0;
          await gate;
          // The service takes the progress; its answer never comes, so the tab's request runs out its time.
          await supabase.races.handle(ada, body, () => {});

          return new Promise(() => {});
        }

        if (dropping && body.p_data.trace?.k.length === 21) {
          dropping -= 1;

          return route.abort('failed');
        }

        return route.fallback();
      });
      await expect.poll(() => Date.now() > clockOut - 3000, { timeout: 20000 }).toBe(true);
      const held = page.waitForRequest(isProgress);
      await page.keyboard.type(passage[20]);
      await held;
      await page.keyboard.type(passage[21]);
      await expect.poll(() => Date.now() > clockOut + 500, { timeout: 10000 }).toBe(true);
      open();

      // The service has closed the room: Lin's results show, and her first read finds Ada's trace missing.
      await expect.poll(() => room.status).toBe('finished');
      await expect(lin.locator('#online-results')).toBeVisible({ timeout: 10000 });
      const note = lin.locator('#online-review-wait');
      await expect(note).toHaveText('Graph and Replay appear when Ada’s keystrokes arrive.');
      const waiting = (await note.boundingBox()).height;

      // Lin's next two reads, 2 and 4 s on, still find it missing: Ada's tab is waiting on its request.
      await advance(lin, 6000);
      expect(await traceReads(lin)).toEqual({ started: 3, settled: 3 });
      expect(room.players[0].trace ?? null).toBe(null);

      // Ada's request runs out its 15 s; her tab sends its finish and then the settled trace, until it gets through.
      await page.clock.fastForward(15000);
      await expect.poll(() => room.players[0].trace?.k.length, { timeout: 20000 }).toBe(21);
      await expect(page.locator('#online-review')).toBeVisible({ timeout: 10000 });

      // Lin's reads go on, and the next finds it.
      for (let step = 0; step < 30 && !(await lin.locator('#online-review').isVisible()); step += 1) await advance(lin, 2000);
      await expect(lin.locator('#online-review')).toBeVisible();
      await expect(note).toBeHidden();
      expect((await lin.locator('#online-review').boundingBox()).height).toBeCloseTo(waiting, 0);
      expect(room.players.map((player) => [player.typed.length, player.trace?.k.length])).toEqual([[21, 21], [20, 20]]);
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
