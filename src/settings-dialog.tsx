export function SettingsDialog() {
  return (
<dialog id="settings-dialog" aria-labelledby="settings-title">
    <header className="settings-header">
      <h2 id="settings-title">Settings</h2>
      <button id="settings-close" type="button" aria-label="Close settings"><span className="key-hint">esc</span><span aria-hidden="true">×</span></button>
    </header>
    <div className="settings-body">
      <nav className="settings-nav" aria-label="Settings categories">
        <button type="button" data-settings-category="appearance" aria-controls="settings-appearance" aria-current="true">appearance</button>
        <button type="button" data-settings-category="practice" aria-controls="settings-practice">practice</button>
        <button type="button" data-settings-category="keyboard" aria-controls="settings-keyboard">keyboard</button>
        <button type="button" data-settings-category="sound" aria-controls="settings-sound">sound</button>
        <button type="button" data-settings-category="shortcuts" aria-controls="settings-shortcuts">shortcuts</button>
        <button id="import-trigger" className="settings-import" type="button" aria-haspopup="dialog" aria-controls="import-dialog">Import Monkeytype settings</button>
      </nav>
      <div className="settings-content">
        <section id="settings-appearance" className="settings-category" aria-labelledby="settings-appearance-title">
          <div className="settings-intro"><h3 id="settings-appearance-title">Appearance</h3></div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="theme-select-label">theme</strong></div>
            <fieldset className="setting-options" id="theme-select" aria-labelledby="theme-select-label">
              <label className="setting-option"><input type="radio" name="theme-select" defaultValue="system" defaultChecked /><span>system</span></label>
              <label className="setting-option"><input type="radio" name="theme-select" defaultValue="dark" /><span>dark</span></label>
              <label className="setting-option"><input type="radio" name="theme-select" defaultValue="light" /><span>light</span></label>
              <button className="setting-action" id="theme-new" type="button" aria-controls="theme-editor" aria-expanded="false">new</button>
              <button className="setting-action" id="theme-edit" type="button" aria-controls="theme-editor" aria-expanded="false" hidden>edit</button>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="dark-theme-label">dark theme</strong></div>
            <fieldset className="setting-options" id="dark-theme" aria-labelledby="dark-theme-label">
              <label className="setting-option"><input type="radio" name="dark-theme" defaultValue="dark" defaultChecked /><span>dark</span></label>
              <label className="setting-option"><input type="radio" name="dark-theme" defaultValue="terminal" /><span>terminal</span></label>
              <label className="setting-option"><input type="radio" name="dark-theme" defaultValue="midnight" /><span>midnight</span></label>
              <label className="setting-option"><input type="radio" name="dark-theme" defaultValue="nord" /><span>nord</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="light-theme-label">light theme</strong></div>
            <fieldset className="setting-options" id="light-theme" aria-labelledby="light-theme-label">
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="light" defaultChecked /><span>light</span></label>
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="paper" /><span>paper</span></label>
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="shadcn" /><span>shadcn</span></label>
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="soft" /><span>soft</span></label>
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="swiss" /><span>swiss</span></label>
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="e-ink" /><span>e-ink</span></label>
            </fieldset>
          </div>
          <form id="theme-editor" className="theme-editor" aria-label="Custom theme" noValidate hidden>
            <input className="input" id="theme-name" type="text" maxLength={40} autoComplete="off" aria-label="Theme name" />
            <div className="theme-vibe">
              <input className="input" id="theme-vibe" type="text" maxLength={120} autoComplete="off" placeholder="describe a vibe" aria-label="Describe a vibe" />
              <button className="btn btn-ghost" id="theme-generate" type="button">generate</button>
            </div>
            <p id="theme-generate-status" className="theme-status" role="status" aria-live="polite"></p>
            <div id="theme-key-colors" className="theme-colors"></div>
            <details className="theme-more">
              <summary>more colours</summary>
              <div id="theme-more-colors" className="theme-colors"></div>
            </details>
            <div className="theme-editor-actions">
              <button className="btn btn-ghost" id="theme-delete" type="button">delete</button>
              <button className="btn btn-ghost" id="theme-cancel" type="button">cancel</button>
              <button className="btn btn-primary" id="theme-save" type="submit">save</button>
            </div>
          </form>
          <div className="preference-row">
            <div className="preference-copy"><strong id="wallpaper-label">background</strong><small id="wallpaper-error" className="preference-note" hidden>can’t read that file</small></div>
            <div className="setting-options" role="group" aria-labelledby="wallpaper-label" aria-describedby="wallpaper-error">
              <label className="setting-option"><input id="wallpaper-file" type="file" accept="image/*" /><span>choose…</span></label>
              <button id="wallpaper-remove" className="setting-option" type="button" hidden><span>remove</span></button>
            </div>
          </div>
          <div className="preference-row" hidden>
            <div className="preference-copy"><strong id="wallpaper-style-label">style</strong></div>
            <fieldset className="setting-options" id="wallpaper-style" aria-labelledby="wallpaper-label wallpaper-style-label">
              <label className="setting-option"><input type="radio" name="wallpaper-style" defaultValue="regular" /><span>regular</span></label>
              <label className="setting-option"><input type="radio" name="wallpaper-style" defaultValue="dither" defaultChecked /><span>dither</span></label>
              <label className="setting-option"><input type="radio" name="wallpaper-style" defaultValue="gradient" /><span>gradient</span></label>
            </fieldset>
          </div>
          <label className="preference-row" htmlFor="wallpaper-blur" hidden>
            <span className="preference-copy"><strong>blur</strong></span>
            <span className="preference-range"><input className="range" id="wallpaper-blur" type="range" min="0" max="32" step="2" defaultValue="0" /></span>
          </label>
          <label className="preference-row" htmlFor="wallpaper-opacity" hidden>
            <span className="preference-copy"><strong>opacity</strong></span>
            <span className="preference-range"><input className="range" id="wallpaper-opacity" type="range" min="10" max="100" step="5" defaultValue="100" /></span>
          </label>
          <label className="preference-row" htmlFor="wallpaper-reach" hidden>
            <span className="preference-copy"><strong>height</strong></span>
            <span className="preference-range"><input className="range" id="wallpaper-reach" type="range" min="0" max="100" step="5" defaultValue="0" /></span>
          </label>
          <div className="preference-row">
            <div className="preference-copy"><strong id="font-size-label">text size</strong></div>
            <fieldset className="setting-options" id="font-size" aria-labelledby="font-size-label">
              <label className="setting-option"><input type="radio" name="font-size" defaultValue="22" /><span>small</span></label>
              <label className="setting-option"><input type="radio" name="font-size" defaultValue="28" defaultChecked /><span>medium</span></label>
              <label className="setting-option"><input type="radio" name="font-size" defaultValue="36" /><span>large</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="word-highlight-label">word highlight</strong></div>
            <fieldset className="setting-options" id="word-highlight" aria-labelledby="word-highlight-label">
              <label className="setting-option"><input type="radio" name="word-highlight" defaultValue="off" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="word-highlight" defaultValue="current" /><span>this word</span></label>
              <label className="setting-option"><input type="radio" name="word-highlight" defaultValue="next" /><span>next word</span></label>
            </fieldset>
          </div>
          <div className="preference-row" hidden>
            <div className="preference-copy"><strong id="word-highlight-slide-label">slide</strong></div>
            <fieldset className="setting-options" id="word-highlight-slide" aria-labelledby="word-highlight-label word-highlight-slide-label">
              <label className="setting-option"><input type="radio" name="word-highlight-slide" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="word-highlight-slide" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="tape-toggle-label">one-line tape</strong></div>
            <fieldset className="setting-options" id="tape-toggle" aria-labelledby="tape-toggle-label">
              <label className="setting-option"><input type="radio" name="tape-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="tape-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="typing-font-label">typing font</strong></div>
            <fieldset className="setting-options" id="typing-font" aria-labelledby="typing-font-label">
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="literata" defaultChecked /><span>literata</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="source-serif" /><span>source serif</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="inter" /><span>inter</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="jetbrains-mono" /><span>jetbrains mono</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="ibm-plex-mono" /><span>ibm plex mono</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="roboto-mono" /><span>roboto mono</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="fira-code" /><span>fira code</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="app-font-label">app font</strong></div>
            <fieldset className="setting-options" id="app-font" aria-labelledby="app-font-label">
              <label className="setting-option"><input type="radio" name="app-font" defaultValue="literata" defaultChecked /><span>literata</span></label>
              <label className="setting-option"><input type="radio" name="app-font" defaultValue="source-serif" /><span>source serif</span></label>
              <label className="setting-option"><input type="radio" name="app-font" defaultValue="inter" /><span>inter</span></label>
            </fieldset>
          </div>
          <div className="settings-preview" aria-label="Passage preview">
            <p id="settings-preview-passage"><span>Find</span> <span>a</span> <span>little</span> <span>room</span> <span>for</span> <span>thought.</span></p>
          </div>
        </section>
        <section id="settings-practice" className="settings-category" aria-labelledby="settings-practice-title" hidden>
          <div className="settings-intro"><h3 id="settings-practice-title">Practice</h3></div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="word-list-label">word list</strong><small id="word-list-lock" className="preference-lock" hidden>fixed for standard</small></div>
            <fieldset className="setting-options" id="word-list" aria-labelledby="word-list-label" aria-describedby="word-list-lock">
              <label className="setting-option"><input type="radio" name="word-list" defaultValue="200" defaultChecked /><span>top 200</span></label>
              <label className="setting-option"><input type="radio" name="word-list" defaultValue="1k" /><span>top 1k</span></label>
              <label className="setting-option"><input type="radio" name="word-list" defaultValue="5k" /><span>top 5k</span></label>
              <label className="setting-option"><input type="radio" name="word-list" defaultValue="10k" /><span>top 10k</span></label>
              <label className="setting-option" hidden><input type="radio" name="word-list" defaultValue="standard" disabled /><span>1k–10k</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="numbers-toggle-label">numbers</strong><small id="numbers-toggle-lock" className="preference-lock" hidden>fixed for standard</small></div>
            <fieldset className="setting-options" id="numbers-toggle" aria-labelledby="numbers-toggle-label" aria-describedby="numbers-toggle-lock">
              <label className="setting-option"><input type="radio" name="numbers-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="numbers-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="repeat-quotes-toggle-label">repeat quotes</strong></div>
            <fieldset className="setting-options" id="repeat-quotes-toggle" aria-labelledby="repeat-quotes-toggle-label">
              <label className="setting-option"><input type="radio" name="repeat-quotes-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="repeat-quotes-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row preference-row-wide">
            <div className="preference-copy"><strong id="correction-select-label">correction</strong><small id="correction-select-lock" className="preference-lock" hidden>fixed for standard</small></div>
            <fieldset className="setting-options" id="correction-select" aria-labelledby="correction-select-label" aria-describedby="correction-select-lock">
              <label className="setting-option"><input type="radio" name="correction-select" defaultValue="relaxed" defaultChecked /><span>free</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" defaultValue="mandatory" /><span>stop on error</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" defaultValue="no-backspace" /><span>no backspace</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" defaultValue="fail-word" /><span>fail on word error</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" defaultValue="fail-any" /><span>fail on any error</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="strict-space-toggle-label">strict space</strong><small className="preference-note" id="rules-note" hidden></small></div>
            <fieldset className="setting-options" id="strict-space-toggle" aria-labelledby="strict-space-toggle-label" aria-describedby="rules-note">
              <label className="setting-option"><input type="radio" name="strict-space-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="strict-space-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="quick-end-toggle-label">quick end</strong><small className="preference-note" id="quick-end-note" hidden></small></div>
            <fieldset className="setting-options" id="quick-end-toggle" aria-labelledby="quick-end-toggle-label" aria-describedby="quick-end-note rules-note">
              <label className="setting-option"><input type="radio" name="quick-end-toggle" defaultValue="false" /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="quick-end-toggle" defaultValue="true" defaultChecked /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="min-accuracy-label">minimum accuracy</strong></div>
            <fieldset className="setting-options" id="min-accuracy" aria-labelledby="min-accuracy-label">
              <label className="setting-option"><input type="radio" name="min-accuracy" defaultValue="0" defaultChecked /><span>any %</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" defaultValue="80" /><span>80%</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" defaultValue="90" /><span>90%</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" defaultValue="95" /><span>95%</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" defaultValue="98" /><span>98%</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="min-wpm-label">minimum speed</strong></div>
            <fieldset className="setting-options" id="min-wpm" aria-labelledby="min-wpm-label">
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="0" defaultChecked /><span data-speed-unit="any {unit}">any wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="20" /><span data-wpm="20">20 wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="30" /><span data-wpm="30">30 wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="40" /><span data-wpm="40">40 wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="60" /><span data-wpm="60">60 wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="80" /><span data-wpm="80">80 wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="100" /><span data-wpm="100">100 wpm</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="pace-select-label">pace caret</strong><small id="pace-note" className="pace-note"></small></div>
            <fieldset className="setting-options" id="pace-select" aria-labelledby="pace-select-label" aria-describedby="pace-note">
              <label className="setting-option"><input type="radio" name="pace-select" defaultValue="off" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" defaultValue="best" /><span>personal best</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" defaultValue="average" /><span>average</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" defaultValue="last" /><span>last run</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" defaultValue="custom" /><span>custom</span></label>
            </fieldset>
          </div>
          <label id="pace-custom" className="preference-row" htmlFor="pace-wpm" hidden>
            <span className="preference-copy"><strong>custom pace</strong><small id="pace-range" className="pace-note">10–300 wpm</small></span>
            <input className="input pace-wpm num" id="pace-wpm" type="number" min="10" max="300" step="1" defaultValue="80" inputMode="numeric" data-unit="wpm" aria-describedby="pace-range" />
          </label>
          <div className="preference-row">
            <div className="preference-copy"><strong id="speed-unit-label">speed unit</strong></div>
            <fieldset className="setting-options" id="speed-unit" aria-labelledby="speed-unit-label">
              <label className="setting-option"><input type="radio" name="speed-unit" defaultValue="wpm" defaultChecked /><span>wpm</span></label>
              <label className="setting-option"><input type="radio" name="speed-unit" defaultValue="cpm" /><span>cpm</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="daily-goal-label">daily goal</strong></div>
            <fieldset className="setting-options" id="daily-goal" aria-labelledby="daily-goal-label">
              <label className="setting-option"><input type="radio" name="daily-goal" defaultValue="0" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" defaultValue="5" /><span>5 min</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" defaultValue="10" /><span>10 min</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" defaultValue="15" /><span>15 min</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" defaultValue="30" /><span>30 min</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="train-focus-label">train focus</strong></div>
            <fieldset className="setting-options" id="train-focus" aria-labelledby="train-focus-label">
              <label className="setting-option"><input type="radio" name="train-focus" defaultValue="balanced" defaultChecked /><span>balanced</span></label>
              <label className="setting-option"><input type="radio" name="train-focus" defaultValue="accuracy" /><span>accuracy</span></label>
              <label className="setting-option"><input type="radio" name="train-focus" defaultValue="speed" /><span>speed</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="drill-length-label">drill length</strong></div>
            <fieldset className="setting-options" id="drill-length" aria-labelledby="drill-length-label">
              <label className="setting-option"><input type="radio" name="drill-length" defaultValue="15" /><span>15 s</span></label>
              <label className="setting-option"><input type="radio" name="drill-length" defaultValue="30" defaultChecked /><span>30 s</span></label>
              <label className="setting-option"><input type="radio" name="drill-length" defaultValue="60" /><span>60 s</span></label>
              <label className="setting-option"><input type="radio" name="drill-length" defaultValue="120" /><span>120 s</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="retest-toggle-label">retest after drill</strong></div>
            <fieldset className="setting-options" id="retest-toggle" aria-labelledby="retest-toggle-label">
              <label className="setting-option"><input type="radio" name="retest-toggle" defaultValue="false" /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="retest-toggle" defaultValue="true" defaultChecked /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="live-toggle-label" data-speed-unit="live {unit} and accuracy">live wpm and accuracy</strong></div>
            <fieldset className="setting-options" id="live-toggle" aria-labelledby="live-toggle-label">
              <label className="setting-option"><input type="radio" name="live-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="live-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="focus-toggle-label">focus mode</strong></div>
            <fieldset className="setting-options" id="focus-toggle" aria-labelledby="focus-toggle-label">
              <label className="setting-option"><input type="radio" name="focus-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="focus-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
        </section>
        <section id="settings-keyboard" className="settings-category" aria-labelledby="settings-keyboard-title" hidden>
          <div className="settings-intro"><h3 id="settings-keyboard-title">Keyboard</h3></div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="layout-select-label">keyboard layout</strong><small id="layout-note" className="preference-note">Doesn’t remap keys; set the layout in your system.</small></div>
            <fieldset className="setting-options" id="layout-select" aria-labelledby="layout-select-label" aria-describedby="layout-note">
              <label className="setting-option"><input type="radio" name="layout-select" defaultValue="qwerty" defaultChecked /><span>qwerty</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" defaultValue="dvorak" /><span>dvorak</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" defaultValue="colemak" /><span>colemak</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" defaultValue="colemak-dh" /><span>colemak-dh</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" defaultValue="workman" /><span>workman</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="keyboard-toggle-label">keyboard</strong></div>
            <fieldset className="setting-options" id="keyboard-toggle" aria-labelledby="keyboard-toggle-label">
              <label className="setting-option"><input type="radio" name="keyboard-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="keyboard-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row" id="finger-row">
            <div className="preference-copy"><strong id="finger-toggle-label">finger map</strong><small id="finger-note" className="preference-note">Turn on the keyboard to show its finger map.</small></div>
            <fieldset className="setting-options" id="finger-toggle" aria-labelledby="finger-toggle-label" aria-describedby="finger-note">
              <label className="setting-option"><input type="radio" name="finger-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="finger-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
        </section>
        <section id="settings-sound" className="settings-category" aria-labelledby="settings-sound-title" hidden>
          <div className="settings-intro"><h3 id="settings-sound-title">Sound</h3></div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="sound-select-label">sound</strong></div>
            <fieldset className="setting-options" id="sound-select" aria-labelledby="sound-select-label">
              <label className="setting-option"><input type="radio" name="sound-select" defaultValue="off" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="sound-select" defaultValue="clicks" /><span>clicks</span></label>
              <label className="setting-option"><input type="radio" name="sound-select" defaultValue="clicks-errors" /><span>clicks + error tick</span></label>
            </fieldset>
          </div>
          <label className="preference-row" id="sound-volume-row" htmlFor="sound-volume">
            <span className="preference-copy"><strong>volume</strong></span>
            <span className="preference-range">
              <span id="sound-volume-value" className="preference-value num" aria-hidden="true">50%</span>
              <input className="range" id="sound-volume" type="range" min="0" max="100" step="5" defaultValue="50" aria-valuetext="50%" disabled />
            </span>
          </label>
        </section>
        <section id="settings-shortcuts" className="settings-category keybindings-category" aria-labelledby="settings-shortcuts-title" hidden>
          <div className="settings-intro"><h3 id="settings-shortcuts-title">Shortcuts</h3></div>
          <p id="keybindings-help">Mod means Ctrl or ⌘. Leave blank to disable.</p>
          <form id="keybindings-form">
            <div className="keybinding-row">
              <label htmlFor="keybinding-restart">restart test / local challenge</label>
              <div className="keybinding-controls">
                <input className="input" id="keybinding-restart" name="restart" type="text" spellCheck={false} autoComplete="off" autoCapitalize="off" aria-describedby="keybindings-help keybinding-restart-error" />
                <button className="btn btn-secondary btn-sm" type="button" data-record="restart" aria-label="Record restart test / local challenge binding" aria-pressed="false">Record</button>
              </div>
              <p className="keybinding-error" id="keybinding-restart-error"></p>
            </div>
            <div className="keybinding-row">
              <label htmlFor="keybinding-commands">commands</label>
              <div className="keybinding-controls">
                <input className="input" id="keybinding-commands" name="commands" type="text" spellCheck={false} autoComplete="off" autoCapitalize="off" aria-describedby="keybindings-help keybinding-commands-error" />
                <button className="btn btn-secondary btn-sm" type="button" data-record="commands" aria-label="Record commands binding" aria-pressed="false">Record</button>
              </div>
              <p className="keybinding-error" id="keybinding-commands-error"></p>
            </div>
            <div className="keybinding-row">
              <label htmlFor="keybinding-exitFocus">exit focus mode</label>
              <div className="keybinding-controls">
                <input className="input" id="keybinding-exitFocus" name="exitFocus" type="text" spellCheck={false} autoComplete="off" autoCapitalize="off" aria-describedby="keybindings-help keybinding-exitFocus-error" />
                <button className="btn btn-secondary btn-sm" type="button" data-record="exitFocus" aria-label="Record exit focus mode binding" aria-pressed="false">Record</button>
              </div>
              <p className="keybinding-error" id="keybinding-exitFocus-error"></p>
            </div>
            <div className="keybinding-actions">
              <button className="btn btn-ghost btn-sm" type="button" data-reset-bindings="">Reset defaults</button>
            </div>
            <p id="keybindings-status" role="status" aria-live="polite"></p>
          </form>

        </section>
      </div>
    </div>
    <footer className="settings-footer">
      <p id="settings-saved">Guest settings last for this tab.</p>
      <button id="settings-done" className="btn btn-primary" type="button">Done</button>
    </footer>
  </dialog>
  );
}
