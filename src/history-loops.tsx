import { useSyncExternalStore } from 'react';
import type { LearningStore } from './learning-store.js';
import { Copy } from './results-card.js';
import { formatSpeed, unitText } from './units.js';

export function HistoryLoops({ learning }: { learning: LearningStore }) {
  const loops = useSyncExternalStore(learning.loops.subscribe, learning.loops.getSnapshot, learning.loops.getSnapshot);

  return <>
    <p id="history-empty" className="result-note" hidden={Boolean(loops.length)}>None in this period.</p>
    <div id="history-list" className="history-list" aria-live="polite" hidden={!loops.length}>
      {loops.map((loop, index) => <details key={loop.id ?? index} className="history-row">
        <summary className="history-summary">
          <div className="history-main"><span className="history-date">{loop.date}</span><strong className="history-target">{loop.title}</strong><small className="history-conditions">{loop.conditions}</small></div>
          <div className="history-measure"><span>Accuracy</span><strong className="history-accuracy num">{loop.accuracy}</strong></div>
          <div className="history-measure"><span><span data-speed-unit="Corrected {unit}">{unitText('Corrected {unit}')}</span></span><strong className="history-timing num"><data value={loop.delta === null || loop.delta === undefined ? '' : String(loop.delta)} data-wpm={loop.delta === null || loop.delta === undefined ? undefined : String(loop.delta)} data-signed="">{loop.delta === null || loop.delta === undefined ? '—' : formatSpeed(Number(loop.delta), { signed: true })}</data></strong></div>
          <span className={`history-status badge ${`badge-${loop.tone}`}`}>{loop.state}</span>
        </summary>
        <div className="history-detail">
          <dl>{loop.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd className="num"><Copy parts={fact.parts} /></dd></div>)}</dl>
          {loop.notes.map((note, index) => <p key={index}><Copy parts={note} /></p>)}
          {loop.target && <button type="button" className="btn btn-secondary" onClick={loop.practice}>Practice “{loop.target}” again</button>}
        </div>
      </details>)}
    </div>
  </>;
}
