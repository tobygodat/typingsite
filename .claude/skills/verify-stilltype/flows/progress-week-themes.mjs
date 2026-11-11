// Progress, "What changed" (TOB-420), in every theme: the gain history from progress-week.mjs, then for each theme,
// picked in settings → appearance in its mode, a shot of the overview.
import { history } from './progress-week.mjs';

const MODES = { dark: ['dark', 'terminal', 'midnight', 'nord'], light: ['light', 'paper', 'shadcn', 'soft', 'swiss', 'e-ink'] };

export default async ({ page, h, shot, check, fake }) => {
  const user = fake.addUser('week-themes@stilltype.test');
  fake.profiles.set(user.id, { data: history('gain') });
  await h.openApp();
  await h.signIn('week-themes@stilltype.test');
  await h.attr('#account', 'data-sync', 'synced');

  for (const [mode, theme] of Object.entries(MODES).flatMap(([name, themes]) => themes.map((one) => [name, one]))) {
    await h.openSettings('appearance');
    await page.locator(`#theme-select input[value="${mode}"]`).locator('..').click();
    await page.locator(`#${mode}-theme input[value="${theme}"]`).locator('..').click();
    await h.attr('html', 'data-theme', theme);
    await page.keyboard.press('Escape');
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    await h.openView('Progress');
    await h.settle();
    check((await page.locator('#week-movers li[data-status="slipping"]').count()) === 1, `${theme}: the slipping pair shows`);
    await shot(theme);
  }
};
