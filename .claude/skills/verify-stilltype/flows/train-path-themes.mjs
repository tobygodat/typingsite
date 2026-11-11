// Train's path (TOB-420) in every theme: the same synced history as train-path.mjs, then for each theme, picked in
// settings → appearance in its mode, a shot of the path. Run with --delay 40.
import { history } from './train-path.mjs';

const MODES = { dark: ['dark', 'terminal', 'midnight', 'nord'], light: ['light', 'paper', 'shadcn', 'soft', 'swiss', 'e-ink'] };

export default async ({ page, h, shot, check, fake }) => {
  const user = fake.addUser('path-themes@stilltype.test');
  fake.profiles.set(user.id, { data: history() });
  await h.openApp();
  await h.signIn('path-themes@stilltype.test');
  await h.attr('#account', 'data-sync', 'synced');

  for (const [mode, theme] of Object.entries(MODES).flatMap(([name, themes]) => themes.map((one) => [name, one]))) {
    await h.openSettings('appearance');
    await page.locator(`#theme-select input[value="${mode}"]`).locator('..').click();
    await page.locator(`#${mode}-theme input[value="${theme}"]`).locator('..').click();
    await h.attr('html', 'data-theme', theme);
    await page.keyboard.press('Escape');
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    await h.openView('Train');
    await h.settle();
    check((await page.locator('#train-path .is-fixed').count()) >= 1, `${theme}: a fixed step shows`);
    await shot(theme);
  }
};
