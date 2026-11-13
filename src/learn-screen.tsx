import { useSyncExternalStore } from 'react';
import type { LearningStore } from './learning-store.js';
import { Copy } from './results-card.js';
import { LessonKeyboard } from './practice-keyboard.js';
import type { PracticeKeyboardController } from './practice-keyboard.js';
import { unitText } from './units.js';

export function LearnScreen({ learning, keyboard, visible = false }: { learning: LearningStore; keyboard: PracticeKeyboardController; visible?: boolean }) {
  const view = useSyncExternalStore(learning.lessons.subscribe, learning.lessons.getSnapshot, learning.lessons.getSnapshot);

  return <section id="learn-screen" className="screen" data-screen="learn" aria-labelledby="learn-heading" hidden={!visible}>
    <header className="section-heading page-heading"><h1 id="learn-heading">Learn to type</h1></header>
    <div className="learn-layout">
      <section id="lesson-current" className="lesson-current" aria-labelledby="lesson-current-heading">
        <p id="lesson-status" className={`status badge ${view?.status?.tone ?? ''}`} hidden={!view?.status}><span className="status-dot" aria-hidden="true"></span><span id="lesson-status-word">{view?.status?.label}</span></p>
        <h2 id="lesson-current-heading">{view ? <Copy parts={view.heading} /> : 'Lesson 1'}</h2>
        <p id="lesson-current-copy">{view?.copy}</p>
        <dl id="lesson-facts" className="lesson-facts" hidden={!view?.facts.length}>{view?.facts.map((fact) => <div key={fact.label}>
          <dt>{fact.speedUnit ? <span data-speed-unit="">{unitText('{unit}')}</span> : fact.label}</dt><dd className="num"><Copy parts={fact.value} /></dd>
          {Boolean(fact.need.length) && <dd className="lesson-need num"><Copy parts={fact.need} /></dd>}
          {fact.met !== null && <dd className={`status badge ${fact.met ? 'badge-success' : 'badge-neutral'}`}><span className="status-dot" aria-hidden="true"></span>{fact.met ? 'met' : 'not met'}</dd>}
        </div>)}</dl>
        <p id="lesson-current-meta" className="condition-copy">{view && <Copy parts={view.meta} />}</p>
        <div className="lesson-actions">
          <button id="lesson-primary" className="btn btn-primary" type="button" onClick={() => learning.commands.lessonPrimary()}>{view?.primary ?? 'Start lesson 1'}</button>
          <button id="lesson-secondary" className="btn btn-ghost" type="button" hidden={!view?.secondary} onClick={() => learning.commands.lessonSecondary()}>{view?.secondary}</button>
        </div>
      </section>
      <figure className="finger-figure">
        <LessonKeyboard controller={keyboard} known={view?.known ?? []} fresh={view?.fresh ?? []} />
        <figcaption className="finger-caption"><span id="finger-caption-keys">{view?.caption}</span></figcaption>
      </figure>
    </div>
    <section className="lesson-list-section" aria-labelledby="lesson-list-heading">
      <h2 id="lesson-list-heading">Lessons</h2><p id="lesson-save-note" className="result-note">{view?.saveNote}</p>
      <ol id="lesson-list" className="lesson-list">{view?.rows.map((row) => <li key={row.id} className="lesson-row" data-state={row.state}>
        <span className="lesson-number num">{row.index + 1}</span><div className="lesson-row-main"><span className="lesson-keys">{row.keys.map((key) => <kbd key={key}>{key}</kbd>)}</span><span className="lesson-row-note">{row.fingers}</span></div>
        <div className="lesson-row-detail"><span className={`lesson-row-state status badge ${row.state === 'passed' ? 'badge-success' : row.state === 'next' ? 'badge-info' : 'badge-neutral'}`}><span className="status-dot" aria-hidden="true"></span>{row.state}</span><span className="lesson-row-numbers num"><Copy parts={row.numbers} /></span></div>
        {row.action && <button className="btn btn-ghost btn-sm" type="button" aria-label={row.actionLabel} onClick={() => learning.commands.lesson(row.index)}>{row.action}</button>}
      </li>)}</ol>
    </section>
  </section>;
}
