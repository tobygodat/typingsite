// Contrast floor for the shipped tokens: text ≥ 4.5:1 and non-text ≥ 3:1 in every theme.
// Reads the token blocks straight from src/styles.css, follows the cascade (plain :root first, then
// :root[data-theme="…"]), composites translucent tokens over the surface they sit on, and checks the
// pairs the app renders. The browser-side check of the same pairs is e2e/light-contrast.spec.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stylesheet = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// ── Parsing ───────────────────────────────────────────────────────────────

// Flat rules as { selectors, declarations }. Rules nested in @media are included; at-rule preludes are not.
function parseRules(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];

  for (const [, prelude, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorText = prelude.trim();

    if (!selectorText || selectorText.startsWith('@')) continue;
    const declarations = {};

    for (const part of body.split(';')) {
      const match = part.match(/^\s*([-\w]+)\s*:\s*([\s\S]+?)\s*$/);

      if (match) declarations[match[1]] = match[2];
    }

    rules.push({ selectors: selectorText.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), declarations });
  }

  return rules;
}

const themeOf = (selector) => selector.match(/^:root\[data-theme=["']?([\w-]+)["']?\]$/)?.[1];

// The custom properties each theme resolves to: every plain :root rule, then that theme's own rules,
// which win on specificity whatever their source order.
function themeTokens(css) {
  const rules = parseRules(css);
  const pick = (test) => Object.assign({}, ...rules.filter((rule) => rule.selectors.some(test)).map((rule) => Object.fromEntries(Object.entries(rule.declarations).filter(([name]) => name.startsWith('--')))));
  const base = pick((selector) => selector === ':root');
  const names = new Set(rules.flatMap((rule) => rule.selectors.map(themeOf)).filter(Boolean));

  return Object.fromEntries([...names].map((name) => [name, { ...base, ...pick((selector) => themeOf(selector) === name) }]));
}

function resolve(value, tokens, depth = 0) {
  assert.ok(depth < 10, `var() cycle in ${value}`);

  return value.replace(/var\(\s*(--[-\w]+)\s*(?:,\s*([^()]*))?\)/g, (_, name, fallback) => {
    const next = tokens[name] ?? fallback;
    assert.ok(next !== undefined, `${name} is not defined`);

    return resolve(next.trim(), tokens, depth + 1);
  });
}

const channelValue = (part, scale) => (part.endsWith('%') ? (parseFloat(part) / 100) * scale : parseFloat(part));

// [r, g, b, a] from hex or rgb()/rgba(), in comma or space syntax. Anything else fails loudly.
function parseColour(value) {
  const text = value.trim().toLowerCase();
  const hex = text.match(/^#([0-9a-f]{3,8})$/);

  if (hex && [3, 4, 6, 8].includes(hex[1].length)) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map((d) => d + d) : hex[1].match(/../g);
    const [r, g, b, a = 'ff'] = digits;

    return [r, g, b].map((d) => parseInt(d, 16)).concat(parseInt(a, 16) / 255);
  }

  const fn = text.match(/^rgba?\(([^)]*)\)$/);

  if (fn) {
    const [channels, alphaPart] = fn[1].includes('/') ? fn[1].split('/') : [fn[1], undefined];
    const parts = channels.split(/[\s,]+/).filter(Boolean);
    const alpha = alphaPart ?? parts[3];

    return parts.slice(0, 3).map((p) => channelValue(p, 255)).concat(alpha === undefined ? 1 : channelValue(alpha.trim(), 1));
  }

  throw new Error(`Unsupported colour for the contrast check: ${value}`);
}

// ── WCAG 2 maths ──────────────────────────────────────────────────────────

const over = (top, under, alpha = top[3]) => [0, 1, 2].map((i) => top[i] * alpha + under[i] * (1 - alpha)).concat(1);

const linear = (v) => {
  const s = v / 255;

  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

// ── The pairs ─────────────────────────────────────────────────────────────

const rules = parseRules(stylesheet);

const plainNumber = (value, where) => {
  assert.match(value, /^(\d*\.)?\d+$/, `${where} opacity must be a plain number to check it`);

  return Number(value);
};

const faded = (colour, opacity) => [...colour.slice(0, 3), colour[3] * opacity];

// The ghost caret is drawn at the opacity of its .ghost-caret rule.
const ghostOpacity = plainNumber(rules.find((r) => r.selectors.includes('.ghost-caret'))?.declarations.opacity ?? '1', '.ghost-caret');

// Every placeholder rule must set opacity itself, so no browser default fade applies on top of the token.
const placeholderRules = rules.filter((r) => r.selectors.some((s) => s.endsWith('::placeholder')));

function pairs(tokens) {
  const colour = (name) => parseColour(resolve(`var(${name})`, tokens));
  const ground = colour('--ground');
  const surfaces = { ground, 'ground-2': over(colour('--ground-2'), ground), raised: over(colour('--raised'), ground) };
  const { raised } = surfaces;
  const wash = colour('--raised-2');
  const washOverRaised = over(wash, raised);
  const washOverGround = over(wash, ground);

  // A translucent foreground lands on whatever is behind it, so composite before comparing.
  const list = [];
  const text = (label, fg, bg) => list.push({ label, value: ratio(over(fg, bg), bg), min: 4.5 });
  const nonText = (label, fg, bg) => list.push({ label, value: ratio(over(fg, bg), bg), min: 3 });

  for (const name of ['--text', '--muted', '--accent', '--danger', '--warning']) {
    for (const [surface, bg] of Object.entries(surfaces)) text(`${name} on ${surface}`, colour(name), bg);
  }

  // A mistyped letter on its own tint, in the passage and on a hovered danger button in a dialog.
  text('--danger on --danger-soft over ground', colour('--danger'), over(colour('--danger-soft'), ground));
  text('--danger on --danger-soft over raised', colour('--danger'), over(colour('--danger-soft'), raised));
  // The selected palette row and hovered rows in raised surfaces.
  text('--accent on --raised-2 over raised', colour('--accent'), washOverRaised);
  // The checked option in a settings radio group, on the raised dialog.
  text('--accent on --accent-soft over raised', colour('--accent'), over(colour('--accent-soft'), raised));
  text('--muted on --raised-2 over raised', colour('--muted'), washOverRaised);
  text('--text on --raised-2 over raised', colour('--text'), washOverRaised);
  text('--ghost on --raised-2 over raised (palette ghost row)', colour('--ghost'), washOverRaised);
  // A pressed challenge-mode button under the pointer.
  text('--accent on --raised-2 over ground', colour('--accent'), washOverGround);
  text('--accent-ink on --accent (primary button)', colour('--accent-ink'), colour('--accent'));
  // A key's letter on the hottest heatmap fill.
  text('--text on --heat-3 over ground', colour('--text'), over(colour('--heat-3'), ground));
  // Placeholders as the stylesheet paints them: the rule's colour, faded by the rule's opacity. Fields
  // are raised stock, and the palette's search field sits on the raised palette box.
  assert.ok(placeholderRules.some((r) => r.selectors.includes('.input::placeholder')), '.input::placeholder rule not found');

  for (const { selectors, declarations } of placeholderRules) {
    const where = selectors.join(', ');

    // Reported with the ratios rather than thrown, so a failing run still lists every pair.
    if (!declarations.opacity) list.push({ label: `${where} sets no opacity, so a browser default fade can apply`, value: 0, min: 1 });
    text(`${where} on raised`, faded(parseColour(resolve(declarations.color, tokens)), plainNumber(declarations.opacity ?? '1', where)), raised);
  }

  // Carets cross mistyped letters, so they hold 3:1 on the coral tint as well as on bare ground.
  const tint = over(colour('--danger-soft'), ground);
  nonText('ghost caret over ground', faded(colour('--ghost'), ghostOpacity), ground);
  nonText('ghost caret over --danger-soft over ground', faded(colour('--ghost'), ghostOpacity), tint);
  nonText('caret (--accent) over --danger-soft over ground', colour('--accent'), tint);
  nonText('--outline against raised', colour('--outline'), raised);
  nonText('--outline against ground', colour('--outline'), ground);
  nonText('caret (--accent) over ground', colour('--accent'), ground);
  nonText('focus ring (--text) against ground', colour('--text'), ground);
  nonText('focus ring (--text) against raised', colour('--text'), raised);

  return list;
}

const themes = themeTokens(stylesheet);

test('the stylesheet defines ten theme token sets of the same shape', () => {
  assert.deepEqual(Object.keys(themes).sort(), ['dark', 'e-ink', 'light', 'midnight', 'nord', 'paper', 'shadcn', 'soft', 'swiss', 'terminal']);
  // Every theme is the same token set: one that leaves a token out would inherit dark's value for it.
  const own = (name) => [...new Set(rules.filter((rule) => rule.selectors.some((selector) => themeOf(selector) === name)).flatMap((rule) => Object.keys(rule.declarations)))].sort();

  for (const name of Object.keys(themes)) assert.deepEqual(own(name), own('dark'), `${name} sets exactly the tokens dark sets`);

  for (const [name, tokens] of Object.entries(themes)) {
    for (const token of ['--ground', '--ground-2', '--raised', '--raised-2', '--text', '--muted', '--accent', '--danger', '--danger-soft', '--ghost', '--outline', '--placeholder']) {
      assert.ok(tokens[token], `${name} theme is missing ${token}`);
    }
  }
});

for (const name of Object.keys(themes)) {
  test(`${name} theme: text ≥ 4.5:1 and non-text ≥ 3:1`, () => {
    const results = pairs(themes[name]);
    assert.ok(results.length >= 25);
    const failures = results.filter((pair) => pair.value < pair.min).map((pair) => `${pair.label}: ${pair.value.toFixed(2)} < ${pair.min}`);
    assert.deepEqual(failures, []);
  });
}

test('the parser follows the cascade and reads other colour syntaxes', () => {
  const css = `
    /* a comment with { braces } */
    :root{--ground:#fff;--text:rgb(0 0 0 / 100%)}
    :root[data-theme='dark'] { --ground: #000; --raised: rgba(255,255,255,.5) }
    @media (min-width: 1px) {
      :root[data-theme="light"] {
        --raised: var(--ground);
        --muted: #3338;
      }
    }`;

  const parsed = themeTokens(css);
  assert.deepEqual(Object.keys(parsed).sort(), ['dark', 'light']);
  assert.deepEqual(parseColour(resolve('var(--raised)', parsed.light)), [255, 255, 255, 1]);
  assert.deepEqual(parseColour(resolve('var(--raised)', parsed.dark)), [255, 255, 255, 0.5]);
  assert.deepEqual(parseColour(resolve('var(--text)', parsed.dark)), [0, 0, 0, 1]);
  assert.deepEqual(parseColour(parsed.light['--muted']).map((v) => Number(v.toFixed(3))), [51, 51, 51, 0.533]);
  assert.equal(ratio([0, 0, 0, 1], [255, 255, 255, 1]), 21);
  assert.throws(() => parseColour('color-mix(in oklab, red, blue)'), /Unsupported colour/);
});
