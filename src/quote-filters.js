import { QUOTE_LENGTHS, QUOTE_DIFFICULTIES } from './typing.js';

const FILTERS = [
  { key: 'quoteLength', id: 'quote-length', label: 'length' },
  { key: 'difficulty', id: 'quote-difficulty', label: 'difficulty' },
];

export function createQuoteFilters({ root, read, commit }) {
  let draft = null;
  let search = '';
  let searchAt = 0;
  const widgets = FILTERS.map(({ key, id, label }) => {
    const values = key === 'quoteLength' ? QUOTE_LENGTHS : QUOTE_DIFFICULTIES;
    const host = document.createElement('div');
    host.className = 'quote-filter';
    host.innerHTML = `
      <div id="${id}" class="quote-filter-trigger" role="combobox" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list" aria-labelledby="${id}-label"><span id="${id}-label">${label}</span><span class="quote-filter-value"><span class="quote-filter-current"></span><span class="quote-filter-chevron" aria-hidden="true">⌄</span></span></div>
      <div id="${id}-list" class="quote-filter-menu" role="listbox" aria-labelledby="${id}-label" hidden></div>`;
    root.append(host);
    const trigger = host.firstElementChild;
    const menu = host.lastElementChild;
    const options = values.map((value) => {
      const option = document.createElement('div');
      option.id = `${id}-${value}`;
      option.className = 'quote-filter-option';
      option.setAttribute('role', 'option');
      option.innerHTML = `<span>${value}</span><span class="quote-filter-check" aria-hidden="true">✓</span>`;
      menu.append(option);
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => {
        if (draft?.widget !== widget) return;
        draft.index = values.indexOf(value);
        finish(true);
      });
      return option;
    });
    const widget = { key, values, trigger, menu, options };
    trigger.addEventListener('click', () => {
      if (draft?.widget === widget) dismiss();
      else open(widget);
    });
    trigger.addEventListener('keydown', (event) => keydown(event, widget));
    trigger.addEventListener('blur', () => {
      if (draft?.widget === widget) finish(false);
    });
    return widget;
  });

  function dismiss() {
    if (!draft) return;
    const { widget } = draft;
    draft = null;
    search = '';
    widget.menu.hidden = true;
    widget.trigger.setAttribute('aria-expanded', 'false');
    widget.trigger.removeAttribute('aria-activedescendant');
  }

  function refresh() {
    dismiss();
    for (const { key, values, trigger, options } of widgets) {
      const current = read()[key];
      trigger.querySelector('.quote-filter-current').textContent = current;
      options.forEach((option, index) => {
        option.toggleAttribute('data-current', values[index] === current);
        option.setAttribute('aria-selected', String(values[index] === current));
      });
    }
  }

  function finish(focus) {
    if (!draft) return;
    const { widget, index } = draft;
    const value = widget.values[index];
    // Clear the draft before resetting practice can move focus and fire blur again.
    dismiss();
    if (value === read()[widget.key]) return;
    commit(widget.key, value, { focus, trigger: widget.trigger });
    refresh();
  }

  function highlight(index) {
    draft.index = Math.max(0, Math.min(index, draft.widget.values.length - 1));
    const { widget } = draft;
    widget.options.forEach((option, i) => option.setAttribute('aria-selected', String(i === draft.index)));
    const option = widget.options[draft.index];
    widget.trigger.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  }

  function open(widget) {
    if (draft) finish(false);
    widget.trigger.focus();
    draft = { widget, index: widget.values.indexOf(read()[widget.key]) };
    search = '';
    widget.menu.hidden = false;
    widget.trigger.setAttribute('aria-expanded', 'true');
    highlight(draft.index);
  }

  function keydown(event, widget) {
    if (event.isComposing || event.ctrlKey || event.metaKey) return;
    const { key } = event;
    if (event.altKey && !['ArrowDown', 'ArrowUp'].includes(key)) return;
    if (key === 'Tab') {
      if (draft) finish(false);
      return;
    }
    if (key === 'Escape') {
      if (draft) { event.preventDefault(); dismiss(); }
      return;
    }
    const printable = key.length === 1 && key !== ' ' && !event.altKey;
    if (!printable && !['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' '].includes(key)) return;
    event.preventDefault();
    if (event.repeat && ['Enter', ' '].includes(key)) return;
    const wasOpen = draft?.widget === widget;
    if (!wasOpen) open(widget);
    if (printable) {
      const now = performance.now();
      search = now - searchAt > 1000 ? key.toLowerCase() : search + key.toLowerCase();
      searchAt = now;
      const repeated = [...search].every((char) => char === search[0]);
      const prefix = repeated ? search[0] : search;
      const start = repeated ? draft.index + 1 : 0;
      for (let i = 0; i < widget.values.length; i += 1) {
        const index = (start + i) % widget.values.length;
        if (widget.values[index].startsWith(prefix)) { highlight(index); break; }
      }
    } else if (wasOpen && (key === 'Enter' || key === ' ' || (key === 'ArrowUp' && event.altKey))) finish(true);
    else if (key === 'Home' || (!wasOpen && key === 'ArrowUp')) highlight(0);
    else if (key === 'End') highlight(widget.values.length - 1);
    else if (wasOpen && key === 'ArrowDown' && !event.altKey) highlight(draft.index + 1);
    else if (wasOpen && key === 'ArrowUp') highlight(draft.index - 1);
    else if (key === 'PageDown') highlight(draft.index + 10);
    else if (key === 'PageUp') highlight(draft.index - 10);
  }

  document.addEventListener('pointerdown', (event) => {
    if (draft && !draft.widget.trigger.parentElement.contains(event.target)) finish(false);
  });
  window.addEventListener('blur', dismiss);
  window.addEventListener('resize', dismiss);
  window.addEventListener('scroll', dismiss, true);
  refresh();
  return { refresh, dismiss };
}
