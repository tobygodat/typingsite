# Theme and settings

The settings control in the dock opens a centred, opaque modal dialog. A sidebar lists the categories
(appearance, practice, keyboard, sound, shortcuts, then "Import Monkeytype settings"); each category is a
column of preference rows whose options are native radio groups styled as inline selectors. Appearance holds
theme (system, dark, light, paper, shadcn, terminal, soft, midnight, swiss, e-ink, nord), background (an image
file, kept on this device only), text size, word highlight, one-line tape and a sample passage. Changes apply as
they are chosen; Done, the close button and Escape all close it. The theme follows the system until the
person picks a theme; a guest's pick lasts for the tab, a signed-in pick persists.

## Sub-features

- `settings-open` opens `#settings-dialog` (a native `<dialog>`, `#settings-dialog[open]`) from the dock's
  `#settings-trigger` (accessible name "Settings"), with focus on the current category button.
- `settings-category` switches the visible `#settings-<category>` section from the sidebar's
  `[data-settings-category="<category>"]` buttons; the current one has `aria-current="true"`.
- `theme-pick` checks a radio in the `#theme-select` fieldset (`#theme-select input[value="dark"|"light"|"paper"|…|"e-ink"|"nord"]`);
  `html[data-theme]` and the page colours follow at once.
- `theme-system` follows the system's light or dark preference while `#theme-select input[value="system"]`
  is checked.
- `theme-persist` keeps a signed-in person's pick across reloads; a guest falls back to the system on reload.
- `wallpaper-pick` takes an image from `#wallpaper-file` (the "choose…" option; `setInputFiles` drives it):
  `#wallpaper[data-shown]` appears as a dithered dot layer tinted from the theme over the top of the page,
  fading out above the passage, and `#wallpaper-remove` ("remove") appears. A file that isn't an image shows
  `#wallpaper-error` and changes nothing. The image survives reloads (IndexedDB) for guests and members alike.
- `wallpaper-dim` drops the layer to a quarter opacity while `body[data-running="true"]`; it returns with the
  chrome on a pointer nudge, finish or restart.
- `wallpaper-remove` clears it (`#wallpaper` hidden again) and moves focus to the file option.
- `settings-close` closes the dialog with Escape, `#settings-close` or `#settings-done` and returns focus to
  the opener (the dock button when opened from there).

## How to get to it (user POV)

- Click "settings" in the dock (the sliders icon only, below 900 px and on phones).
- Ctrl+K → `theme · <name>` for any of the ten, or `theme · system` (see [Command palette](./command-palette.md)).
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
- **Every theme.** Run `$V drive .claude/skills/verify-stilltype/flows/themes.mjs`. For each of the ten it
  picks the theme in settings (shot `<theme>-settings`), checks `meta[name=theme-color]` follows `--ground`,
  then runs 10 words with one slip (shot `<theme>-mid-run`) and finishes (shot `<theme>-results`). Below
  761 px wide it shoots mid-run only.
- **Phone.** `$V shot settings --width 390 --height 844 --mobile` (add `--scheme light` to switch towards
  dark). Below 760 px the category nav wraps across the top of the dialog.
- **Background image.** Run `$V drive .claude/skills/verify-stilltype/flows/wallpaper.mjs` (add
  `WALLPAPER_IMAGE=<path>` for your own image, default the app icon; `THEME=<name>` picks a theme first).
  Shots: `settings-none`, `settings-image`, `idle` and `mid-run`; `run.json` notes the running opacity and
  checks it is under 0.5.
- **Other categories.** In a flow, `await h.openSettings('practice')` opens the dialog (if closed) and shows
  that category; pass any of appearance, practice, keyboard, sound, shortcuts.
- **System theme.** Run `$V shot idle --scheme light` and `$V shot idle --scheme dark`. Each `run.json` step
  records `theme` as the scheme passed.
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
- Contrast has its own checks: `tests/contrast.test.js` (every theme's token pairs), `e2e/passage-contrast.spec.js`
  (every theme's passage letters and caret as painted), `e2e/wallpaper.spec.js` (the same over the brightest background image) and `e2e/light-contrast.spec.js`. A screenshot isn't a contrast check.
