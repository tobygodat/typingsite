import { Fragment, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createStore } from './store.js';

export interface PaletteCommand {
  group: string;
  label: string;
  keywords?: string;
  hint?: string;
  on?: boolean;
  secret?: boolean;
  disabled?: boolean;
  run(): void;
}

interface PaletteOptions {
  getCommands(query: string): PaletteCommand[];
  onOpen?(): void;
}

interface PaletteHost {
  open(reopening: boolean): void;
  close(restore: boolean): void;
  move(active: number, instant: boolean): void;
}

interface PaletteView {
  query: string;
  items: PaletteCommand[];
  active: number;
  open: boolean;
  closing: boolean;
}

const PREFIX_SCORE = 300;
const SUBSTRING_SCORE = 200;
const FUZZY_CEILING = 100;

export function fuzzyScore(text: string, query: string) {
  if (!query) return 1;
  const haystack = text.toLowerCase();
  const direct = haystack.indexOf(query);

  if (direct === 0) return PREFIX_SCORE;

  if (direct > 0) return SUBSTRING_SCORE + 40 - Math.min(direct, 40) + (haystack[direct - 1] === ' ' ? 10 : 0);
  let score = 0;
  let from = 0;
  let streak = 0;

  for (const char of query) {
    const index = haystack.indexOf(char, from);

    if (index < 0) return 0;
    streak = index === from ? streak + 1 : 0;
    score += 1 + streak * 2 + (index === 0 || haystack[index - 1] === ' ' ? 3 : 0);
    from = index + 1;
  }

  return (FUZZY_CEILING * score) / (score + FUZZY_CEILING);
}

export function createPalette() {
  let options: PaletteOptions = { getCommands: () => [] };
  let host: PaletteHost | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const view = createStore<PaletteView>({ query: '', items: [], active: 0, open: false, closing: false });

  function publish(next: PaletteView) { flushSync(() => view.publish(next)); }

  function filtered(query: string) {
    const q = query.trim().toLowerCase();
    const commands = options.getCommands(q);
    const groups = [...new Set(commands.map((command) => command.group))];

    return commands
      .map((command) => ({ command, score: command.secret ? PREFIX_SCORE : fuzzyScore(`${command.label} ${command.keywords || ''} ${command.group}`, q) }))
      .filter(({ score, command }) => score > 0 && !command.disabled)
      .sort((a, b) => q ? b.score - a.score : groups.indexOf(a.command.group) - groups.indexOf(b.command.group))
      .map(({ command }) => command);
  }

  function query(value: string) {
    publish({ ...view.getSnapshot(), query: value, items: filtered(value), active: 0 });
    host?.move(0, true);
  }

  function move(index: number, instant = false) {
    const current = view.getSnapshot();
    const active = current.items.length ? (index + current.items.length) % current.items.length : 0;
    publish({ ...current, active });
    host?.move(active, instant);
  }

  function open() {
    const current = view.getSnapshot();

    if (current.open && !current.closing) return;

    if (timer !== null) clearTimeout(timer);
    timer = null;
    options.onOpen?.();
    publish({ query: '', items: filtered(''), active: 0, open: true, closing: false });
    host?.open(current.closing);
    host?.move(0, true);
  }

  function close({ restore = true, animate = true } = {}) {
    const current = view.getSnapshot();

    if (!current.open || (current.closing && animate)) return;

    if (timer !== null) clearTimeout(timer);
    timer = null;

    const finish = () => {
      timer = null;
      publish({ ...view.getSnapshot(), open: false, closing: false });
      host?.close(restore);
    };

    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else {
      publish({ ...current, closing: true });
      timer = setTimeout(finish, 150);
    }
  }

  const isOpen = () => view.getSnapshot().open && !view.getSnapshot().closing;

  return {
    view, open, close, query, move, isOpen,
    toggle: () => isOpen() ? close() : open(),
    configure(next: PaletteOptions) { options = next; },
    attach(next: PaletteHost) {
      host = next;

      return () => { if (host === next) host = null; };
    },
    run(index = view.getSnapshot().active) {
      const command = view.getSnapshot().items[index];

      if (!command) return;
      close({ restore: false, animate: false });
      command.run();
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      host = null;
    },
  };
}

export type PaletteController = ReturnType<typeof createPalette>;

export function Palette({ palette }: { palette: PaletteController }) {
  const view = useSyncExternalStore(palette.view.subscribe, palette.view.getSnapshot, palette.view.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const frame = useRef<number | null>(null);
  useLayoutEffect(() => {
    const detach = palette.attach({
      open(reopening) {
        if (!reopening) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const panel = dialog.current;

        if (panel && !panel.open) panel.showModal();
        input.current?.focus();
      },
      close(restore) {
        dialog.current?.close();

        if (restore && returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      },
      move(active, instant) {
        const options = list.current;
        const glow = highlight.current;
        const row = options?.querySelector<HTMLElement>(`#palette-option-${active}`);

        if (!glow || !options) return;

        if (!row) { glow.style.setProperty('--hl-o', '0');

 return; }

        if (instant) glow.style.transition = 'none';
        glow.style.setProperty('--hl-y', `${options.offsetTop + row.offsetTop}px`);
        glow.style.setProperty('--hl-h', `${row.offsetHeight}px`);
        glow.style.setProperty('--hl-o', '1');

        if (instant) {
          if (frame.current !== null) cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => { glow.style.transition = ''; frame.current = null; });
        }

        row.scrollIntoView({ block: 'nearest' });
      },
    });

    return () => {
      detach();

      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [palette]);
  let group: string | null = null;

  return <dialog ref={dialog} id="palette" className={`palette${view.closing ? ' is-closing' : ''}`} aria-label="Command palette" onCancel={(event) => { event.preventDefault(); palette.close(); }} onClick={(event) => { if (event.target === event.currentTarget) palette.close(); }} onMouseDown={(event) => {
    if (event.target === event.currentTarget || (event.target instanceof Node && list.current?.contains(event.target))) event.preventDefault();
  }}>
    <div className="palette-box">
      <div className="palette-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
        <input ref={input} id="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-activedescendant={view.items.length ? `palette-option-${view.active}` : undefined} autoComplete="off" spellCheck={false} placeholder="Search commands" value={view.query} onChange={(event) => palette.query(event.currentTarget.value)} onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); palette.run();

 return; }

          const next = { ArrowDown: view.active + 1, ArrowUp: view.active - 1, Home: 0, End: view.items.length - 1 }[event.key];

          if (next === undefined) return;
          event.preventDefault();
          palette.move(next);
        }} />
        <kbd className="key-hint">esc</kbd>
      </div>
      <div className="palette-scroll">
        <span ref={highlight} className="palette-highlight" aria-hidden="true"></span>
        <ul ref={list} id="palette-list" role="listbox" aria-label="Commands">{view.items.map((command, index) => {
          const heading = !view.query.trim() && command.group !== group ? command.group : null;
          group = command.group;

          return <Fragment key={`${command.group}:${command.label}`}>
            {heading && <li className="palette-group" role="presentation">{heading}</li>}
            <li id={`palette-option-${index}`} className={`palette-option${command.secret ? ' is-secret' : ''}`} role="option" data-index={index} aria-selected={index === view.active} onPointerMove={() => { if (view.active !== index) palette.move(index); }} onClick={() => palette.run(index)}>
              <span className="opt-label"><span className="opt-mark" aria-hidden="true"></span><span className="opt-text">{command.label}</span></span>
              {command.hint && <span className={`opt-hint${command.on ? ' is-on' : ''}`}>{command.hint}</span>}
            </li>
          </Fragment>;
        })}</ul>
        <p id="palette-empty" className="palette-empty" hidden={view.items.length > 0}>No matches</p>
      </div>
    </div>
  </dialog>;
}
