import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { Effect } from 'effect';
import { AsyncLifetime, pageLifetime } from './async-runtime.js';
import { BASE_TOKENS, MAX_CUSTOM_THEMES, READABLE, THEME_TOKENS, cleanThemeName, contrastIssues, newThemeId, normalizeHex, themeMode } from './custom-themes.js';
import type { CustomTheme, ThemeColors } from './custom-themes.js';
import type { GeneratedTheme } from './account.js';
import { createStore } from './store.js';
import type { SettingsController } from './settings.js';

export function wearColors(root: HTMLElement, colors?: Record<string, string> | null): 'dark' | 'light' | null {
  for (const token of THEME_TOKENS) root.style.removeProperty(`--${token.name}`);

  if (!colors) {
    delete root.dataset.custom;

    return null;
  }

  for (const [token, hex] of Object.entries(colors)) root.style.setProperty(`--${token}`, hex);
  root.dataset.custom = '';

  return themeMode({ ...colors, ground: colors.ground ?? '', danger: colors.danger ?? '' });
}

const options = createStore<{ themes: readonly CustomTheme[]; shown: string }>({ themes: [], shown: '' });

export function showThemeOptions(themes: readonly CustomTheme[], shown: string): void {
  const current = options.getSnapshot();

  if (current.themes === themes && current.shown === shown) return;
  flushSync(() => options.publish({ themes, shown }));
}

export interface ThemeEditorCallbacks {
  themes(): readonly CustomTheme[];
  currentTheme(): string;
  preview(colors: ThemeColors | null): void;
  save(themes: CustomTheme[], selected: string | null): void;
  signedIn(): boolean;
  generate(vibe: string, signal?: AbortSignal): PromiseLike<GeneratedTheme>;
  signIn(): void;
}

interface ThemeDraft {
  id: string | null;
  name: string;
  colors: ThemeColors;
  hex: Record<string, string>;
  invalid: Record<string, boolean>;
  resolved: Record<string, string>;
  nameInvalid: boolean;
}

interface ThemeEditorView {
  draft: ThemeDraft | null;
  member: boolean;
  generating: boolean;
  status: string;
  vibe: string;
  expanded: 'new' | 'edit' | null;
}

interface ThemeEditorHost {
  resolve(token: string, under?: string): string;
  focusName(): void;
  focusVibe(): void;
  focusNew(): void;
  focusSaved(id: string): void;
  focusFallback(): void;
}

function palette(colors: Record<string, string>): ThemeColors {
  return { ...colors, ground: colors.ground ?? '', danger: colors.danger ?? '' };
}

export function createThemeEditor(initial?: ThemeEditorCallbacks) {
  let callbacks = initial ?? null;
  let host: ThemeEditorHost | null = null;
  let opener: HTMLElement | null = null;
  let generation: AbortController | null = null;
  const lifetime = new AsyncLifetime(pageLifetime());
  const view = createStore<ThemeEditorView>({ draft: null, member: false, generating: false, status: '', vibe: '', expanded: null });
  const publish = (next: ThemeEditorView) => flushSync(() => view.publish(next));

  function update(draft: ThemeDraft): void {
    callbacks?.preview(draft.colors);
    const ground = host?.resolve('ground') ?? draft.colors.ground;
    const resolved = Object.fromEntries(THEME_TOKENS.map((token) => [token.name, draft.colors[token.name] || host?.resolve(token.name, ground) || '#000000']));
    publish({ ...view.getSnapshot(), draft: { ...draft, resolved } });
  }

  function syncAccount(): void {
    publish({ ...view.getSnapshot(), member: callbacks?.signedIn() ?? false });
  }

  function close({ saved = false, focus = true }: { saved?: boolean; focus?: boolean } = {}): void {
    if (!view.getSnapshot().draft) return;
    generation?.abort();
    generation = null;
    publish({ ...view.getSnapshot(), draft: null, expanded: null, generating: false });

    if (!saved) callbacks?.preview(null);

    if (focus) {
      if (opener?.isConnected && !opener.hidden && !('disabled' in opener && opener.disabled)) opener.focus();
      else host?.focusFallback();
    }
  }

  function open(id: string | null, from?: HTMLElement): void {
    if (!callbacks || !host) return;
    close({ focus: false });
    const themes = callbacks.themes();
    const saved = themes.find((theme) => theme.id === id);
    const current = themes.find((theme) => theme.id === callbacks?.currentTheme());
    const base = saved ?? current;
    const colors = palette(base ? { ...base.colors } : Object.fromEntries(BASE_TOKENS.map((token) => [token, host?.resolve(token) ?? '#000000'])));
    const label = current?.name || document.documentElement.dataset.theme;
    opener = from ?? null;
    publish({ ...view.getSnapshot(), vibe: '', status: '', member: callbacks.signedIn(), expanded: saved ? 'edit' : 'new' });
    update({ id: saved?.id ?? null, name: saved ? saved.name : cleanThemeName(`${label} copy`), colors, hex: { ...colors }, invalid: {}, resolved: {}, nameInvalid: false });
    host.focusName();
  }

  async function runGenerate(): Promise<void> {
    if (!callbacks) return;

    if (!callbacks.signedIn()) return callbacks.signIn();
    const current = view.getSnapshot();
    const vibe = current.vibe.replace(/\s+/g, ' ').trim();

    if (!vibe || current.generating) return host?.focusVibe();
    const request = new AbortController();
    generation = request;
    publish({ ...current, generating: true, status: '' });
    const generate = callbacks.generate;

    try {
      const raw = await lifetime.run(Effect.tryPromise({ try: (signal) => generate(vibe, signal), catch: (cause) => cause instanceof Error ? cause : new Error('Couldn’t generate a theme. Try again.') }), request.signal);
      const draft = view.getSnapshot().draft;

      if (!draft || generation !== request) return;
      const colors: Record<string, string> = {};
      const received = raw.colors;

      for (const token of BASE_TOKENS) {
        const hex = normalizeHex(received[token]);

        if (!hex) throw new Error('Couldn’t generate a theme. Try again.');
        colors[token] = hex;
      }

      update({ ...draft, colors: palette(colors), hex: { ...colors }, invalid: {}, name: cleanThemeName(raw.name) || draft.name, nameInvalid: false });
    } catch (error) {
      if (view.getSnapshot().draft && generation === request && !request.signal.aborted) publish({ ...view.getSnapshot(), status: error instanceof Error ? error.message : 'Couldn’t generate a theme. Try again.' });
    } finally {
      if (generation === request) {
        generation = null;
        publish({ ...view.getSnapshot(), generating: false, member: callbacks.signedIn() });
      }
    }
  }

  return {
    view, open, close, syncAccount, runGenerate,
    configure(next: ThemeEditorCallbacks) { callbacks = next; syncAccount(); },
    attach(next: ThemeEditorHost) { host = next;

      return () => { if (host === next) host = null; }; },
    draftColors: () => view.getSnapshot().draft?.colors ?? null,
    name(name: string) { const current = view.getSnapshot();

      if (current.draft) publish({ ...current, draft: { ...current.draft, name, nameInvalid: false } }); },
    vibe(vibe: string) { publish({ ...view.getSnapshot(), vibe }); },
    color(token: string, text: string, picker = false) {
      const draft = view.getSnapshot().draft;
      const descriptor = THEME_TOKENS.find((kept) => kept.name === token);

      if (!draft || !descriptor) return;
      const value = normalizeHex(text);
      const colors = { ...draft.colors };
      const hex = { ...draft.hex, [token]: text };
      const invalid = { ...draft.invalid, [token]: false };

      if (!text.trim() && descriptor.derived) delete colors[token];
      else if (!value) {
        publish({ ...view.getSnapshot(), draft: { ...draft, hex, invalid: { ...invalid, [token]: true } } });

        return;
      } else {
        colors[token] = value;

        if (picker) hex[token] = value;
      }

      update({ ...draft, colors, hex, invalid });
    },
    settle(token: string) {
      const draft = view.getSnapshot().draft;

      if (draft?.invalid[token]) update({ ...draft, hex: { ...draft.colors }, invalid: {}, nameInvalid: false });
    },
    submit() {
      const draft = view.getSnapshot().draft;

      if (!draft || !callbacks) return;
      const name = cleanThemeName(draft.name);

      if (!name) {
        publish({ ...view.getSnapshot(), draft: { ...draft, nameInvalid: true } });
        host?.focusName();

        return;
      }

      const theme = { id: draft.id ?? newThemeId(), name, colors: { ...draft.colors } };
      const next = draft.id ? callbacks.themes().map((kept) => kept.id === draft.id ? theme : kept) : [...callbacks.themes(), theme];
      close({ saved: true, focus: false });
      callbacks.save(next, theme.id);
      host?.focusSaved(theme.id);
    },
    delete() {
      const draft = view.getSnapshot().draft;

      if (!draft || !callbacks) return;
      close({ saved: true, focus: false });
      callbacks.save(callbacks.themes().filter((theme) => theme.id !== draft.id), null);
      host?.focusNew();
    },
    async dispose() { close({ focus: false }); await lifetime.close(); },
  };
}

export type ThemeEditorController = ReturnType<typeof createThemeEditor>;

const BUILT_INS = { dark: ['dark', 'terminal', 'midnight', 'nord'], light: ['light', 'paper', 'shadcn', 'soft', 'swiss', 'e-ink'] };

export function ThemeSettings({ controller, settings }: { controller: ThemeEditorController; settings: SettingsController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const choices = useSyncExternalStore(options.subscribe, options.getSnapshot, options.getSnapshot);
  const selected = useSyncExternalStore(settings.view.subscribe, settings.view.getSnapshot, settings.view.getSnapshot);
  const probe = useRef<HTMLSpanElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const vibe = useRef<HTMLInputElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const section = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const paint = canvas.getContext('2d', { willReadFrequently: true });

    if (!paint) throw new Error('Theme preview needs a canvas.');

    return controller.attach({
      resolve(token, under = '#ffffff') {
        if (!probe.current) return under;
        probe.current.style.color = `var(--${token})`;
        paint.fillStyle = under;
        paint.fillRect(0, 0, 1, 1);
        paint.fillStyle = getComputedStyle(probe.current).color;
        paint.fillRect(0, 0, 1, 1);

        return `#${[...paint.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
      },
      focusName() { name.current?.focus(); },
      focusVibe() { vibe.current?.focus(); },
      focusNew() { newButton.current?.focus(); },
      focusSaved(id) { section.current?.querySelectorAll<HTMLInputElement>('[data-custom-option] input').forEach((input) => { if (input.value === id) input.focus(); }); },
      focusFallback() { if (newButton.current?.disabled) section.current?.querySelector<HTMLInputElement>('#theme-select input:checked')?.focus(); else newButton.current?.focus(); },
    });
  }, [controller]);
  const draft = view.draft;
  const issues = draft ? contrastIssues(draft.colors) : {};
  const canEdit = choices.themes.some((theme) => theme.id === choices.shown);

  function radio(id: 'theme-select' | 'dark-theme' | 'light-theme', value: string, fallback: string) {
    return { value, checked: (selected.selected[id] ?? fallback) === value, onChange: () => settings.choose(id, value) };
  }

  function rows(key: boolean) {
    return THEME_TOKENS.filter((token) => Boolean(token.key) === key).map((token) => {
      const floor = READABLE.find((kept) => kept.name === token.name)?.min;
      const issue = issues[token.name];

      return <div className="theme-color" key={token.name}>
        <label htmlFor={`theme-hex-${token.name}`}>{token.label}</label>
        <input type="color" id={`theme-pick-${token.name}`} aria-label={`${token.label} colour`} value={draft?.colors[token.name] || draft?.resolved[token.name] || '#000000'} onInput={(event) => controller.color(token.name, event.currentTarget.value, true)} />
        <input type="text" id={`theme-hex-${token.name}`} className="input theme-hex" maxLength={7} spellCheck={false} autoComplete="off" aria-describedby={`theme-issue-${token.name}`} aria-invalid={draft?.invalid[token.name] ? 'true' : undefined} placeholder={token.derived ? draft?.resolved[token.name] : undefined} value={draft?.hex[token.name] ?? ''} onChange={(event) => controller.color(token.name, event.currentTarget.value)} onBlur={() => controller.settle(token.name)} />
        <span id={`theme-issue-${token.name}`} className="theme-issue">{issue ? `${issue}:1, needs ${floor}:1` : ''}</span>
      </div>;
    });
  }

  return <div ref={section} style={{ display: 'contents' }}>
    <div className="preference-row"><div className="preference-copy"><strong id="theme-select-label">theme</strong></div>
      <fieldset className="setting-options" id="theme-select" aria-labelledby="theme-select-label" disabled={selected.disabled['theme-select'] ?? false}>
        {['system', 'dark', 'light'].map((value) => <label className="setting-option" key={value}><input type="radio" name="theme-select" {...radio('theme-select', value, 'system')} /><span>{value}</span></label>)}
        <button ref={newButton} className="setting-action" id="theme-new" type="button" aria-controls="theme-editor" aria-expanded={view.expanded === 'new'} disabled={choices.themes.length >= MAX_CUSTOM_THEMES} onClick={(event) => controller.open(null, event.currentTarget)}>new</button>
        <button className="setting-action" id="theme-edit" type="button" aria-controls="theme-editor" aria-expanded={view.expanded === 'edit'} hidden={!canEdit} onClick={(event) => controller.open(choices.shown, event.currentTarget)}>edit</button>
      </fieldset>
    </div>
    {(['dark', 'light'] satisfies Array<'dark' | 'light'>).map((mode) => <div className="preference-row" key={mode}>
      <div className="preference-copy"><strong id={`${mode}-theme-label`}>{mode} theme</strong></div>
      <fieldset className="setting-options" id={`${mode}-theme`} aria-labelledby={`${mode}-theme-label`} disabled={selected.disabled[`${mode}-theme`] ?? false}>
        {BUILT_INS[mode].map((value) => <label className="setting-option" key={value}><input type="radio" name={`${mode}-theme`} {...radio(`${mode}-theme`, value, mode)} /><span>{value}</span></label>)}
        {choices.themes.filter((theme) => themeMode(palette(theme.colors)) === mode).map((theme) => <label className="setting-option" data-custom-option="" key={theme.id}><input type="radio" name={`${mode}-theme`} {...radio(`${mode}-theme`, theme.id, mode)} /><span>{theme.name}</span></label>)}
      </fieldset>
    </div>)}
    <form id="theme-editor" className="theme-editor" aria-label="Custom theme" noValidate hidden={!draft} aria-busy={view.generating} onSubmit={(event) => { event.preventDefault(); controller.submit(); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); controller.close(); } }}>
      <span ref={probe} hidden />
      <input ref={name} className="input" id="theme-name" type="text" maxLength={40} autoComplete="off" aria-label="Theme name" aria-invalid={draft?.nameInvalid ? 'true' : undefined} value={draft?.name ?? ''} onChange={(event) => controller.name(event.currentTarget.value)} />
      <div className="theme-vibe"><input ref={vibe} className="input" id="theme-vibe" type="text" maxLength={120} autoComplete="off" placeholder="describe a vibe" aria-label="Describe a vibe" disabled={!view.member} value={view.vibe} onChange={(event) => controller.vibe(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void controller.runGenerate(); } }} /><button className="btn btn-ghost" id="theme-generate" type="button" disabled={view.generating} onClick={() => { void controller.runGenerate(); }}>{view.generating ? 'generating…' : view.member ? 'generate' : 'sign in'}</button></div>
      <p id="theme-generate-status" className="theme-status" role="status" aria-live="polite">{view.status}</p>
      <div id="theme-key-colors" className="theme-colors">{rows(true)}</div>
      <details className="theme-more"><summary>more colours</summary><div id="theme-more-colors" className="theme-colors">{rows(false)}</div></details>
      <div className="theme-editor-actions"><button className="btn btn-ghost" id="theme-delete" type="button" hidden={!draft?.id} onClick={() => controller.delete()}>delete</button><button className="btn btn-ghost" id="theme-cancel" type="button" onClick={() => controller.close()}>cancel</button><button className="btn btn-primary" id="theme-save" type="submit">save</button></div>
    </form>
  </div>;
}
