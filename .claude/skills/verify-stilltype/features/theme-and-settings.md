# Theme and settings

The settings control in the dock opens a centred, opaque modal dialog. A sidebar lists the categories
(appearance, practice, keyboard, sound, shortcuts, then "Import Monkeytype settings"); each category is a
column of preference rows whose options are native radio groups styled as inline selectors. Appearance holds
theme (system, dark, light, then "new" and, while a custom theme is on show, "edit"), dark theme (dark,
terminal, midnight, nord, then the saved custom themes with a dark background by name), light theme (light,
paper, shadcn, soft, swiss, e-ink, then the saved custom themes with a light background), background (an image
file, kept on this device only), text size, word highlight, slide (shown only while a highlight is on), one-line tape, typing font (literata, source serif, inter, jetbrains mono, ibm plex mono, roboto
mono, fira code), app font (literata, source serif, inter) and a sample passage set in the typing font. Changes apply as they are chosen; Done, the close button and
Escape all close it. In system mode the page shows the dark theme pick or the light theme pick as the system
changes; in dark or light mode it shows that mode's pick, and picking a theme from the other row switches to
its mode. A guest's choices last for the tab, a signed-in person's persist.

## Sub-features

- `settings-open` opens `#settings-dialog` (a native `<dialog>`, `#settings-dialog[open]`) from the dock's
  `#settings-trigger` (accessible name "Settings"), with focus on the current category button.
- `settings-category` switches the visible `#settings-<category>` section from the sidebar's
  `[data-settings-category="<category>"]` buttons; the current one has `aria-current="true"`.
- `theme-mode` checks a radio in `#theme-select` (`input[value="system"|"dark"|"light"]`); `html[data-theme]`
  becomes that mode's pick at once.
- `theme-pick` checks a radio in `#dark-theme` (`dark`, `terminal`, `midnight`, `nord`) or `#light-theme`
  (`light`, `paper`, `shadcn`, `soft`, `swiss`, `e-ink`). Outside system mode the pick shows at once, in its
  own mode; in system mode it shows when the system is in that mode.
- `font-pick` checks a radio in `#typing-font` or `#app-font`; `html[data-typing-font]` / `html[data-app-font]`
  follow, and the font file is fetched then (nothing but Literata and Geist Mono loads by default). A signed-in
  pick is applied before first paint by the inline script in `index.html`.
- `theme-system` switches between the two picks as the system's light or dark preference changes, while
  `#theme-select input[value="system"]` is checked.
- `theme-persist` keeps a signed-in person's mode and picks across reloads, painted by the inline script in
  `index.html` before the app runs; a guest falls back to system mode with dark and light on reload.
- `theme-custom` "new" (`#theme-new`) or "edit" (`#theme-edit`) opens the editor (`#theme-editor`) under the
  theme rows: a name (`#theme-name`), a vibe field (`#theme-vibe`) with `#theme-generate`, five colours up front
  (background, text, muted text, accent, mistakes) and the rest behind "more colours" (`.theme-more`), each a
  colour input `#theme-pick-<token>` plus a hex field `#theme-hex-<token>`. Edits preview on the whole page
  (`html[data-custom]`, colours inline on `:root`, `data-theme` dark or light by the background). A derived
  token's hex field is empty with what it derives to as placeholder until overridden. Text, muted text, accent
  and mistakes under AA show `#theme-issue-<token>` ("2.1:1, needs 4.5:1"). Save adds a radio named after the
  theme to `#dark-theme` or `#light-theme` by its background's luminance and picks it there, as picking a
  theme does; cancel, Escape inside the editor, picking another theme or closing settings put the saved theme
  back. Deleting one sends any pick of it back to its mode's default.
- `theme-generate` (signed in) sends the vibe to the generate-theme Edge Function and opens the answer in the
  editor unsaved; a failure is one line in `#theme-generate-status`. A guest's vibe field is disabled and the
  button reads "sign in".
- `wallpaper-pick` takes an image from `#wallpaper-file` (the "choose…" option; `setInputFiles` drives it):
  `#wallpaper[data-shown]` appears as a dithered dot layer tinted from the theme over the top of the page,
  fading out at the countdown, and `#wallpaper-remove` ("remove") appears. A file that isn't an image shows
  `#wallpaper-error` and changes nothing. The image survives reloads (IndexedDB) for guests and members alike.
- `wallpaper-style` (its row, and the blur, opacity and height rows, show only once there is an image) checks
  `#wallpaper-style input[value=…]`: regular (the photo in colour), dither (the default, as above) or gradient
  (a smooth wash of the photo's colours). `#wallpaper[data-style]` follows.
- `wallpaper-blur` and `wallpaper-opacity` are native ranges (`#wallpaper-blur` 0–32 px, disabled for dither;
  `#wallpaper-opacity` 10–100%). They set `--wallpaper-blur` and `--wallpaper-opacity` on the layer as they
  move (read them on `#wallpaper::before`) and save on release. `#wallpaper-reach` ("height", 0–100%) moves
  where the layer's fade ends on the practice screen, from the top of the reading band (`#typing-form`: the
  countdown, passage and controls) to the bottom of the screen; above 0 the picture runs on behind the band,
  `.shortcut-row` and the footer items with no hole cut around them. Where it would take text below the
  contrast floor, `#live-stats`, `#typing-wrap`, `.shortcut-row` or a footer item gets `[data-halo]` (an outline
  in `--ground` under the letters; the caret stays bare). Style, blur,
  opacity and height survive reloads with the image and never reach the profile.
- `wallpaper-dim` drops the layer to a quarter opacity while `body[data-running="true"]`; it returns with the
  chrome on a pointer nudge, finish or restart.
- `wallpaper-remove` clears it (`#wallpaper` hidden again) and moves focus to the file option.
- `word-highlight-slide` checks `#word-highlight-slide input[value="true"]` (its row shows only while
  `#word-highlight` is not off): `body[data-word-highlight-slide="true"]`, and one `.word-glide` in each
  passage glides from word to word behind the letters instead of the letters' own tint.
- `settings-close` closes the dialog with Escape, `#settings-close` or `#settings-done` and returns focus to
  the opener (the dock button when opened from there).

## How to get to it (user POV)

- Click "settings" in the dock (the sliders icon only, below 900 px and on phones).
- Ctrl+K → `theme · system|dark|light`, or `dark theme · <name>` / `light theme · <name>` (see [Command palette](./command-palette.md)).
- Ctrl+K → `typing font · <name>` or `app font · <name>`.
- Change the operating system's appearance while the theme is "system".

## Driving it with verify.mjs

Preconditions:

- `$V doctor` exits 0.
- Guest, `#theme-select` at "system", emulated system theme dark.

- **Open settings and switch theme.** Run `$V shot settings`. `settings.png` shows the dialog on its
  appearance category over the dark page; `settings-light.png` shows the same dialog and page in the light
  set with "light" selected. `run.json` notes `theme: {before: "dark", after: "light"}`, and the checks
  cover the radio being checked, `html[data-theme]` following, Escape closing the dialog with focus back on
  `#settings-trigger`, and the theme staying after the close.
- **Dark and light picks.** Run `$V drive .claude/skills/verify-stilltype/flows/theme-modes.mjs`. In system mode
  it picks nord and paper, then emulates each system scheme: shots `settings-dark` and `settings-light` show
  the appearance rows, `idle-dark` (nord) and `idle-light` (paper) the page. The checks cover the checked
  radios and `html[data-theme]` following the scheme.
- **Every theme.** Run `$V drive .claude/skills/verify-stilltype/flows/themes.mjs`. For each of the ten it
  sets its mode and picks the theme in settings (shot `<theme>-settings`), checks `meta[name=theme-color]` follows `--ground`,
  then runs 10 words with one slip (shot `<theme>-mid-run`) and finishes (shot `<theme>-results`). Below
  761 px wide it shoots mid-run only.
- **Word highlight slide.** Run `$V drive .claude/skills/verify-stilltype/flows/word-glide.mjs` (and again
  with `--reduced-motion`). It checks the slide row is hidden until a highlight is on, turns on "this word"
  and slide (shot `settings`), then compares the glide's edges with the current word's at rest, after a
  space (shot `mid-glide`, notes how far it still has to go), on a miss (shot `miss`) and on a later line.
- **Fonts.** Run `$V drive .claude/skills/verify-stilltype/flows/fonts.mjs --delay 30`. For each typing font
  (with a non-default app font), on three lines and on the tape, with the custom pace caret, it types past the
  second line and measures from the rendered glyphs: caret bar on the current letter's left edge (±1px), the
  bar's top and bottom against the font's baseline (Literata's place, ±1px), the letter in view and the pace caret
  on a line of letters. Shots `<font>-lines` and `<font>-tape`; `run.json` notes every measurement.
- **Phone.** `$V shot settings --width 390 --height 844 --mobile` (add `--scheme light` to switch towards
  dark). Below 760 px the category nav wraps across the top of the dialog.
- **Background image.** Run `$V drive .claude/skills/verify-stilltype/flows/wallpaper.mjs` (add
  `WALLPAPER_IMAGE=<path>` for your own image, default the app icon; `THEME=<name>` picks a theme first;
  `BLUR=<steps>` / `OPACITY=<steps>` move those sliders with the arrow keys first.) Shots: `settings-none`,
  `settings-image`, `settings-<style>` and `idle-<style>` for regular, dither and gradient, and `mid-run`;
  `run.json` notes each style's filter and opacity and the running opacity, and checks it is under 0.5.
- **Other categories.** In a flow, `await h.openSettings('practice')` opens the dialog (if closed) and shows
  that category; pass any of appearance, practice, keyboard, sound, shortcuts.
- **System theme.** Run `$V shot idle --scheme light` and `$V shot idle --scheme dark`. Each `run.json` step
  records `theme` as the scheme passed.
- **Custom themes.** Run `$V drive .claude/skills/verify-stilltype/flows/custom-theme.mjs --signed-in`. Shots:
  `theme-row`, `editor`, `contrast-note`, `more-colours`, `saved`, `generated`, `generate-limit`, `reloaded`.
  It checks the live preview, Escape reverting with settings left open, save, the generate reply (routed, so
  nothing reaches Anthropic) and its limit line, and that the inline script alone (app.js stubbed out) wears
  the saved theme on reload. Without `--signed-in` it stops after Escape and checks the guest's disabled vibe.
- **Signed-in persistence.** Run `$V shot settings --signed-in`. The flow signs in first (shot `signed-in`),
  then switches the theme. To prove persistence, write a flow that does the same and then `page.reload()`,
  and check `html[data-theme]` is still the picked theme.

## Gotchas

- Playwright's own default system theme is light; `$V` defaults to `--scheme dark`. Always say which scheme
  a shot used (it's in the file name).
- A guest's pick survives only until reload: the inline script in `index.html` resolves the theme from the
  system for guests. Reload-persistence needs `--signed-in`. The dialog's footer says which applies.
- The radios sit inside their labels; click the label (`input.locator('..')`), as a person would, rather
  than `check({ force: true })`. `selectOption` no longer applies: there is no `<select>`.
- The modal makes the page inert: close the dialog (Escape) before driving anything behind it. Escape first
  cancels a shortcut recording in the shortcuts category, and only a second Escape closes the dialog.
- During a run the dock fades and ignores the pointer; `h.openSettings()` nudges the mouse first.
- The background image lives in IndexedDB, not the profile: each `$V` run starts without one, and
  `--signed-in` doesn't bring one along.
- The fake Supabase has no generate-theme function: route `**/functions/v1/generate-theme` in the flow.
- Contrast has its own checks: `tests/contrast.test.js` (every theme's token pairs), `e2e/passage-contrast.spec.js`
  (every theme's passage letters and caret as painted), `e2e/wallpaper.spec.js` (the same over the brightest background image) and `e2e/light-contrast.spec.js`. A screenshot isn't a contrast check.
