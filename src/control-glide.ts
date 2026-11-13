import type { createApplicationLifetime } from './application-lifetime.js';

export function createControlGlides(lifetime: ReturnType<typeof createApplicationLifetime>) {
  function update(container: HTMLElement, { instant = false } = {}) {
    const pill = container.querySelector<HTMLElement>(':scope > .glide-pill');

    if (!pill) throw new Error('A React control group has no glide host');

    const target = container.querySelector<HTMLElement>(container.dataset.glide === 'current' ? ':scope > [aria-current="page"]' : ':scope > [aria-pressed="true"]')
      ?? container.querySelector<HTMLElement>(':scope > [data-active]');

    if (!target || !target.offsetWidth) {
      pill.style.setProperty('--pill-o', '0');

      return;
    }

    if (instant) container.classList.add('no-anim');
    pill.style.setProperty('--pill-x', `${target.offsetLeft}px`);
    pill.style.setProperty('--pill-y', `${target.offsetTop}px`);
    pill.style.setProperty('--pill-w', `${target.offsetWidth}px`);
    pill.style.setProperty('--pill-h', `${target.offsetHeight}px`);
    pill.style.setProperty('--pill-o', '1');

    if (instant) lifetime.frame(() => lifetime.frame(() => container.classList.remove('no-anim')));
  }

  return { update, all(options?: { instant?: boolean }) { document.querySelectorAll<HTMLElement>('.glide').forEach((container) => update(container, options)); } };
}
