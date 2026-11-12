// Train's open step at a phone size (TOB-448): with drills behind you, is the Drill button clear of the dock on first
// view, with no sideways scroll? Run with --width 320 --height 568 --mobile (and 390 × 844 to compare).
import { history } from './train-path.mjs';

export default async ({ page, h, shot, note, check, fake }) => {
  const user = fake.addUser('dock@stilltype.test');
  fake.profiles.set(user.id, { data: history() });
  await h.openApp();
  await h.signIn('dock@stilltype.test');
  await h.openView('Train');
  await h.settle();

  const measure = () => page.evaluate(() => {
    const box = (node) => node.getBoundingClientRect();
    const button = box(document.querySelector('#start-drill'));
    const dock = box(document.querySelector('.dock'));
    const viewport = { width: innerWidth, height: innerHeight };

    return { button: { top: Math.round(button.top), bottom: Math.round(button.bottom), height: Math.round(button.height) },
      dock: { top: Math.round(dock.top), bottom: Math.round(dock.bottom) }, viewport, scrollY: Math.round(scrollY),
      sideways: document.documentElement.scrollWidth - innerWidth };
  });

  const first = await measure();
  note('first view', first);
  await shot('first-view');
  const clear = first.dock.top >= first.viewport.height / 2 ? first.button.bottom <= first.dock.top : first.button.top >= first.dock.bottom;
  check(clear && first.button.bottom <= first.viewport.height, 'the Drill button is clear of the dock and on screen on first view');
  check(first.button.height >= 44, 'the Drill button is at least 44px tall');
  check(first.sideways <= 0, 'nothing scrolls sideways');
};
