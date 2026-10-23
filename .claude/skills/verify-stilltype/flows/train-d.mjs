// Train direction D end to end, signed in with nine saved runs that miss "ou" (and "br"): a run's result on
// Practice (D1), Train from the dock (D2), Drill and retest to its comparison on Train (D5), Train again with
// the finished loop's line, adaptive practice on (D3) and its result (D4). The clock is Playwright's, so the
// drill's minute passes at once; every run is typed through the page. Run at 1440×900 and 390×844 --mobile.
import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, createAttempt } from '../../../../src/typing.js';
import { runRecord } from '../../../../src/insights.js';

const conditions = { mode: 'time', duration: 30, count: null, punctuation: false, numbers: false, quoteLength: null, difficulty: null,
  wordList: '200', inputClass: 'physical-keyboard', layout: 'qwerty', correctionPolicy: 'relaxed', strictSpace: false, quickEnd: true,
  language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
const words = 'brought the people bright would about library there brief house abroad round embrace could through our'.split(' ');

// One saved run: the words above three times, a slip on the "u" of an "ou" in every eighth word and on the "r"
// of a "br" in every sixteenth, typed at about 70 wpm.
function savedRun(index) {
  const text = Array(3).fill(words).flat().join(' ');
  const attempt = createAttempt({ id: `seed-${index}`, text, textId: `seed-${index}`, kind: 'test', conditions });
  attempt.startedAt = 0;
  let word = 0;
  attempt.events = [...text].map((char, position) => {
    if (char === ' ') word += 1;
    const pair = text.slice(position - 1, position + 1);
    const slip = (pair === 'ou' && word % 8 === index % 8) || (pair === 'br' && word % 16 === index % 16);
    return { type: 'insert', text: slip ? 'x' : char, position, offsetMs: position * 170, accepted: true };
  });
  const at = new Date(Date.UTC(2026, 9, 10 + index, 12)).toISOString();
  return runRecord({ ...completeAttempt(attempt, { endedAt: text.length * 170 }), at, fresh: true }, at);
}

export default async ({ page, h, shot, note, check, fake }) => {
  const user = fake.addUser('train@stilltype.test');
  const runs = Array.from({ length: 9 }, (_, index) => savedRun(index));
  fake.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: [], runs, loops: [], seenTextIds: runs.map((run) => run.textId),
    bests: {}, updatedAt: runs.at(-1).at } });
  await page.clock.install();
  await h.openApp();
  await h.signIn(user.email);

  // About 75 wpm on the page's clock with a slip every 37 characters, until the clock ends the run.
  const typeRun = async () => {
    const text = await h.passage();
    await page.locator('#typing-input').focus();
    for (const [index, char] of [...text.slice(0, 220)].entries()) {
      if (await page.locator('#typing-input').isDisabled()) break;
      await page.keyboard.type(index % 37 === 36 && char !== ' ' ? 'x' : char);
      await page.clock.runFor(150 + (index % 7) * 10);
    }
    await page.clock.fastForward(5_000);
  };

  await typeRun();
  await h.attr('body', 'data-view', 'results');
  await h.settle();
  note('D1 actions', await page.locator('.result-actions').innerText());
  check((await h.text('#result-drill')) === 'Drill “ou”', 'the result offers the recurring pair');
  await shot('d1-result');

  await h.openView('Train');
  await h.settle();
  check((await h.text('#train-heading')) === 'Practice “ou”', 'Train names the recurring pair');
  note('D2 evidence', await h.text('#train-evidence'));
  check(await page.locator('#train-last').isHidden(), 'no loop line before a loop');
  await shot('d2-train');

  await page.locator('#start-drill').click();
  await h.attr('#typing-screen', 'data-session', 'drill');
  // The drill's minute starts with its first key.
  await page.locator('#typing-input').focus();
  await page.keyboard.type((await h.passage()).slice(0, 60), { delay: 150 });
  await page.clock.fastForward(61_000);
  await h.attr('#typing-screen', 'data-session', 'retest');
  await typeRun();
  await h.attr('body', 'data-view', 'train');
  await h.settle();
  note('D5', await page.locator('#comparison-panel').innerText());
  await shot('d5-comparison');

  await h.openView('Practice');
  await h.openView('Train');
  await h.settle();
  note('D2 after a loop', await h.text('#train-last'));
  check(await page.locator('#train-last').isVisible(), 'the finished loop shows its line');
  await shot('d2-after-loop');

  await h.openView('Practice');
  await page.locator('#adaptive-switch').click();
  await h.settle();
  check(await page.locator('#adaptive-toggle').isChecked(), 'adaptive is on');
  await shot('d3-adaptive');
  await typeRun();
  await h.attr('body', 'data-view', 'results');
  await h.settle();
  check((await h.text('#result-drill')) === 'Retest on fresh text', 'an adaptive result offers the fresh-text retest');
  note('footer best', await h.text('.site-footer'));
  await shot('d4-adaptive-result');
};
