// System mode with a dark and a light pick: pick nord and paper in settings → appearance, then emulate each
// system scheme. Shots: settings-<scheme> (the appearance rows) and idle-<scheme> (the page).
export default async ({ page, h, shot, check }) => {
  const picks = { dark: 'nord', light: 'paper' };
  await h.openApp();
  await h.openSettings('appearance');
  check(await page.locator('#theme-select input[value="system"]').isChecked(), 'theme starts at system');
  for (const [mode, theme] of Object.entries(picks)) {
    const option = page.locator(`#${mode}-theme input[value="${theme}"]`);
    await option.locator('..').click();
    check(await option.isChecked(), `${mode} theme radio "${theme}" is checked`);
  }
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await h.attr('html', 'data-theme', picks[scheme]);
    check(await page.locator('#theme-select input[value="system"]').isChecked(), `still system with the ${scheme} scheme`);
    await h.settle();
    await shot(`settings-${scheme}`);
  }
  await page.keyboard.press('Escape');
  await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await h.attr('html', 'data-theme', picks[scheme]);
    await h.settle();
    await shot(`idle-${scheme}`);
  }
};
