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
    // field's do; a zero-width space stands in when the caret is at the very end.
    const value = input.value;
    mirror.textContent = value.slice(0, at);
    marker.textContent = value.slice(at) || '​';
    mirror.append(marker);
    const letter = marker.getClientRects()[0] || marker.getBoundingClientRect();
    const origin = mirror.getBoundingClientRect();
    const x = letter.left - origin.left - input.clientLeft - input.scrollLeft;
    const y = letter.top - origin.top - input.clientTop - input.scrollTop;
    const height = letter.height;
    // The writing never stays in the page beyond the field itself.
    mirror.textContent = '';

    bar.style.height = `${height}px`;
    bar.style.transform = `translate(${x}px, ${y}px)`;
    bar.hidden = false;
  }

  input.addEventListener('focus', () => { focused = true; update(); });
  input.addEventListener('blur', () => { focused = false; hide(); });
  for (const type of ['input', 'select', 'scroll', 'compositionupdate', 'compositionend']) input.addEventListener(type, update);
  // Arrow keys, clicks and drags move the selection without an input event.
  document.addEventListener('selectionchange', () => { if (focused) update(); });
  // A new window width or text size wraps the writing again; a late font changes letter widths.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (focused) update(); }).observe(input);
  document.fonts?.addEventListener?.('loadingdone', () => { if (focused) update(); });

  return { update };
}
