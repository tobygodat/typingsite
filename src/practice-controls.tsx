import { QuoteFilters } from './quote-filters.js';
import type { QuoteFiltersController } from './quote-filters.js';
import { useSyncExternalStore } from 'react';
import type { PracticeControlsView, PracticeSession } from './practice-session.js';
import type { Preferences } from './profile-types.js';
import { LENGTHS, isPresetLength } from './lengths.js';

function ModeButton({ mode, view, practice }: { mode: Preferences['mode']; view: PracticeControlsView; practice: PracticeSession }) {
  const selected = !view.custom && !view.composing && mode === view.mode;

  return <button id={`mode-${mode}`} type="button" data-mode={mode} aria-pressed={selected} className={selected ? 'is-active' : ''} onClick={() => practice.choices.chooseMode(mode)}>{mode}</button>;
}

export function PracticeControls({ practice, quoteFilters }: { practice: PracticeSession; quoteFilters: QuoteFiltersController }) {
  const view = useSyncExternalStore(practice.controls.subscribe, practice.controls.getSnapshot, practice.controls.getSnapshot);
  const mode = typeof view.mode === 'string' ? view.mode : '';
  const spec = LENGTHS[view.lengthMode];
  const hasLength = view.mode === 'time' || view.mode === 'words';
  const current = view.lengthValue;
  const customLength = !isPresetLength(view.lengthMode, current);
  const special = view.custom || view.composing;
  const moreLabel = view.composing ? 'compose' : view.custom ? 'custom' : ['code', 'standard', 'book'].includes(mode) ? mode : 'more';

  return (
        <div className="practice-controls" aria-label="Practice setup" hidden={!view.visible}>
          <div className="practice-rail">
            <div className="segmented glide mode-options" role="group" aria-label="Practice mode" data-glide="pressed">
              <span className="glide-pill" aria-hidden="true"></span>
              <ModeButton mode="time" view={view} practice={practice} />
              <ModeButton mode="words" view={view} practice={practice} />
              <ModeButton mode="quote" view={view} practice={practice} />
              <details id="mode-more" className="mode-more" data-active={moreLabel !== 'more' ? '' : undefined}>
                <summary id="mode-more-label">{moreLabel}</summary>
                <div className="mode-more-menu" role="group" aria-label="More practice modes">
                  <ModeButton mode="code" view={view} practice={practice} />
                  <ModeButton mode="standard" view={view} practice={practice} />
                  <ModeButton mode="book" view={view} practice={practice} />
                  <button id="mode-compose" type="button" data-compose="" aria-pressed={view.composing} className={view.composing ? 'is-active' : ''} onClick={() => practice.choices.compose()}>compose</button>
                  <button id="mode-custom" type="button" aria-pressed={view.custom} aria-controls="custom-options" aria-expanded={view.customOpen} className={view.custom ? 'is-active' : ''} onClick={() => practice.choices.custom()}>custom</button>
                  <button id="mode-drill" type="button" aria-pressed="false" aria-controls="manual-target" aria-expanded="false">drill</button>
                  <button id="open-lessons" className="mode-more-lessons" type="button" data-action="open-lessons">learn to type</button>
                </div>
              </details>
            </div>
            <div className="practice-options">
              <div id="standard-options" className="standard-options" hidden={special || view.mode !== 'standard'}>
                <p id="standard-recipe" className="condition-copy">{view.standardRecipe}</p>
              </div>
              <div id="duration-options" className="segmented compact glide" role="group" aria-label="Test length" data-glide="pressed" hidden={special || !hasLength}>
                {spec.presets.map((length, index) => <button key={index} type="button" data-length={length} aria-pressed={length === current} aria-label={`${length} ${spec.unit}`} className={length === current ? 'is-active' : ''} onClick={() => practice.choices.chooseLength(length)}>{length}</button>)}
                <button id="custom-length" type="button" className={customLength ? 'is-active' : ''} aria-pressed={customLength} aria-label={customLength ? `custom ${spec.noun}, ${current} ${spec.unit}` : `custom ${spec.noun}`}>{customLength ? current : 'custom'}</button>
                <form id="custom-length-form" className="custom-length" noValidate hidden>
                  <input id="custom-length-input" className="custom-length-input" type="text" inputMode="numeric" enterKeyHint="done" maxLength={12} autoComplete="off" spellCheck={false} placeholder="5–600" aria-label="custom time in seconds, 5 to 600" aria-describedby="custom-length-error" />
                </form>
              </div>
              <div id="quote-options" className="segmented quote-options" role="group" aria-label="Quote filters" hidden={special || view.mode !== 'quote'}>
                <QuoteFilters controller={quoteFilters} />
              </div>
              <div id="book-options" className="segmented quote-options book-options" role="group" aria-label="Book" hidden={special || view.mode !== 'book'}>
                <QuoteFilters controller={quoteFilters} books />
                <span id="book-page" className="book-page">page {view.bookPage}</span>
              </div>
              <div id="code-options" className="segmented compact glide" role="group" aria-label="Code language" data-glide="pressed" hidden={special || view.mode !== 'code'}>
                {['js', 'python', 'go', 'rust'].map((language) => <button key={language} type="button" data-language={language} aria-pressed={view.codeLanguage === language} className={view.codeLanguage === language ? 'is-active' : ''} onClick={() => practice.choices.chooseLanguage(language)}>{language}</button>)}
              </div>
            </div>
            <label id="punctuation-switch" className="compact-switch" htmlFor="punctuation-toggle" hidden={special}>
              <input id="punctuation-toggle" className="switch" type="checkbox" checked={view.mode === 'standard' || view.punctuation} disabled={['quote', 'code', 'book', 'standard'].includes(mode)} onChange={(event) => practice.choices.punctuation(event.currentTarget.checked)} />
              <span>punctuation</span>
            </label>
            <label id="adaptive-switch" className="compact-switch" htmlFor="adaptive-toggle" hidden={special || !['time', 'words'].includes(mode)}>
              <input id="adaptive-toggle" className="switch" type="checkbox" checked={view.adaptive} onChange={(event) => practice.choices.adaptive(event.currentTarget.checked)} />
              <span>adaptive</span>
            </label>
          </div>
          <p id="custom-length-error" className="field-error custom-length-error" role="alert"></p>
          <span id="minimum-note" className="minimum-note" hidden></span>
        </div>

  );
}
