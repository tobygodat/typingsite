import test from 'node:test';
import assert from 'node:assert/strict';
import { ditherMask, greyscale } from '../src/wallpaper.js';

const rgba = (values) => new Uint8ClampedArray(values.flatMap((value) => [value, value, value, 255]));
const levels = (mask) => [...mask.filter((_, i) => i % 4 === 3)];

test('greyscale stretches the luma so the image spans the whole range', () => {
  const luma = greyscale(rgba(Array.from({ length: 100 }, (_, i) => 100 + i)));
  assert.equal(luma[0], 0);
  assert.equal(luma[99], 255);
  assert.ok(luma[50] > 100 && luma[50] < 155);
});

test('greyscale weighs green over red over blue and leaves a flat image as it is', () => {
  const [red, green, blue] = greyscale(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]));
  assert.ok(green > red && red > blue);
  assert.deepEqual([...greyscale(rgba([90, 90, 90]))], [90, 90, 90]);
});

test('ditherMask gives one alpha level per dot, in four steps, black underneath', () => {
  const mask = ditherMask({ width: 8, height: 8, luma: new Uint8ClampedArray(64).fill(128) }, 8, 8);
  assert.equal(mask.length, 8 * 8 * 4);
  assert.ok(mask.every((value, i) => i % 4 === 3 || value === 0));
  assert.ok(levels(mask).every((value) => [0, 85, 170, 255].includes(value)));
});

test('ordered dither keeps the average brightness and varies dot to dot', () => {
  for (const grey of [0, 40, 128, 200, 255]) {
    const mask = levels(ditherMask({ width: 16, height: 16, luma: new Uint8ClampedArray(256).fill(grey) }, 16, 16));
    const mean = mask.reduce((sum, value) => sum + value, 0) / mask.length;
    assert.ok(Math.abs(mean - grey) <= 12, `grey ${grey} averages ${mean}`);
    if (grey > 0 && grey < 255 && grey % 85) assert.ok(new Set(mask).size > 1, `grey ${grey} is dithered`);
  }
});

test('the image covers the dots: cropped to the middle, never stretched', () => {
  // Left half black, right half white, twice as wide as tall: a square grid shows the middle half.
  const width = 40;
  const luma = new Uint8ClampedArray(width * 20).map((_, i) => (i % width < width / 2 ? 0 : 255));
  const mask = levels(ditherMask({ width, height: 20, luma }, 8, 8));
  for (let y = 0; y < 8; y++) {
    assert.deepEqual(mask.slice(y * 8, y * 8 + 4), [0, 0, 0, 0]);
    assert.deepEqual(mask.slice(y * 8 + 4, y * 8 + 8), [255, 255, 255, 255]);
  }
});

test('a small image still fills a large grid', () => {
  const mask = levels(ditherMask({ width: 2, height: 1, luma: new Uint8ClampedArray([0, 255]) }, 30, 10));
  assert.equal(mask.length, 300);
  assert.equal(mask[0], 0);
  assert.equal(mask[29], 255);
});
