import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { QUOTE_LENGTHS, QUOTE_DIFFICULTIES } from './typing.js';
import { BOOKS, bookIds } from './books.js';
import { createStore } from './store.js';

type FilterKey = 'quoteLength' | 'difficulty' | 'book';

interface Filter { key: FilterKey; id: string; label: string; values: readonly string[]; names?: Readonly<Record<string, string>> }

export const QUOTE_FILTERS = [
  { key: 'quoteLength', id: 'quote-length', label: 'length', values: QUOTE_LENGTHS },
  { key: 'difficulty', id: 'quote-difficulty', label: 'difficulty', values: QUOTE_DIFFICULTIES },
] satisfies Filter[];

const FILTERS: Filter[] = [...QUOTE_FILTERS, { key: 'book', id: 'book-select', label: 'book', values: bookIds, names: Object.fromEntries(BOOKS.map((book) => [book.id, book.name])) }];

interface FilterSelection { quoteLength: unknown; difficulty: unknown; book: unknown }

interface FilterOptions {
  read(): FilterSelection;
  commit(key: FilterKey, value: string, options: { focus: boolean; trigger: HTMLElement }): void;
}

interface FilterHost { trigger: HTMLElement; root: HTMLElement; scroll(index: number): void }

interface FiltersView { selected: FilterSelection; draft: { key: FilterKey; index: number } | null }

export function createQuoteFilters() {
  let options: FilterOptions = { read: () => ({ quoteLength: 'medium', difficulty: 'any', book: bookIds[0] }), commit() {} };
  const hosts = new Map<FilterKey, FilterHost>();
  let search = '';
  let searchAt = 0;
  const view = createStore<FiltersView>({ selected: options.read(), draft: null });
  const publish = (patch: Partial<FiltersView>) => flushSync(() => view.publish({ ...view.getSnapshot(), ...patch }));
  const filter = (key: FilterKey) => FILTERS.find((item) => item.key === key);
  const name = (widget: Filter, value: string) => widget.names?.[value] || value;

  function dismiss() { search = '';

 if (view.getSnapshot().draft) publish({ draft: null }); }

  function refresh() { dismiss(); publish({ selected: options.read() }); }

  function finish(focus: boolean) {
    const draft = view.getSnapshot().draft;

    if (!draft) return;
    const widget = filter(draft.key);
    const host = hosts.get(draft.key);
    const value = widget?.values[draft.index];
    dismiss();

    if (!widget || !host || value === undefined || value === options.read()[widget.key]) return;
    options.commit(widget.key, value, { focus, trigger: host.trigger });
    refresh();
  }

  function highlight(index: number) {
    const draft = view.getSnapshot().draft;

    if (!draft) return;
    const widget = filter(draft.key);

    if (!widget) return;
    const selected = Math.max(0, Math.min(index, widget.values.length - 1));
    publish({ draft: { key: draft.key, index: selected } });
    hosts.get(draft.key)?.scroll(selected);
  }

  function open(key: FilterKey) {
    if (view.getSnapshot().draft) finish(false);
    const widget = filter(key);

    if (!widget) return;
    hosts.get(key)?.trigger.focus();
    const current = options.read()[key];
    publish({ draft: { key, index: widget.values.findIndex((value) => value === current) } });
    search = '';
    highlight(view.getSnapshot().draft?.index ?? 0);
  }

  return {
    view, refresh, dismiss,
    configure(next: FilterOptions) { options = next; refresh(); },
    attach(key: FilterKey, host: FilterHost) { hosts.set(key, host);

 return () => { if (hosts.get(key) === host) hosts.delete(key); }; },
    outside(target: EventTarget | null) { const draft = view.getSnapshot().draft;

 if (draft && target instanceof Node && !hosts.get(draft.key)?.root.contains(target)) finish(false); },
    click(key: FilterKey) { if (view.getSnapshot().draft?.key === key) dismiss(); else open(key); },
    blur(key: FilterKey) { if (view.getSnapshot().draft?.key === key) finish(false); },
    pick(key: FilterKey, index: number) { if (view.getSnapshot().draft?.key === key) { highlight(index); finish(true); } },
    keydown(event: KeyboardEvent, key: FilterKey) {
      if (event.isComposing || event.ctrlKey || event.metaKey) return;
      const widget = filter(key);

      if (!widget) return;
      const pressed = event.key;

      if (event.altKey && !['ArrowDown', 'ArrowUp'].includes(pressed)) return;

      if (pressed === 'Tab') { if (view.getSnapshot().draft) finish(false);

 return; }

      if (pressed === 'Escape') { if (view.getSnapshot().draft) { event.preventDefault(); dismiss(); }

 return; }

      const printable = pressed.length === 1 && pressed !== ' ' && !event.altKey;

      if (!printable && !['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' '].includes(pressed)) return;
      event.preventDefault();

      if (event.repeat && ['Enter', ' '].includes(pressed)) return;
      const wasOpen = view.getSnapshot().draft?.key === key;

      if (!wasOpen) open(key);
      const index = view.getSnapshot().draft?.index ?? 0;

      if (printable) {
        const at = performance.now();
        search = at - searchAt > 1000 ? pressed.toLowerCase() : search + pressed.toLowerCase();
        searchAt = at;
        const repeated = [...search].every((char) => char === search[0]);
        const prefix = repeated ? search[0] ?? '' : search;
        const start = repeated ? index + 1 : 0;

        for (let offset = 0; offset < widget.values.length; offset += 1) {
          const next = (start + offset) % widget.values.length;
          const value = widget.values[next];

          if (value !== undefined && name(widget, value).startsWith(prefix)) { highlight(next); break; }
        }
      } else if (wasOpen && (pressed === 'Enter' || pressed === ' ' || (pressed === 'ArrowUp' && event.altKey))) finish(true);
      else if (pressed === 'Home' || (!wasOpen && pressed === 'ArrowUp')) highlight(0);
      else if (pressed === 'End') highlight(widget.values.length - 1);
      else if (wasOpen && pressed === 'ArrowDown' && !event.altKey) highlight(index + 1);
      else if (wasOpen && pressed === 'ArrowUp') highlight(index - 1);
      else if (pressed === 'PageDown') highlight(index + 10);
      else if (pressed === 'PageUp') highlight(index - 10);
    },
  };
}

export type QuoteFiltersController = ReturnType<typeof createQuoteFilters>;

function QuoteFilter({ widget, controller }: { widget: Filter; controller: QuoteFiltersController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!root.current || !trigger.current) return;

    return controller.attach(widget.key, { root: root.current, trigger: trigger.current, scroll(index) { list.current?.children[index]?.scrollIntoView({ block: 'nearest' }); } });
  }, [controller, widget]);
  const active = view.draft?.key === widget.key ? view.draft.index : null;
  const current = view.selected[widget.key];
  const name = (value: string) => widget.names?.[value] || value;

  return <div ref={root} className="quote-filter">
    <div ref={trigger} id={widget.id} className="quote-filter-trigger" role="combobox" tabIndex={0} aria-haspopup="listbox" aria-expanded={active !== null} aria-controls={`${widget.id}-list`} aria-labelledby={`${widget.id}-label`} aria-activedescendant={active === null ? undefined : `${widget.id}-${widget.values[active]}`} onClick={() => controller.click(widget.key)} onKeyDown={(event) => controller.keydown(event.nativeEvent, widget.key)} onBlur={() => controller.blur(widget.key)}>
      <span id={`${widget.id}-label`}>{widget.label}</span><span className="quote-filter-value"><span className="quote-filter-current">{typeof current === 'string' ? name(current) : current === null || current === undefined ? '' : String(current)}</span><span className="quote-filter-chevron" aria-hidden="true">⌄</span></span>
    </div>
    <div ref={list} id={`${widget.id}-list`} className="quote-filter-menu" role="listbox" aria-labelledby={`${widget.id}-label`} hidden={active === null}>{widget.values.map((value, index) => <div key={value} id={`${widget.id}-${value}`} className="quote-filter-option" role="option" data-current={value === current ? '' : undefined} aria-selected={active === null ? value === current : index === active} onPointerDown={(event) => event.preventDefault()} onClick={() => controller.pick(widget.key, index)}><span>{name(value)}</span><span className="quote-filter-check" aria-hidden="true">✓</span></div>)}</div>
  </div>;
}

export function QuoteFilters({ controller, books = false }: { controller: QuoteFiltersController; books?: boolean }) {
  useLayoutEffect(() => {
    if (books) return;
    const abort = new AbortController();
    document.addEventListener('pointerdown', (event) => controller.outside(event.target), { signal: abort.signal });
    window.addEventListener('blur', controller.dismiss, { signal: abort.signal });
    window.addEventListener('resize', controller.dismiss, { signal: abort.signal });

    return () => abort.abort();
  }, [controller, books]);

  return FILTERS.flatMap((widget) => (widget.key === 'book') === books ? [<QuoteFilter key={widget.key} widget={widget} controller={controller} />] : []);
}
