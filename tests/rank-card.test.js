// The rank card's contrast floor, from its own colour table (src/rank-card.js): every piece of text holds 4.5:1 and
// the emblem, its mark and the bar hold 3:1, on the dark card and the paper card, for every rank and the provisional
// card. The card's ground is a gradient, so each colour is checked against every stop of it, the brightest included.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD, PROVISIONAL_LOOK, RANK_LOOKS, cardColours } from '../src/rank-card.js';
import { RANKS } from '../src/quick-match.js';

function parse(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);

  if (hex) return [...hex[1].match(/../g).map((pair) => parseInt(pair, 16)), 1];
  const fn = value.match(/^rgba?\(([^)]*)\)$/);
  assert.ok(fn, `unsupported colour ${value}`);
  const [r, g, b, a = 1] = fn[1].split(',').map(Number);

  return [r, g, b, a];
}

const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
const linear = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

function pairs(look, scheme) {
  const colour = Object.fromEntries(Object.entries(cardColours(look, scheme)).map(([name, value]) => [name, parse(value)]));
  const grounds = ['top', 'mid', 'edge'].map((stop) => [stop, colour[stop]]);
  const list = [];
  const check = (label, fg, bg, min) => list.push({ label, value: ratio(over(fg, bg), bg), min });

  for (const [stop, ground] of grounds) {
    const hull = over(colour.hull, ground);
    const track = over(colour.track, ground);

    // The label, the numeral, the rank name's two ends, the rating, the change and the quiet lines.
    for (const name of ['a', 'ink', 'soft', 'up', 'down']) check(`${name} text on ${stop}`, colour[name], ground, 4.5);
    check(`step numeral (a) on the hull over ${stop}`, colour.a, hull, 4.5);

    // The hexagon and the mark are drawn from a to b; the bar's fill runs b to a, and a gain or loss lies on its track.
    for (const name of ['a', 'b']) {
      check(`${name} stroke on ${stop}`, colour[name], ground, 3);
      check(`${name} mark on the hull over ${stop}`, colour[name], hull, 3);
      check(`${name} bar fill on the track over ${stop}`, colour[name], track, 3);
    }

    check(`gain on the track over ${stop}`, colour.gain, track, 3);
    check(`loss (down) on the track over ${stop}`, colour.down, track, 3);
  }

  return list;
}

test('every rank has one look, and nothing else does', () => {
  assert.deepEqual(Object.keys(RANK_LOOKS), [...RANKS.names]);

  for (const [name, look] of Object.entries(RANK_LOOKS)) {
    assert.match(look.mark, /^<(path|circle) /, `${name} has a mark`);
    assert.ok(look.wind.trails > 0 && look.wind.speed > 0 && look.sway > 0, `${name} has wind and sway`);
  }

  // The wind gets denser and faster up the ladder, and the mark sways faster.
  const looks = Object.values(RANK_LOOKS);

  for (let i = 1; i < looks.length; i += 1) {
    assert.ok(looks[i].wind.trails > looks[i - 1].wind.trails && looks[i].wind.speed > looks[i - 1].wind.speed, RANKS.names[i]);
    assert.ok(looks[i].sway < looks[i - 1].sway, RANKS.names[i]);
  }
});

for (const [name, look] of [...Object.entries(RANK_LOOKS), ['provisional', PROVISIONAL_LOOK]]) {
  for (const scheme of Object.keys(CARD)) {
    test(`${name} on the ${scheme} card: text ≥ 4.5:1 and marks ≥ 3:1`, () => {
      const results = pairs(look, scheme);
      assert.equal(results.length, 42);
      const failures = results.filter((pair) => pair.value < pair.min).map((pair) => `${pair.label}: ${pair.value.toFixed(2)} < ${pair.min}`);
      assert.deepEqual(failures, []);
    });
  }
}

test('the contrast maths reads the colours the card writes', () => {
  assert.equal(ratio([0, 0, 0, 1], [255, 255, 255, 1]), 21);
  assert.deepEqual(parse(cardColours(RANK_LOOKS.Gale, 'dark').top), [19, 55, 65, 1]);
  assert.deepEqual(parse('rgba(255, 255, 255, 0.09)'), [255, 255, 255, 0.09]);
});
