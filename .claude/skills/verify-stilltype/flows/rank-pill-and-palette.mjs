// The studio chrome: the inked mode and length rows, the palette opening and closing on the key's frame, a theme
// generated inside it (a guest is sent to sign in, with nothing sent), and the member's rank pill with its card.
// Runs at any size and scheme; a phone (--width 320 --height 568 --mobile) also checks the card stays on screen,
// and --reduced-motion that the wipe and the card are still.
const THEME = {
  name: 'Kyoto Matcha', mode: 'dark',
  colors: { ground: '#10140f', text: '#eef2e6', muted: '#a7b39a', accent: '#9ccc65', danger: '#ff8a80', 'accent-ink': '#0d1a05', warning: '#ffd54f', ghost: '#b3c7ff' },
};

export default async ({ page, h, shot, note, check, fake }) => {
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const { width, height } = page.viewportSize();

  // How far the ink window is from the chosen segment, and the chosen label's copy from the label, in px.
  const inkOff = (group) => page.locator(group).evaluate((row) => {
    const ink = row.querySelector(':scope > .glide-ink');
    const chosen = row.querySelector(':scope > [aria-pressed="true"]') ?? row.querySelector(':scope > [data-active]');
    const box = ink.getBoundingClientRect();
    const target = chosen.getBoundingClientRect();
    const [top, right, bottom, left] = getComputedStyle(ink).clipPath.match(/inset\(([-\d.]+)px ([-\d.]+)px ([-\d.]+)px ([-\d.]+)px/).slice(1).map(Number);
    const label = chosen.matches('details') ? chosen.querySelector('summary') : chosen;
    const index = [...row.querySelectorAll(':scope > :is(button, details)')].indexOf(chosen);
    const range = document.createRange();
    range.selectNodeContents(label);
    const text = range.getBoundingClientRect();
    range.selectNodeContents(ink.children[index]);
    const copy = range.getBoundingClientRect();

    return {
      window: Math.max(Math.abs(box.left + left - target.left), Math.abs(box.right - right - target.right), Math.abs(box.top + top - target.top), Math.abs(box.bottom - bottom - target.bottom)),
      label: Math.max(Math.abs(text.left - copy.left), Math.abs(text.top - copy.top), Math.abs(text.width - copy.width)),
      copy: ink.children[index].textContent, pressed: label.textContent, opacity: getComputedStyle(ink).opacity, pointer: getComputedStyle(ink).pointerEvents,
      duration: getComputedStyle(ink).transitionDuration,
    };
  });

  async function choose(selector, group) {
    await page.locator(selector).click();
    await h.settle();
    const off = await inkOff(group);
    note(`ink ${selector}`, off);
    check(off.window <= 1, `${selector}: the ink window covers the chosen segment within 1px (${off.window.toFixed(2)})`);
    check(off.label <= 1, `${selector}: the inked label sits on the label it hides within 1px (${off.label.toFixed(2)})`);
    check(off.copy === off.pressed && off.opacity === '1' && off.pointer === 'none', `${selector}: the ink reads "${off.pressed}", shows, and takes no pointer`);

    if (reduced) check(Number.parseFloat(off.duration) <= 0.001, `${selector}: the wipe is still under reduced motion (${off.duration})`);
  }

  // Each palette open and close, timed from the key's own event to the dialog's state, both read in that task.
  async function cycle(query) {
    await page.locator('#typing-input').focus();
    const opened = await page.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
      resolve({ ms: performance.now() - t0, open: document.querySelector('#palette').open, focused: document.activeElement?.id });
    }));

    if (query) await page.locator('#palette-input').fill(query);
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => ({ open: document.querySelector('#palette').open, focused: document.activeElement?.id, closing: document.querySelector('#palette.is-closing') !== null }));

    return { opened, closed };
  }

  await h.openApp();
  check(await page.locator('#rank-pill').count() === 0, 'a guest has no rank pill in the page');
  check(await page.locator('.dock-nav .glide-pill').count() === 1, 'the dock keeps its gliding pill');

  await choose('#mode-time', '.practice-rail .mode-options');
  await choose('#mode-quote', '.practice-rail .mode-options');
  await choose('#mode-words', '.practice-rail .mode-options');
  await shot('ink-words');
  for (const length of [10, 25, 50]) await choose(`#duration-options [data-length="${length}"]`, '#duration-options');
  await shot('ink-length-50');
  await page.locator('#mode-time').click();
  await choose('#duration-options [data-length="60"]', '#duration-options');

  const cycles = [];
  for (let index = 0; index < 10; index += 1) cycles.push(await cycle(index % 2 ? 'theme' : ''));
  note('palette cycles', cycles);
  check(cycles.every(({ opened }) => opened.open && opened.focused === 'palette-input'), 'Ctrl-K opens the palette with its search focused in the same task as the key');
  check(cycles.every(({ closed }) => !closed.open && !closed.closing && closed.focused === 'typing-input'), 'Escape closes it at once, with no closing state, and the passage has focus');
  const slowest = Math.max(...cycles.map(({ opened }) => opened.ms));
  note('slowest open ms', slowest);
  check(slowest < 16, `the slowest of ten opens took under a frame (${slowest.toFixed(1)} ms)`);
  // The key after Escape types.
  const first = (await h.passage()).slice(0, 1);
  await page.keyboard.type(first);
  check(await page.locator('#typing-input').inputValue() === first, 'the first key after Escape lands in the passage');
  await page.locator('#restart-button').click();

  // A guest's theme: offered, and asking for it opens sign in, with nothing sent.
  const before = fake.requests.length;
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('warm kyoto matcha');
  const offer = page.locator('#palette-list [role="option"]', { hasText: 'generate theme · warm kyoto matcha' });
  await offer.waitFor();
  check((await offer.locator('.opt-hint').textContent()) === 'sign in', 'a guest is offered the theme behind sign in');
  await shot('palette-vibe-guest');
  await offer.click();
  await page.locator('#account-dialog[open]').waitFor();
  check(!(await page.locator('#palette').evaluate((dialog) => dialog.open)), 'the palette gives way to the sign-in dialog');
  check(fake.requests.length === before, `a guest's theme sends nothing (${fake.requests.length - before} requests)`);
  note('guest requests', fake.requests.length - before);
  await page.keyboard.press('Escape');

  // A member with 18 rated races at 1920: Gale II.
  const user = fake.addUser('ranked@stilltype.test');
  fake.races.quick.ratings.set(user.id, { rating: 1920, races: 18 });
  await h.signIn('ranked@stilltype.test');
  const pill = page.locator('#rank-pill');
  await pill.waitFor();
  const reading = await pill.evaluate((el) => ({ text: el.textContent, label: el.getAttribute('aria-label'), height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width }));
  note('pill', reading);
  check(reading.text === 'Gale II1920' && reading.label.startsWith('Race rank: Gale'), `the pill reads the member's own rank (${reading.text})`);
  // 44px on a coarse pointer; in a fine pointer's side bar, as tall as the corner's other rows.
  const row = await page.locator('.inbox .corner-trigger').evaluate((el) => el.getBoundingClientRect().height);
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  check(reading.height >= (coarse ? 44 : row) && reading.width >= reading.height, `the pill is as big a target as the corner's others (${reading.height}px)`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing scrolls sideways with the pill in the corner');
  await shot('pill');

  await pill.click();
  const card = page.locator('#rank-popover');
  await card.waitFor();
  await h.settle();
  const placed = await card.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);

    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, origin: style.transformOrigin, width: box.width, animation: style.animationDuration, text: el.textContent };
  });
  note('card', placed);
  check(placed.left >= 0 && placed.right <= width && placed.bottom <= height, 'the card stays inside the viewport');
  // From the pill's corner: under it in a top bar or on a phone, beside the row's foot in the side bar.
  const side = await page.evaluate(() => document.documentElement.dataset.navigation === 'side' && matchMedia('(min-width: 960px)').matches);
  const [x, y] = placed.origin.split(' ').map(Number.parseFloat);
  const from = side ? 'bottom left' : 'top right';
  check(side ? x === 0 && Math.abs(y - (placed.bottom - placed.top)) < 1 : y === 0 && Math.abs(x - placed.width) < 1, `the card grows from its ${from} (${placed.origin})`);
  check(placed.text.includes('Gale II') && placed.text.includes('80 to Gale I') && placed.text.includes('Open quick match'), 'the card shows the rank, the way to the next step and Open quick match');

  if (reduced) check(Number.parseFloat(placed.animation) <= 0.001, `the card appears without motion under reduced motion (${placed.animation})`);
  await shot('rank-card');
  await page.keyboard.press('Escape');
  check(await card.count() === 0, 'Escape puts the card away');
  check(await page.evaluate(() => document.activeElement?.id) === 'rank-pill', 'and focus goes back to the pill');
  await pill.click();
  await page.mouse.click(Math.round(width / 2), Math.round(height * 0.7));
  check(await card.count() === 0, 'a press outside puts the card away');
  await pill.click();
  await page.locator('#rank-popover .rank-challenge').click();
  await h.attr('body', 'data-view', 'compete');
  check(await page.evaluate(() => document.activeElement?.id) === 'quick-match-heading', 'Open quick match goes straight to quick match');
  await h.openView('Practice');

  // A member's theme: generated in the palette, worn, its contrast read, Escape puts it back, Enter saves it.
  let generated = 0;
  await page.route('**/functions/v1/generate-theme', (route) => { generated += 1; route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme: THEME }) }); });
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('vibe warm kyoto matcha');
  check((await page.locator('#palette-list [aria-selected="true"]').textContent()).includes('generate theme · warm kyoto matcha'), '"vibe …" leads with the theme');
  await page.keyboard.press('Enter');
  await page.locator('#palette-theme[data-status="ready"]').waitFor();
  check(await page.evaluate(() => document.documentElement.hasAttribute('data-custom') && getComputedStyle(document.documentElement).getPropertyValue('--ground').trim() === '#10140f'), 'the generated theme is worn while the palette stays open');
  const contrastText = await h.text('#palette-contrast');
  note('contrast', contrastText);
  check(/^AA · \d+(\.\d)?:1$/.test(contrastText), `the contrast reads AA (${contrastText})`);
  await shot('palette-vibe-ready');
  await page.keyboard.press('Escape');
  check(await page.locator('#palette').evaluate((dialog) => dialog.open), 'Escape keeps the palette open');
  check(!(await page.evaluate(() => document.documentElement.hasAttribute('data-custom'))), 'and puts the theme back');
  await page.keyboard.press('Enter');
  await page.locator('#palette-theme[data-status="ready"]').waitFor();
  await page.keyboard.press('Enter');
  check(!(await page.locator('#palette').evaluate((dialog) => dialog.open)), 'Enter saves it and closes the palette');
  // A dark theme saved while the system is light becomes the dark pick, so it is worn only in a dark scheme.
  if (!(await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches))) await page.waitForFunction(() => document.documentElement.hasAttribute('data-custom'));
  await h.openSettings('appearance');
  check(await page.locator('#settings-dialog label:has-text("Kyoto Matcha")').count() > 0, 'the saved theme is in the theme list');
  note('generations', generated);
  check(generated === 2, 'one request for each theme asked for, none while typing');
  await shot('theme-saved');
  await page.keyboard.press('Escape');

  // While typing, the pill steps back with the corner and takes no pointer.
  await pill.click();
  await page.locator('#typing-input').focus();
  check(await card.count() === 0, 'focus going to the passage puts the card away');
  await page.mouse.move(Math.round(width / 2), Math.round(height / 2));
  await h.type((await h.passage()).slice(0, 4));
  await h.attr('body', 'data-running', 'true');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#rank-pill')).opacity === '0');
  check(await pill.evaluate((el) => getComputedStyle(el).pointerEvents) === 'none', 'the pill takes no pointer mid-run');
  await shot('typing');
};
