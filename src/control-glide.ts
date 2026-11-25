import type { createApplicationLifetime } from './application-lifetime.js';

const px = (value: number) => `${value}px`;

// A node's box inside the group, to the fraction of a pixel: whole-pixel offsets leave the ink up to a pixel off
// a label set in sub-pixel type. A pressed choice is scaled about its centre, so its centre holds and its layout
// size stands in for the scaled one.
function boxIn(container: HTMLElement, node: HTMLElement) {
  const group = container.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const still = getComputedStyle(node).transform === 'none';
  const width = still ? box.width : node.offsetWidth;
  const height = still ? box.height : node.offsetHeight;

  return {
    x: box.left + (box.width - width) / 2 - group.left - container.clientLeft,
    y: box.top + (box.height - height) / 2 - group.top - container.clientTop,
    width, height,
  };
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
    const { x, y, width, height } = boxIn(container, label);
    copy.textContent = label.textContent;
    Object.assign(copy.style, {
      left: px(x), top: px(y), width: px(width), height: px(height),
      padding: style.padding, columnGap: style.columnGap, justifyContent: style.display.includes('flex') ? style.justifyContent : 'center',
      fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight,
    });
  });

  if (!target) return;
  const layer = boxIn(container, ink);
  const chosen = boxIn(container, target);
  ink.style.setProperty('--ink-t', px(chosen.y - layer.y));
  ink.style.setProperty('--ink-r', px(layer.x + layer.width - chosen.x - chosen.width));
  ink.style.setProperty('--ink-b', px(layer.y + layer.height - chosen.y - chosen.height));
  ink.style.setProperty('--ink-l', px(chosen.x - layer.x));
}

function placePill(pill: HTMLElement, target: HTMLElement | null) {
  if (!target) return;
  pill.style.setProperty('--pill-x', px(target.offsetLeft));
  pill.style.setProperty('--pill-y', px(target.offsetTop));
  pill.style.setProperty('--pill-w', px(target.offsetWidth));
  pill.style.setProperty('--pill-h', px(target.offsetHeight));
}

export function createControlGlides(lifetime: ReturnType<typeof createApplicationLifetime>) {
  // A group re-measures when a choice, or the group, changes size, or when the app's type changes or a font
  // finishes loading without either: a label set in new type can move without its button changing size.
  const owners = new WeakMap<Element, HTMLElement>();
  const sizes = new WeakMap<Element, string>();
  const stale = new Set<HTMLElement>();
  let frame = 0;
  let resizes: ResizeObserver | null = null;

  function remeasure(container: HTMLElement) {
    stale.add(container);

    if (frame) return;
    frame = lifetime.frame(() => {
      frame = 0;
      const groups = [...stale];
      stale.clear();
      groups.forEach((group) => { if (group.isConnected) update(group, { instant: true }); });
    });
  }

  const remeasureAll = () => document.querySelectorAll<HTMLElement>('.glide').forEach(remeasure);

  function watch(container: HTMLElement) {
    if (!resizes) {
      resizes = new ResizeObserver((entries) => {
        for (const { target, borderBoxSize, contentRect } of entries) {
          const box = borderBoxSize?.[0];
          const size = box ? `${box.inlineSize}x${box.blockSize}` : `${contentRect.width}x${contentRect.height}`;
          const before = sizes.get(target);
          sizes.set(target, size);
          const group = owners.get(target);

          // The first report only records the size the group was just measured at.
          if (before !== undefined && before !== size && group) remeasure(group);
        }
      });
      lifetime.signal.addEventListener('abort', () => resizes?.disconnect(), { once: true });
      lifetime.observeMutation(remeasureAll, document.documentElement, { attributeFilter: ['data-app-font', 'data-typing-font'] });
      document.fonts?.addEventListener('loadingdone', remeasureAll, { signal: lifetime.signal });
    }

    for (const node of [container, ...container.querySelectorAll<HTMLElement>(':scope > :is(button, details)')]) {
      if (owners.has(node)) continue;
      owners.set(node, container);
      resizes.observe(node);
    }
  }

  function update(container: HTMLElement, { instant = false } = {}) {
    watch(container);
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
