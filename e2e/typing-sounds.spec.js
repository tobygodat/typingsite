// Typing sounds: off by default, a lazily created AudioContext, a click per key, a tick only for a
// mistyped letter, volume (0 is silent), palette commands and the guest/member preference rules.
// AudioContext is stubbed so each test can count what would have played. The first audible key asks
// for the context and is silent; the context is built after that key paints, never inside an event.
import { test, expect, openApp, openView, passageText, typeInto, chooseWords, completePassage, openSettings, signInWithEmail } from './fixtures.js';

async function stubAudio(page) {
  await page.addInitScript(() => {
    const log = { created: 0, closed: 0, plays: [], clickGains: [], builtDuring: [] };
    window.__sound = log;
    const node = (extra) => ({ connect(target) { return target; }, disconnect() {}, ...extra });
    const param = (record) => ({ value: 0, setValueAtTime(value) { record?.(value); return this; }, exponentialRampToValueAtTime() { return this; } });
    class FakeAudioContext {
      constructor() {
        log.created += 1;
        // window.event is set only while an event is being dispatched, as an input handler is.
        if (window.event) log.builtDuring.push(window.event.type);
        this.state = 'running';
        this.currentTime = 0;
        this.sampleRate = 48000;
        this.destination = node({});
      }
      resume() { return Promise.resolve(); }
      close() { log.closed += 1; this.state = 'closed'; return Promise.resolve(); }
      createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
      createBufferSource() { return node({ buffer: null, start() { log.plays.push('click'); }, stop() {} }); }
      createOscillator() { return node({ type: 'sine', frequency: param(), start() { log.plays.push('tick'); }, stop() {} }); }
      createBiquadFilter() { return node({ type: 'lowpass', frequency: { value: 0 }, Q: { value: 0 } }); }
      // The click sets its starting level once; the tick ramps, so only clicks are recorded here.
      createGain() { return node({ gain: param((value) => { if (value > 0.001) log.clickGains.push(value); }) }); }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });
}

const sound = (page) => page.evaluate(() => ({ ...window.__sound, plays: [...window.__sound.plays], clickGains: [...window.__sound.clickGains], builtDuring: [...window.__sound.builtDuring] }));
const plays = async (page) => (await sound(page)).plays;
const wrongFor = (char) => (char === 'x' ? 'z' : 'x');

// Types the first audible key, which makes no sound itself, and waits for the context it asked for.
async function firstKey(page, char, contexts = 1, selector = '#typing-input') {
  await typeInto(page, char, selector);
  await expect.poll(async () => (await sound(page)).created).toBe(contexts);
}

async function chooseSound(page, mode) {
  await openSettings(page);
  await page.locator('#sound-select').selectOption(mode);
  await page.keyboard.press('Escape');
  await expect(page.locator('.preferences-popover')).toBeHidden();
}

async function restart(page) {
  await page.locator('#typing-input').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveAttribute('data-running', 'true');
}

// Every settings row stays inside the popover, and the sound select shows its whole label. A
// select's scrollWidth never exceeds its clientWidth, so the label is measured in the select's own
// font against the room left by its padding and the native chevron (about 24px).
const settingsFit = (page) => page.evaluate(() => {
  const popover = document.querySelector('.preferences-popover').getBoundingClientRect();
  const select = document.getElementById('sound-select');
  const style = getComputedStyle(select);
  const pen = document.createElement('canvas').getContext('2d');
  pen.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const label = pen.measureText(select.selectedOptions[0].textContent).width;
  const room = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 24;
  return [...document.querySelectorAll('.preferences-popover .preference-row')].every((row) => row.getBoundingClientRect().right <= popover.right + 0.5)
    && label <= room;
});

async function shot(page, testInfo, name) {
  const path = process.env.SCREENSHOTS ? `docs/screenshots/typing-sounds/${name}.png` : testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
}

test.beforeEach(async ({ page }) => { await stubAudio(page); });
test.afterEach(async ({ page }) => {
  expect((await sound(page)).builtDuring, 'no AudioContext is built inside an event handler').toEqual([]);
});

test('sound is off by default and no audio context is made', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await expect(page.locator('#sound-select')).toHaveValue('off');
  await expect(page.locator('#sound-volume-row')).toBeVisible();
  await expect(page.locator('#sound-volume')).toBeDisabled();
  await page.keyboard.press('Escape');
  const text = await passageText(page);
  await typeInto(page, `${text.slice(0, 4)}${wrongFor(text[4])}`);
  await page.keyboard.press('Backspace');
  expect(await sound(page)).toMatchObject({ created: 0, plays: [] });
});

test('clicks wait for the first key; the tick marks only mistyped letters', async ({ page }) => {
  await openApp(page);
  await chooseSound(page, 'clicks');
  expect((await sound(page)).created, 'choosing a sound makes no context yet').toBe(0);

  let text = await passageText(page);
  await firstKey(page, text[0]);
  expect(await plays(page), 'the key that asked for the context is silent').toEqual([]);
  // Clicks only: a correct letter, a mistyped letter and a backspace each click.
  await page.keyboard.type(`${text[1]}${wrongFor(text[2])}`);
  await page.keyboard.press('Backspace');
  expect(await plays(page)).toEqual(['click', 'click', 'click']);

  await restart(page);
  await chooseSound(page, 'clicks-errors');
  text = await passageText(page);
  await typeInto(page, `${text[0]}${wrongFor(text[1])}`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text[1]);
  expect(await plays(page)).toEqual(['click', 'click', 'click', 'click', 'tick', 'click', 'click']);
  expect((await sound(page)).created, 'one context for the whole session').toBe(1);
});

test('stop on error: a refused key clicks, only the mistyped letter ticks', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.locator('#stop-on-error-toggle').check();
  await page.locator('#sound-select').selectOption('clicks-errors');
  await page.keyboard.press('Escape');
  const text = await passageText(page);
  await firstKey(page, text[0]);
  await page.keyboard.type(`${wrongFor(text[1])}${text[2]}`);
  await expect(page.locator('#input-help')).toHaveText('Fix the underlined letter.');
  expect(await plays(page)).toEqual(['tick', 'click']);
});

test('volume 0 is silent and a lower volume plays more quietly', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.locator('#sound-select').selectOption('clicks');
  await expect(page.locator('#sound-volume')).toBeEnabled();
  await expect(page.locator('#sound-volume')).toHaveValue('50');
  await page.locator('#sound-volume').fill('0');
  await expect(page.locator('#sound-volume-value')).toHaveText('0%');
  await expect(page.locator('#sound-volume')).toHaveAttribute('aria-valuetext', '0%');
  await page.keyboard.press('Escape');
  let text = await passageText(page);
  await typeInto(page, text.slice(0, 3));
  expect(await sound(page), 'volume 0 makes no context and no sound').toMatchObject({ created: 0, plays: [] });

  await restart(page);
  await openSettings(page);
  await page.locator('#sound-volume').fill('100');
  await page.keyboard.press('Escape');
  text = await passageText(page);
  await firstKey(page, text[0]);
  await page.keyboard.type(text[1]);
  await restart(page);
  await openSettings(page);
  await page.locator('#sound-volume').fill('25');
  await page.keyboard.press('Escape');
  text = await passageText(page);
  await typeInto(page, text[0]);
  const { plays: played, clickGains } = await sound(page);
  expect(played).toEqual(['click', 'click']);
  expect(clickGains[1]).toBeLessThan(clickGains[0]);
});

test('turning sound off closes the context; turning it on waits for the next key', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await chooseSound(page, 'clicks');
  let text = await passageText(page);
  // Sound isn't motion: reduced motion leaves it on.
  await firstKey(page, text[0]);
  await page.keyboard.type(text[1]);
  expect(await sound(page)).toMatchObject({ created: 1, closed: 0, plays: ['click'] });

  await restart(page);
  await chooseSound(page, 'off');
  expect((await sound(page)).closed).toBe(1);
  await expect(page.locator('#sound-volume')).toBeDisabled();
  text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  expect(await plays(page)).toEqual(['click']);

  await restart(page);
  await chooseSound(page, 'clicks');
  expect((await sound(page)).created).toBe(1);
  text = await passageText(page);
  await firstKey(page, text[0], 2);
  await page.keyboard.type(text[1]);
  expect(await sound(page)).toMatchObject({ created: 2, plays: ['click', 'click'] });
});

test('a whole run clicks once per key and still finishes normally', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await chooseSound(page, 'clicks-errors');
  // One key on a throwaway passage builds the context, so every key of the run below can click.
  await firstKey(page, (await passageText(page))[0]);
  await restart(page);
  const text = await completePassage(page);
  await expect(page.locator('#result-accuracy')).toHaveText('100');
  const played = await plays(page);
  expect(played).toHaveLength(text.length);
  expect(new Set(played)).toEqual(new Set(['click']));
});

test('palette commands set the sound and its volume', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await page.keyboard.press('Control+K');
  await expect(page.locator('#palette')).toBeVisible();
  await page.locator('#palette-input').fill('sound');
  const options = page.locator('#palette-list [role="option"]');
  await expect(options.filter({ hasText: 'sound · off' })).toHaveCount(1);
  await expect(options.filter({ hasText: 'sound · clicks + error tick' })).toHaveCount(1);
  // Volume commands wait until a sound is chosen, as the settings row does.
  await expect(options.filter({ hasText: 'sound volume' })).toHaveCount(0);
  await page.locator('#palette-input').fill('error tick');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('sound · clicks + error tick');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#sound-select')).toHaveValue('clicks-errors');

  await page.keyboard.press('Control+K');
  await page.locator('#palette-input').fill('sound');
  await expect(options.filter({ hasText: 'sound volume · 50%' }).locator('.opt-hint')).toHaveText('current');
  await expect(options.filter({ hasText: 'sound · clicks + error tick' }).locator('.opt-hint')).toHaveText('current');
  await shot(page, testInfo, 'palette-dark');
  await page.locator('#palette-input').fill('volume 25');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('sound volume · 25%');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sound-volume')).toHaveValue('25');
  await expect(page.locator('#sound-volume-value')).toHaveText('25%');
  expect((await sound(page)).created, 'palette changes make no context').toBe(0);
});

test('a guest’s sound choice lasts only for the tab', async ({ page }) => {
  await openApp(page);
  await chooseSound(page, 'clicks');
  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect(page.locator('#sound-select')).toHaveValue('off');
  await expect(page.locator('#sound-volume')).toBeDisabled();
});

test('a member’s sound and volume follow the account', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openSettings(page);
  await page.locator('#sound-select').selectOption('clicks-errors');
  await page.locator('#sound-volume').fill('75');
  await page.keyboard.press('Escape');
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences?.sound).toBe('clicks-errors');
  expect(supabase.profileFor('ada@stilltype.test').preferences.soundVolume).toBe(75);

  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect(page.locator('#sound-select')).toHaveValue('clicks-errors');
  await expect(page.locator('#sound-volume')).toHaveValue('75');
  expect((await sound(page)).created, 'still no context until a key').toBe(0);
  const text = await passageText(page);
  await firstKey(page, text[0]);
  await page.keyboard.type(text[1]);
  expect(await sound(page)).toMatchObject({ created: 1, plays: ['click'] });
});

for (const theme of ['dark', 'light']) {
  test(`settings show sound and volume (${theme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await openSettings(page);
    await page.locator('#sound-select').selectOption('clicks-errors');
    await expect(page.locator('#sound-volume')).toBeEnabled();
    expect(await settingsFit(page)).toBe(true);
    await page.locator('#sound-volume').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#sound-volume')).toHaveValue('55');
    await expect(page.locator('#sound-volume-value')).toHaveText('55%');
    await page.evaluate(() => document.activeElement.blur());
    await page.mouse.move(0, 400);
    await shot(page, testInfo, `settings-${theme}`);
  });
}

// On phones the popover grows up from the bottom dock. Choosing a sound must not move the row under
// the finger, the popover must stay clear of the account corner at the top, and every control must be
// reachable (scrolling inside the popover on short screens).
const phoneLayout = (page) => page.evaluate(() => {
  window.scrollTo(0, 0);
  const popover = document.querySelector('.preferences-popover');
  popover.scrollTop = 0;
  const box = popover.getBoundingClientRect();
  const corner = document.querySelector('.corner').getBoundingClientRect();
  const layout = { top: box.top, bottom: box.bottom, clearOfCorner: box.top >= corner.bottom, soundTop: document.getElementById('sound-select').getBoundingClientRect().top, covered: [] };
  for (const control of popover.querySelectorAll('select, input')) {
    control.scrollIntoView({ block: 'nearest' });
    const rect = control.getBoundingClientRect();
    const inside = rect.top >= box.top && rect.bottom <= box.bottom;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!inside || hit !== control) layout.covered.push(control.id);
  }
  popover.scrollTop = 0;
  window.scrollTo(0, 0);
  return layout;
});

for (const [width, height] of [[390, 844], [320, 844], [320, 568]]) {
  test(`settings fit a ${width}×${height} phone with sound on`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await openSettings(page);
    const before = await phoneLayout(page);
    expect(before).toMatchObject({ clearOfCorner: true, covered: [] });
    await page.locator('#sound-select').selectOption('clicks-errors');
    const after = await phoneLayout(page);
    expect(after, 'the popover keeps its height, clear of the account corner').toEqual(before);
    await page.locator('#sound-volume-row').scrollIntoViewIfNeeded();
    await expect(page.locator('#sound-volume-row')).toBeInViewport({ ratio: 1 });
    expect(await settingsFit(page)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 390) {
      await page.evaluate(() => document.activeElement.blur());
      await shot(page, testInfo, 'settings-mobile');
    }
  });
}

// Races have their own input path; each key there plays through the same module.
async function hostOnlineRace(page, browser, supabase) {
  supabase.addUser('host@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await chooseSound(page, 'clicks-errors');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#create-online-race').click();
  await expect(page.locator('#online-room')).toBeVisible();
  const context = await browser.newContext();
  const guest = await context.newPage();
  await supabase.attach(guest);
  await guest.goto(await page.locator('#online-guest-link').inputValue());
  await guest.locator('#online-guest-name').fill('Lin');
  await guest.locator('#join-online-race').click();
  await expect(page.locator('#online-players')).toContainText('Lin');
  await page.locator('#online-ready').click();
  await guest.locator('#online-ready').click();
  await expect(page.locator('#online-input')).toBeEnabled({ timeout: 12000 });
  return context;
}

test('an online race ticks a mistyped letter and clicks refused keys and backspaces', async ({ page, browser, supabase }) => {
  test.setTimeout(60000);
  const context = await hostOnlineRace(page, browser, supabase);
  try {
    const passage = await page.locator('#online-accessible-passage').textContent();
    await firstKey(page, passage[0], 1, '#online-input');
    // Races always stop on error: the mistyped letter ticks; the refused key, each backspace and a
    // backspace with nothing left to delete click.
    await page.keyboard.type(`${wrongFor(passage[1])}${passage[2]}`);
    await expect(page.locator('#online-help')).toHaveText('Correct the mistyped letter before continuing.');
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Backspace');
    await expect(page.locator('#online-input')).toHaveValue('');
    await page.keyboard.type(passage[0]);
    await expect(page.locator('#online-input')).toHaveValue(passage[0]);
    expect(await plays(page)).toEqual(['tick', 'click', 'click', 'click', 'click', 'click']);
  } finally { await context.close(); }
});

test('a one-keyboard challenge plays once per key', async ({ page }) => {
  await openApp(page);
  await chooseSound(page, 'clicks-errors');
  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  await page.locator('#player-one-name').fill('Ada');
  await page.locator('#player-two-name').fill('Lin');
  await page.locator('#start-local-race').click();
  await expect(page.locator('#race-input')).toBeFocused();
  const text = await page.locator('#race-accessible-passage').textContent();
  await firstKey(page, text[0], 1, '#race-input');
  await page.keyboard.type(`${text[1]}${wrongFor(text[2])}`);
  await page.keyboard.press('Backspace');
  expect(await plays(page)).toEqual(['click', 'tick', 'click']);
});
