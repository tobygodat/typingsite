// Settings → appearance → theme: the saved custom themes as theme options, and the editor that makes and
// changes them. Edits preview on the whole page as they're made; cancel, Escape or closing settings puts
// the saved theme back. src/app.js owns the preferences and their save.
import { BASE_TOKENS, MAX_CUSTOM_THEMES, READABLE, THEME_TOKENS, cleanThemeName, contrastIssues, newThemeId, normalizeHex, themeMode } from './custom-themes.js';

const $ = (id) => document.getElementById(id);

// The colours a custom theme sets on :root, over dark or light by its background; null takes them off.
// Returns the token set it wears over, or null.
export function wearColors(root, colors) {
  for (const name of [...root.style]) if (name.startsWith('--')) root.style.removeProperty(name);
  if (!colors) {
    delete root.dataset.custom;
    return null;
  }
  for (const [token, hex] of Object.entries(colors)) root.style.setProperty(`--${token}`, hex);
  root.dataset.custom = '';
  return themeMode(colors);
}

// One radio per saved custom theme, after the built-in ones; edit shows while one is in use.
export function showThemeOptions(themes, current) {
  const group = $('theme-select');
  for (const option of group.querySelectorAll('[data-custom-option]')) option.remove();
  for (const theme of themes) {
    const label = document.createElement('label');
    label.className = 'setting-option';
    label.dataset.customOption = '';
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'theme-select', value: theme.id });
    const span = document.createElement('span');
    span.textContent = theme.name;
    label.append(input, span);
    group.insertBefore(label, $('theme-new'));
  }
  $('theme-edit').hidden = !themes.some((theme) => theme.id === current);
  $('theme-new').disabled = themes.length >= MAX_CUSTOM_THEMES;
}

// The colour a token resolves to on screen, as an opaque hex: translucent tokens over the background.
const canvas = document.createElement('canvas');
canvas.width = 1;
canvas.height = 1;
const paint = canvas.getContext('2d', { willReadFrequently: true });
function resolvedHex(probe, token, under = '#ffffff') {
  probe.style.color = `var(--${token})`;
  paint.fillStyle = under;
  paint.fillRect(0, 0, 1, 1);
  paint.fillStyle = getComputedStyle(probe).color;
  paint.fillRect(0, 0, 1, 1);
  return `#${[...paint.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function createThemeEditor({ themes, currentTheme, preview, save, signedIn, generate, signIn }) {
  const form = $('theme-editor');
  const probe = document.createElement('span');
  probe.hidden = true;
  form.append(probe);
  let draft = null;
  let opener = null;
  let generating = false;

  const rows = new Map();
  for (const token of THEME_TOKENS) {
    const row = document.createElement('div');
    row.className = 'theme-color';
    const label = Object.assign(document.createElement('label'), { htmlFor: `theme-hex-${token.name}`, textContent: token.label });
    const picker = Object.assign(document.createElement('input'), { type: 'color', id: `theme-pick-${token.name}` });
    picker.setAttribute('aria-label', `${token.label} colour`);
    const hex = Object.assign(document.createElement('input'), { type: 'text', id: `theme-hex-${token.name}`, className: 'input theme-hex', maxLength: 7, spellcheck: false, autocomplete: 'off' });
    const issue = Object.assign(document.createElement('span'), { id: `theme-issue-${token.name}`, className: 'theme-issue' });
    hex.setAttribute('aria-describedby', issue.id);
    row.append(label, picker, hex, issue);
    (token.key ? $('theme-key-colors') : $('theme-more-colors')).append(row);
    rows.set(token.name, { token, picker, hex, issue });
    picker.addEventListener('input', () => {
      draft.colors[token.name] = picker.value;
      hex.value = picker.value;
      hex.removeAttribute('aria-invalid');
      update();
    });
    hex.addEventListener('input', () => {
      const value = normalizeHex(hex.value);
      if (!hex.value.trim() && token.derived) delete draft.colors[token.name];
      else if (!value) return hex.setAttribute('aria-invalid', 'true');
      else picker.value = draft.colors[token.name] = value;
      hex.removeAttribute('aria-invalid');
      update();
    });
    // A half-typed hex goes back to the colour in use when the field is left.
    hex.addEventListener('change', () => { if (hex.hasAttribute('aria-invalid')) show(); });
  }

  // Wears the draft, then shows what each token resolves to: derived ones as their placeholder, until
  // overridden, and a contrast note under each colour that has to stay readable.
  function update() {
    preview(draft.colors);
    const ground = resolvedHex(probe, 'ground');
    for (const { token, picker, hex } of rows.values()) {
      if (!token.derived || draft.colors[token.name]) continue;
      const shown = resolvedHex(probe, token.name, ground);
      picker.value = shown;
      hex.placeholder = shown;
    }
    const issues = contrastIssues(draft.colors);
    for (const { name, min } of READABLE) rows.get(name).issue.textContent = issues[name] ? `${issues[name]}:1, needs ${min}:1` : '';
  }

  function show() {
    for (const { token, picker, hex } of rows.values()) {
      const value = draft.colors[token.name] || '';
      hex.value = value;
      hex.removeAttribute('aria-invalid');
      if (value) picker.value = value;
    }
    $('theme-name').value = draft.name;
    $('theme-name').removeAttribute('aria-invalid');
    update();
  }

  function setGenerating(pending) {
    generating = pending;
    form.setAttribute('aria-busy', String(pending));
    $('theme-generate').disabled = pending;
    $('theme-generate').textContent = pending ? 'generating…' : 'generate';
  }

  function syncAccount() {
    const member = signedIn();
    $('theme-vibe').disabled = !member;
    if (!generating) $('theme-generate').textContent = member ? 'generate' : 'sign in';
  }

  function open(id, from) {
    if (draft) preview(null);
    const saved = themes().find((theme) => theme.id === id);
    const current = themes().find((theme) => theme.id === currentTheme());
    const base = saved || current;
    const colors = base ? { ...base.colors } : Object.fromEntries(BASE_TOKENS.map((token) => [token, resolvedHex(probe, token)]));
    const label = current?.name || document.documentElement.dataset.theme;
    draft = { id: saved?.id ?? null, name: saved ? saved.name : cleanThemeName(`${label} copy`), colors };
    opener = from;
    form.hidden = false;
    $('theme-delete').hidden = !saved;
    $('theme-generate-status').textContent = '';
    $('theme-vibe').value = '';
    for (const button of [$('theme-new'), $('theme-edit')]) button.setAttribute('aria-expanded', String(button === from));
    syncAccount();
    show();
    $('theme-name').focus();
  }

  // Puts away the editor; unsaved, the saved theme comes back.
  function close({ saved = false, focus = true } = {}) {
    if (!draft) return;
    draft = null;
    form.hidden = true;
    for (const button of [$('theme-new'), $('theme-edit')]) button.setAttribute('aria-expanded', 'false');
    if (!saved) preview(null);
    const back = opener?.isConnected && !opener.hidden && !opener.disabled ? opener : $('theme-new').disabled ? $('theme-select').querySelector('input:checked') : $('theme-new');
    if (focus) back?.focus();
  }

  async function runGenerate() {
    if (!signedIn()) return signIn();
    const vibe = $('theme-vibe').value.replace(/\s+/g, ' ').trim();
    if (!vibe || generating) return $('theme-vibe').focus();
    setGenerating(true);
    $('theme-generate-status').textContent = '';
    try {
      const theme = await generate(vibe);
      if (!draft) return;
      const colors = {};
      for (const token of BASE_TOKENS) colors[token] = normalizeHex(theme?.colors?.[token]);
      if (BASE_TOKENS.some((token) => !colors[token])) throw new Error('Couldn’t generate a theme. Try again.');
      draft.colors = colors;
      draft.name = cleanThemeName(theme.name) || draft.name;
      show();
    } catch (error) {
      if (draft) $('theme-generate-status').textContent = error.message;
    } finally {
      setGenerating(false);
      syncAccount();
    }
  }

  $('theme-new').addEventListener('click', (event) => open(null, event.currentTarget));
  $('theme-edit').addEventListener('click', (event) => open(currentTheme(), event.currentTarget));
  $('theme-cancel').addEventListener('click', () => close());
  $('theme-generate').addEventListener('click', runGenerate);
  $('theme-vibe').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    runGenerate();
  });
  $('theme-name').addEventListener('input', () => {
    draft.name = $('theme-name').value;
    $('theme-name').removeAttribute('aria-invalid');
  });
  // Escape inside the editor cancels the edit and leaves settings open.
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = cleanThemeName(draft.name);
    if (!name) {
      $('theme-name').setAttribute('aria-invalid', 'true');
      return $('theme-name').focus();
    }
    const theme = { id: draft.id ?? newThemeId(), name, colors: { ...draft.colors } };
    const next = draft.id ? themes().map((kept) => (kept.id === draft.id ? theme : kept)) : [...themes(), theme];
    close({ saved: true, focus: false });
    save(next, theme.id);
    $('theme-select').querySelector(`input[value="${theme.id}"]`)?.focus();
  });
  $('theme-delete').addEventListener('click', () => {
    const id = draft.id;
    close({ saved: true, focus: false });
    save(themes().filter((theme) => theme.id !== id), currentTheme() === id ? 'system' : currentTheme());
    $('theme-new').focus();
  });

  return {
    // The draft's colours while editing, so a redraw keeps showing them.
    draftColors: () => draft?.colors ?? null,
    close,
    syncAccount,
  };
}
