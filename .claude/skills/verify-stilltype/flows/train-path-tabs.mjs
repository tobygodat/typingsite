// Train follows the history from another tab (TOB-420): this tab shows Train while a second tab of the same account
// clears the history, undoes the clear, and types a run. After each, this tab's path is shot and checked against the
// path trainPath gives for the stored history. Run with --delay 40.
import { CORPUS_VERSION, METRIC_VERSION } from '../../../../src/typing.js';
import { history } from './train-path.mjs';

const conditions = { mode: 'words', count: 10, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const drawn = (page) => page.evaluate(() => {
  const unit = (item) => item.querySelector('.path-unit').firstChild.textContent;
  const lines = (item) => [...item.querySelectorAll('.path-line')].map((line) => line.textContent);
  const shown = (id) => (document.getElementById(id).hidden ? '' : document.getElementById(id).textContent);
  const steps = [...document.querySelectorAll('#train-path > li:not([hidden])')];

  return JSON.stringify({
    behind: steps.filter((item) => item.matches('.is-behind:not(#comparison-panel)')).map((item) => [unit(item), item.classList.contains('is-fixed') ? 'fixed' : 'drilled', ...lines(item)].join(' | ')),
    current: [document.querySelector('#train-heading').textContent, shown('train-evidence'), shown('train-last')].join(' | '),
    ahead: steps.filter((item) => item.matches('.is-ahead:not(.is-place)')).map((item) => [unit(item), ...lines(item)].join(' | ')),
  });
});

const stored = (page) => page.evaluate(async (source) => {
  const { trainPath, aheadCopy, behindCopy, evidenceCopy, sinceCopy } = await import('/src/train-path.js');
  const { DEFAULT_POLICY, keyboardOf, recommendFor } = await import('/src/learner.js');
  const key = Object.keys(localStorage).find((name) => name.startsWith('stilltype-profile-v2:'));
  const { runs = [], loops = [], attempts = [], preferences = {} } = JSON.parse(localStorage.getItem(key));
  const path = trainPath({ recommendation: recommendFor(DEFAULT_POLICY, { runs, loops, traces: attempts, source, now: Date.now(), focus: preferences.trainFocus || 'balanced' }),
    loops, runs, keyboard: keyboardOf(source) });
  const since = sinceCopy(path.current.since);

  return JSON.stringify({
    behind: path.behind.map((step) => [step.unit, step.state, ...behindCopy(step)].join(' | ')),
    current: [path.current.title, path.current.unit ? evidenceCopy(path.current.was, { all: Boolean(since) }) : '', since].join(' | '),
    ahead: path.ahead.map((step) => [step.unit, aheadCopy(step.was)].join(' | ')),
  });
}, conditions);

export default async ({ page, h, shot, note, check, fake, url }) => {
  const user = fake.addUser('path-tabs@stilltype.test');
  fake.profiles.set(user.id, { data: history() });
  await h.openApp();
  await h.signIn('path-tabs@stilltype.test');
  await h.openView('Practice');
  await h.chooseWords(10);
  await h.type(await h.passage());
  await h.attr('body', 'data-view', 'results');
  await h.openView('Train');
  await h.settle();
  await shot('before');

  const other = await page.context().newPage();
  await fake.attach(other);
  await other.goto(url);
  await other.locator('#account[data-sync="synced"]').waitFor();

  const follows = async (label) => {
    for (let tries = 0; tries < 40 && (await drawn(page)) !== (await stored(page)); tries += 1) await page.waitForTimeout(250);
    note(label, await drawn(page));
    check((await drawn(page)) === (await stored(page)), `${label}: Train draws the stored history`);
    await h.settle();
    await shot(label);
  };

  await other.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Progress' }).click();
  await other.locator('#clear-history').click();
  await other.locator('#confirm-clear-input').fill('clear');
  await other.locator('#confirm-clear').click();
  await follows('cleared-there');
  check((await h.text('#train-heading')) === 'General drill', 'cleared elsewhere: the general drill, nothing behind');

  await other.locator('#undo-clear').click();
  await follows('undone-there');
  check((await h.text('#train-heading')) === 'Practice “th”', 'undone elsewhere: “th” is open again, its steps behind it');

  const before = await drawn(page);
  await other.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Practice' }).click();
  await other.locator('#mode-words').click();
  await other.locator('#duration-options [data-length="10"]').click();
  const text = await other.locator('#accessible-passage').textContent();
  await other.locator('#typing-input').focus();
  await other.keyboard.type(text.replaceAll('n', 'x'), { delay: 20 });
  await other.locator('body[data-view="results"]').waitFor();
  await follows('run-there');
  note('changed', String(before !== (await drawn(page))));
  await other.close();
};
