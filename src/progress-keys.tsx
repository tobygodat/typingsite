import { useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { keyAnalysis, MIN_PATTERN_SAMPLES } from './insights.js';
import { createStore } from './store.js';

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const STEPS = [{ step: '0', min: 0, label: 'no misses' }, { step: '1', min: Number.MIN_VALUE, label: 'under 4%' }, { step: '2', min: 0.04, label: '4–8%' }, { step: '3', min: 0.08, label: '8% or more' }];
const NONE = { step: 'none', label: `under ${MIN_PATTERN_SAMPLES} samples` };
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export function createProgressKeys() {
  const view = createStore({ picture: false, analysis: keyAnalysis([]), note: '' });

  return {
    view,
    show(runs: readonly unknown[], picture: boolean) {
      const analysis = keyAnalysis(runs);
      const older = analysis.pairDerivedRuns;
      const count = analysis.runs;

      const note = count ? `First-try misses per key · ${count} run${count === 1 ? '' : 's'}${older ? ` · ${older} older ${older === 1 ? 'run skips' : 'runs skip'} first letters` : ''}`
        : runs.length ? `No keystroke detail in ${runs.length === 1 ? 'this run' : `these ${runs.length} runs`} yet. Fresh-text runs from now on fill in the map.` : 'No runs at these conditions in this period.';

      flushSync(() => view.publish({ analysis, picture, note }));
    },
  };
}

export type ProgressKeysController = ReturnType<typeof createProgressKeys>;

export function ProgressKeys({ controller }: { controller: ProgressKeysController }) {
  const { analysis, picture, note } = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const [selected, select] = useState<string | null>(null);
  const cells = useRef(new Map<string, HTMLSpanElement>());
  const stat = selected ? analysis.keys[selected] : undefined;

  const detail = !selected ? '' : stat?.enough ? `“${selected}”: ${pct(stat.missRate)} first-try misses (${stat.errors} of ${stat.samples} samples).`
    : `“${selected}”: ${stat?.samples || 0} ${stat?.samples === 1 ? 'sample' : 'samples'}, fewer than ${MIN_PATTERN_SAMPLES}, so no miss rate yet.`;

  const top = Math.max(...analysis.pairs.map((pair) => pair.missRate));

  function choose(letter: string | null, focus = false) { select(letter);

 if (focus && letter && !picture) cells.current.get(letter)?.focus(); }

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;

    if (!(target instanceof HTMLElement)) return;
    const letter = target.closest<HTMLElement>('.key')?.dataset.letter;

    if (!letter) return;
    const row = ROWS.findIndex((letters) => letters.includes(letter));
    const letters = ROWS[row];

    if (!letters) return;
    const col = letters.indexOf(letter);

    const at = (r: number, c: number) => { const letters = ROWS[r];

 return letters?.[Math.max(0, Math.min(c, letters.length - 1))]; };

    let next: string | undefined;

    switch (event.key) {
      case 'ArrowLeft': if (col > 0) next = at(row, col - 1); break;
      case 'ArrowRight': if (col < letters.length - 1) next = at(row, col + 1); break;
      case 'ArrowUp': if (row > 0) next = at(row - 1, col); break;
      case 'ArrowDown': if (row < ROWS.length - 1) next = at(row + 1, col); break;
      case 'Home': next = at(event.ctrlKey ? 0 : row, 0); break;
      case 'End': next = event.ctrlKey ? ROWS[ROWS.length - 1]?.slice(-1) : at(row, letters.length - 1); break;
      default: return;
    }

    event.preventDefault();

    if (next) choose(next, true);
  }

  return <><p id="key-note" className="result-note">{note}</p><div id="keys-layout" className="keys-layout" hidden={!analysis.runs}><div className="keys-map"><div id="key-heatmap" className="keyboard key-heatmap" role={picture ? undefined : 'grid'} aria-hidden={picture ? 'true' : undefined} aria-label="Miss rate by key. Arrow keys move between keys." onKeyDown={move}>{ROWS.map((letters) => <div key={letters} className="key-row" role={picture ? undefined : 'row'}>{[...letters].map((letter) => {
    const stat = analysis.keys[letter];
    const step = stat?.enough ? STEPS.filter((step) => stat.missRate >= step.min).slice(-1)[0] ?? NONE : NONE;
    const title = stat?.enough ? `${letter}: ${pct(stat.missRate)} miss · ${stat.samples} samples` : `${letter}: not enough samples (${stat?.samples || 0})`;

    return <span key={letter} ref={(node) => { if (node) cells.current.set(letter, node); else cells.current.delete(letter); }} className="key" data-letter={letter} data-heat={step.step} data-selected={selected === letter ? 'true' : undefined} role={picture ? undefined : 'gridcell'} tabIndex={picture ? undefined : (selected ?? 'q') === letter ? 0 : -1} title={title} aria-label={picture ? undefined : title} onFocus={() => { if (selected !== letter) choose(letter); }} onClick={() => { if (!picture) choose(letter, true); }}>{letter}{stat && step.step !== 'none' && step.step !== '0' && <span className="key-rate" aria-hidden="true">{stat.missRate >= 0.1 ? `${Math.round(stat.missRate * 100)}%` : pct(stat.missRate)}</span>}</span>;
  })}</div>)}</div><ul id="heat-legend" className="heat-legend" aria-hidden="true">{[...STEPS, NONE].map((step) => <li key={step.step} data-heat={step.step}>{step.label}</li>)}</ul><label id="key-select-field" className="filter-field key-select-field" htmlFor="key-select" hidden={!picture}>Key<select id="key-select" className="input" value={selected ?? ''} onChange={(event) => choose(event.currentTarget.value || null)}><option value="">Choose a key</option>{[...'abcdefghijklmnopqrstuvwxyz'].map((letter) => <option key={letter} value={letter}>{letter}</option>)}</select></label><p id="key-detail" className="result-note key-detail">{detail}</p></div><div className="keys-pairs"><h3 className="pairs-heading">Pairs to watch</h3><p id="pairs-empty" className="result-note" hidden={Boolean(analysis.pairs.length)}>Not enough data yet.</p><table id="pairs-table" className="pairs-table" hidden={!analysis.pairs.length}><thead><tr><th scope="col">pair</th><th scope="col">error rate</th><th scope="col">slow runs</th><th scope="col">samples</th></tr></thead><tbody>{analysis.pairs.map((pair) => {
    const title = pair.timedRuns ? `Slower than your median in ${pair.slowRuns} of ${pair.timedRuns} ${pair.timedRuns === 1 ? 'run' : 'runs'} with at least ${MIN_PATTERN_SAMPLES} clean intervals` : `No run has ${MIN_PATTERN_SAMPLES} clean intervals for this pair yet`;

    return <tr key={pair.pair}><td>“{pair.pair}”</td><td className="num">{pct(pair.missRate)} ({pair.errors})<span className="pair-bar" aria-hidden="true" style={{ width: `${top ? pair.missRate / top * 100 : 0}%` }}></span></td><td className="num" title={title}>{pair.timedRuns ? `${pair.slowRuns} of ${pair.timedRuns}` : '—'}{!pair.timedRuns && <span className="sr-only"> {title}</span>}</td><td className="num">{pair.samples}</td></tr>;
  })}</tbody></table></div></div></>;
}
