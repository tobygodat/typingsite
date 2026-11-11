// Training settings (TOB-419, ADR 0015), signed in at words 50: the settings dialog's three training rows; three
// passages typed with a 150 ms pause before the "h" of every "th" and the "n" of every "an" and "in" missed once; Train
// and Patterns across runs in each focus on that history; a 15-second drill and its retest at speed, then Train's
// two lines; the retest off; a 120-second drill. Run with --signed-in --delay 40.
export default async ({ page, h, shot, note, check }) => {
  const choose = async (id, value) => {
    await h.openSettings('practice');
    await page.locator(`#${id} input[value="${value}"]`).locator('..').click();
    await page.locator('#settings-done').click();
  };

  const typeHistoryRun = async () => {
    const text = await h.passage();
    await page.locator('#typing-input').focus();

    for (let at = 0; at < text.length; at += 1) {
      if (text.slice(at - 1, at + 1) === 'th') await page.waitForTimeout(150);

      if (['an', 'in'].includes(text.slice(at - 1, at + 1))) {
        await page.keyboard.type('x');
        await page.keyboard.press('Backspace');
      }

      await page.keyboard.type(text[at], { delay: 40 });
    }

    await h.attr('body', 'data-view', 'results');
  };

  const drillFor = async (seconds) => {
    await h.attr('#typing-screen', 'data-session', 'drill');
    await page.locator('#typing-input').focus();
    await page.keyboard.type((await h.passage()).slice(0, 8), { delay: 40 });
    await page.waitForTimeout(seconds * 1000 + 500);
  };

  await h.openApp();
  await h.openSettings('practice');
  await page.locator('#train-focus').scrollIntoViewIfNeeded();
  await h.settle();
  check((await page.locator('#train-focus input:checked').inputValue()) === 'balanced', 'balanced by default');
  check((await page.locator('#drill-length input:checked').inputValue()) === '30', '30 s by default');
  check((await page.locator('#retest-toggle input:checked').inputValue()) === 'true', 'retest on by default');
  await shot('settings-training');
  await page.locator('#settings-done').click();

  await h.chooseWords(50);

  for (let run = 0; run < 3; run += 1) {
    if (run) {
      await page.locator('#run-again').click();
      await h.attr('body', 'data-view', 'practice');
    }

    await typeHistoryRun();
  }

  const targets = {};

  for (const focus of ['balanced', 'accuracy', 'speed']) {
    await choose('train-focus', focus);
    await h.openView('Train');
    await h.settle();
    targets[focus] = { heading: await h.text('#train-heading'), evidence: await h.text('#train-evidence') };
    note(`train, ${focus}`, `${targets[focus].heading} · ${targets[focus].evidence}`);
    await shot(`train-${focus}`);

    await h.openView('Progress');
    await page.locator('#training-memory-heading').scrollIntoViewIfNeeded();
    await h.settle();
    const first = page.locator('#training-targets .training-target').first();
    note(`patterns, ${focus}`, await page.locator('#training-targets').innerText());
    check((await first.locator('h3').textContent()) === targets[focus].heading, `${focus}: Patterns across runs leads with Train's target`);
    check((await first.locator('p').first().textContent()) === targets[focus].evidence, `${focus}: with Train's evidence line`);
    await shot(`patterns-${focus}`);
  }

  check(targets.accuracy.heading !== targets.speed.heading, 'accuracy and speed name different targets on this history');
  check(/missed in/.test(targets.accuracy.evidence) && /than your pace/.test(targets.speed.evidence), 'each names its target on its own kind of evidence');

  // Speed, a 15-second drill and its fresh retest, then Train's evidence and "since you drilled it" lines.
  await choose('drill-length', '15');
  await h.openView('Train');
  await page.locator('#start-drill').click();
  check((await h.text('#session-kicker')) === 'drill · 15 s', 'the drill is 15 seconds');
  await shot('drill-15');
  await drillFor(15);
  await h.attr('#typing-screen', 'data-session', 'retest');
  await h.type(await h.passage());
  await h.attr('body', 'data-view', 'train');
  await h.settle();
  note('comparison', await page.locator('#comparison-panel').innerText());
  await shot('comparison-speed');
  await h.openView('Train');
  await h.settle();
  note('train after the loop', await page.locator('#train-next').innerText());
  await shot('train-two-lines');

  // The retest off: Train says Drill, and the drill ends on its own result.
  await choose('retest-toggle', 'false');
  await h.openView('Train');
  await h.settle();
  check((await h.text('#start-drill')) === 'Drill', 'the button says Drill');
  await shot('train-retest-off');
  await page.locator('#start-drill').click();
  await drillFor(15);
  await h.attr('body', 'data-view', 'results');
  check(await page.locator('#comparison-panel').isHidden(), 'nothing is compared');
  await h.settle();
  await shot('drill-result-retest-off');

  await choose('drill-length', '120');
  await h.openView('Train');
  await page.locator('#start-drill').click();
  check((await h.text('#session-kicker')) === 'drill · 120 s', 'the drill is 120 seconds');
  await h.settle();
  await shot('drill-120');
};
