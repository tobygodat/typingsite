// Finding 1 of TOB-419's check: a focus change made while the results card shows. Signed in at words 50, three
// passages typed with a 150 ms pause before the "h" of every "th" and the "n" of every "an" and "in" missed once;
// then the palette's train focus · accuracy and · speed with the card on screen, the card's Drill pressed, and
// the loop it records. Run with --signed-in --delay 40.
export default async ({ page, h, shot, note, check, fake }) => {
  const palette = async (label) => {
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill(label);
    await page.locator('#palette-list [role="option"]', { hasText: label }).first().click();
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

  await h.openApp();
  await h.chooseWords(50);

  for (let run = 0; run < 3; run += 1) {
    if (run) {
      await page.locator('#run-again').click();
      await h.attr('body', 'data-view', 'practice');
    }

    await typeHistoryRun();
  }

  await h.settle();
  const card = {};
  card.balanced = await h.text('#result-drill');
  note('card, balanced', card.balanced);
  await shot('card-balanced');

  for (const focus of ['accuracy', 'speed']) {
    await palette(`train focus · ${focus}`);
    await h.settle();
    card[focus] = await h.text('#result-drill');
    note(`card, ${focus}`, card[focus]);
    await shot(`card-${focus}`);
  }

  check(card.accuracy !== card.balanced, 'the card follows the focus to accuracy');

  // The card's Drill in accuracy, a 15-second drill and its retest, then the comparison's Next as the focus changes.
  await palette('train focus · accuracy');
  await palette('drill length · 15 seconds');
  await h.settle();
  const named = card.accuracy.replace('Drill', 'Practice');
  await page.locator('#result-drill').click();
  await h.attr('#typing-screen', 'data-session', 'drill');
  note('drill from the card', await h.text('#session-title'));
  check((await h.text('#session-title')) === named, 'the drill drills what the card named');
  await shot('drill-from-card');
  await page.locator('#typing-input').focus();
  await page.keyboard.type((await h.passage()).slice(0, 8), { delay: 40 });
  await page.waitForTimeout(15_500);
  await h.attr('#typing-screen', 'data-session', 'retest');
  await h.type(await h.passage());
  await h.attr('body', 'data-view', 'train');
  await h.settle();
  const loop = fake.profileFor('verify@stilltype.test')?.loops?.at(-1);
  note('loop', JSON.stringify({ target: loop?.target, focus: loop?.focus, kind: loop?.recommendationKind }));
  check(loop?.target === named.slice(10, -1) && loop?.focus === 'accuracy', 'the loop records the target and the focus that chose it');

  const next = {};
  next.accuracy = await h.text('#comparison-next');
  await shot('comparison-accuracy');

  for (const focus of ['speed', 'balanced']) {
    await palette(`train focus · ${focus}`);
    await h.settle();
    next[focus] = await h.text('#comparison-next');
    await shot(`comparison-${focus}`);
  }

  note('comparison next', JSON.stringify(next));
  check(next.accuracy !== next.speed, 'the comparison\'s Next follows the focus');
  await page.locator('#comparison-next').click();
  await h.attr('#typing-screen', 'data-session', 'drill');
  check((await h.text('#session-title')) === next.balanced.replace('Next:', 'Practice'), 'Next drills what it named');
};
