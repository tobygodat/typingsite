import { test, expect, openApp, openSettings, chooseMore, typeInto } from './fixtures.js';

const TEXT = 'minimum errors remain readable';
const ERROR_LENGTH = 'minimum errors'.length;

async function expectUniformErrorBand(page, testInfo, name) {
  const boxes = await page.locator('#text-display .wrong').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node, node.parentElement.classList.contains('word') ? null : '::before');
    return {
      left: rect.left, right: rect.right,
      top: node.parentElement.classList.contains('word') ? rect.top : rect.top + parseFloat(style.top),
      height: parseFloat(style.height),
    };
  }));
  expect(boxes.length).toBeGreaterThan(1);
  for (const box of boxes) {
    expect(box.top).toBeCloseTo(boxes[0].top, 1);
    expect(box.height).toBeCloseTo(boxes[0].height, 1);
  }
  const left = Math.ceil(boxes[0].left) + 2;
  const right = Math.floor(boxes.at(-1).right) - 2;
  const band = await page.screenshot({ clip: {
    x: left, y: Math.floor(boxes[0].top + boxes[0].height) - 2,
    width: right - left, height: 1,
  } });
  const colors = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, 1).data;
    return [...new Set(Array.from({ length: image.width }, (_, index) => [...pixels.slice(index * 4, index * 4 + 4)].join(',')))];
  }, band.toString('base64'));
  await testInfo.attach(name, { body: band, contentType: 'image/png' });
  expect(colors, 'the error tint stays uniform across every letter and space join').toHaveLength(1);
}

for (const colorScheme of ['dark', 'light']) {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    test(`${colorScheme}, ${reducedMotion}: adjacent errors form one flat tint and correct cleanly`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme, reducedMotion });
      await openApp(page);
      await openSettings(page);
      await page.locator('#word-highlight').selectOption('current');
      await page.keyboard.press('Escape');
      await chooseMore(page, 'mode-custom');
      await page.locator('#custom-text').fill(TEXT);
      await page.locator('#custom-use').click();

      await typeInto(page, 'xxxx');
      await expect(page.locator('#text-display .wrong')).toHaveCount(4);
      await expectUniformErrorBand(page, testInfo, 'adjacent letters');

      await page.keyboard.type('x'.repeat(ERROR_LENGTH - 4));
      await expect(page.locator('#text-display .wrong')).toHaveCount(ERROR_LENGTH);
      await expectUniformErrorBand(page, testInfo, 'letters and space');
      await expect(page.locator('#typing-input')).toBeFocused();
      await expect(page.locator('#text-display .caret-bar')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('errors.png') });

      for (let index = 0; index < ERROR_LENGTH - 3; index += 1) await page.keyboard.press('Backspace');
      await expect(page.locator('#text-display .wrong')).toHaveCount(3);
      await expectUniformErrorBand(page, testInfo, 'after backspacing');
      for (let index = 0; index < 3; index += 1) await page.keyboard.press('Backspace');
      await expect(page.locator('#text-display .wrong')).toHaveCount(0);
      await page.keyboard.type(TEXT);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
      await expect(page.locator('#result-errors')).toHaveText(String(ERROR_LENGTH));
    });
  }
}
