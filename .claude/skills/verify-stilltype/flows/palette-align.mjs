// Command palette alignment: opens the palette with Ctrl+K, walks the selection through every row with the
// arrow keys and measures each one. Checks the highlight covers the selected row exactly, the label, bullet
// and hint are centred in it (1px), the search icon, group headings and bullets share one left edge, the
// search text and labels share the next, the hints end where the esc key does, and no group heading repeats.
// Shots: palette-top, palette-end.
// PALETTE_ALL=1 also walks every theme (in settings → appearance) and every app font (settings → appearance).
const MODES = { dark: ['dark', 'terminal', 'midnight', 'nord'], light: ['light', 'paper', 'shadcn', 'soft', 'swiss', 'e-ink'] };
const FONTS = ['literata', 'source-serif', 'inter'];

function measure() {
  // The ring's geometric edge (stroke centre), the same in every engine: Firefox's client rect includes the stroke.
  const circleLeft = () => { const svg = document.querySelector('.palette-search svg'); return svg.getBoundingClientRect().left + svg.querySelector('circle').getBBox().x * (svg.getBoundingClientRect().width / svg.viewBox.baseVal.width); };
  const rect = (el) => el.getBoundingClientRect();
  const textRect = (node) => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect(); };
  const middle = (r) => r.top + r.height / 2;
  const box = rect(document.querySelector('.palette-box'));
  const scroll = rect(document.querySelector('.palette-scroll'));
  const highlight = rect(document.querySelector('.palette-highlight'));
  const row = document.querySelector('#palette-list [aria-selected="true"]');
  const label = row.querySelector('.opt-label');
  const hint = row.querySelector('.opt-hint');
  const x = (value) => Math.round((value - box.left) * 100) / 100;
  return {
    row: label.textContent,
    highlight: { top: highlight.top - rect(row).top, height: highlight.height - rect(row).height, left: highlight.left - scroll.left, right: scroll.right - highlight.right },
    centre: {
      label: middle(rect(row.querySelector('.opt-text'))) - middle(highlight),
      mark: middle(rect(row.querySelector('.opt-mark'))) - middle(highlight),
      hint: hint ? middle(rect(hint)) - middle(highlight) : 0,
    },
    x: {
      icon: x(circleLeft()),
      headings: [...new Set([...document.querySelectorAll('.palette-group')].map((heading) => x(textRect(heading.firstChild).left)))],
      marks: [...new Set([...document.querySelectorAll('.opt-mark')].map((mark) => x(rect(mark).left)))],
      escRight: rect(document.querySelector('.palette-search kbd')).width ? x(rect(document.querySelector('.palette-search kbd')).right) : null,
      input: x(rect(document.querySelector('#palette-input')).left),
      labels: [...new Set([...document.querySelectorAll('.opt-label')].map((one) => x(rect(one.querySelector('.opt-text')).left)))],
      hintRights: [...new Set([...document.querySelectorAll('.opt-hint')].map((one) => x(rect(one).right)))],
    },
    groups: [...document.querySelectorAll('.palette-group')].map((heading) => heading.textContent),
  };
}

export default async ({ page, h, shot, note, check }) => {
  const idle = () => page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'));
  const walk = async (name, top, end) => {
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').waitFor();
    await idle();
    await shot(top);
    const count = await page.locator('#palette-list [role="option"]').count();
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      if (index) await page.keyboard.press('ArrowDown');
      await idle();
      rows.push(await page.evaluate(measure));
    }
    if (end) await shot(end);
    await page.keyboard.press('Escape');
    await page.locator('#palette').waitFor({ state: 'hidden' });
    return { name, count, rows };
  };
  const walks = [];
  // Notes every walk before the first check throws, so run.json keeps the whole picture.
  const judge = (walks) => {
    const off = (value) => Math.abs(value) > 1;
    const verdicts = walks.map(({ name, count, rows }) => {
      const bad = rows.filter((one) => off(one.highlight.top) || off(one.highlight.height) || off(one.centre.label) || off(one.centre.mark) || off(one.centre.hint));
      const first = rows[0];
      note(name, { rows: count, worst: bad.slice(0, 3), x: first.x, highlight: first.highlight, groups: first.groups });
      return { name, count, bad, first, edges: [first.x.icon, ...first.x.headings, ...first.x.marks], hintEdges: [first.x.escRight ?? first.x.hintRights[0], ...first.x.hintRights], textEdges: [first.x.input, ...first.x.labels] };
    });
    for (const { name, count, bad, first, edges, hintEdges, textEdges } of verdicts) {
      check(bad.length === 0, `${name}: every row's highlight, label, bullet and hint centred (${bad.length} of ${count} off)`);
      check(Math.max(...edges) - Math.min(...edges) <= 1, `${name}: icon, headings and bullets share a left edge (${edges.join(', ')})`);
      check(Math.max(...textEdges) - Math.min(...textEdges) <= 1, `${name}: search text and labels share a left edge (${textEdges.join(', ')})`);
      check(Math.max(...hintEdges) - Math.min(...hintEdges) <= 1, `${name}: hints end at the esc key (${hintEdges.join(', ')})`);
      check(Math.abs(first.highlight.left - first.highlight.right) <= 1, `${name}: highlight inset even (${first.highlight.left} / ${first.highlight.right})`);
      check(new Set(first.groups).size === first.groups.length, `${name}: no repeated group heading (${first.groups.join(', ')})`);
    }
  };

  await h.openApp();
  walks.push(await walk('default', 'palette-top', 'palette-end'));

  if (!process.env.PALETTE_ALL) { judge(walks); return; }
  for (const [mode, theme] of Object.entries(MODES).flatMap(([one, themes]) => themes.map((pick) => [one, pick]))) {
    await h.openSettings('appearance');
    await page.locator(`#theme-select input[value="${mode}"]`).locator('..').click();
    await page.locator(`#${mode}-theme input[value="${theme}"]`).locator('..').click();
    await h.attr('html', 'data-theme', theme);
    await page.keyboard.press('Escape');
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    walks.push(await walk(`theme ${theme}`, `palette-${theme}`));
  }
  for (const font of FONTS) {
    await h.openSettings('appearance');
    const option = page.locator(`input[name="app-font"][value="${font}"]`);
    await option.locator('..').click();
    await page.keyboard.press('Escape');
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    await page.evaluate(() => document.fonts.ready);
    walks.push(await walk(`app font ${font}`, `palette-font-${font}`));
  }
  judge(walks);
};
