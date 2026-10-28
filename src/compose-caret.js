// The composing field's caret where the browser can't hold its own still. With
// `caret-animation: manual` (src/styles.css) the native caret is solid and nothing here runs. Without
// it the native caret would blink for the whole minute, so it is made transparent (never removed: IME,
// selection and editing stay native) and a plain accent bar is drawn at the collapsed selection,
// measured from a hidden mirror of the field. It jumps, never glides or fades. Presentational only:
// nothing here reads or changes what is measured.

export const holdsCaretStill = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
  && CSS.supports('caret-animation', 'manual');

// Everything that decides where the field's text wraps and how tall its letters stand.
const MIRRORED = [
  'direction', 'writing-mode', 'text-orientation',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch',
  'font-variant-ligatures', 'font-variant-caps', 'font-variant-numeric', 'font-variant-east-asian',
  'font-variant-position', 'font-feature-settings', 'font-variation-settings', 'font-kerning',
  'font-optical-sizing', 'font-size-adjust', 'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-indent', 'text-transform', 'text-rendering', 'tab-size',
  'white-space', 'overflow-wrap', 'word-break', 'line-break', 'hyphens',
];

const VERTICAL = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']);
const AT_CARET = new Set(['Backspace', 'Delete', 'Enter', 'Home', 'ArrowLeft', 'ArrowRight']);

export function drawCaret(input) {
  const wrap = input.parentElement;
  const layer = document.createElement('div');
  layer.className = 'compose-caret-layer';
  layer.setAttribute('aria-hidden', 'true');
  const mirror = document.createElement('div');
  mirror.className = 'compose-caret-mirror';
  const marker = document.createElement('span');
  const bar = document.createElement('span');
  bar.className = 'compose-caret';
  bar.hidden = true;
  layer.append(mirror, bar);
  input.after(layer);
  wrap.dataset.caret = 'drawn';
  let focused = document.activeElement === input;
  // Where a wrapped line breaks, one offset is both the end of a line and the start of the next. The
  // browser shows its caret on one or the other by what moved it there, and a textarea doesn't say
  // which, so this follows the same moves: End (or Cmd+Right) keeps it at the end of the line, and
  // so does typing, which keeps it just after what was typed (a space typed at the start of a line
  // joins the spaces ending the line before); Up, Down, Page Up and Page Down take the side nearest
  // the x they set out from; a click or tap takes the line it hit; deleting, Home, Left and Right
  // put it at the start of the next line.
  let move = { side: 'start' };
  // The side a move settled on, kept while the caret stays at that offset (so scrolling never flips it).
  let settled = null;
  let lastX = 0;
  // At a wrapped line Firefox's Right first moves the caret from the end of the line to the start of
  // the next, and Left back, without changing the offset, so no selectionchange follows: an arrow
  // that leaves the offset where it was has crossed the break, and its release shows where it went.
  let arrow = null;

  function moved(next) {
    move = next;
    settled = null;
  }

  function sideFor(at, end, start, top) {
    if (settled?.at === at) return settled.side;
    let side = 'start';

    if (move.side) side = move.side;
    else if ('x' in move) side = Math.abs(end.x - move.x) < Math.abs(start.x - move.x) ? 'end' : 'start';
    else if ('y' in move) {
      const off = (spot) => Math.abs(top + spot.y + spot.height / 2 - move.y);
      side = off(end) < off(start) ? 'end' : 'start';
    }

    settled = { at, side };

    return side;
  }

  function hide() {
    bar.hidden = true;
  }

  function update() {
    const at = input.selectionStart;

    if (!focused || input.readOnly || input.disabled || at === null || at !== input.selectionEnd || !input.getClientRects().length) {
      hide();

      return;
    }

    const style = getComputedStyle(input);

    for (const name of MIRRORED) mirror.style.setProperty(name, style.getPropertyValue(name));
    const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    mirror.style.width = `${input.clientWidth + borders}px`;

    // The layer is the field's padding box, where its text is clipped as it scrolls.
    const field = input.getBoundingClientRect();
    const host = wrap.getBoundingClientRect();
    layer.style.left = `${field.left - host.left - wrap.clientLeft + input.clientLeft}px`;
    layer.style.top = `${field.top - host.top - wrap.clientTop + input.clientTop}px`;
    layer.style.width = `${input.clientWidth}px`;
    layer.style.height = `${input.clientHeight}px`;

    // The text up to the caret, then the rest of it in a marker, so the line breaks fall where the
    // field's do. Two places can show the caret: the start of the text after it (the marker) and the
    // end of the text before it on its own line. On an empty line only a zero-width space can stand
    // in for the start; after other text nothing is added, since a stand-in after a space hung past a
    // full line would wrap to a line the field doesn't have.
    const value = input.value;
    const lineStart = at === 0 || value[at - 1] === '\n';
    const lineEnd = at === value.length || value[at] === '\n';
    mirror.textContent = value.slice(0, at);
    let start = null;
    let end = null;

    if (lineStart || !lineEnd) {
      marker.textContent = (lineEnd ? '\u200B' : '') + value.slice(at);
      mirror.append(marker);
      start = marker.getClientRects()[0] || marker.getBoundingClientRect();
    }

    if (!lineStart) {
      const range = document.createRange();
      range.setStart(mirror.firstChild, value.lastIndexOf('\n', at - 1) + 1);
      range.setEnd(mirror.firstChild, at);
      const rects = range.getClientRects();
      const last = rects[rects.length - 1];

      if (last) end = { left: last.right, top: last.top, height: last.height };
    }

    const origin = mirror.getBoundingClientRect();

    const place = (rect) => rect && ({
      x: rect.left - origin.left - input.clientLeft - input.scrollLeft,
      y: rect.top - origin.top - input.clientTop - input.scrollTop,
      height: rect.height,
    });

    start = place(start);
    end = place(end);
    // The writing never stays in the page beyond the field itself.
    mirror.textContent = '';

    if (!start && !end) {
      hide();

      return;
    }

    let spot = start || end;

    if (start && end && Math.abs(start.y - end.y) > start.height / 2) {
      spot = sideFor(at, end, start, field.top + input.clientTop) === 'end' ? end : start;
    }

    // Kept inside the field, so all 2px show at the start of a line and after a space hung past its end.
    const x = Math.min(Math.max(spot.x, 1), input.clientWidth - 1);
    lastX = x;
    bar.style.height = `${spot.height}px`;
    bar.style.transform = `translate(${x}px, ${spot.y}px)`;
    bar.hidden = false;
  }

  input.addEventListener('focus', () => { focused = true; update(); });
  input.addEventListener('blur', () => { focused = false; hide(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'End' || (event.metaKey && event.key === 'ArrowRight')) moved({ side: 'end' });
    else if (VERTICAL.has(event.key)) {
      // Measured now, before the key moves it (the last selectionchange may not have run yet): the
      // x the browser keeps to from line to line.
      if (!('x' in move)) update();
      moved({ x: 'x' in move ? move.x : lastX });
    }
    else if (event.key.length === 1 || AT_CARET.has(event.key)) moved({ side: 'start' });

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') arrow = { key: event.key, at: input.selectionStart };
  });
  input.addEventListener('keyup', (event) => {
    if (event.key === arrow?.key && input.selectionStart === arrow.at) moved({ side: arrow.key === 'ArrowLeft' ? 'end' : 'start' });
    arrow = null;

    if (focused) update();
  });
  input.addEventListener('pointerdown', (event) => moved({ y: event.clientY }));
  input.addEventListener('input', (event) => {
    moved({ side: event.inputType?.startsWith('insert') ? 'end' : 'start' });
    update();
  });

  for (const type of ['select', 'scroll', 'compositionupdate', 'compositionend']) input.addEventListener(type, update);
  // Arrow keys, clicks and drags move the selection without an input event; a click can also keep
  // the offset and change only the line it is shown on.
  document.addEventListener('selectionchange', () => { if (focused) update(); });
  input.addEventListener('pointerup', () => { if (focused) update(); });

  // A new window width or text size wraps the writing again; a late font changes letter widths.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (focused) update(); }).observe(input);
  document.fonts?.addEventListener?.('loadingdone', () => { if (focused) update(); });

  return { update };
}
