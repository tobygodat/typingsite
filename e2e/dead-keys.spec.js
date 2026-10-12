import { test, expect, openApp, passageText, typeInto, chooseWords, openSettings, openView, signInWithEmail } from './fixtures.js';

// Accent (dead) keys, as US-International and similar layouts send them. On macOS (and Linux with an
// input method) the mark arrives as a composition that the next key commits; Chrome sends that through
// the same IME channel CDP drives here. On Windows there is no composition: the commit is plain text.
// CI can only simulate these events; physical layouts still need a device check.
const IME_NOTICE = 'IME input isn’t scored. Esc to restart.';

async function accentKeys(page) {
  const cdp = await page.context().newCDPSession(page);
  return {
    // The dead key shows its mark as composition text.
    async deadKey(mark = '"') {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 });
      await cdp.send('Input.imeSetComposition', { text: mark, selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 });
    },
    // An auto-repeat of a held dead key (the OS sends these while the key stays down).
    deadKeyRepeat: () => cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222, autoRepeat: true }),
    // The next key commits the open composition; with none open this is plain text (the Windows lane).
    commit: (text) => cdp.send('Input.insertText', { text }),
    preview: (text) => cdp.send('Input.imeSetComposition', { text, selectionStart: [...text].length, selectionEnd: [...text].length }),
    // Composition text over letters already in the field, as the macOS press-and-hold accent menu sends it.
    replace: (text, start, end) => cdp.send('Input.imeSetComposition', { text, selectionStart: [...text].length, selectionEnd: [...text].length, replacementStart: start, replacementEnd: end }),
    cancel: () => cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }),
  };
}

// Three of the five short precise quotes hold a quotation mark followed by a capital consonant
// ("Back, "Measure, "Let); restarting shows an unseen one until a quote with a mark comes up.
async function quoteWithMarks(page) {
  await page.locator('#mode-quote').click();
  await page.locator('#quote-length').selectOption('short');
  await page.locator('#quote-difficulty').selectOption('precise');
  await expect(page.locator('#condition-line')).toContainText('precise');
  for (let tries = 0; tries < 5 && !(await passageText(page)).includes('"'); tries += 1) {
    await page.locator('#restart-button').click();
  }
  await expect(page.locator('#accessible-passage')).toContainText('"');
  return passageText(page);
}

// Every ' and " goes through the accent key: with a consonant after it the pair commits together ("B, 's),
// otherwise the typist presses space after the mark and types the next key as usual.
async function typeWithAccentKeys(page, keys, text, from = 0, to = text.length) {
  let plain = '';
  for (let i = from; i < to; i += 1) {
    if (!['"', "'"].includes(text[i])) { plain += text[i]; continue; }
    if (plain) { await page.keyboard.type(plain); plain = ''; }
    await keys.deadKey(text[i]);
    if (/[b-df-hj-np-tv-z]/i.test(text[i + 1] || '')) { await keys.commit(text[i] + text[i + 1]); i += 1; }
    else await keys.commit(text[i]);
  }
  if (plain) await page.keyboard.type(plain);
}

const recordHelp = (page) => page.evaluate(() => {
  window.helpSeen = [];
  const help = document.querySelector('#input-help');
  new MutationObserver(() => window.helpSeen.push(help.textContent)).observe(help, { childList: true, characterData: true, subtree: true });
});

const scored = (page) => page.evaluate(() => ({
  correct: document.querySelectorAll('#text-display .char.correct').length,
  wrong: document.querySelectorAll('#text-display .char.wrong').length,
  value: document.querySelector('#typing-input').value,
}));

const lastStoredAttempt = (page, userId) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).attempts.at(-1), `stilltype-profile-v2:${userId}`);

test('a dead-key quote mark followed by space is one typed character', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  const text = await quoteWithMarks(page);
  const at = text.indexOf('"');
  await recordHelp(page);
  await typeInto(page, text.slice(0, at));

  await keys.deadKey('"');
  // The mark waits in the field (no mid-composition reset) and is not yet scored.
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, at + 1));
  expect((await scored(page)).correct).toBe(at);
  await keys.commit('"');
  expect(await scored(page)).toEqual({ correct: at + 1, wrong: 0, value: text.slice(0, at + 1) });

  await page.keyboard.type(text.slice(at + 1));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-accuracy')).toHaveText('100');
  await expect(page.locator('#result-delta')).not.toHaveText('Interrupted · not counted');
  expect((await page.evaluate(() => window.helpSeen)).filter((text) => text.includes('IME'))).toEqual([]);
});

test('a quote with \' and " typed on accent keys completes as a counted run', async ({ page, supabase }) => {
  // Master's quotes have no apostrophe, so the precise ones gain one: the run needs both marks.
  await page.route('**/src/corpus.js', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll("difficulty: 'precise', text: '", "difficulty: 'precise', text: 'It\\'s here. ");
    await route.fulfill({ response, body });
  });
  const user = supabase.addUser('accents@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  const keys = await accentKeys(page);
  const text = await quoteWithMarks(page);
  expect(text.startsWith('It\'s here. ')).toBe(true);
  const at = text.indexOf('"');

  // Dead ' then s has no composed form, so both characters commit together and both count.
  await typeInto(page, 'It');
  await keys.deadKey("'");
  await keys.commit("'s");
  expect(await scored(page)).toEqual({ correct: 4, wrong: 0, value: "It's" });
  await typeWithAccentKeys(page, keys, text, 4);

  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-accuracy')).toHaveText('100');
  await expect(page.locator('#result-errors')).toHaveText('0');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');

  await expect.poll(() => lastStoredAttempt(page, user.id).then((stored) => stored?.textId)).toMatch(/^short-precise-/);
  const stored = await lastStoredAttempt(page, user.id);
  expect(stored.status).toBe('complete');
  expect(stored.interrupted).toBeFalsy();
  expect(stored.unsupportedInput).toBeFalsy();
  expect(stored.events.some((event) => event.type === 'composition')).toBe(false);
  expect(stored.typed).toBe(text);
  // A mark and its letter are two keystrokes from one commit, so they share its time.
  const inserts = stored.events.filter((event) => event.type === 'insert');
  expect(inserts).toHaveLength(text.length);
  expect(inserts[at].text + inserts[at + 1].text).toBe(text.slice(at, at + 2));
  expect(inserts[at + 1].offsetMs).toBe(inserts[at].offsetMs);
  // Deterministic replay, and the card shows the replayed speed.
  const replayed = await page.evaluate(async (attempt) => (await import('/src/typing.js')).replayAttempt(attempt).score, stored);
  expect(replayed).toEqual(stored.summary.score);
  await expect(page.locator('#result-wpm')).toHaveText(String(stored.summary.score.wpm));
});

test('a composed vowel where the mark belongs is a coral mistake, not an interruption', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  const text = await quoteWithMarks(page);
  const at = text.indexOf('"');
  await typeInto(page, text.slice(0, at));
  await keys.deadKey('"');
  await keys.commit('ä');
  expect(await scored(page)).toEqual({ correct: at, wrong: 1, value: text.slice(0, at) + 'ä' });
  const wrong = page.locator('#text-display .char.wrong');
  const tint = await wrong.evaluate((node) => ({
    background: getComputedStyle(node).backgroundColor,
    expected: getComputedStyle(document.documentElement).getPropertyValue('--danger-soft').trim(),
  }));
  expect(tint.background).toBe(tint.expected);
  await expect(page.locator('#input-help')).toHaveText('');

  await page.keyboard.press('Backspace');
  await keys.deadKey('"');
  await keys.commit('"');
  await page.keyboard.type(text.slice(at + 1));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-errors')).toHaveText('1');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
});

test('a pending mark is not input: the run waits, and a cancelled mark leaves nothing', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await quoteWithMarks(page);
  await page.locator('#typing-input').focus();
  await keys.deadKey('"');
  await expect(page.locator('#typing-input')).toHaveValue('"');
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  await expect(page.locator('body')).not.toHaveAttribute('data-running', 'true');

  await keys.cancel();
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  await expect(page.locator('#input-help')).toHaveText('');
  expect(await scored(page)).toEqual({ correct: 0, wrong: 0, value: '' });
});

test('IME text is still refused: the run is interrupted and not counted', async ({ page, supabase }) => {
  const user = supabase.addUser('ime@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await page.locator('#typing-input').focus();

  // Pinyin: one letter could be an accent preview, two cannot. The IME keeps its field.
  await keys.preview('n');
  await expect(page.locator('#input-help')).toHaveText('');
  await keys.preview('ni');
  await expect(page.locator('#input-help')).toHaveText(IME_NOTICE);
  await expect(page.locator('#typing-input')).toHaveValue('ni');
  await keys.commit('你');
  await expect(page.locator('#typing-input')).toHaveValue('');
  expect(await scored(page)).toEqual({ correct: 0, wrong: 0, value: '' });

  await page.keyboard.type(text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
  await expect.poll(() => lastStoredAttempt(page, user.id).then((stored) => stored?.status)).toBe('interrupted');
  const stored = await lastStoredAttempt(page, user.id);
  expect(stored.unsupportedInput).toBe(true);
  expect(stored.interrupted).toBe(true);
  expect(stored.events.filter((event) => event.type === 'composition')).toHaveLength(1);
  await expect(page.locator('#best')).toHaveText('No best yet');
});

test('a multi-character IME commit and a single kana are refused as before', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await page.locator('#typing-input').focus();

  // A one-letter preview that commits two letters is a word, not an accent key.
  await keys.preview('n');
  await keys.commit('no');
  await expect(page.locator('#input-help')).toHaveText(IME_NOTICE);
  await expect(page.locator('#typing-input')).toHaveValue('');
  await page.keyboard.type(text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');

  await page.locator('#run-again').click();
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  await keys.preview('あ');
  await expect(page.locator('#input-help')).toHaveText(IME_NOTICE);
  await keys.commit('あ');
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('#typing-status')).toHaveText('In progress');
});

test('Firefox and Safari composition orders each score the commit once', async ({ page }) => {
  await openApp(page);
  const text = await quoteWithMarks(page);
  const at = text.indexOf('"');
  const prefix = text.slice(0, at);
  // Chromium has no path that produces these orders, so dispatch them, setting the field as the browser would.
  const fire = (events) => page.evaluate((list) => {
    const input = document.querySelector('#typing-input');
    for (const [kind, type, init, value] of list) {
      if (value !== undefined) input.value = value;
      const event = kind === 'c' ? new CompositionEvent(type, { bubbles: true, ...init }) : new InputEvent(type, { bubbles: true, ...init });
      // Chromium blanks inputTypes it doesn't implement (insertFromComposition, deleteCompositionText).
      if (init.inputType && event.inputType !== init.inputType) Object.defineProperty(event, 'inputType', { value: init.inputType });
      input.dispatchEvent(event);
    }
  }, events);
  const markShown = (before) => [
    ['c', 'compositionstart', { data: '' }],
    ['c', 'compositionupdate', { data: '"' }],
    ['i', 'beforeinput', { inputType: 'insertCompositionText', data: '"', isComposing: true }],
    ['i', 'input', { inputType: 'insertCompositionText', data: '"', isComposing: true }, `${before}"`],
  ];

  await typeInto(page, prefix);
  // Firefox: beforeinput and input while composing, compositionend, then a trailing input.
  await fire([
    ...markShown(prefix),
    ['c', 'compositionupdate', { data: '"' }],
    ['i', 'beforeinput', { inputType: 'insertCompositionText', data: '"', isComposing: true }],
    ['i', 'input', { inputType: 'insertCompositionText', data: '"', isComposing: true }, `${prefix}"`],
    ['c', 'compositionend', { data: '"' }],
    ['i', 'input', { inputType: 'insertCompositionText', data: '"', isComposing: false }, `${prefix}"`],
  ]);
  expect(await scored(page)).toEqual({ correct: at + 1, wrong: 0, value: text.slice(0, at + 1) });

  // Safari: the composition text is deleted and re-inserted from the composition, then compositionend.
  await page.keyboard.press('Backspace');
  await fire([
    ...markShown(prefix),
    ['i', 'beforeinput', { inputType: 'deleteCompositionText', data: null, isComposing: true }],
    ['i', 'input', { inputType: 'deleteCompositionText', isComposing: true }, prefix],
    ['i', 'beforeinput', { inputType: 'insertFromComposition', data: `"${text[at + 1]}`, cancelable: true }],
    ['i', 'input', { inputType: 'insertFromComposition', data: `"${text[at + 1]}` }, text.slice(0, at + 2)],
    ['c', 'compositionend', { data: `"${text[at + 1]}` }],
  ]);
  expect(await scored(page)).toEqual({ correct: at + 2, wrong: 0, value: text.slice(0, at + 2) });

  // Safari, the other way round: compositionend first, then the insert from the composition.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await fire([
    ...markShown(prefix),
    ['i', 'beforeinput', { inputType: 'deleteCompositionText', data: null, isComposing: true }],
    ['i', 'input', { inputType: 'deleteCompositionText', isComposing: true }, prefix],
    ['c', 'compositionend', { data: '"' }],
    ['i', 'beforeinput', { inputType: 'insertFromComposition', data: '"', cancelable: true }],
    ['i', 'input', { inputType: 'insertFromComposition', data: '"' }, `${text.slice(0, at + 1)}"`],
  ]);
  expect(await scored(page)).toEqual({ correct: at + 1, wrong: 0, value: text.slice(0, at + 1) });
  await expect(page.locator('#input-help')).toHaveText('');
});

test('without composition (Windows), a mark and letter sent together are two keys', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  const text = await quoteWithMarks(page);
  const at = text.indexOf('"');
  await typeInto(page, text.slice(0, at));
  await page.keyboard.insertText('"');
  expect(await scored(page)).toEqual({ correct: at + 1, wrong: 0, value: text.slice(0, at + 1) });
  await page.keyboard.press('Backspace');
  await keys.commit(`"${text[at + 1]}`);
  expect(await scored(page)).toEqual({ correct: at + 2, wrong: 0, value: text.slice(0, at + 2) });
  await expect(page.locator('#input-help')).toHaveText('');

  await page.keyboard.insertText('xy');
  await expect(page.locator('#input-help')).toHaveText('One key at a time. Esc to restart.');
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, at + 2));
});

test('stop on error still blocks keys after a wrong accent commit', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.locator('#stop-on-error-toggle').check();
  await page.keyboard.press('Escape');
  const keys = await accentKeys(page);
  const text = await quoteWithMarks(page);
  await expect(page.locator('#condition-line')).toContainText('stop on error');
  const at = text.indexOf('"');
  const pair = text.slice(at, at + 2);
  await typeInto(page, text.slice(0, at));

  await keys.deadKey('"');
  await keys.commit('ä');
  await keys.deadKey('"');
  await keys.commit(pair);
  await expect(page.locator('#input-help')).toHaveText('Fix the underlined letter.');
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-blocked', 'true');
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, at) + 'ä');

  await page.keyboard.press('Backspace');
  await keys.deadKey('"');
  await keys.commit(pair);
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, at + 2));
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-blocked', 'false');
});

test('a mark pending when the clock runs out is not scored', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  const keys = await accentKeys(page);
  await page.locator('#duration-options [data-length="15"]').click();
  await expect(page.locator('#timer')).toHaveText('15');
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 10));
  await keys.deadKey('"');

  await page.clock.fastForward(15_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-time')).toHaveText('15.0 s');
  await expect(page.locator('#result-accuracy')).toHaveText('100');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
  await keys.commit('"');
  await expect(page.locator('#result-accuracy')).toHaveText('100');
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 10));
});

test('Esc with a mark pending restarts cleanly', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  await page.locator('#typing-input').focus();
  await keys.deadKey('"');
  await page.keyboard.press('Escape');
  await expect(page.locator('#typing-input')).toHaveValue('');
  const text = await passageText(page);
  await page.keyboard.type(text[0]);
  await expect(page.locator('#typing-input')).toHaveValue(text[0]);
  await expect(page.locator('#typing-status')).toHaveText('In progress');
});

test('a composition dropped without compositionend frees the field for the next key', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  const text = await quoteWithMarks(page);
  const at = text.indexOf('"');
  await typeInto(page, text.slice(0, at));
  await keys.deadKey('"');
  // Setting the field mid-composition ends it with no compositionend; the next commit is plain text.
  await page.evaluate(() => { document.querySelector('#typing-input').value = 'zz'; });
  await keys.commit('"');
  expect(await scored(page)).toEqual({ correct: at + 1, wrong: 0, value: text.slice(0, at + 1) });
  await page.keyboard.type(text.slice(at + 1, at + 4));
  expect(await scored(page)).toEqual({ correct: at + 4, wrong: 0, value: text.slice(0, at + 4) });
});

test('a composition over letters already typed (press-and-hold accents) does not type them again', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  // A doubled letter, where a second copy of the held letter would score as correct.
  let text = await passageText(page);
  for (let tries = 0; tries < 10 && !/([a-z])\1/.test(text); tries += 1) {
    await page.locator('#restart-button').click();
    text = await passageText(page);
  }
  const at = text.search(/([a-z])\1/);
  expect(at).toBeGreaterThanOrEqual(0);
  await typeInto(page, text.slice(0, at + 1));

  // Holding the letter opens the accent menu over it; typing on commits the same letter back.
  await keys.replace(text[at], at, at + 1);
  await keys.commit(text[at]);
  expect(await scored(page)).toEqual({ correct: at + 1, wrong: 0, value: text.slice(0, at + 1) });
  await expect(page.locator('#input-help')).toHaveText('');
  await page.keyboard.type(text.slice(at + 1));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-accuracy')).toHaveText('100');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');

  // Picking an accent from the menu changes a letter already scored: an input method's edit, refused.
  await page.locator('#run-again').click();
  const next = await passageText(page);
  const second = next.search(/[a-z]{2}/) + 1;
  await typeInto(page, next.slice(0, second + 1));
  await keys.replace(next[second], second, second + 1);
  await keys.preview('é');
  await keys.commit('é');
  await expect(page.locator('#input-help')).toHaveText(IME_NOTICE);
  expect(await scored(page)).toEqual({ correct: second + 1, wrong: 0, value: next.slice(0, second + 1) });
  await page.keyboard.type(next.slice(second + 1));
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
});

test('a held accent key is key repeat: what it commits is ignored', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  await page.evaluate(() => {
    window.repeats = [];
    window.addEventListener('keydown', (event) => { if (event.repeat) window.repeats.push(event.defaultPrevented); });
  });

  // macOS and Linux: each repeat commits the pending mark with another (^^) or shows a new one.
  await keys.deadKey('^');
  await keys.deadKeyRepeat();
  await keys.commit('^^');
  await keys.deadKeyRepeat();
  await keys.preview('^');
  await keys.deadKeyRepeat();
  await keys.commit('^^');
  // Windows: the repeat's keydown is cancelled; anything that still arrives is plain text.
  await keys.deadKeyRepeat();
  await keys.commit('^^');
  expect(await scored(page)).toEqual({ correct: 2, wrong: 0, value: text.slice(0, 2) });
  await expect(page.locator('#input-help')).toHaveText('Key repeat ignored.');
  expect(await page.evaluate(() => window.repeats)).toEqual([true, true, true, true]);

  // The next key press types as usual.
  await page.keyboard.type(text.slice(2, 5));
  expect(await scored(page)).toEqual({ correct: 5, wrong: 0, value: text.slice(0, 5) });
});

test('a mark pending when focus leaves does not start a ready run', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  const ready = async () => {
    await expect(page.locator('#typing-status')).toHaveText('Ready');
    expect(await scored(page)).toEqual({ correct: 0, wrong: 0, value: '' });
  };

  // macOS Chrome dispatches the window blur before it commits the pending mark.
  await page.locator('#typing-input').focus();
  await keys.deadKey('"');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await keys.commit('"');
  await ready();

  // Opening commands moves focus, and Chrome commits the mark on the way.
  await page.locator('#typing-input').focus();
  await keys.deadKey('"');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();
  await ready();

  // The run starts with its first real key, and counts.
  await typeInto(page, text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
});

test('both one-keyboard race players can type with accent keys', async ({ page }) => {
  // Race passages are medium quotes; keep those with quotation marks, so each turn uses the dead key.
  await page.route('**/src/typing.js', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('const candidates = quoteCorpus.filter(', 'const candidates = quoteCorpus.filter((item) => item.text.includes(\'"\')).filter(');
    await route.fulfill({ response, body });
  });
  await openApp(page);
  const keys = await accentKeys(page);
  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  await page.locator('#player-one-name').fill('Ada');
  await page.locator('#player-two-name').fill('Lin');
  await page.locator('#start-local-race').click();
  await expect(page.locator('#race-input')).toBeFocused();
  const text = await page.locator('#race-accessible-passage').textContent();
  expect(text).toContain('"');
  const raceScored = () => page.evaluate(() => ({
    correct: document.querySelectorAll('#race-text-display .char.correct').length,
    wrong: document.querySelectorAll('#race-text-display .char.wrong').length,
  }));

  // A mark pending as the window loses focus (macOS Chrome blurs before it commits) doesn't start the turn.
  await keys.deadKey('"');
  await page.evaluate(() => {
    document.querySelector('#race-input').dispatchEvent(new FocusEvent('blur'));
    window.dispatchEvent(new Event('blur'));
  });
  await keys.commit('"');
  await expect(page.locator('#race-input')).toHaveValue('');
  expect(await raceScored()).toEqual({ correct: 0, wrong: 0 });

  // The first mark waits in the field, unscored, until the next key commits it ("W together, or the
  // mark alone before a space); every other mark goes through the accent key too.
  const typeRace = async () => {
    const at = text.indexOf('"');
    await typeWithAccentKeys(page, keys, text, 0, at);
    await keys.deadKey('"');
    await expect(page.locator('#race-input')).toHaveValue(`${text.slice(0, at)}"`);
    expect(await raceScored()).toEqual({ correct: at, wrong: 0 });
    const commit = /[b-df-hj-np-tv-z]/i.test(text[at + 1]) ? text.slice(at, at + 2) : '"';
    await keys.commit(commit);
    await expect(page.locator('#race-input')).toHaveValue(text.slice(0, at + commit.length));
    expect(await raceScored()).toEqual({ correct: at + commit.length, wrong: 0 });
    await typeWithAccentKeys(page, keys, text, at + commit.length);
  };
  await typeRace();
  await expect(page.locator('#race-handoff')).toBeVisible();
  await page.locator('#start-next-player').click();
  await expect(page.locator('#race-input')).toBeFocused();
  await typeRace();

  await expect(page.locator('#race-leaderboard')).toBeVisible();
  await expect(page.locator('#race-winner')).toHaveText(/^(Ada leads\.|Lin leads\.|It’s a tie\.)$/);
  const rows = page.locator('.race-result-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(/\d+ wpm/);
  await expect(rows.nth(1)).toContainText(/\d+ wpm/);
  await expect(rows).toContainText(['100% accuracy', '100% accuracy']);
  await expect(page.locator('#race-help')).not.toHaveText(IME_NOTICE);
});
