# Theme and settings

The settings control in the dock opens a raised popover of preferences: theme (system, dark, light), text
size, word list, keyboard layout, live metrics, keyboard, focus mode and more. The theme follows the system
until the person picks dark or light; a guest's pick lasts for the tab, a signed-in pick persists.

## Sub-features

- `settings-open` opens `.preferences-popover` from the dock's "settings" (`details.preferences > summary`).
- `theme-pick` switches `#theme-select` to dark or light; `html[data-theme]` and the page colours follow at once.
- `theme-system` follows the system's light or dark preference while `#theme-select` is "system".
- `theme-persist` keeps a signed-in person's pick across reloads; a guest falls back to the system on reload.

## How to get to it (user POV)

- Click "settings" in the dock (the sliders icon on phones).
- Ctrl+K → `theme · dark`, `theme · light` or `theme · system` (see [Command palette](./command-palette.md)).
- Change the operating system's appearance while the theme is "system".

## Driving it with verify.mjs

Preconditions:

- `$V doctor` exits 0.
- Guest, `#theme-select` at "system", emulated system theme dark.

- **Open settings and switch theme.** Run `$V shot settings`. `settings.png` shows the popover over the dark
  page; `settings-light.png` shows the same popover and page in the light set. `run.json` notes
  `theme: {before: "dark", after: "light"}` and the check passes.
- **System theme.** Run `$V shot idle --scheme light` and `$V shot idle --scheme dark`. Each `run.json` step
  records `theme` as the scheme passed.
- **Signed-in persistence.** Run `$V shot settings --signed-in`. The flow signs in first (shot `signed-in`),
  then switches the theme. To prove persistence, write a flow that does the same and then `page.reload()`,
  and check `html[data-theme]` is still the picked theme.

## Gotchas

- Playwright's own default system theme is light; `$V` defaults to `--scheme dark`. Always say which scheme
  a shot used (it's in the file name).
- A guest's pick survives only until reload: the inline script in `index.html` resolves the theme from the
  system for guests. Reload-persistence needs `--signed-in`.
- The settings popover is a `<details>`; clicking the summary again closes it.
- Light-theme contrast has its own spec (`e2e/light-contrast.spec.js`); a screenshot isn't a contrast check.
