// Every theme: in settings → appearance, set the theme to its mode (dark or light) and pick it in that mode's
// row, then a 10-word run with one slip (mid-run shot shows typed, mistyped and untyped letters and the
// caret), then the results. Shots: <theme>-settings, <theme>-mid-run, <theme>-results. At a phone width it
// shoots mid-run only.
const MODES = { dark: ['dark', 'terminal', 'midnight', 'nord'], light: ['light', 'paper', 'shadcn', 'soft', 'swiss', 'e-ink'] };

export default async ({ page, h, shot, check }) => {
  const phone = page.viewportSize().width < 761;
  for (const [mode, theme] of Object.entries(MODES).flatMap(([name, themes]) => themes.map((one) => [name, one]))) {
    await h.openApp();
    await h.openSettings('appearance');
    await page.locator(`#theme-select input[value="${mode}"]`).locator('..').click();
    const option = page.locator(`#${mode}-theme input[value="${theme}"]`);
    await option.locator('..').click();
    await h.attr('html', 'data-theme', theme);
    check(await option.isChecked(), `${theme} radio is checked`);
    const ground = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ground').trim());
    check(await page.locator('meta[name="theme-color"]').first().getAttribute('content') === ground, `${theme} theme-color follows --ground`);
    await h.settle();
    if (!phone) await shot(`${theme}-settings`);
    await page.keyboard.press('Escape');
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });

    await h.chooseWords(10);
    const text = await h.passage();
    const half = Math.ceil(text.length / 2);
    let slip = 6;
    while (!/[a-z]/i.test(text[slip])) slip += 1;
    await h.type(`${text.slice(0, slip)}${text[slip] === 'x' ? 'z' : 'x'}${text.slice(slip + 1, half)}`);
    check(await page.locator('body').getAttribute('data-running') !== null, `${theme} run is under way`);
    await h.settle();
    await shot(`${theme}-mid-run`);
    if (phone) continue;
    await h.type(text.slice(half));
    await h.attr('body', 'data-view', 'results');
    await h.settle();
    await shot(`${theme}-results`);
  }
};
