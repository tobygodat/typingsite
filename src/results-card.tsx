import { Fragment, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CopyPart, PracticeSession, ResultView, ResultWord } from './practice-session.js';
import { formatSpeed, unitText } from './units.js';

export function Copy({ parts }: { parts: readonly CopyPart[] }) {
  return parts.map((part, index) => typeof part === 'string' ? <Fragment key={index}>{part}</Fragment>
    : <data key={index} value={part.wpm} data-wpm={part.wpm} data-bare={part.bare ? '' : undefined} data-signed={part.signed ? '' : undefined} data-whole={part.whole ? '' : undefined}>{formatSpeed(part.wpm, part)}</data>);
}

function ResultWords({ result }: { result: ResultView | null }) {
  const [selected, select] = useState<number | null>(null);
  const words = useRef<(HTMLSpanElement | null)[]>([]);
  useLayoutEffect(() => { select(null); }, [result?.id]);
  const items = result?.words ?? [];
  const item = selected === null ? null : items[selected];
  const pace = (word: ResultWord) => word.wpm === null ? 'no pace' : formatSpeed(word.wpm);

  function choose(index: number, focus = false) {
    const next = Math.max(0, Math.min(index, items.length - 1));
    select(next);

    if (focus) words.current[next]?.focus();
  }

  return <>
    <div id="result-words" className="run-card-words" role="listbox" aria-label="Words typed; mistyped words are marked. Arrow keys move between words.">
      {items.map((word, index) => <Fragment key={index}>{index ? ' ' : ''}<span ref={(node) => { words.current[index] = node; }} role="option" data-index={index} className={word.wrong ? 'word-miss' : ''} tabIndex={index === (selected ?? 0) ? 0 : -1} aria-selected={index === selected} aria-label={`${word.word}, ${pace(word)}${word.wrong ? ', mistyped' : ''}`} title={pace(word)} onFocus={() => choose(index)} onClick={() => choose(index, true)} onKeyDown={(event) => {
        const next = { ArrowLeft: index - 1, ArrowUp: index - 1, ArrowRight: index + 1, ArrowDown: index + 1, Home: 0, End: items.length - 1 }[event.key];

        if (next === undefined) return;
        event.preventDefault();
        choose(next, true);
      }}>{word.word}</span></Fragment>)}
    </div>
    <p id="result-word-detail" className="word-detail">{item && <>“{item.word}” · {item.wpm === null ? 'no pace' : <Copy parts={[{ kind: 'speed', wpm: item.wpm }]} />}{item.wrong ? ' · mistyped' : ''}</>}</p>
  </>;
}

export function ResultsCard({ practice }: { practice: PracticeSession }) {
  const result = useSyncExternalStore(practice.result.subscribe, practice.result.getSnapshot, practice.result.getSnapshot);
  const { commands } = practice;

  return <>
    <header className="section-heading result-heading">
      <h2 id="results-heading" className={result?.counted === false ? '' : 'sr-only'} tabIndex={-1} onKeyDown={(event) => commands.headingKeyDown(event.nativeEvent)}><span id="result-delta">{result ? <Copy parts={result.headline} /> : 'No run yet.'}</span></h2>
      <p id="result-comparison-note" className="result-note">{result && <Copy parts={result.note} />}</p>
    </header>
    <article id="run-card" className="run-card" aria-label="Run summary" hidden={!result}>
      <div className="run-card-head">
        <div className="run-card-score">
          <strong id="result-wpm" className="num" data-bare="" data-wpm={result?.wpm ?? undefined}>{result?.wpm === null || !result ? '—' : formatSpeed(result.wpm, { bare: true })}</strong>
          <span className="run-card-unit" data-speed-unit="">{unitText('{unit}')}</span>
        </div>
        <div className="run-card-side">
          <dl className="run-card-facts">
            <div id="result-accuracy-fact" title={result?.accuracyTitle}><dt>accuracy</dt><dd><strong id="result-accuracy" className="num">{result?.accuracy ?? '—'}</strong><b>%</b></dd></div>
            <div><dt>time</dt><dd id="result-time" className="num">{result ? <>{result.seconds}<b> s</b></> : '—'}</dd></div>
            <div title="100 minus the variation of your per-second raw speed; needs 3 seconds"><dt>consistency</dt><dd><strong id="result-consistency" className="num">{result?.consistency ?? '—'}</strong><b hidden={result?.consistency === null}>%</b></dd></div>
          </dl>
          <p id="result-standing" className="run-card-standing" hidden={!result?.standing.length}>{result && <Copy parts={result.standing} />}</p>
        </div>
      </div>
      <figure className="run-card-graph" hidden={result?.graph === false}>
        <div id="speed-graph" className="speed-graph" role="img" aria-label="Speed over time"></div>
      </figure>
      <div className="run-card-wordlist">
        <ResultWords result={result} />
        <button id="practice-words" className="run-card-practice" type="button" data-action="practice-words" hidden={!result?.practiceWords.length} onClick={commands.practiceWords}>{result?.practiceWords.length === 1 ? 'Practice this word' : result ? `Practice these ${result.practiceWords.length} words` : 'Practice missed words'}</button>
      </div>
      <div className="result-actions">
        <div className="result-buttons">
          <button id="run-again" className="btn btn-primary" type="button" data-action="run-again" onClick={commands.runAgain} onKeyDown={(event) => commands.resultKeyDown(event.nativeEvent)} onKeyUp={(event) => commands.resultKeyUp(event.nativeEvent)}>{result?.againLabel ?? 'Run again'}</button>
          <button id="result-drill" className="btn btn-secondary" type="button" hidden={!result?.drillLabel} onClick={commands.drill}>{result?.drillLabel ?? 'Drill'}</button>
          <button id="watch-replay" className="btn btn-ghost" type="button" data-action="watch-replay" hidden={!result?.replay} onClick={commands.watchReplay}>Watch replay</button>
        </div>
        <p className="condition-copy" id="result-conditions">{result ? <Copy parts={result.conditions} /> : 'english · common words'}</p>
      </div>
    </article>
  </>;
}
