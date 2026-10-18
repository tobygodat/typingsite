import { test, expect, openApp, passageText, typeInto, chooseWords, openSettings, openView, signInWithEmail, chooseMore, chooseSetting, chooseQuoteFilter } from './fixtures.js';

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
    // Letting go of a held dead key.
    releaseDeadKey: () => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 }),
    // Another accent key (^ on US-International), pressed while the first is still held.
    otherDeadKey: () => cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Dead', code: 'Digit6', windowsVirtualKeyCode: 54 }),
    // Chromium on Linux sends every key its input method takes (the accent key, its repeats, the letter
    // that commits the mark) as key Process, keyCode 229, keeping the key's code and repeat flag
    // (SendFakeProcessKeyEvent in input_method_auralinux.cc), before the composition change it makes.
    processKey: (code, autoRepeat = false) => cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code, windowsVirtualKeyCode: 229, autoRepeat }),
    // The next key commits the open composition; with none open this is plain text (the Windows lane).
    commit: (text) => cdp.send('Input.insertText', { text }),
    // Windows has no composition: the accent key's keydown (Dead) types nothing, then the next key's keydown
    // types the mark and that key, as one plain input or as one input per character (a WM_CHAR each).
    async windowsPair(key, code, ...inputs) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 });
      await this.windowsKey(key, code, ...inputs);
    },
    // One key on Windows: its keydown, then the plain inputs it types.
    async windowsKey(key, code, ...inputs) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code });
      for (const text of inputs) await cdp.send('Input.insertText', { text });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
    },
    // Windows: an accent key held past its repeats (their keydowns are cancelled), then let go. Each repeat
    // commits the pending mark or leaves a new one, so a mark may still be pending for the next key.
    async windowsHeld() {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 });
      await this.deadKeyRepeat();
      await this.deadKeyRepeat();
      await this.releaseDeadKey();
    },
    // Chrome on macOS sends the key that ends a composition first, as keyCode 229, then the commit
    // (render_widget_host_view_cocoa.mm, keyEvent:).
    async macKey(key, text) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key === 'Tab' ? 'Tab' : '', windowsVirtualKeyCode: 229 });
      await cdp.send('Input.insertText', { text });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === 'Tab' ? 'Tab' : '', windowsVirtualKeyCode: 229 });
    },
    // Tab with a mark pending, there: the commit comes before the real Tab, which moves focus in a later task.
    async macTab(mark = '"') {
      await this.macKey('Tab', mark);
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    },
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
  await chooseQuoteFilter(page, 'length', 'short');
  await chooseQuoteFilter(page, 'difficulty', 'precise');
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

// A commit that no key came before waits this long for one (COMMIT_KEY_WAIT_MS in src/app.js): Safari
// sends the key that ended a composition after it, and Tab, or focus moving, drops the mark.
const COMMIT_KEY_WAIT_MS = 100;
const readScore = (page, wait, display = '#text-display', field = '#typing-input') => page.evaluate(([ms, d, f]) => new Promise((resolve) => setTimeout(() => resolve({
  correct: document.querySelectorAll(`${d} .char.correct`).length,
  wrong: document.querySelectorAll(`${d} .char.wrong`).length,
  value: document.querySelector(f).value,
}), ms)), [wait, display, field]);
// Read once a commit's wait is over. Timers run in order of when they are due, so the read is deterministic.
const scored = (page) => readScore(page, COMMIT_KEY_WAIT_MS + 50);
// Read after the task that made a commit whose key came first (Chrome, Firefox), without the wait.
const scoredNow = (page) => readScore(page, 0);

// Safari dispatches composition events before the keydown of the key that caused them (WebKit runs the
// input method first): the accent key's mark shows, then its keydown; the next key's commit, then its
// keydown, then any focus change. Chromium has no path that produces this order, so dispatch it.
const safariOrder = (page, { field = '#typing-input', commit = '"', key = ' ', nextTask = false, focus = null }) => page.evaluate(async (o) => {
  const input = document.querySelector(o.field);
  const composition = (type, data) => input.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
  const keydown = (key) => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
  const nextTask = () => new Promise((resolve) => setTimeout(resolve));
  composition('compositionstart', '');
  composition('compositionupdate', '"');
  input.value += '"';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '"', isComposing: true }));
  keydown('Dead');
  await nextTask();
  composition('compositionend', o.commit);
  if (o.nextTask) await nextTask();
  if (o.key) keydown(o.key);
  if (o.focus === 'blur') input.blur();
  else if (o.focus) document.querySelector(o.focus).focus();
}, { field, commit, key, nextTask, focus });

// A run of key and composition events dispatched in one task, in the order given (Safari's, for a held key).
const start = (mark) => [{ type: 'compositionstart', data: '' }, { type: 'compositionupdate', data: mark }];
const end = (data) => ({ type: 'compositionend', data });
const down = (key, repeat = false) => ({ type: 'keydown', key, repeat });
const up = (key) => ({ type: 'keyup', key });
const dispatchEvents = (page, events, field = '#typing-input') => page.evaluate(([list, f]) => {
  const input = document.querySelector(f);
  for (const { type, data, key, repeat } of list) {
    if (type.startsWith('key')) {
      input.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key, repeat }));
      continue;
    }
    input.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
    if (type !== 'compositionupdate') continue;
    input.value += data;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data, isComposing: true }));
  }
}, [events, field]);

const lastStoredAttempt = (page, userId) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).attempts.at(-1), `stilltype-profile-v2:${userId}`);
const storedRuns = (page, userId) => page.evaluate((key) => JSON.parse(localStorage.getItem(key))?.runs ?? [], `stilltype-profile-v2:${userId}`);

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

  // From the accent key and the letter's keydowns: the pair as one input, or as one input per character
  // (the mark waits for the letter's input, so both are typed together).
  const letter = text[at + 1];
  for (const inputs of [[`"${letter}`], ['"', letter]]) {
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await keys.windowsPair(letter, `Key${letter.toUpperCase()}`, ...inputs);
    expect(await scoredNow(page), inputs.join('|')).toEqual({ correct: at + 2, wrong: 0, value: text.slice(0, at + 2) });
  }
  // A mark whose letter never comes as an input of its own is typed once the wait is over.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await keys.windowsPair(letter, `Key${letter.toUpperCase()}`, '"');
  expect(await scored(page)).toEqual({ correct: at + 1, wrong: 0, value: text.slice(0, at + 1) });
  await page.keyboard.type(letter);
  expect(await scoredNow(page)).toEqual({ correct: at + 2, wrong: 0, value: text.slice(0, at + 2) });
  await expect(page.locator('#input-help')).toHaveText('');

  await page.keyboard.insertText('xy');
  await expect(page.locator('#input-help')).toHaveText('One key at a time. Esc to restart.');
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, at + 2));
});

test('stop on error still blocks keys after a wrong accent commit', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await chooseSetting(page, 'correction-select', 'mandatory');
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

test('an accent commit made before a timed run’s limit counts, though it is scored after the limit', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  const keys = await accentKeys(page);
  await page.locator('#duration-options [data-length="15"]').click();
  await expect(page.locator('#timer')).toHaveText('15');
  // Chrome sends the letter's key before the commit, which is scored a task later; Safari sends it after
  // the commit, which waits for it. Either way the clock runs out before the commit is scored.
  const orders = {
    chrome: async () => {
      await keys.deadKey('´');
      await keys.macKey('e', 'é');
    },
    safari: () => dispatchEvents(page, [...start('´'), down('Dead'), end('é')]),
  };
  for (const [order, commit] of Object.entries(orders)) {
    const text = await passageText(page);
    // Time stands still while the run is typed, and the commit lands 50 ms before the limit.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await typeInto(page, text.slice(0, 10));
    await page.clock.fastForward(14_950);
    await expect(page.locator('#typing-status'), order).toHaveText('In progress');
    await commit();
    await page.clock.fastForward(300);
    await expect(page.locator('body'), order).toHaveAttribute('data-view', 'results');
    await expect(page.locator('#result-time'), order).toHaveText('15.0 s');
    await expect(page.locator('#typing-input'), order).toHaveValue(`${text.slice(0, 10)}é`);
    await expect(page.locator('#result-delta'), order).not.toHaveText('Interrupted · not counted');
    await page.clock.resume();
    await page.locator('#run-again').click();
    await expect(page.locator('#typing-status')).toHaveText('Ready');
  }

  // Focus leaving after the limit drops a commit still waiting for its key, and the run ends complete.
  const text = await passageText(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await typeInto(page, text.slice(0, 10));
  await page.clock.fastForward(14_950);
  await dispatchEvents(page, [...start('´'), down('Dead'), end('é')]);
  await page.clock.fastForward(60);
  await page.evaluate(() => {
    document.querySelector('#typing-input').dispatchEvent(new FocusEvent('blur'));
    window.dispatchEvent(new Event('blur'));
  });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-time')).toHaveText('15.0 s');
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 10));
  await expect(page.locator('#result-delta')).not.toHaveText('Interrupted · not counted');
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

// A browser can end a composition without compositionend and send what it commits as plain text. Setting
// the field mid-composition ends one that way here; the plain text after it stands for that commit.
const loseCompositionEnd = (page, field = '#typing-input') => page.evaluate((f) => { document.querySelector(f).value = 'zz'; }, field);

test('when compositionend is lost, an accent key’s commit still types and an input method’s is refused', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);

  // An accent key's mark: the plain text after it is typed, and the run counts.
  const quote = await quoteWithMarks(page);
  const mark = quote.indexOf('"');
  await typeInto(page, quote.slice(0, mark));
  await keys.deadKey('"');
  await loseCompositionEnd(page);
  await keys.commit('"');
  expect(await scored(page)).toEqual({ correct: mark + 1, wrong: 0, value: quote.slice(0, mark + 1) });
  await expect(page.locator('#input-help')).toHaveText('');
  // The field is free for the next keys.
  await page.keyboard.type(quote.slice(mark + 1, mark + 4));
  expect(await scored(page)).toEqual({ correct: mark + 4, wrong: 0, value: quote.slice(0, mark + 4) });
  await typeWithAccentKeys(page, keys, quote, mark + 4);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).not.toHaveText('Interrupted · not counted');

  // Pinyin previews n, and space commits 你 as plain text: that is the input method's commit, not a key.
  await page.locator('#run-again').click();
  await chooseWords(page, 10);
  const ways = {
    commit: async () => {
      await keys.processKey('KeyN');
      await keys.preview('n');
      await loseCompositionEnd(page);
      await keys.processKey('Space');
      await keys.commit('你');
    },
    // A backspace in between deletes a letter as usual; the text after it is still the commit.
    backspace: async () => {
      await keys.preview('n');
      await loseCompositionEnd(page);
      await page.keyboard.press('Backspace');
      await keys.commit('你');
    },
  };
  for (const [way, commit] of Object.entries(ways)) {
    await page.locator('#typing-input').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#typing-status'), way).toHaveText('Ready');
    const text = await passageText(page);
    await typeInto(page, text.slice(0, 3));
    await commit();
    await expect(page.locator('#input-help'), way).toHaveText(IME_NOTICE);
    const kept = way === 'backspace' ? 2 : 3;
    expect(await scored(page), way).toEqual({ correct: kept, wrong: 0, value: text.slice(0, kept) });
  }

  // The run no longer counts.
  const text = await passageText(page);
  await page.keyboard.type(text.slice(2));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
});

test('an input method’s composition dropped as focus leaves still has its plain commit refused', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  const ready = async (way) => {
    await page.locator('#typing-input').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#typing-status'), way).toHaveText('Ready');
  };

  // Chrome commits the preview as focus moves, then blurs the field: dropped, and the next key types.
  await ready('commit on the way out');
  const text = await passageText(page);
  await keys.preview('n');
  await page.locator('#restart-button').focus();
  await page.locator('#typing-input').focus();
  await page.keyboard.type(text[0]);
  expect(await scored(page)).toEqual({ correct: 1, wrong: 0, value: text[0] });
  await expect(page.locator('#input-help')).toHaveText('');

  // The window loses focus first (macOS Chrome), or the field does, with the composition still open; its
  // compositionend never comes, and its commit arrives as plain text.
  const ways = {
    window: async () => {
      await keys.preview('n');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await loseCompositionEnd(page);
      await keys.commit('你');
    },
    field: async () => {
      await keys.preview('n');
      await loseCompositionEnd(page);
      await page.locator('#restart-button').focus();
      await page.locator('#typing-input').focus();
      await keys.commit('你');
    },
  };
  for (const [way, leave] of Object.entries(ways)) {
    await ready(way);
    await leave();
    await expect(page.locator('#input-help'), way).toHaveText(IME_NOTICE);
    expect(await scored(page), way).toEqual({ correct: 0, wrong: 0, value: '' });
  }
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

test('a mark a held accent key leaves pending is repeat too, whichever order its letter arrives in', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  const unscored = { correct: 2, wrong: 0, value: text.slice(0, 2) };

  // Chrome and Firefox: the last repeat shows a new mark, then the next letter's keydown comes before
  // the commit it ends (â).
  await keys.deadKey('^');
  await keys.deadKeyRepeat();
  await keys.commit('^^');
  await keys.deadKeyRepeat();
  await keys.preview('^');
  await keys.releaseDeadKey();
  await keys.macKey('a', 'â');
  expect(await scored(page)).toEqual(unscored);
  await expect(page.locator('#input-help')).toHaveText('Key repeat ignored.');

  // Safari: each key's composition events come before its keydown, the first repeat's commit (^^) included.
  await dispatchEvents(page, [
    ...start('^'), down('Dead'),
    end('^^'), down('Dead', true),
    ...start('^'), down('Dead', true),
    up('Dead'),
    end('â'), down('a'),
  ]);
  expect(await scored(page)).toEqual(unscored);
  await expect(page.locator('#input-help')).toHaveText('Key repeat ignored.');

  // Once the key is let go, a fresh accent key types its mark again (here " then space, a wrong letter).
  await dispatchEvents(page, [
    ...start('^'), down('Dead'), end('^^'), down('Dead', true), up('Dead'),
    ...start('"'), down('Dead'), end('"'), down(' '),
  ]);
  expect(await scored(page)).toEqual({ correct: 2, wrong: 1, value: `${text.slice(0, 2)}"` });
  await keys.deadKey('"');
  await keys.commit('"');
  expect(await scored(page)).toEqual({ correct: 2, wrong: 2, value: `${text.slice(0, 2)}""` });
});

test('a held accent key is key repeat on Linux too, where its repeats arrive as Process keys', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  const unscored = { correct: 2, wrong: 0, value: text.slice(0, 2) };
  await page.evaluate(() => {
    window.repeats = [];
    window.addEventListener('keydown', (event) => { if (event.repeat) window.repeats.push(event.defaultPrevented); });
  });

  // Each repeat commits the pending mark (^) or shows a new one.
  await keys.processKey('Quote');
  await keys.preview('^');
  await keys.processKey('Quote', true);
  await keys.commit('^');
  await keys.processKey('Quote', true);
  await keys.preview('^');
  await keys.processKey('Quote', true);
  await keys.commit('^');
  expect(await scored(page)).toEqual(unscored);
  await expect(page.locator('#input-help')).toHaveText('Key repeat ignored.');
  // An input method that shows no mark sends a repeat's commit as plain text, as Windows does.
  await keys.processKey('Quote', true);
  await keys.commit('^');
  expect(await scored(page)).toEqual(unscored);
  expect(await page.evaluate(() => window.repeats)).toEqual([true, true, true, true]);

  // The mark the last repeat leaves pending is repeat too, with the letter that commits it (â).
  await keys.processKey('Quote', true);
  await keys.preview('^');
  await keys.releaseDeadKey();
  await keys.processKey('KeyA');
  await keys.commit('â');
  expect(await scored(page)).toEqual(unscored);
  await expect(page.locator('#input-help')).toHaveText('Key repeat ignored.');

  // Once it is let go, a fresh accent key types its mark (here " then space, a wrong letter).
  await keys.processKey('Quote');
  await keys.preview('"');
  await keys.processKey('Space');
  await keys.commit('"');
  expect(await scored(page)).toEqual({ correct: 2, wrong: 1, value: `${text.slice(0, 2)}"` });
});

test('on Windows, a mark a held accent key leaves pending is repeat too, with all the next key types', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  const unscored = { correct: 2, wrong: 0, value: text.slice(0, 2) };
  const code = (key) => (key === ' ' ? 'Space' : /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : '');

  // No composition marks the pending mark: once the key is let go, the next key commits it as plain text,
  // as one input (â, ^h) or two (^ then h), the mark alone after a space, or both marks from the accent key
  // pressed again. The repeats show the notice already, so it is cleared to see the commit's own.
  for (const [key, ...inputs] of [['a', 'â'], ['h', '^h'], ['h', '^', 'h'], [' ', '^'], ['Dead', '^', '^']]) {
    await keys.windowsHeld();
    await page.evaluate(() => { document.querySelector('#input-help').textContent = ''; });
    await keys.windowsKey(key, key === 'Dead' ? 'Quote' : code(key), ...inputs);
    expect(await scored(page), inputs.join('|')).toEqual(unscored);
    await expect(page.locator('#input-help'), inputs.join('|')).toHaveText('Key repeat ignored.');
  }

  // The next key press types as usual, and so does a key after a held one that left no mark pending.
  await page.keyboard.type(text[2]);
  expect(await scored(page)).toEqual({ correct: 3, wrong: 0, value: text.slice(0, 3) });
  await keys.windowsHeld();
  await keys.windowsKey(text[3], code(text[3]), text[3]);
  expect(await scored(page)).toEqual({ correct: 4, wrong: 0, value: text.slice(0, 4) });
  await typeInto(page, text.slice(4));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-accuracy')).toHaveText('100');
});

test('another accent key pressed while one is held types its own mark, whichever order the events come in', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 2));

  // Safari: the second key's composition comes before its own keydown, while the first key is still down.
  await dispatchEvents(page, [
    ...start('^'), down('Dead'), end('^^'), down('Dead', true),
    ...start('"'), down('Dead'), end('"'), down(' '), up('Dead'),
  ]);
  expect(await scored(page)).toEqual({ correct: 2, wrong: 1, value: `${text.slice(0, 2)}"` });
  // The same with a repeated mark still pending: the second key commits it (dropped), then shows its own.
  await dispatchEvents(page, [
    ...start('^'), down('Dead'), end('^^'), down('Dead', true),
    ...start('^'), down('Dead', true),
    end('^'), ...start('"'), down('Dead'), end('"'), down(' '), up('Dead'),
  ]);
  expect(await scored(page)).toEqual({ correct: 2, wrong: 2, value: `${text.slice(0, 2)}""` });

  // Chrome and Firefox: the second key's keydown comes first, then the held key's pending mark (dropped)
  // and the second key's own.
  await keys.deadKey('^');
  await keys.deadKeyRepeat();
  await keys.commit('^^');
  await keys.deadKeyRepeat();
  await keys.preview('^');
  await keys.otherDeadKey();
  await keys.commit('^');
  await keys.preview('"');
  await keys.releaseDeadKey();
  await keys.macKey(' ', '"');
  expect(await scored(page)).toEqual({ correct: 2, wrong: 3, value: `${text.slice(0, 2)}"""` });
});

test('an accent key let go where the field can’t hear it doesn’t hold back the next one', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await page.locator('#duration-options [data-length="15"]').click();
  await expect(page.locator('#timer')).toHaveText('15');
  const text = await passageText(page);
  // Safari order: the key is held past its first repeat; the next accent key's composition comes first.
  const held = [...start('^'), down('Dead'), end('^^'), down('Dead', true)];
  const fresh = [...start('"'), down('Dead'), end('"'), down(' ')];

  // A timed run ends with the key held: the field is disabled, and the key is let go on Run again.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await typeInto(page, text.slice(0, 10));
  await dispatchEvents(page, held);
  await page.clock.fastForward(15_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#run-again')).toBeFocused();
  await page.locator('#run-again').dispatchEvent('keyup', { key: 'Dead' });
  await page.clock.resume();
  await page.locator('#run-again').click();
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await dispatchEvents(page, fresh);
  await expect(page.locator('#typing-input')).toHaveValue('"');
  await expect(page.locator('#typing-status')).toHaveText('In progress');

  // Mid-run, focus moves (a click elsewhere, a window switch) and the key is let go there.
  await dispatchEvents(page, held);
  await page.locator('#restart-button').focus();
  await page.locator('#restart-button').dispatchEvent('keyup', { key: 'Dead' });
  await page.locator('#typing-input').focus();
  await dispatchEvents(page, fresh);
  await expect(page.locator('#typing-input')).toHaveValue('""');
});

// Each way focus moves to a control on the page with a mark pending. Chrome commits the mark as focus
// moves, then blurs the field (Tab, a click); on macOS it commits on Tab's first keydown, a task before
// the Tab that moves focus. Firefox and Safari blur first and commit after.
const leaveWithMark = {
  tab: async (page) => {
    await page.keyboard.press('Tab');
    await expect(page.locator('#restart-button')).toBeFocused();
  },
  macTab: async (page, keys) => {
    await keys.macTab();
    await expect(page.locator('#restart-button')).toBeFocused();
  },
  click: async (page) => {
    // A run fades the chrome until the pointer moves.
    await page.mouse.move(5, 5);
    await page.mouse.move(40, 40);
    await page.locator('.dock-settings').click();
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-dialog')).toBeHidden();
  },
  blurFirst: async (page, keys) => {
    await page.evaluate(() => document.querySelector('#typing-input').dispatchEvent(new FocusEvent('blur')));
    await keys.commit('"');
  },
};

// Before a run starts, focus can also leave the page: macOS Chrome dispatches the window blur before it
// commits the pending mark, and opening commands moves focus, with Chrome committing the mark on the way.
const leaveReadyRun = {
  windowBlur: async (page, keys) => {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await keys.commit('"');
  },
  palette: async (page) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('#palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#palette')).toBeHidden();
  },
};

test('a mark pending when focus moves on is dropped, and the run stays ready or in progress as it was', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  const leaveEachWay = async (ways, typed, status) => {
    for (const [way, leave] of Object.entries(ways)) {
      // Clicking the passage puts focus back in the field.
      await page.locator('#typing-input').click();
      await keys.deadKey('"');
      await expect(page.locator('#typing-input'), way).toHaveValue(`${typed.value}"`);
      await leave(page, keys);
      expect(await scored(page), way).toEqual(typed);
      await expect(page.locator('#typing-status'), way).toHaveText(status);
      await expect(page.locator('#input-help'), way).toHaveText('');
    }
  };

  await leaveEachWay({ ...leaveWithMark, ...leaveReadyRun }, { correct: 0, wrong: 0, value: '' }, 'Ready');
  // The run starts with its first real key. Moving focus within the page neither ends it nor stops it counting.
  await typeInto(page, text.slice(0, 5));
  await leaveEachWay(leaveWithMark, { correct: 5, wrong: 0, value: text.slice(0, 5) }, 'In progress');

  await page.locator('#typing-input').click();
  await page.keyboard.type(text.slice(5));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-accuracy')).toHaveText('100');
  await expect(page.locator('#result-errors')).toHaveText('0');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
});

test('a mark committed a task or more before focus moves (Safari, a click on macOS) is dropped too', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  // Safari sends Tab's keydown after the commit, in the same task or a later one; a click on macOS
  // commits as it begins, and moves focus a task later.
  const orders = {
    safariTab: { key: 'Tab', focus: '#restart-button' },
    safariTabNextTask: { key: 'Tab', nextTask: true, focus: '#restart-button' },
    macClick: { key: null, nextTask: true, focus: '.dock-settings' },
  };
  const leaveEachWay = async (typed, status) => {
    for (const [way, order] of Object.entries(orders)) {
      await page.locator('#typing-input').focus();
      await safariOrder(page, order);
      expect(await scored(page), way).toEqual(typed);
      await expect(page.locator('#typing-status'), way).toHaveText(status);
      await expect(page.locator('#input-help'), way).toHaveText('');
    }
  };

  await leaveEachWay({ correct: 0, wrong: 0, value: '' }, 'Ready');
  await typeInto(page, text.slice(0, 5));
  await leaveEachWay({ correct: 5, wrong: 0, value: text.slice(0, 5) }, 'In progress');

  await page.locator('#typing-input').focus();
  await page.keyboard.type(text.slice(5));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-accuracy')).toHaveText('100');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
});

test('a mark is typed as soon as the key that commits it arrives, before or after the commit', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  const text = await quoteWithMarks(page);
  const at = text.indexOf('"');
  const pair = text.slice(at, at + 2);
  const typed = { correct: at + 2, wrong: 0, value: text.slice(0, at + 2) };
  await typeInto(page, text.slice(0, at));

  // Chrome on macOS: the key, then the commit.
  await keys.deadKey('"');
  await keys.macKey(pair[1], pair);
  expect(await scoredNow(page)).toEqual(typed);

  // Safari: the commit, then the key.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await safariOrder(page, { commit: pair, key: pair[1] });
  expect(await scoredNow(page)).toEqual(typed);

  await page.keyboard.type(text.slice(at + 2));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
});

test('an emoji committed through a composition is refused like IME text', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 3));

  // An emoji picker or phone keyboard: 😀 is two UTF-16 units, so typing it would move the caret two letters.
  await keys.preview('😀');
  await expect(page.locator('#input-help')).toHaveText(IME_NOTICE);
  await keys.commit('😀');
  expect(await scored(page)).toEqual({ correct: 3, wrong: 0, value: text.slice(0, 3) });
  await page.keyboard.type(text.slice(3));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');

  // A pictograph from the Basic Multilingual Plane, committed straight into an accent key's composition.
  await page.locator('#run-again').click();
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  await keys.deadKey('"');
  await keys.commit('❤');
  await expect(page.locator('#input-help')).toHaveText(IME_NOTICE);
  expect(await scored(page)).toEqual({ correct: 0, wrong: 0, value: '' });
});

test('a one-letter commit no accent key opened is refused like IME text, whatever its script', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  // Each way an input method commits a single letter with no accent key behind it.
  const ways = {
    // Hindi: the letter shows, then commits.
    hindi: () => keys.preview('अ').then(() => keys.commit('अ')),
    // Russian on Linux: Chromium sends key Process, then the input method's letter.
    russian: async () => {
      await keys.processKey('KeyF');
      await keys.preview('ж');
      await keys.commit('ж');
    },
    // Hebrew, committed with nothing shown first and no key before it (Safari's order).
    hebrew: () => dispatchEvents(page, [{ type: 'compositionstart', data: '' }, end('ש')]),
    // Pinyin or Telex committing the very letter the passage wants next: Latin, but an input method's.
    latin: async (next) => {
      await keys.processKey(`Key${next.toUpperCase()}`);
      await keys.preview(next);
      await keys.commit(next);
    },
  };
  for (const [way, commit] of Object.entries(ways)) {
    await page.locator('#typing-input').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#typing-status'), way).toHaveText('Ready');
    const text = await passageText(page);
    const at = 3 + text.slice(3).search(/[a-z]/);
    await typeInto(page, text.slice(0, at));
    await commit(text[at]);
    await expect(page.locator('#input-help'), way).toHaveText(IME_NOTICE);
    expect(await scored(page), way).toEqual({ correct: at, wrong: 0, value: text.slice(0, at) });
  }

  // The run no longer counts.
  const text = await passageText(page);
  const typed = (await page.locator('#typing-input').inputValue()).length;
  await page.keyboard.type(text.slice(typed));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
});

test('a symbol a Latin layout’s own key types after an accent mark is a slip, not IME text', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  await chooseWords(page, 10);
  // Each way an accent key commits a punctuation mark or symbol past Latin-1: a typing error, in the run.
  const ways = {
    // Linux (IBus): dead circumflex, then 4, composes the superscript (Compose: <dead_circumflex> <4>).
    linux: async () => {
      await keys.processKey('Digit6');
      await keys.preview('^');
      await keys.processKey('Digit4');
      await keys.commit('⁴');
      return '⁴';
    },
    // Windows US-International: dead ', then AltGr+0 (’), sent as one plain input.
    windows: () => keys.windowsPair('’', 'Digit0', "'’").then(() => "'’"),
    // macOS: dead ", then Option+Shift+- (—).
    mac: () => keys.deadKey('"').then(() => keys.commit('"—')).then(() => '"—'),
  };
  let text = '';
  let typed = '';
  for (const [way, slip] of Object.entries(ways)) {
    await page.locator('#typing-input').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#typing-status'), way).toHaveText('Ready');
    text = await passageText(page);
    await typeInto(page, text.slice(0, 3));
    typed = text.slice(0, 3) + await slip();
    await expect(page.locator('#input-help'), way).toHaveText('');
    expect(await scored(page), way).toEqual({ correct: 3, wrong: typed.length - 3, value: typed });
  }

  // The run still counts.
  await page.keyboard.type(text.slice(typed.length));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).not.toHaveText('Interrupted · not counted');
});

test('a commit on a passage’s last letter counts every key in it before the run ends', async ({ page, supabase }) => {
  const user = supabase.addUser('last-letter@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  const keys = await accentKeys(page);
  const custom = 'She said "go"';
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(custom);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');

  // The closing " takes the accent key, and the h that commits it is a slip (space types the mark alone).
  // The passage has no place for the h, so it is a mistake against the last letter and not kept: 13 of 14
  // keys right, nothing left wrong in the text, one extra. Plain keys can't do this: a plain " ends the run
  // before the next key, but here the h was pressed while the last letter was still to come. Stop on
  // error has nothing left to hold, so the run ends the same way.
  const ways = {
    composition: () => keys.deadKey('"').then(() => keys.commit('"h')),
    // Windows has no composition: the h's keydown types the mark and the h as one plain input, or as two
    // (one per character), and then the mark waits for the h's input.
    windows: () => keys.windowsPair('h', 'KeyH', '"h'),
    windowsTwoInputs: () => keys.windowsPair('h', 'KeyH', '"', 'h'),
    stopOnError: () => keys.deadKey('"').then(() => keys.commit('"h')),
  };
  for (const [way, commit] of Object.entries(ways)) {
    if (way === 'stopOnError') {
      await openSettings(page);
      await chooseSetting(page, 'correction-select', 'mandatory');
      await page.keyboard.press('Escape');
      await expect(page.locator('#condition-line')).toContainText('stop on error');
    }
    expect(await passageText(page), way).toBe(custom);
    await typeInto(page, custom.slice(0, -1));
    await commit();
    await expect(page.locator('body'), way).toHaveAttribute('data-view', 'results');
    await expect(page.locator('#result-accuracy'), way).toHaveText('93');
    await expect(page.locator('#result-errors'), way).toHaveText('0');
    await expect(page.locator('#result-chars'), way).toHaveText('13/0/1/0');
    await expect(page.locator('#typing-input'), way).toHaveValue(custom);
    await expect(page.locator('#result-delta'), way).toHaveText('Custom text complete · not counted toward your best');
    await expect.poll(async () => (await storedRuns(page, user.id)).length, way).toBe(Object.keys(ways).indexOf(way) + 1);
    const run = (await storedRuns(page, user.id)).at(-1);
    expect(run.status, way).toBe('complete');
    expect(run.score.accuracy, way).toBe(93);
    await page.locator('#run-again').click();
    await expect(page.locator('#typing-status')).toHaveText('Ready');
  }
});

test('a doubled mark on a passage’s last letter costs nothing, after a slip too', async ({ page }) => {
  await openApp(page);
  const keys = await accentKeys(page);
  const custom = 'She said "go"';
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(custom);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');

  // One slip left in (Sxe), then the closing ". A plain " scores 12 of 13 and ends the run, so a second
  // press of the key is never recorded. Pressing the accent key twice commits "" on the last letter: the
  // second mark is that letter again, so it adds nothing either, and can't lift accuracy to 13 of 14.
  const ways = {
    plain: () => page.keyboard.type('"'),
    composition: () => keys.deadKey('"').then(() => keys.commit('""')),
    // Windows: the second press is the accent key again, and each mark comes as an input of its own.
    windows: () => keys.windowsPair('Dead', 'Quote', '"', '"'),
  };
  for (const [way, close] of Object.entries(ways)) {
    expect(await passageText(page), way).toBe(custom);
    await typeInto(page, 'Sxe said "go');
    await close();
    await expect(page.locator('body'), way).toHaveAttribute('data-view', 'results');
    await expect(page.locator('#result-accuracy'), way).toHaveText('92');
    await expect(page.locator('#result-chars'), way).toHaveText('12/1/0/0');
    await page.locator('#run-again').click();
    await expect(page.locator('#typing-status')).toHaveText('Ready');
  }
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
  const raceScored = async () => {
    const { correct, wrong } = await readScore(page, COMMIT_KEY_WAIT_MS + 50, '#race-text-display', '#race-input');
    return { correct, wrong };
  };

  // A mark pending as the window loses focus (macOS Chrome blurs before it commits) doesn't start the turn.
  await keys.deadKey('"');
  await page.evaluate(() => {
    document.querySelector('#race-input').dispatchEvent(new FocusEvent('blur'));
    window.dispatchEvent(new Event('blur'));
  });
  await keys.commit('"');
  await expect(page.locator('#race-input')).toHaveValue('');
  expect(await raceScored()).toEqual({ correct: 0, wrong: 0 });
  // Nor does one Chrome commits as Tab moves focus on.
  await page.locator('#race-input').focus();
  await keys.deadKey('"');
  await page.keyboard.press('Tab');
  await expect(page.locator('#race-input')).not.toBeFocused();
  expect(await raceScored()).toEqual({ correct: 0, wrong: 0 });
  // Nor one that Tab commits on macOS: Chrome sends Tab before the commit, Safari after it.
  await page.locator('#race-input').focus();
  await keys.deadKey('"');
  await keys.macTab();
  await expect(page.locator('#race-input')).not.toBeFocused();
  expect(await raceScored()).toEqual({ correct: 0, wrong: 0 });
  await page.locator('#race-input').focus();
  await safariOrder(page, { field: '#race-input', key: 'Tab', nextTask: true, focus: 'blur' });
  await expect(page.locator('#race-input')).not.toBeFocused();
  expect(await raceScored()).toEqual({ correct: 0, wrong: 0 });
  await expect(page.locator('#race-help')).not.toHaveText('Focus lost. Esc to restart this turn.');
  await page.locator('#race-input').focus();

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
