// PR-4's surfaces, end to end as a person uses them: a finished run's card arriving in order with Run again live
// from its first frame, the speed trace scrubbed by pointer and keyboard (with the handler cost and layout shift
// measured), Inspect words closed and opened, Progress's friction and flow pairs with a friction pair drilled, and an
// online race between two accounts: the countdown, both lanes mid-race, and the duel graph scrubbed.
// Pairs need ten tries before they are named, so three 50-word runs are typed with "th" missed on its first try,
// "er" slow and "an", "in" and "re" quick, which gives friction and flow at the same conditions.
export default async ({ page, h, shot, note, check, fake, url }) => {
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const QUICK = new Set(['an', 'in', 're']);
  const pause = (pair) => (QUICK.has(pair) ? 25 : pair === 'er' ? 230 : 80);

  await page.addInitScript(() => {
    window.__shifts = [];
    const name = (node) => (node ? `${node.nodeName.toLowerCase()}${node.id ? `#${node.id}` : ''}${node.classList?.length ? `.${[...node.classList].join('.')}` : ''}` : '?');
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__shifts.push({ at: Math.round(entry.startTime), value: entry.value, view: document.body.dataset.view, nodes: entry.sources.map((source) => name(source.node)) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  const typeRun = async () => {
    const text = await h.passage();
    await page.locator('#typing-input').focus();

    for (let index = 0; index < text.length; index += 1) {
      const pair = index ? text.slice(index - 1, index + 1).toLowerCase() : '';

      if (index) await page.waitForTimeout(pause(pair));

      if (pair === 'th') {
        await page.keyboard.type('x');
        await page.keyboard.press('Backspace');
      }

      await page.keyboard.type(text[index]);
    }
  };

  await h.openApp();
  await h.chooseWords(50);
  await typeRun();
  await h.attr('body', 'data-view', 'results');

  // The first frames of the card: Run again is the element under its own centre, takes pointer events, and a click
  // lands at once, whatever its opacity is mid-fade.
  const arrival = await page.evaluate(() => {
    const button = document.getElementById('run-again');
    button.scrollIntoView({ block: 'center', behavior: 'instant' });
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

    return { opacity: Number(getComputedStyle(button.closest('.result-actions')).opacity), pointer: getComputedStyle(button).pointerEvents, hit: hit === button || button.contains(hit),
      cascade: [...document.querySelectorAll('#run-card > *')].map((part) => getComputedStyle(part).animationDelay) };
  });
  note('arrival', arrival);
  check(arrival.pointer === 'auto' && arrival.hit, 'Run again is hit-testable on the first frame');
  check(reduced ? arrival.opacity === 1 : arrival.opacity < 1, reduced ? 'reduced motion: the card arrives whole' : 'the actions are still fading in');
  await shot('results-arriving');
  const firstPassage = await h.passage();
  const clicked = performance.now();
  await page.locator('#run-again').click({ force: true });
  await h.attr('body', 'data-view', 'practice');
  note('run again took ms', Math.round(performance.now() - clicked));
  check((await h.passage()) !== firstPassage, 'Run again starts a fresh passage');

  await typeRun();
  await h.attr('body', 'data-view', 'results');
  await h.settle();
  const shifts = await page.evaluate(() => window.__shifts);
  note('layout shifts so far', shifts);
  check(!shifts.some((shift) => shift.nodes.some((node) => /run-card|result|speed-graph|word/.test(node))), 'the reveal shifts no part of the card');
  await shot('results-settled');

  const graph = page.locator('#speed-graph');
  const box = await graph.boundingBox();
  const readout = page.locator('#speed-graph .graph-readout');

  for (const at of [0.25, 0.5, 0.8]) {
    await page.mouse.move(box.x + box.width * at, box.y + box.height / 2);
    const text = await readout.textContent();
    note(`scrub ${at * 100}%`, text);
    check(/^\d+(\.\d)?s · \d+ (wpm|cpm) · \d+ mistakes?$/.test(text), `the readout at ${at * 100}% reads time, speed and mistakes`);
    check((await graph.getAttribute('aria-valuetext')) === text, `the slider says the same at ${at * 100}%`);

    if (at === 0.5) await shot('scrub-pointer');
  }

  const hair = await page.locator('#speed-graph .graph-scrub').evaluate((line) => ({ x: Number(line.getAttribute('x1')), visible: getComputedStyle(line).visibility }));
  check(hair.visible === 'visible' && Math.abs(hair.x - box.width * 0.8) < box.width / 20, 'the hairline sits at the pointer');
  await page.mouse.move(box.x + box.width / 2, box.y - 40);
  check(!(await graph.getAttribute('data-scrubbing')) && (await readout.textContent()) === '', 'leaving the trace clears the scrub');

  await graph.focus();
  await page.keyboard.press('ArrowRight');
  const first = await readout.textContent();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const third = await readout.textContent();
  await page.keyboard.press('ArrowLeft');
  check(first.startsWith('1s ') && third.startsWith('3s ') && (await readout.textContent()).startsWith('2s '), 'arrows step one point at a time');
  await shot('scrub-keyboard');
  await page.keyboard.press('End');
  note('End', await readout.textContent());
  await page.keyboard.press('Home');
  check((await readout.textContent()) === first, 'Home returns to the first point');
  await page.keyboard.press('Escape');
  check((await readout.textContent()) === '' && (await h.attr('body', 'data-view', 'results'), true), 'Escape clears the scrub and leaves the results');

  // Sixty moves across the trace, each timed around its dispatch, the way a pointer sends them.
  const cost = await page.evaluate(() => {
    const node = document.getElementById('speed-graph');
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new PointerEvent('pointerenter', { clientX: rect.left + 1, clientY: rect.top + 10, pointerType: 'mouse' }));
    const times = Array.from({ length: 60 }, (_, step) => {
      const started = performance.now();
      node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left + (rect.width * step) / 59, clientY: rect.top + 10, pointerType: 'mouse' }));

      return performance.now() - started;
    }).sort((a, b) => a - b);

    node.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));

    return { median: times[30], p95: times[57], max: times[59] };
  });
  note('pointermove ms', cost);
  check(cost.p95 < 2, 'a scrub move costs under 2 ms at p95');

  const toggle = page.locator('#inspect-words');
  const drawer = page.locator('#result-words-drawer');
  check((await toggle.getAttribute('aria-expanded')) === 'true' && (await page.locator('#result-words').isVisible()), 'the words show on arrival');
  const before = await page.evaluate(() => window.__shifts.length);
  await toggle.click();
  await h.settle();
  check((await toggle.getAttribute('aria-expanded')) === 'false' && (await drawer.evaluate((node) => getComputedStyle(node).visibility)) === 'hidden', 'Inspect words closes the list');
  check(await page.locator('#practice-words').isVisible(), 'Practice these words stays in view with the list closed');
  await shot('words-closed');
  await toggle.click();
  await h.settle();
  check((await toggle.getAttribute('aria-expanded')) === 'true' && (await page.locator('#result-words').isVisible()), 'and opens it again');
  note('shifts from the toggle (none count: they follow input)', await page.evaluate((from) => window.__shifts.slice(from), before));
  await page.locator('#result-words [role="option"]').nth(1).click();
  await page.keyboard.press('ArrowRight');
  note('word detail', await h.text('#result-word-detail'));
  check(/^“.+” · /.test(await h.text('#result-word-detail')), 'a chosen word shows its pace');
  await shot('words-open');

  await page.locator('#run-again').click();
  await h.attr('body', 'data-view', 'practice');
  await typeRun();
  await h.attr('body', 'data-view', 'results');
  await h.settle();

  await h.openView('Progress');
  await page.locator('#progress-pairs').waitFor();
  await h.settle();
  const chips = await page.evaluate(() => Object.fromEntries(['friction', 'flow'].map((kind) => [kind, [...document.querySelectorAll(`#progress-pairs [data-kind="${kind}"]`)].map((chip) => chip.dataset.pair)])));
  note('pairs', chips);
  check(chips.friction.length > 0 && chips.flow.length > 0, 'Progress names friction and flow pairs');
  check(chips.friction.every((pair) => !chips.flow.includes(pair)), 'no pair is both friction and flow');
  check(chips.friction.includes('th') && chips.friction.includes('er'), 'the missed and the slow pairs are friction');
  check(chips.flow.filter((pair) => QUICK.has(pair)).length >= 2, 'the quick pairs are flow');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing scrolls sideways');
  await page.locator('#progress-pairs').scrollIntoViewIfNeeded();
  await shot('progress-pairs');
  const drilled = chips.friction[0];
  await page.locator(`#progress-pairs button[data-pair="${drilled}"]`).click();
  await h.attr('#typing-screen', 'data-session', 'drill');
  const drill = await h.passage();
  note('drill', drill.slice(0, 80));
  check(drill.split(' ').filter((word) => word.toLowerCase().includes(drilled)).length >= drill.split(' ').length / 2, `the drill is "${drilled}" words`);
  await shot('pair-drill');

  const host = fake.addUser('toby@stilltype.test');
  const guest = fake.addUser('mara@stilltype.test');
  void host;
  void guest;
  const light = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
  const context = await page.context().browser().newContext({ baseURL: url, viewport: page.viewportSize(), colorScheme: light ? 'light' : 'dark', reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
  const mara = await context.newPage();
  await fake.attach(mara);

  try {
    await h.openApp();
    await h.signIn('toby@stilltype.test');
    await h.openView('Challenge');
    await page.locator('#people-setup').click();
    await page.locator('#online-name').fill('Toby');
    await page.locator('#online-setup-done').click();
    await page.locator('#people-add').click();
    await page.locator('#online-invite-email').fill('mara@stilltype.test');
    await page.locator('#create-online-race').click();
    await page.locator('#online-room').waitFor();

    await mara.goto('/');
    await mara.locator('#text-display .char').first().waitFor();
    await mara.locator('#account-trigger').click();
    await mara.locator('#account-signin').click();
    await mara.locator('#account-email-input').fill('mara@stilltype.test');
    await mara.locator('#account-password').fill('correct horse battery');
    await Promise.all([mara.waitForEvent('load'), mara.locator('#account-submit').click()]);
    await mara.locator('#account[data-state="member"]').waitFor();
    await mara.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Challenge' }).click();
    await mara.locator('#people-setup').click();
    await mara.locator('#online-name').fill('Mara');
    await mara.locator('#online-setup-done').click();
    await mara.locator('[data-accept-invite]').click();
    await mara.locator('#online-room').waitFor();

    await page.locator('#online-ready').click();
    await mara.locator('#online-ready').click();
    await page.locator('#online-countdown:has-text("Starting in")').waitFor({ timeout: 20000 });
    const countdown = await h.text('#online-countdown');
    note('countdown', countdown);
    check(/^Starting in [1-9]$/.test(countdown), 'the countdown reads "Starting in <n>"');
    await shot('race-countdown');
    await page.locator('#online-input:enabled').waitFor({ timeout: 20000 });
    await mara.locator('#online-input:enabled').waitFor();
    const passage = await page.locator('#online-accessible-passage').textContent();
    const half = Math.min(40, Math.floor(passage.length / 2));
    await Promise.all([page.keyboard.type(passage.slice(0, half), { delay: 90 }), mara.keyboard.type(passage.slice(0, Math.floor(half * 0.7)), { delay: 120 })]);
    await page.waitForTimeout(700);
    const lanes = await page.locator('#online-players .online-player-row').evaluateAll((rows) => rows.map((row) => {
      const fill = row.querySelector('.progress-track > span');
      const style = getComputedStyle(fill);

      return { self: row.hasAttribute('data-self'), transform: style.transform, colour: style.backgroundColor, state: row.querySelector(':scope > span').textContent };
    }));
    note('lanes', lanes);
    check(lanes.length === 2 && lanes.every((lane) => lane.transform.startsWith('matrix(') && Number(lane.transform.slice(7).split(',')[0]) > 0), 'both lanes fill by transform');
    check(lanes[0].colour !== lanes[1].colour, 'your lane and theirs differ in colour');
    check(!(await page.locator('#online-players').innerText()).match(/\b1[0-9]{3}\b/), 'no rating shows in the lanes');
    await shot('race-lanes');
    await Promise.all([page.keyboard.type(passage.slice(half), { delay: 90 }), mara.keyboard.type(passage.slice(Math.floor(half * 0.7)), { delay: 120 })]);
    await page.locator('#online-results').waitFor({ timeout: 20000 });
    await page.locator('#online-review').waitFor({ timeout: 10000 });
    await page.locator('#online-duel-graph svg').waitFor();
    await h.settle();

    const duel = page.locator('#online-duel-graph');
    await duel.scrollIntoViewIfNeeded();
    const area = await duel.boundingBox();
    await page.mouse.move(area.x + area.width * 0.4, area.y + area.height / 2);
    const duelText = await page.locator('#online-duel-graph .graph-readout').textContent();
    note('duel scrub', duelText);
    check(/^\d+(\.\d)?s · You \d+ (wpm|cpm) · Mara (\d+ (wpm|cpm)|—)$/.test(duelText), 'the duel readout names both racers');
    check(await page.locator('#online-duel-graph .graph-scrub-dot[visibility="visible"]').count() === 2, 'a dot on each line');
    await shot('duel-scrub');
    await duel.focus();
    await page.keyboard.press('End');
    note('duel End', await page.locator('#online-duel-graph .graph-readout').textContent());
    await page.locator('#online-show-replay').click();
    check(await page.locator('#online-duel-replay').isVisible(), 'Replay still opens');
    await page.locator('#online-show-graph').click();
    check(await page.locator('#online-duel-graph path.graph-line').count() === 2, 'Graph draws both lines again');
  } finally {
    await context.close();
  }
};
