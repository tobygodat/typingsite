import type { createApplicationLifetime } from './application-lifetime.js';

const px = (value: number) => `${value}px`;

// Where a node's untransformed box starts inside the group, through every positioned box between them.
function offsetIn(container: HTMLElement, node: HTMLElement) {
  let x = 0;
  let y = 0;

  for (let at: Element | null = node; at instanceof HTMLElement && at !== container; at = at.offsetParent) {
    x += at.offsetLeft;
    y += at.offsetTop;
  }

  return { x, y };
}

// The ink layer is a native host: one copy of each choice's label, set where the label sits and in its type, so
// the clipped window shows the chosen label in ink exactly over the one it hides. A disclosure's label is its
// summary; the menu under it never shows in the row.
function paintInk(container: HTMLElement, ink: HTMLElement, target: HTMLElement | null) {
  const items = [...container.querySelectorAll<HTMLElement>(':scope > :is(button, details)')];

  while (ink.children.length > items.length) ink.lastElementChild?.remove();

  while (ink.children.length < items.length) ink.append(document.createElement('span'));

  items.forEach((item, index) => {
    const copy = ink.children[index];
    const label = item.matches('details') ? item.querySelector<HTMLElement>(':scope > summary') : item;

    if (!(copy instanceof HTMLElement) || !label) return;
    copy.className = item.matches('details') ? 'glide-ink-label is-disclosure' : 'glide-ink-label';
    copy.hidden = !label.offsetWidth;

    if (copy.hidden) return;
    const style = getComputedStyle(label);
    const { x, y } = offsetIn(container, label);
    copy.textContent = label.textContent;
    Object.assign(copy.style, {
      left: px(x), top: px(y), width: px(label.offsetWidth), height: px(label.offsetHeight),
      padding: style.padding, columnGap: style.columnGap, justifyContent: style.display.includes('flex') ? style.justifyContent : 'center',
      fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight,
    });
  });

  if (!target) return;
  const { x, y } = offsetIn(container, target);
  ink.style.setProperty('--ink-t', px(y));
  ink.style.setProperty('--ink-r', px(ink.clientWidth - x - target.offsetWidth));
  ink.style.setProperty('--ink-b', px(ink.clientHeight - y - target.offsetHeight));
  ink.style.setProperty('--ink-l', px(x));
}

function placePill(pill: HTMLElement, target: HTMLElement | null) {
  if (!target) return;
  pill.style.setProperty('--pill-x', px(target.offsetLeft));
  pill.style.setProperty('--pill-y', px(target.offsetTop));
  pill.style.setProperty('--pill-w', px(target.offsetWidth));
  pill.style.setProperty('--pill-h', px(target.offsetHeight));
}

export function createControlGlides(lifetime: ReturnType<typeof createApplicationLifetime>) {
  function update(container: HTMLElement, { instant = false } = {}) {
    const pill = container.querySelector<HTMLElement>(':scope > .glide-pill');
    const ink = container.querySelector<HTMLElement>(':scope > .glide-ink');
    const mark = ink ?? pill;

    if (!mark) throw new Error('A React control group has no glide host');

    const chosen = container.querySelector<HTMLElement>(container.dataset.glide === 'current' ? ':scope > [aria-current="page"]' : ':scope > [aria-pressed="true"]')
      ?? container.querySelector<HTMLElement>(':scope > [data-active]');

    const target = chosen?.offsetWidth ? chosen : null;

    if (instant) container.classList.add('no-anim');

    if (ink) paintInk(container, ink, target);
    else if (pill) placePill(pill, target);
    mark.style.setProperty(ink ? '--ink-o' : '--pill-o', target ? '1' : '0');

    if (instant) lifetime.frame(() => lifetime.frame(() => container.classList.remove('no-anim')));
  }

  return { update, all(options?: { instant?: boolean }) { document.querySelectorAll<HTMLElement>('.glide').forEach((container) => update(container, options)); } };
}
