import { Fragment, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { MAX_CUSTOM_THEMES, THEME_TOKENS, cleanThemeName, contrast, contrastIssues, generatedColors } from './custom-themes.js';
import type { ThemeColors } from './custom-themes.js';
import type { GeneratedTheme } from './account.js';
import { createStore } from './store.js';

export interface PaletteCommand {
  group: string;
  label: string;
  keywords?: string;
  hint?: string;
  on?: boolean;
  secret?: boolean;
  disabled?: boolean;
  // Runs with the palette left open, as a step inside it.
  stay?: boolean;
  // Ranks the command by this instead of by how well its words match the query.
  score?: number;
  run(): void;
}

// Generating a theme from the query. The prompt is sent only when the person runs the command, never while
// they type, and never for a guest (ADR 0009).
export interface PaletteThemePorts {
  member(): boolean;
  full(): boolean;
  generate(vibe: string, signal: AbortSignal): PromiseLike<GeneratedTheme>;
  preview(colors: ThemeColors | null): void;
  save(name: string, colors: ThemeColors): void;
  signIn(): void;
}

interface PaletteOptions {
  getCommands(query: string): PaletteCommand[];
  onOpen?(): void;
  themes?: PaletteThemePorts;
}

interface PaletteHost {
  open(): void;
  close(restore: boolean): void;
  move(active: number, instant: boolean): void;
}

export type PaletteTheme =
  | { status: 'idle' }
  | { status: 'generating'; vibe: string }
  | { status: 'ready'; vibe: string; name: string; colors: ThemeColors; issues: Record<string, number>; ratio: number }
  | { status: 'failed'; vibe: string; message: string };

interface PaletteView {
  query: string;
  items: PaletteCommand[];
  active: number;
  open: boolean;
  theme: PaletteTheme;
}

const PREFIX_SCORE = 300;
const SUBSTRING_SCORE = 200;
const FUZZY_CEILING = 100;

// Under every command the query matches, so the offer never takes Enter from one ("time 15"), unless asked for.
const VIBE_SCORE = 0;
const ASKED_SCORE = PREFIX_SCORE + 1;
const MAX_VIBE = 120;
const IDLE: PaletteTheme = { status: 'idle' };
const FAILED = 'Couldn’t generate a theme. Try again.';
const FULL = `You have ${MAX_CUSTOM_THEMES} custom themes, the most there can be. Delete one in settings to save another.`;
const SWATCHES = ['ground', 'text', 'muted', 'accent', 'danger'];

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

// The look a query describes, and how high to rank making it. "vibe …" and "generate …" ask for one and lead.
// "theme …" or two or more words may describe one, unless they name a command outright (`spelled`, a disabled one
// too): then the offer follows whatever else matches.
export function vibeOf(query: string, spelled = false) {
  const text = query.replaceAll(/\s+/g, ' ').trim();
  const prefix = /^(?:generate theme|generate|vibe|theme) /i.exec(text)?.[0] ?? '';
  const vibe = text.slice(prefix.length, prefix.length + MAX_VIBE).trim();
  const asked = /^(?:generate|vibe) /i.test(prefix);

  if (!vibe || (!asked && (spelled || (!prefix && !vibe.includes(' '))))) return null;

  return { vibe, score: asked ? ASKED_SCORE : VIBE_SCORE };
}

export function contrastNote(theme: Extract<PaletteTheme, { status: 'ready' }>) {
  const low = Object.entries(theme.issues).map(([token, ratio]) => `${THEME_TOKENS.find((kept) => kept.name === token)?.label ?? token} ${ratio}:1`);

  return low.length ? `under AA · ${low.join(', ')}` : `AA · ${Math.floor(theme.ratio * 10) / 10}:1`;
}

export function createPalette() {
  let options: PaletteOptions = { getCommands: () => [] };
  let host: PaletteHost | null = null;
  // The request in flight, aborted the moment its answer is no longer wanted.
  let generation: AbortController | null = null;
  let previewing = false;
  const view = createStore<PaletteView>({ query: '', items: [], active: 0, open: false, theme: IDLE });

  function publish(next: PaletteView) { flushSync(() => view.publish(next)); }

  function unwear() {
    if (previewing) options.themes?.preview(null);
    previewing = false;
  }

  function forget() {
    generation?.abort();
    generation = null;
    unwear();
  }

  function generateCommand(vibe: string, score: number): PaletteCommand {
    const ports = options.themes;
    const member = Boolean(ports?.member());

    return { group: 'theme', label: `generate theme · ${vibe}`, hint: member ? (ports?.full() ? 'list full' : 'enter') : 'sign in', score, stay: member, run: () => { void generate(vibe); } };
  }

  function themeItems(theme: PaletteTheme): PaletteCommand[] {
    switch (theme.status) {
      case 'generating': return [];
      case 'ready': return [
        { group: 'theme', label: `save “${theme.name}” to my themes`, hint: 'enter', run: () => options.themes?.save(theme.name, theme.colors) },
        { group: 'theme', label: `try another for “${theme.vibe}”`, stay: true, run: () => { void generate(theme.vibe); } },
      ];
      case 'failed': return [{ group: 'theme', label: `try again · ${theme.vibe}`, stay: true, run: () => { void generate(theme.vibe); } }];
      case 'idle': return [];
    }
  }

  function itemsFor(typed: string, theme: PaletteTheme) {
    if (theme.status !== 'idle') return themeItems(theme);
    const q = typed.trim().toLowerCase();
    const commands = options.getCommands(q);
    const groups = [...new Set(commands.map((command) => command.group))];
    const ranked = commands.map((command) => ({ command, score: command.score ?? (command.secret ? PREFIX_SCORE : fuzzyScore(`${command.label} ${command.keywords || ''} ${command.group}`, q)) }));
    const scored = ranked.filter(({ score, command }) => score > 0 && !command.disabled);
    const offer = options.themes ? vibeOf(typed, ranked.some(({ score }) => score >= SUBSTRING_SCORE)) : null;

    if (offer) scored.push({ command: generateCommand(offer.vibe, offer.score), score: offer.score });

    return scored
      .sort((a, b) => q ? b.score - a.score : groups.indexOf(a.command.group) - groups.indexOf(b.command.group))
      .map(({ command }) => command);
  }

  function show(theme: PaletteTheme) {
    const current = view.getSnapshot();
    publish({ ...current, theme, items: itemsFor(current.query, theme), active: 0 });
    host?.move(0, true);
  }

  async function generate(vibe: string) {
    const ports = options.themes;

    if (!ports) return;

    if (!ports.member()) {
      close({ restore: false });
      ports.signIn();

      return;
    }

    if (ports.full()) { show({ status: 'failed', vibe, message: FULL });

 return; }

    generation?.abort();
    const request = new AbortController();
    generation = request;
    show({ status: 'generating', vibe });

    try {
      const reply = await ports.generate(vibe, request.signal);

      if (generation !== request || request.signal.aborted) return;
      const colors = generatedColors(reply.colors);

      if (!colors) throw new Error(FAILED);
      ports.preview(colors);
      previewing = true;
      show({ status: 'ready', vibe, name: cleanThemeName(reply.name) || 'generated', colors, issues: contrastIssues(colors), ratio: contrast(colors.text ?? '', colors.ground) });
    } catch (error) {
      if (generation !== request || request.signal.aborted) return;
      unwear();
      show({ status: 'failed', vibe, message: error instanceof Error && error.message ? error.message : FAILED });
    } finally {
      if (generation === request) generation = null;
    }
  }

  function query(value: string) {
    forget();
    publish({ ...view.getSnapshot(), query: value, theme: IDLE, items: itemsFor(value, IDLE), active: 0 });
    host?.move(0, true);
  }

  function move(index: number, instant = false) {
    const current = view.getSnapshot();
    const active = current.items.length ? (index + current.items.length) % current.items.length : 0;
    publish({ ...current, active });
    host?.move(active, instant);
  }

  function open() {
    if (view.getSnapshot().open) return;
    options.onOpen?.();
    publish({ query: '', items: itemsFor('', IDLE), active: 0, open: true, theme: IDLE });
    host?.open();
    host?.move(0, true);
  }

  function close({ restore = true } = {}) {
    if (!view.getSnapshot().open) return;
    forget();
    publish({ ...view.getSnapshot(), open: false, theme: IDLE });
    host?.close(restore);
  }

  const isOpen = () => view.getSnapshot().open;

  return {
    view, open, close, query, move, isOpen,
    toggle: () => isOpen() ? close() : open(),
    // Escape puts back a theme being tried before it closes the palette.
    escape() {
      if (view.getSnapshot().theme.status === 'idle') { close();

 return; }

      forget();
      show(IDLE);
    },
    configure(next: PaletteOptions) { options = next; },
    attach(next: PaletteHost) {
      host = next;

      return () => { if (host === next) host = null; };
    },
    run(index = view.getSnapshot().active) {
      const command = view.getSnapshot().items[index];

      if (!command) return;

      if (!command.stay) close({ restore: false });
      command.run();
    },
    dispose() {
      generation?.abort();
      generation = null;
      host = null;
    },
  };
}

export type PaletteController = ReturnType<typeof createPalette>;

function ThemeStatus({ theme }: { theme: PaletteTheme }) {
  let content = null;

  if (theme.status === 'generating') content = <span className="palette-theme-text">Generating a theme for “{theme.vibe}”…</span>;
  else if (theme.status === 'failed') content = <span className="palette-theme-text">{theme.message}</span>;
  else if (theme.status === 'ready') {
    const note = contrastNote(theme);
    content = <>
      <span className="palette-swatches" aria-hidden="true">{SWATCHES.map((token) => <i key={token} style={{ background: theme.colors[token] }}></i>)}</span>
      <span className="palette-theme-text">Wearing {theme.name}. Enter saves it, esc puts yours back.</span>
      <span id="palette-contrast" className={`palette-contrast${Object.keys(theme.issues).length ? ' is-low' : ''}`}>{note}</span>
    </>;
  }

  return <div id="palette-theme" className="palette-theme" role="status" data-status={theme.status}>{content}</div>;
}

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
      open() {
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

  return <dialog ref={dialog} id="palette" className="palette" aria-label="Command palette" onCancel={(event) => { event.preventDefault(); palette.escape(); }} onClick={(event) => { if (event.target === event.currentTarget) palette.close(); }} onMouseDown={(event) => {
    if (event.target === event.currentTarget || (event.target instanceof Node && list.current?.contains(event.target))) event.preventDefault();
  }}>
    <div className="palette-box">
      <div className="palette-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
        <input ref={input} id="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-activedescendant={view.items.length ? `palette-option-${view.active}` : undefined} autoComplete="off" spellCheck={false} placeholder="Search commands or describe a theme" value={view.query} onChange={(event) => palette.query(event.currentTarget.value)} onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); palette.run();

 return; }

          const next = { ArrowDown: view.active + 1, ArrowUp: view.active - 1, Home: 0, End: view.items.length - 1 }[event.key];

          if (next === undefined) return;
          event.preventDefault();
          palette.move(next);
        }} />
        <kbd className="key-hint">esc</kbd>
      </div>
      <ThemeStatus theme={view.theme} />
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
        <p id="palette-empty" className="palette-empty" hidden={view.items.length > 0 || view.theme.status !== 'idle'}>No matches</p>
      </div>
    </div>
  </dialog>;
}
