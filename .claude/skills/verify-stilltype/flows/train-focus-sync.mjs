// A training focus chosen on another device (TOB-419). Signed in as verify@stilltype.test at words 50, three
// passages typed with a 150 ms pause before the "h" of every "th" and the "n" of every "an" and "in" missed once.
// A second browser context, the phone, signs in as the same account and picks a focus in the settings dialog; this
// page hears of it when its connection returns (an `online` event, as the profile-sync specs send), and the results
// card, then Train, follow. Run with --signed-in --delay 40.
export default async ({ page, h, shot, note, check, fake, url }) => {
  const typeHistoryRun = async () => {
    const text = await h.passage();
    await page.locator('#typing-input').focus();

    for (let at = 0; at < text.length; at += 1) {
      if (text.slice(at - 1, at + 1) === 'th') await page.waitForTimeout(150);

      if (['an', 'in'].includes(text.slice(at - 1, at + 1))) {
        await page.keyboard.type('x');
        await page.keyboard.press('Backspace');
      }

      await page.keyboard.type(text[at], { delay: 40 });
    }

    await h.attr('body', 'data-view', 'results');
  };

  await h.chooseWords(50);

  for (let run = 0; run < 3; run += 1) {
    if (run) {
      await page.locator('#run-again').click();
      await h.attr('body', 'data-view', 'practice');
    }

    await typeHistoryRun();
  }

  const light = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
  const context = await page.context().browser().newContext({ baseURL: url, viewport: page.viewportSize(), colorScheme: light ? 'light' : 'dark', serviceWorkers: 'block' });
  const phone = await context.newPage();
  await fake.attach(phone);

  const chooseOnPhone = async (focus) => {
    await phone.locator('#settings-trigger').click();
    await phone.locator('[data-settings-category="practice"]').click();
    await phone.locator(`#train-focus input[value="${focus}"]`).locator('..').click();
    await phone.locator('#settings-done').click();

    for (let tries = 0; tries < 50 && fake.profileFor('verify@stilltype.test')?.preferences?.trainFocus !== focus; tries += 1) await phone.waitForTimeout(100);
    check(fake.profileFor('verify@stilltype.test')?.preferences?.trainFocus === focus, `the phone saved ${focus}`);
    await page.evaluate(() => dispatchEvent(new Event('online')));
  };

  try {
    await phone.goto('/');
    await phone.locator('#text-display .char').first().waitFor();
    await phone.locator('#account-trigger').click();
    await phone.locator('#account-signin').click();
    await phone.locator('#account-email-input').fill('verify@stilltype.test');
    await phone.locator('#account-password').fill('correct horse battery');
    await Promise.all([phone.waitForEvent('load'), phone.locator('#account-submit').click()]);
    await phone.locator('#account[data-state="member"]').waitFor();

    await h.settle();
    const before = await h.text('#result-drill');
    note('card, balanced', before);
    await shot('card-before');

    await chooseOnPhone('accuracy');
    await page.waitForFunction((was) => document.querySelector('#result-drill').textContent !== was, before);
    await h.settle();
    note('card after the phone chose accuracy', await h.text('#result-drill'));
    await shot('card-after-phone-accuracy');

    await h.openView('Train');
    await h.settle();
    const accuracy = await h.text('#train-heading');
    note('train, accuracy', accuracy);
    check(accuracy === (await h.text('#result-drill')).replace('Drill', 'Practice'), 'Train names what the card named');
    await shot('train-accuracy');

    await chooseOnPhone('speed');
    await page.waitForFunction((was) => document.querySelector('#train-heading').textContent !== was, accuracy);
    await h.settle();
    note('train after the phone chose speed', await h.text('#train-heading'));
    await shot('train-after-phone-speed');
  } finally {
    await context.close();
  }
};
