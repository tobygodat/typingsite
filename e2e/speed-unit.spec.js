// Speed unit: wpm (default) or cpm. Display only: scoring, bests, comparisons and condition keys stay in wpm.
import { CORPUS_VERSION, METRIC_VERSION, standardConditions, conditionKey } from '../src/typing.js';
import { test, expect, openApp, openView, openSettings, chooseWords, chooseMore, completePassage, freshTextCheck, passageText, typeInto, signInWithEmail } from './fixtures.js';

test.setTimeout(120000);

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Screenshots go to the docs only when asked for; otherwise into the test's own output.
async function shot(page, testInfo, name) {
  const path = process.env.SCREENSHOTS ? `docs/screenshots/speed-unit/${name}.png` : testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
}

// Types like a person, roughly 60–90 wpm: uneven gaps between keys, a beat after some spaces, and
// one slip corrected with Backspace. Seeded, so a run is repeatable.
async function typeHumanly(page, text, { seed = 7, slip = true } = {}) {
  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const words = text.match(/\S+\s*|\s+/g) || [];
  const slipAt = slip ? Math.floor(words.length * 0.4) : -1;
  for (const [index, word] of words.entries()) {
    if (index === slipAt && /^[a-z]/.test(word)) {
      await page.keyboard.type(word[0] === 'e' ? 'r' : 'e');
      await page.waitForTimeout(220);
      await page.keyboard.press('Backspace');
    }
    // Each word at its own pace (one driver call per word keeps the pace steady on a busy machine).
    await page.keyboard.type(word, { delay: 70 + random() * 90 });
    if (random() < 0.35) await page.waitForTimeout(80 + random() * 220);
  }
}

async function typeRun(page, seed) {
  await page.locator('#typing-input').focus();
  await typeHumanly(page, await passageText(page), { seed });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
}

async function command(page, label) {
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();
  await page.keyboard.type(label);
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText(label);
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
}

// "+15 wpm" → [sign, 15]
const parseSigned = (text) => {
  const match = text.match(/^([+−]?)(\d+(?:\.\d+)?) (wpm|cpm)$/);
  expect(match, text).not.toBeNull();
  return [match[1], Number(match[2])];
};

test('cpm changes only the display: the run card, best, graph and Progress read in it, and switch back', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await chooseWords(page, 10);
  await typeRun(page, 11);
  const first = Number(await page.locator('#result-wpm').textContent());
  expect(first).toBeGreaterThanOrEqual(40);
  expect(first).toBeLessThanOrEqual(110);
  await expect(page.locator('.run-card-unit')).toHaveText('wpm');
  await expect(page.locator('#best')).toHaveText(`Best · ${first} wpm`);
  const raw = Number(await page.locator('#result-raw').textContent());
  const rawRow = page.locator('.run-card-more > div', { has: page.locator('#result-raw') });
  await expect(rawRow).toHaveAttribute('title', 'Every character typed, mistakes included: characters ÷ 5 per minute');
  await expect(page.locator('#result-word-detail')).toContainText(/^fastest “.+” \d+ wpm · slowest/);

  await openSettings(page);
  await expect(page.locator('#speed-unit')).toHaveValue('wpm');
  await page.locator('#speed-unit').selectOption('cpm');
  await expect(page.locator('#result-wpm')).toHaveText(String(first * 5));
  await expect(page.locator('.run-card-unit')).toHaveText('cpm');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
  await expect(page.locator('#best')).toHaveText(`Best · ${first * 5} cpm`);
  await expect(page.locator('#speed-definition')).toHaveText('cpm counts correct characters kept (wpm × 5)');
  await expect(page.locator('.legend-speed')).toHaveText('speed · cpm');
  // The run card's secondary stats read in the unit too: raw speed and each word's pace.
  await expect(page.locator('#result-raw')).toHaveText(String(raw * 5));
  await expect(page.locator('.run-card-more dt').first()).toHaveText('raw cpm');
  // Its tooltip defines the unit shown, not five-character words.
  await expect(rawRow).toHaveAttribute('title', 'Every character typed, mistakes included: characters per minute');
  await expect(page.locator('#result-word-detail')).toContainText(/^fastest “.+” \d+ cpm · slowest “.+” \d+ cpm/);
  await expect(page.locator('#result-words [role="option"]').first()).toHaveAttribute('aria-label', /, (\d+ cpm|no pace)/);
  await expect(page.locator('#speed-graph')).toHaveAttribute('aria-label', new RegExp(`^Speed over time: average ${first * 5} cpm, peak \\d+ cpm, lowest \\d+ cpm\\.`));
  // The axis is drawn in cpm: its top gridline sits above the run's own average.
  const labels = await page.locator('#speed-graph text.graph-label').allTextContents();
  expect(Math.max(...labels.map(Number).filter(Number.isFinite))).toBeGreaterThanOrEqual(first * 5);
  await expect(page.locator('.preferences-popover')).toContainText('live cpm and accuracy');
  await shot(page, testInfo, 'settings-dark');
  await page.keyboard.press('Escape');

  // Same conditions, so the same best: the headline compares in cpm.
  await page.locator('#run-again').click();
  await typeRun(page, 29);
  const second = Number(await page.locator('#result-wpm').textContent());
  const accuracy = await page.locator('#result-accuracy').textContent();
  expect(second % 5).toBe(0);
  expect(second / 5).toBeGreaterThanOrEqual(40);
  expect(second / 5).toBeLessThanOrEqual(110);
  await expect(page.locator('#result-delta')).toHaveText(new RegExp(`^(Matched your best of|[+−]\\d+ vs your best of) ${first * 5} cpm$`));
  await expect(page.locator('#announcement')).toHaveText(`${second} cpm, ${accuracy}% accuracy.`);
  await expect(page.locator('#best')).toHaveText(`Best · ${Math.max(first * 5, second)} cpm`);
  await shot(page, testInfo, 'results-dark');

  await openView(page, 'Progress');
  await expect(page.locator('#progress-trend figcaption').first()).toHaveText('Corrected CPM');
  await expect(page.locator('#run-history .run-summary strong').first()).toHaveText(new RegExp(`^${second} cpm · \\d+%$`));
  await expect(page.locator('#progress-trend .trend-dot.trend-wpm').last()).toHaveAttribute('aria-label', new RegExp(`: ${second} CPM\\. View run\\.$`));
  await shot(page, testInfo, 'progress-dark');

  // Back to wpm from the palette; nothing was re-keyed, so the same best and runs come back.
  await command(page, 'speed unit · wpm');
  await expect(page.locator('#progress-trend figcaption').first()).toHaveText('Corrected WPM');
  await expect(page.locator('#run-history .run-summary strong').first()).toHaveText(new RegExp(`^${second / 5} wpm · \\d+%$`));
  await expect(page.locator('#best')).toHaveText(`Best · ${Math.max(first, second / 5)} wpm`);
  await openView(page, 'Train');
  await expect(page.locator('#result-wpm')).toHaveText(String(second / 5));
  await expect(page.locator('.run-card-unit')).toHaveText('wpm');
  await expect(page.locator('#speed-graph')).toHaveAttribute('aria-label', /average \d+ wpm/);
  await expect(rawRow).toHaveAttribute('title', 'Every character typed, mistakes included: characters ÷ 5 per minute');
});

test('light theme: the run card and the palette command in cpm', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  await chooseWords(page, 10);
  await command(page, 'speed unit · cpm');
  await expect(page.locator('#live-wpm + span')).toHaveText('cpm');
  await page.locator('#typing-input').focus();
  await typeRun(page, 5);
  const value = Number(await page.locator('#result-wpm').textContent());
  expect(value % 5).toBe(0);
  expect(value / 5).toBeGreaterThanOrEqual(40);
  expect(value / 5).toBeLessThanOrEqual(110);
  await expect(page.locator('.run-card-unit')).toHaveText('cpm');
  await shot(page, testInfo, 'results-light');

  await page.keyboard.press('Control+k');
  await page.keyboard.type('speed');
  await expect(page.locator('#palette-list [role="option"]', { hasText: 'speed unit · cpm' }).locator('.opt-hint')).toHaveText('current');
  await expect(page.locator('#palette-list [role="option"]', { hasText: 'speed unit · wpm' })).toBeVisible();
  await shot(page, testInfo, 'palette-light');
  await page.keyboard.press('Escape');
});

test('live speed and the ghost pacer read in the chosen unit', async ({ page }) => {
  await openApp(page);
  await command(page, 'speed unit · cpm');
  await openSettings(page);
  await page.locator('#live-toggle').check();
  await page.keyboard.press('Escape');

  // The ghost's pace is 60 wpm without a best: 300 cpm.
  await command(page, 'ghost');
  await expect(page.locator('#egg-feedback')).toHaveText('Ghost pacer · 300 cpm');
  await expect(page.locator('#pace-label')).toHaveText('pace 300 cpm');
  // A toast already showing is reworded with the unit, and so is the pace caret's label.
  await command(page, 'speed unit · wpm');
  await expect(page.locator('#egg-feedback')).toHaveText('Ghost pacer · 60 wpm');
  await expect(page.locator('#pace-label')).toHaveText('pace 60 wpm');
  await command(page, 'speed unit · cpm');
  await command(page, 'ghost');

  await expect(page.locator('#live-wpm + span')).toHaveText('cpm');
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 14), '#typing-input', { delay: 150 });
  await expect(page.locator('#live-wpm')).toHaveText(/^\d+$/);
  expect(Number(await page.locator('#live-wpm').textContent()) % 5).toBe(0);

  // Switching mid-run from settings neither interrupts the run nor waits for the next second.
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await openSettings(page);
  await page.locator('#speed-unit').selectOption('wpm');
  await expect(page.locator('#live-wpm + span')).toHaveText('wpm');
  await expect(page.locator('.preferences-popover')).toContainText('live wpm and accuracy');
  await expect(page.locator('#typing-status')).toHaveText('In progress');
});

test('the custom pace is entered in cpm, kept in wpm, and the caret runs at the cpm entered', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 25);
  await command(page, 'speed unit · cpm');
  await openSettings(page);
  await page.locator('#pace-select').selectOption('custom');
  const input = page.locator('#pace-wpm');
  const range = page.locator('#pace-custom .pace-note');
  // The default 80 wpm reads as 400 cpm, inside a range and step given in cpm.
  await expect(input).toHaveValue('400');
  await expect(range).toHaveText('50–1500 cpm');
  await expect(input).toHaveAttribute('min', '50');
  await expect(input).toHaveAttribute('max', '1500');
  await expect(input).toHaveAttribute('step', '5');
  await expect(page.locator('#pace-label')).toHaveText('pace 400 cpm');

  // Kept as whole wpm, like every other speed: 333 cpm is 67 wpm, which reads back as 335 cpm.
  await input.fill('333');
  await input.press('Tab');
  await expect(input).toHaveValue('335');
  await expect(page.locator('#pace-label')).toHaveText('pace 335 cpm');

  // The caret's own animation clock: the characters it passes between two frames two seconds apart.
  await page.keyboard.press('Escape');
  await typeInto(page, (await passageText(page)).slice(0, 1));
  const cpm = await page.locator('#text-display').evaluate(async (display) => {
    const ghost = display.querySelector('.ghost-caret');
    const lineHeight = parseFloat(getComputedStyle(display).lineHeight) || 60;
    // Where src/motion.js would place the ghost on each character; it sits on the first one not behind it.
    const place = (char) => {
      let left = 0;
      let top = 0;
      for (let node = char; node && node !== display; node = node.offsetParent) {
        left += node.offsetLeft;
        top += node.offsetTop;
      }
      return { left, row: Math.floor((top + lineHeight * 0.25) / lineHeight) * lineHeight };
    };
    const index = () => {
      const [x, y] = ghost.style.transform.match(/-?[\d.]+(?=px)/g).map(Number);
      return [...display.querySelectorAll('.char')].map(place).filter(({ left, row }) => row < y || (row === y && left < x)).length;
    };
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const t1 = await frame();
    const i1 = index();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const t2 = await frame();
    const i2 = index();
    return ((i2 - i1) / (t2 - t1)) * 60000;
  });
  expect(Math.abs(cpm - 335), `${Math.round(cpm)} cpm`).toBeLessThanOrEqual(60);

  // Back in wpm, the same saved pace reads as 67 wpm in the original range.
  await page.keyboard.press('Escape');
  await command(page, 'speed unit · wpm');
  await openSettings(page);
  await expect(input).toHaveValue('67');
  await expect(range).toHaveText('10–300 wpm');
  await expect(input).toHaveAttribute('min', '10');
  await expect(input).toHaveAttribute('max', '300');
  await expect(input).toHaveAttribute('step', '1');
  await expect(page.locator('#pace-label')).toHaveText('pace 67 wpm');
});

test('a minimum speed is picked and named in cpm, kept in wpm, and the stop reason follows the unit', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await command(page, 'speed unit · cpm');
  await openSettings(page);
  // The options keep their wpm values and read in cpm.
  await expect(page.locator('#min-wpm option')).toHaveText(['any cpm', '100 cpm', '150 cpm', '200 cpm', '300 cpm', '400 cpm', '500 cpm']);
  await page.locator('#min-wpm').selectOption({ label: '300 cpm' });
  await expect(page.locator('#min-wpm')).toHaveValue('60');
  await expect(page.locator('#minimum-note')).toHaveText('min 300 cpm');
  await page.locator('details.preferences > summary').click();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('minimum speed · 300 cpm');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('current');
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();

  // 22 keys by five seconds is about 53 wpm (265 cpm): under the minimum once the grace is over.
  const text = await passageText(page);
  await page.clock.pauseAt(Date.now() + 1000);
  await page.locator('#typing-input').focus();
  for (const char of text.slice(0, 22)) {
    await page.keyboard.type(char);
    await page.clock.runFor(200);
  }
  await page.clock.runFor(1000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.clock.resume();
  await expect(page.locator('#result-comparison-note')).toHaveText('Stopped: speed fell below 300 cpm, so it isn’t counted.');
  await expect(page.locator('#result-conditions')).toContainText('min 300 cpm');

  // Switching back rewords what is on screen without touching the saved minimum.
  await command(page, 'speed unit · wpm');
  await expect(page.locator('#result-comparison-note')).toHaveText('Stopped: speed fell below 60 wpm, so it isn’t counted.');
  await expect(page.locator('#result-conditions')).toContainText('min 60 wpm');
  await expect(page.locator('#min-wpm option:checked')).toHaveText('60 wpm');
});

test('a retest comparison and the drills and retests list read in cpm', async ({ page }) => {
  await openApp(page);
  await freshTextCheck(page);
  const [sign, delta] = parseSigned(await page.locator('#comparison-wpm').textContent());
  await command(page, 'speed unit · cpm');
  await expect(page.locator('#comparison-wpm')).toHaveText(`${sign}${delta * 5} cpm`);
  await expect(page.locator('#comparison-panel .comparison-rows span').last()).toHaveText('cpm');

  await openView(page, 'Progress');
  await expect(page.locator('.history-measure span').nth(1)).toHaveText('Corrected cpm');
  await expect(page.locator('.history-timing')).toHaveText(`${sign}${delta * 5} cpm`);
  await page.locator('.history-summary').click();
  await expect(page.locator('.history-detail')).toContainText(/before\d+ cpm · \d+%/);
  await expect(page.locator('.history-detail')).toContainText(/after\d+ cpm · \d+%/);

  // Switching back from the palette keeps open rows open and keyboard focus where it was.
  await page.locator('#run-history .run-summary').first().click();
  await page.locator('.history-summary').focus();
  await command(page, 'speed unit · wpm');
  await expect(page.locator('.history-timing')).toHaveText(`${sign}${delta} wpm`);
  await expect(page.locator('.history-row')).toHaveAttribute('open', '');
  await expect(page.locator('#run-history .run-row').first()).toHaveAttribute('open', '');
  await expect(page.locator('.history-summary')).toBeFocused();
});

test('the daily challenge and a one-keyboard race read in cpm', async ({ page }) => {
  await openApp(page);
  await command(page, 'speed unit · cpm');
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText('Daily challenge complete');
  await expect(page.locator('.run-card-unit')).toHaveText('cpm');
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await expect(page.locator('#daily-status')).toContainText(/^Today’s best: \d+ cpm · \d+% accuracy · 1 attempt/);
  await page.locator('#daily-history-panel summary').click();
  await expect(page.locator('.daily-result strong')).toHaveText(/^\d+ cpm · \d+%$/);

  await page.locator('#challenge-local').click();
  await page.locator('#player-one-name').fill('Ada');
  await page.locator('#player-two-name').fill('Lin');
  await page.locator('#start-local-race').click();
  const text = await page.locator('#race-accessible-passage').textContent();
  await typeInto(page, text, '#race-input');
  await page.locator('#start-next-player').click();
  await expect(page.locator('#race-player')).toHaveText('Lin');
  await typeInto(page, text, '#race-input');
  const rows = page.locator('.race-result-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(/\d+ cpm/);
  const cpm = Number((await rows.nth(0).locator('span').first().textContent()).split(' ')[0]);
  await command(page, 'speed unit · wpm');
  await expect(rows.nth(0).locator('span').first()).toHaveText(`${cpm / 5} wpm`);
  await expect(page.locator('#daily-status')).toContainText(/^Today’s best: \d+ wpm/);
});

test('a member’s unit is saved with the profile, a guest’s is not, and saved bests are untouched', async ({ page, supabase }) => {
  await openApp(page);
  await command(page, 'speed unit · cpm');
  await page.reload();
  await expect(page.locator('#speed-unit')).toHaveValue('wpm');
  await expect(page.locator('#live-wpm + span')).toHaveText('wpm');

  // A profile saved before the setting existed reads in wpm.
  const conditions = { mode: 'time', duration: 30, count: null, punctuation: false, quoteLength: null, difficulty: null, wordList: '200',
    inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
  const bests = { [conditionKey(conditions)]: { wpm: 72, attemptId: 'earlier', at: '2026-09-29T12:00:00Z' } };
  const user = supabase.addUser('ada@stilltype.test');
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { theme: 'dark' }, attempts: [], runs: [], loops: [], seenTextIds: [], bests, updatedAt: '2026-09-29T12:00:00Z' } });
  await signInWithEmail(page, user.email);
  await expect(page.locator('#speed-unit')).toHaveValue('wpm');
  await expect(page.locator('#best')).toHaveText('Best · 72 wpm');

  await openSettings(page);
  await page.locator('#speed-unit').selectOption('cpm');
  await expect(page.locator('#best')).toHaveText('Best · 360 cpm');
  await expect.poll(() => supabase.profileFor(user.email)?.preferences?.speedUnit).toBe('cpm');
  expect(supabase.profileFor(user.email).bests).toEqual(bests);

  await page.reload();
  await expect(page.locator('#speed-unit')).toHaveValue('cpm');
  await expect(page.locator('#best')).toHaveText('Best · 360 cpm');
  await expect(page.locator('#live-wpm + span')).toHaveText('cpm');
});

async function member(browser, supabase, email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await supabase.attach(page);
  await openApp(page);
  await signInWithEmail(page, email);
  return { context, page };
}

test('an online race’s results and its inbox entry read in the chosen unit', async ({ page, browser, supabase }) => {
  supabase.addUser('host@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#online-invite-email').fill('lin@stilltype.test');
  await page.locator('#online-save-friend').uncheck();
  await page.locator('#create-online-race').click();
  const { context, page: lin } = await member(browser, supabase, 'lin@stilltype.test');
  try {
    await openView(lin, 'Challenge');
    await lin.locator('#online-name').fill('Lin');
    await lin.locator('[data-accept-invite]').click();
    await expect(lin.locator('#online-room')).toBeVisible();
    await page.locator('#online-ready').click();
    await lin.locator('#online-ready').click();
    await expect(page.locator('#online-input')).toBeEnabled({ timeout: 12000 });
    await expect(lin.locator('#online-input')).toBeEnabled();
    const passage = await page.locator('#online-accessible-passage').textContent();
    await typeInto(page, passage, '#online-input', { delay: 5 });
    await typeInto(lin, passage, '#online-input', { delay: 5 });
    await expect(page.locator('#online-results')).toBeVisible({ timeout: 10000 });
    await expect(lin.locator('#online-results')).toBeVisible({ timeout: 10000 });

    const speeds = page.locator('#online-result-rows .race-result-row span:first-of-type');
    const before = await speeds.allTextContents();
    before.forEach((value) => expect(value).toMatch(/^\d+ wpm$/));
    await page.locator('#inbox-trigger').click();
    await expect(page.locator('#inbox-list [data-kind="result"]')).toContainText(/Lin: \d+ wpm to \d+\./);
    await page.locator('#inbox-trigger').click();

    await page.mouse.move(5, 5);
    await page.mouse.move(40, 40);
    await command(page, 'speed unit · cpm');
    await expect(speeds).toHaveText(before.map((value) => `${Number(value.split(' ')[0]) * 5} cpm`));
    await expect(page.locator('#online-results')).toContainText('Corrected cpm uses matching characters');
    await page.locator('#inbox-trigger').click();
    await expect(page.locator('#inbox-list [data-kind="result"]')).toContainText(/Lin: \d+ cpm to \d+\./);
    // Each player's own setting: Lin still reads wpm.
    await expect(lin.locator('#online-result-rows .race-result-row span:first-of-type').first()).toHaveText(/^\d+ wpm$/);
  } finally {
    await context.close();
  }
});

test('a race result saved before the setting reads in cpm, and what was saved is kept', async ({ page, supabase }) => {
  const user = supabase.addUser('ada@stilltype.test');
  const key = `stilltype-inbox-v1:${user.id}`;
  // Exactly what the inbox saved before the speed unit setting: a result was its sentence alone, in wpm.
  const saved = [
    { id: 'result:old-room', kind: 'result', roomId: 'old-room', until: '2026-09-30T12:00:00.000Z', conditions: { mode: 'quote' },
      text: 'You beat Lin: 72 wpm to 65.', at: '2026-09-29T12:00:00.000Z', read: false },
    // Not a sentence the app wrote, so it can't be read back: it is shown as saved.
    { id: 'result:odd-room', kind: 'result', roomId: 'odd-room', until: '2026-09-30T12:00:00.000Z',
      text: 'You beat Lin: 72.5 wpm to 65.', at: '2026-09-29T11:00:00.000Z', read: false },
    { id: 'joined:old-room', kind: 'joined', roomId: 'old-room', text: 'Lin joined your race.', at: '2026-09-29T10:00:00.000Z', read: true },
  ];
  await openApp(page);
  await page.evaluate(([name, entries]) => localStorage.setItem(name, JSON.stringify(entries)), [key, saved]);
  await signInWithEmail(page, user.email);

  const rows = page.locator('#inbox-list .inbox-entry p');
  await page.locator('#inbox-trigger').click();
  await expect(rows).toHaveText(['You beat Lin: 72 wpm to 65.', 'You beat Lin: 72.5 wpm to 65.', 'Lin joined your race.']);
  await page.locator('#inbox-trigger').click();

  await command(page, 'speed unit · cpm');
  await page.locator('#inbox-trigger').click();
  await expect(rows).toHaveText(['You beat Lin: 360 cpm to 325.', 'You beat Lin: 72.5 wpm to 65.', 'Lin joined your race.']);
  await page.locator('#inbox-trigger').click();

  // Saving (the entries were marked read) keeps every saved field and sentence; the read-back
  // result gains its scores in wpm.
  const stored = await page.evaluate((name) => JSON.parse(localStorage.getItem(name)), key);
  expect(stored).toEqual([
    { ...saved[0], read: true, race: { lead: 'You beat', opponent: 'Lin', wpm: [72, 65] } },
    { ...saved[1], read: true },
    saved[2],
  ]);

  // Loading it again reads the same.
  await page.reload();
  await page.locator('#inbox-trigger').click();
  await expect(rows).toHaveText(['You beat Lin: 360 cpm to 325.', 'You beat Lin: 72.5 wpm to 65.', 'Lin joined your race.']);
  expect(await page.evaluate((name) => JSON.parse(localStorage.getItem(name)), key)).toEqual(stored);
});

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['narrow phone', { width: 320, height: 640 }]]) {
  test.describe(`${name} ${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('three- and four-digit cpm figures fit without sideways scroll', async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openApp(page);
      await chooseWords(page, 10);
      await command(page, 'speed unit · cpm');
      await openSettings(page);
      await page.locator('#live-toggle').check();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.keyboard.press('Escape');
      await page.locator('#typing-input').focus();
      const text = await passageText(page);
      await typeHumanly(page, text.slice(0, 16), { seed: 3, slip: false });
      await expect(page.locator('#live-wpm')).toHaveText(/^\d{2,}$/);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await typeHumanly(page, text.slice(16), { seed: 17 });
      await expect(page.locator('#run-card')).toBeVisible();
      const cpm = Number(await page.locator('#result-wpm').textContent());
      expect(cpm / 5).toBeGreaterThanOrEqual(40);
      expect(cpm / 5).toBeLessThanOrEqual(110);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      if (viewport.width === 390) await shot(page, testInfo, 'results-mobile');

      // A 230 wpm burst would print four digits in cpm; the card still holds it.
      await page.locator('#result-wpm').evaluate((node) => { node.textContent = '1150'; });
      const card = await page.locator('#run-card').evaluate((node) => node.scrollWidth - node.clientWidth);
      expect(card).toBeLessThanOrEqual(0);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe('narrow phone 320px, a two-minute run', () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });

  test('a three-digit live cpm beside a three-digit timer fits mid-run', async ({ page }) => {
    await openApp(page);
    await page.locator('#mode-time').click();
    await page.locator('#duration-options [data-length="120"]').click();
    await expect(page.locator('#condition-line')).toContainText('120 s');
    await command(page, 'speed unit · cpm');
    await openSettings(page);
    await page.locator('#live-toggle').check();
    await page.keyboard.press('Escape');
    await page.locator('#typing-input').focus();
    await typeHumanly(page, (await passageText(page)).slice(0, 30), { seed: 5, slip: false });
    await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
    await expect(page.locator('#live-wpm')).toHaveText(/^\d{3}$/);
    expect(Number(await page.locator('#timer').textContent())).toBeGreaterThanOrEqual(100);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('short phone 375×553', () => {
  test.use({ viewport: { width: 375, height: 553 }, hasTouch: true, isMobile: true });

  test('settings stay below the account button and scroll to every touch-sized row', async ({ page }) => {
    await openApp(page);
    await openSettings(page);
    // A tap on the theme select's chevron reaches the select, not the account button above it.
    const hit = await page.locator('#theme-select').evaluate((node) => {
      const box = node.getBoundingClientRect();
      return document.elementFromPoint(box.right - 4, box.top + 4)?.id;
    });
    expect(hit).toBe('theme-select');
    const popover = page.locator('.preferences-popover');
    expect(await popover.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);
    await page.locator('#focus-toggle').scrollIntoViewIfNeeded();
    await expect(page.locator('#focus-toggle')).toBeInViewport();
    expect(await popover.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    // Every row on screen; the collapsed test content rows and the hidden custom pace row aren't drawn.
    const heights = await popover.locator('.preference-row:visible').evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThanOrEqual(8);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
  });
});

// Custom text is never counted and can end inside a second: in either unit it shows no rate, and a unit
// change while its card is shown redraws nothing into the blanks (no rate, no graph, no word pace).
test('a custom run too quick to time shows no rate in cpm, before or after a unit change', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T12:00:00Z') });
  await openApp(page);
  await command(page, 'speed unit · cpm');
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill('hello world');
  await page.locator('#custom-use').click();
  await expect(page.locator('#best')).toHaveText('Not counted');
  await page.clock.pauseAt(new Date('2026-10-01T12:10:00Z'));
  await page.locator('#typing-input').focus();
  for (const key of 'hello world') {
    await page.keyboard.type(key);
    await page.clock.runFor(40);
  }
  await page.clock.resume();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toContainText('not counted toward your best');
  await expect(page.locator('#announcement')).toContainText('Too quick to time');
  for (const unit of ['cpm', 'wpm']) {
    if (unit === 'wpm') await command(page, 'speed unit · wpm');
    await expect(page.locator('#speed-unit')).toHaveValue(unit);
    await expect(page.locator('#result-wpm')).toHaveText('—');
    await expect(page.locator('#result-raw')).toHaveText('—');
    await expect(page.locator('.run-card-graph')).toBeHidden();
    const words = await page.locator('#result-words [role="option"]').evaluateAll((nodes) => nodes.map((word) => word.getAttribute('aria-label')).join(' '));
    expect(words).not.toMatch(/wpm|cpm/);
  }
});

test('new learning and composing surfaces follow cpm without changing their stored metrics', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.locator('#speed-unit').selectOption('cpm');
  await page.keyboard.press('Escape');
  await command(page, 'learn to type');
  await expect(page.locator('#lesson-current-meta')).toContainText('cpm');
  await expect(page.locator('#lesson-list')).not.toContainText(/\d+ wpm/);
  await openView(page, 'practice');
  await chooseMore(page, 'mode-compose');
  await page.locator('#compose-input').pressSequentially('a quiet sentence has enough letters to measure the active typing speed', { delay: 100 });
  await page.locator('#compose-done').click();
  const cpm = Number(await page.locator('#compose-wpm').textContent());
  expect(cpm).toBeGreaterThan(0);
  await expect(page.locator('#compose-wpm + span')).toHaveText('cpm');
  await expect(page.locator('#compose-definition')).toContainText('Free-typing cpm:');
  await openSettings(page);
  await page.locator('#speed-unit').selectOption('wpm');
  await expect(page.locator('#compose-wpm')).toHaveText(String(cpm / 5));
  await expect(page.locator('#compose-definition')).toContainText('Free-typing wpm:');
});


test('standard scores display cpm while profile bests remain stored in wpm', async ({ page, supabase }) => {
  const user = supabase.addUser('standard-units@stilltype.test');
  const conditions = standardConditions();
  const runs = [58, 63, 61, 66, 64].map((wpm, i) => ({ id: `unit-standard-${i}`, at: new Date(Date.now() - (5 - i) * 86400000).toISOString(),
    kind: 'test', status: 'complete', conditions, textId: `standard-v1-unit${i}`, fresh: true, interrupted: false,
    score: { wpm, accuracy: 98 }, elapsedMs: 60000, errors: 1, patterns: [] }));
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { speedUnit: 'cpm' }, attempts: [], runs, loops: [], seenTextIds: [],
    bests: { [conditionKey(conditions)]: { wpm: 66, attemptId: runs[3].id, at: runs[3].at } }, updatedAt: new Date().toISOString() } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await expect(page.locator('#standard-best')).toHaveText('330');
  await expect(page.locator('#standard-median')).toHaveText('315');
  await expect(page.locator('#standard-best + span')).toHaveText('cpm');
  expect(supabase.profileFor(user.email).bests[conditionKey(conditions)].wpm).toBe(66);
});


test('explicit speedUnit reselect is recorded as a fresh preference choice', async ({ page, supabase }) => {
  const user = supabase.addUser('choice-40@stilltype.test');
  const stamp = '2000-01-01T00:00:00.000Z';
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { speedUnit: "wpm" }, preferencesAt: { speedUnit: stamp },
    attempts: [], runs: [], loops: [], seenTextIds: [], bests: {}, updatedAt: stamp } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openSettings(page);
  await page.locator('#speed-unit').selectOption('wpm');
  await expect.poll(() => supabase.profileFor(user.email)?.preferencesAt?.speedUnit).not.toBe(stamp);
  expect(supabase.profileFor(user.email).preferences.speedUnit).toEqual("wpm");
});
