// Coarse pointers keep a 44px minimum target (DESIGN.md, Breakpoints). This sweep visits each view
// and state on a touch phone and measures every visible control generically, so a new control is
// checked without being listed here. The hit area is measured with elementFromPoint, outward from the
// control's centre, so padding, negative margins, pseudo-elements and a wrapping label all count,
// and anything that covers part of a control takes that part away.
import { randomUUID } from 'node:crypto';
import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, createAttempt } from '../src/typing.js';
import { runRecord } from '../src/insights.js';
import { test, expect, openProgressDetail, openApp, openView, openProgressView, openSettings, chooseWords, passageText, typeInto, completePassage, freshTextCheck, signInWithEmail, chooseMore, chooseSetting, closeSettings, phone } from './fixtures.js';

const MIN = 44;

// Controls WCAG 2.5.5 exempts from the minimum. Keep this list as short as possible, and say why.
const EXEMPT = [
  // Progress chart points closer together than a 44px target (the "equivalent" exception): every
  // run is also a full-size row in the run history below. Each point still gets the whole gap to
  // its neighbours and a 44px height, so a tap opens the point under it; the dense chart test
  // checks that instead.
  { selector: '.trend-dense .trend-dot', reason: 'equivalent: its run history row' },
  // The run card's typed words (the "inline" exception): each word is a target inside a block of
  // text, sized by its line. A tap or the arrow keys from its single tab stop show the word's pace
  // in the line below, which already names the fastest and slowest words.
  { selector: '.run-card-words [role="option"]', reason: 'inline: words in a block of text' },
];

// Runs in the page. Returns every visible control under `root` and its hit area.
function measure({ root, exempt }) {
  const CONTROLS = 'label.setting-option, button, a[href], input:not([type="hidden"]), select, textarea, summary, '
    + '[role="button"], [role="switch"], [role="tab"], [role="option"], [tabindex="0"]';

  const describe = (el) => {
    const classes = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).map((c) => `.${c}`).join('');
    const text = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();

    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes}${text ? ` “${text.slice(0, 36)}”` : ''}`;
  };

  const controls = [];

  for (const el of (document.querySelector('dialog:modal') || document.querySelector(root)).querySelectorAll(CONTROLS)) {
    // Hidden from everyone, faded out mid-run, or not taking pointer input: not a target right now.
    if (el.closest('[aria-hidden="true"], [inert]')) continue;

    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;

    if (getComputedStyle(el).pointerEvents === 'none') continue;

    if (exempt.some((selector) => el.matches(selector))) continue;
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const box = [...el.getClientRects()].sort((a, b) => b.width * b.height - a.width * a.height)[0];

    if (!box?.width || !box.height) continue;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;

    // Off-screen until focused (the skip link): not something a finger can reach.
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
    // A tap on a checkbox's label toggles it, so the label is part of its target.
    const labels = ['checkbox', 'radio'].includes(el.type) ? [...el.labels] : [];

    const owns = (x, y) => {
      const hit = document.elementFromPoint(x, y);

      return Boolean(hit) && (el.contains(hit) || labels.some((label) => label.contains(hit)));
    };

    // Whole device pixels along the row and the column through the centre that land on the
    // target, up to 64 each way: the hit width and height.
    const x = Math.round(cx);
    const y = Math.round(cy);

    const run = (dx, dy) => {
      let d = 1;

      while (d <= 64 && owns(x + dx * d, y + dy * d)) d += 1;

      return d - 1;
    };

    const centred = owns(x, y);

    const blocker = (dx, dy) => {
      const d = run(dx, dy) + 1;
      const hit = document.elementFromPoint(x + dx * d, y + dy * d);

      return hit && !hit.contains(el) ? describe(hit) : null;
    };

    controls.push({
      control: describe(el),
      box: [Math.round(box.width * 10) / 10, Math.round(box.height * 10) / 10],
      hit: centred ? [run(-1, 0) + run(1, 0) + 1, run(0, -1) + run(0, 1) + 1] : [0, 0],
      blockers: centred ? [...new Set([blocker(-1, 0), blocker(1, 0), blocker(0, -1), blocker(0, 1)].filter(Boolean))]
        : [describe(document.elementFromPoint(x, y) || document.body)],
    });
  }

  window.scrollTo({ top: 0, behavior: 'instant' });

  return controls;
}

// Waits for visible fades and slides to finish. Animations inside a closed <details> never tick,
// so only visible targets count, and the wait is capped.
const settle = (page) => page.evaluate(() => Promise.race([
  Promise.all(document.getAnimations()
    .filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().endTime !== Infinity
      && animation.effect?.target?.checkVisibility?.())
    .map((animation) => animation.finished.catch(() => {}))),
  new Promise((resolve) => { setTimeout(resolve, 1500); }),
]));

// Measures one state and returns the controls under the minimum, labelled with the state.
async function sweep(page, state, root = 'body') {
  // A toast fading in is still at opacity 0 on its first frame.
  await settle(page);
  const controls = await page.evaluate(measure, { root, exempt: EXEMPT.map((entry) => entry.selector) });
  expect(controls.length, `${state}: controls found`).toBeGreaterThan(0);

  if (process.env.TOUCH_REPORT) for (const c of controls) console.log(`${state}\t${c.control}\tbox ${c.box.join('×')}\thit ${c.hit.join('×')}`);

  return controls.filter((c) => c.hit[0] < MIN || c.hit[1] < MIN)
    .map((c) => `${state}: ${c.control} — box ${c.box.join('×')}, hit ${c.hit.join('×')}${c.blockers.length ? `, meets ${c.blockers.join(', ')}` : ''}`);
}

const conditions = { mode: 'words', count: 25, duration: null, punctuation: false, quoteLength: null,
  difficulty: null, wordList: '1k', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

// A finished run with a recurring "th" miss, so Train has targets and Progress has points.
function errorTrace(id, at) {
  const text = Array(25).fill('the').join(' ');
  const attempt = createAttempt({ id, text, textId: id, conditions });
  attempt.startedAt = 0;
  attempt.events = [...text].map((char, position) => ({ type: 'insert', text: position % 4 === 1 ? 'x' : char,
    position, offsetMs: position * 100, accepted: true }));

  return { ...completeAttempt(attempt, { endedAt: text.length * 100 }), at, fresh: true };
}

// The PR's pictures: written to docs/ only when SCREENSHOTS is set.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/touch-targets/${name}.png` : testInfo.outputPath(`${name}.png`));

// A run at a steady pace with one corrected slip, so the graph has a mistake on it.
async function typeRun(page, delay) {
  const text = await passageText(page);
  const at = [...text].findIndex((char, index) => index > text.length / 2 && /[a-z]/.test(char));
  await typeInto(page, text.slice(0, at) + (text[at] === 'x' ? 'z' : 'x'), '#typing-input', { delay });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text.slice(at), { delay });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await settle(page);
}

for (const theme of ['dark', 'light']) {
  test.describe(`touch screenshots, ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 390, height: 844 }, ...phone });
    test.setTimeout(120000);

    test(`the run card and the enlarged text controls look unchanged, ${theme}`, async ({ page }, testInfo) => {
      test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
      await openApp(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await chooseWords(page, 25);
      await typeRun(page, 110);
      const wpm = Number(await page.locator('#result-wpm').textContent());
      expect(wpm).toBeGreaterThanOrEqual(40);
      expect(wpm).toBeLessThanOrEqual(110);
      await page.screenshot({ path: shot(testInfo, `run-card-390-${theme}`) });

      // Progress: the run's "View passage" disclosure and the footer link, both grown for touch.
      await openView(page, 'Progress');
      await openProgressDetail(page, 'runs');
      await page.locator('#run-history .run-summary').first().click();
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await settle(page);
      await page.screenshot({ path: shot(testInfo, `inline-controls-390-${theme}`) });

      if (theme === 'dark') {
        // The same screen with each grown control's hit area outlined.
        const outline = await page.addStyleTag({ content: '.footer-link::after, .run-detail summary::after { outline: 1px dashed var(--accent); }' });
        await page.screenshot({ path: shot(testInfo, `inline-controls-hit-areas-390-${theme}`) });
        await outline.evaluate((node) => node.remove());
      }

      // 320px: a quick but human run, so the numeral holds three real digits at 100–110 wpm. The
      // shared CPU adds its own time to each key, so the delay is retuned if a run misses.
      await page.setViewportSize({ width: 320, height: 640 });
      let fast = 0;

      for (let attempt = 0, delay = 104; attempt < 4 && !(fast >= 100 && fast <= 110); attempt += 1) {
        if (attempt) delay = Math.round(delay * fast / 105);
        await openView(page, 'Practice');
        await chooseWords(page, 25);
        await typeRun(page, delay);
        fast = Number(await page.locator('#result-wpm').textContent());
      }

      expect(fast).toBeGreaterThanOrEqual(100);
      expect(fast).toBeLessThanOrEqual(110);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await page.evaluate(() => window.scrollTo({ top: document.querySelector('#run-card').getBoundingClientRect().top + scrollY - 16, behavior: 'instant' }));
      await page.screenshot({ path: shot(testInfo, `run-card-320-${theme}`) });
    });
  });
}

// 390px is the common phone; 320px is the narrowest width the layout supports.
for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
  test.describe(`touch targets on a ${viewport.width}px phone`, () => {
    test.use({ viewport, ...phone });
    test.setTimeout(120000);

    test('practice, a run, results, settings, palette, account and challenge controls are 44px targets', async ({ page }) => {
      const small = [];
      await openApp(page);
      expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true);
      small.push(...await sweep(page, 'practice'));
      await page.locator('#mode-quote').click();
      small.push(...await sweep(page, 'practice, quote'));
      // Custom text: its editor opens under the mode bar, with a text box, an order select and "Use this text".
      await chooseMore(page, 'mode-custom');
      await expect(page.locator('#custom-options')).toBeVisible();
      small.push(...await sweep(page, 'practice, custom text'));
      await chooseWords(page, 10);
      small.push(...await sweep(page, 'practice, words'));

      const text = await passageText(page);
      await typeInto(page, text.slice(0, 6));
      await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
      small.push(...await sweep(page, 'mid-run'));
      await page.keyboard.type(text.slice(6));
      await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
      small.push(...await sweep(page, 'results'));
      // The 1–8 letter drill moved from the result into Practice's "more" menu.
      await chooseMore(page, 'mode-drill');
      await expect(page.locator('#manual-target')).toBeVisible();
      small.push(...await sweep(page, 'results, manual drill open'));
      // The ghost race offer, where a run offers one (signed in only).
      const offer = page.locator('.manual-panel > summary', { hasText: 'Challenge a friend' });

      if (await offer.isVisible()) {
        await offer.click();
        small.push(...await sweep(page, 'results, challenge offer open'));
      }

      await openView(page, 'Practice');
      await openSettings(page);
      small.push(...await sweep(page, 'settings', '#settings-dialog'));
      await chooseSetting(page, 'focus-toggle', true);
      await closeSettings(page);
      small.push(...await sweep(page, 'focus mode'));
      await closeSettings(page);
  await page.locator('#exit-focus').click();
      await expect(page.locator('#exit-focus')).toBeHidden();

      if (await page.locator('#settings-dialog').getAttribute('open') !== null) await closeSettings(page);
      await expect(page.locator('#settings-dialog')).toBeHidden();

      await page.locator('#palette-trigger').click();
      await expect(page.locator('#palette')).toBeVisible();
      small.push(...await sweep(page, 'palette', '#palette'));
      await page.keyboard.press('Escape');
      await expect(page.locator('#palette')).toBeHidden();

      await page.locator('#account-trigger').click();
      small.push(...await sweep(page, 'account, guest', '.corner'));
      await page.locator('#account-create').click();
      await expect(page.locator('#account-dialog')).toBeVisible();
      small.push(...await sweep(page, 'account dialog', '#account-dialog'));
      await page.locator('#account-switch').click();
      small.push(...await sweep(page, 'account dialog, sign in', '#account-dialog'));
      await page.locator('#account-cancel').click();

      await page.locator('#suggest-trigger').click();
      await expect(page.locator('#suggest-dialog')).toBeVisible();
      small.push(...await sweep(page, 'suggest dialog', '#suggest-dialog'));
      await page.locator('#cancel-suggest').click();

      await openView(page, 'Challenge');
      small.push(...await sweep(page, 'challenge, online'));
      await page.locator('#challenge-daily').click();
      small.push(...await sweep(page, 'challenge, daily'));
      await page.locator('#challenge-local').click();
      small.push(...await sweep(page, 'challenge, one keyboard'));
      await page.locator('#player-one-name').fill('Ada');
      await page.locator('#player-two-name').fill('Lin');
      await page.locator('#start-local-race').click();
      small.push(...await sweep(page, 'one keyboard, player 1'));
      await typeInto(page, await page.locator('#race-accessible-passage').textContent(), '#race-input');
      await expect(page.locator('#race-handoff')).toBeVisible();
      small.push(...await sweep(page, 'one keyboard, handoff'));
      await page.locator('#start-next-player').click();
      await expect(page.locator('#race-stage')).toBeVisible();
      await expect(page.locator('#race-player')).toHaveText('Lin');
      await typeInto(page, await page.locator('#race-accessible-passage').textContent(), '#race-input');
      await expect(page.locator('#race-leaderboard')).toBeVisible();
      small.push(...await sweep(page, 'one keyboard, results'));

      expect(small).toEqual([]);
    });

    test('Train, Progress, history, dialogs, toasts, inbox and online race controls are 44px targets', async ({ page, supabase }) => {
      await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
      const host = supabase.addUser('host@stilltype.test');
      const user = supabase.addUser('patterns@stilltype.test');
      const traces = [errorTrace('baseline-a', '2026-09-28T12:00:00Z'), errorTrace('baseline-b', '2026-09-29T12:00:00Z')];
      supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: traces,
        runs: traces.map((t) => runRecord(t)), loops: [], seenTextIds: traces.map((t) => t.textId), bests: {}, updatedAt: '2026-09-29T12:00:00Z' } });
      supabase.races.friends.set(user.id, [{ id: randomUUID(), email: 'lin@stilltype.test', name: 'lin' }]);
      const small = [];
      await openApp(page);
      await signInWithEmail(page, user.email);
      await page.locator('#account-trigger').click();
      small.push(...await sweep(page, 'account, signed in', '.corner'));
      await page.locator('#account-trigger').click();

      // Train recommends from runs at the current conditions, so match the saved runs: 25 words from the top 1k.
      await chooseSetting(page, 'word-list', '1k');
      await closeSettings(page);
      await chooseWords(page, 25);
      await openView(page, 'Train');
      await expect(page.locator('#train-heading')).toHaveText(/^Practice “/);
      await expect(page.locator('#train-evidence')).toBeVisible();
      small.push(...await sweep(page, 'train'));
      // The patterns across runs moved to Progress, with their "Practice … again" buttons.
      await openView(page, 'Progress');
      await openProgressDetail(page, 'keys');
      await expect(page.locator('#training-targets')).toContainText(/missed in 2 runs|than your pace/);
      await expect(page.locator('#training-targets button').first()).toBeVisible();
      small.push(...await sweep(page, 'progress, patterns across runs'));

      await openView(page, 'Practice');
      await freshTextCheck(page);
      await openView(page, 'Progress');
      await openProgressView(page, 'Speed');
      await expect(page.locator('#progress-trend .trend-dot').first()).toBeVisible();
      small.push(...await sweep(page, 'progress'));

      // Every view's own controls, one panel at a time.
      for (const view of ['Accuracy', 'Consistency', 'Practice', 'Keys', 'Speed']) {
        await openProgressView(page, view);
        small.push(...await sweep(page, `progress, ${view.toLowerCase()} view`));
      }

      // The overview, its conditions control open, then the runs.
      await page.locator('#progress-back').click();
      await page.locator('.conditions-disclosure > summary').click();
      small.push(...await sweep(page, 'progress overview, conditions open'));
      await openProgressDetail(page, 'runs');
      await page.locator('#run-history .run-summary').first().click();
      small.push(...await sweep(page, 'progress, run open'));
      await page.getByRole('group', { name: 'Test' }).getByRole('button', { name: '10 words' }).click();
      await page.locator('.history-summary').first().click();
      small.push(...await sweep(page, 'progress, comparison open'));

      await openView(page, 'Challenge');
      await expect(page.locator('#online-friend-list')).toContainText('lin@stilltype.test');
      small.push(...await sweep(page, 'challenge, signed in'));
      await page.locator('#online-name').fill('Ada');
      await page.locator('#create-online-race').click();
      await expect(page.locator('#online-share')).toBeVisible();
      small.push(...await sweep(page, 'online race room'));
      await page.locator('#online-leave').click();
      await page.locator('#challenge-daily').click();
      await page.locator('#start-daily').click();
      await completePassage(page);
      await openView(page, 'Challenge');
      await page.locator('#challenge-daily').click();
      await page.locator('#daily-history-panel summary').click();
      small.push(...await sweep(page, 'challenge, daily results'));

      await new Promise((resolve) => supabase.races.handle(host.id, { p_action: 'create', p_data: {
        passage: 'The quick brown fox jumps over the lazy dog, twice over.', conditions: {}, displayName: 'Ada', inviteEmail: user.email,
      } }, resolve));
      await page.clock.fastForward(11000);
      await expect(page.locator('#challenge-toast')).toBeVisible();
      small.push(...await sweep(page, 'challenge toast', '#challenge-toast'));
      await page.locator('#challenge-toast-close').click();
      await page.locator('#inbox-trigger').click();
      await expect(page.locator('#inbox-list [data-inbox-action]')).toBeVisible();
      small.push(...await sweep(page, 'inbox', '.corner'));
      await page.locator('#inbox-trigger').click();

      await openView(page, 'Progress');
      await page.locator('#clear-history').click();
      await expect(page.locator('#clear-dialog')).toBeVisible();
      small.push(...await sweep(page, 'clear-history dialog', '#clear-dialog'));
      await page.locator('#confirm-clear-input').fill('clear');
      await page.locator('#confirm-clear').click();
      await expect(page.locator('#undo-clear')).toBeVisible();
      small.push(...await sweep(page, 'history toast', '#history-toast'));

      expect(small).toEqual([]);
    });

    test('a dense Progress chart gives each point its own gap, and a tap opens the run under it', async ({ page, supabase }) => {
      await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
      const user = supabase.addUser('dense@stilltype.test');
      // Fourteen runs at one pace: a flat line whose points sit closer than 44px at both widths.
      const traces = Array.from({ length: 14 }, (_, i) => errorTrace(`run-${String(i).padStart(2, '0')}`, `2026-09-${17 + i}T12:00:00Z`));
      supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: traces,
        runs: traces.map((t) => runRecord(t)), loops: [], seenTextIds: traces.map((t) => t.textId), bests: {}, updatedAt: '2026-09-30T12:00:00Z' } });
      await openApp(page);
      await signInWithEmail(page, user.email);
      await openView(page, 'Progress');
      await openProgressView(page, 'Accuracy');
      await expect(page.locator('#accuracy-trend .trend-dot')).toHaveCount(14);
      await expect(page.locator('#accuracy-trend svg.trend-dense')).toHaveCount(1);
      expect(await sweep(page, 'progress, dense accuracy chart')).toEqual([]);
      await openProgressView(page, 'Speed');
      await expect(page.locator('#progress-trend .trend-dot')).toHaveCount(14);
      await expect(page.locator('#progress-trend svg.trend-dense')).toHaveCount(1);
      expect(await sweep(page, 'progress, dense chart')).toEqual([]);

      // The exempt points: each owns its centre, is at least 44px tall and fills the gap it has.
      const gaps = await page.locator('#progress-trend .trend-hit').evaluateAll((hits) => hits.map((hit) => {
        const svg = hit.ownerSVGElement;

        return parseFloat(hit.style.getPropertyValue('--trend-step')) * svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      }));

      expect(Math.min(...gaps)).toBeLessThan(MIN);
      const points = await page.evaluate(measure, { root: '#progress-trend', exempt: [] });
      expect(points).toHaveLength(14);
      points.forEach(({ control, hit }, i) => {
        expect(hit[0], `${control} width`).toBeGreaterThanOrEqual(Math.min(MIN, Math.floor(gaps[i]) - 1));
        expect(hit[1], `${control} height`).toBeGreaterThanOrEqual(MIN);
      });
      const dot = page.locator('#progress-trend .trend-dot.trend-wpm').nth(6).locator('circle');
      await dot.scrollIntoViewIfNeeded();
      const box = await dot.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.locator('#run-history details[open]')).toHaveAttribute('data-run-id', 'run-06');
    });
  });
}
