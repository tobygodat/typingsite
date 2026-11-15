import { Fragment, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CopyPart, PracticeSession, ResultView, ResultWord } from './practice-session.js';
import { formatSpeed, unitText } from './units.js';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

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
  const versus = result?.versus;
  const missed = result?.words.filter((word) => word.wrong).length ?? 0;

  return <>
    <header className="section-heading result-heading">
      <h2 id="results-heading" className={result?.counted === false ? '' : 'sr-only'} tabIndex={-1} onKeyDown={(event) => commands.headingKeyDown(event.nativeEvent)}><span id="result-delta">{result ? <Copy parts={result.headline} /> : 'No run yet.'}</span></h2>
      <p id="result-comparison-note" className="result-note">{result && <Copy parts={result.note} />}</p>
    </header>
    <article id="run-card" className="run-card" aria-label="Run summary" hidden={!result}>
      <dl className="cells run-card-facts">
        <div className="cell run-card-score">
          <dt className="cell-label run-card-unit" data-speed-unit="">{unitText('{unit}')}</dt>
          <dd>
            <p className="cell-value"><strong id="result-wpm" className="num cell-figure" data-bare="" data-wpm={result?.wpm ?? undefined}>{result?.wpm === null || !result ? '—' : formatSpeed(result.wpm, { bare: true })}</strong></p>
            {versus && <span id="result-versus" className="cell-note"><span className={versus.change < 0 ? 'is-down' : 'is-up'}><Copy parts={[{ kind: 'speed', wpm: versus.change, bare: true, signed: true }]} /></span> vs avg <Copy parts={[{ kind: 'speed', wpm: versus.average, bare: true, whole: true }]} /></span>}
          </dd>
        </div>
        <div id="result-accuracy-fact" className="cell" title={result?.accuracyTitle}><dt className="cell-label">accuracy</dt><dd><p className="cell-value"><strong id="result-accuracy" className="num cell-figure">{result?.accuracy ?? '—'}</strong><i className="cell-unit">%</i></p>{result && <span className="cell-note">{missed} missed</span>}</dd></div>
        <div className="cell"><dt className="cell-label">time</dt><dd><p id="result-time" className="cell-value num">{result ? <><b className="cell-figure">{result.seconds}</b><i className="cell-unit"> s</i></> : '—'}</p>{result && <span className="cell-note">{plural(result.words.length, 'word')}</span>}</dd></div>
        <div className="cell" title="100 minus the variation of your per-second raw speed; needs 3 seconds"><dt className="cell-label">consistency</dt><dd><p className="cell-value"><strong id="result-consistency" className="num cell-figure">{result?.consistency ?? '—'}</strong><i className="cell-unit" hidden={result?.consistency === null}>%</i></p>{result?.range && <span id="result-range" className="cell-note"><Copy parts={[{ kind: 'speed', wpm: result.range.low, bare: true }, '–', { kind: 'speed', wpm: result.range.high }]} /></span>}</dd></div>
      </dl>
      <section className="panel run-card-trace" aria-labelledby="speed-title" hidden={result?.graph === false}>
        <header className="panel-head"><h3 id="speed-title" className="panel-title">speed</h3><span className="trace-legend" aria-hidden="true"><i className="legend-average"></i>{result?.wpm === null || !result ? 'average' : <Copy parts={[{ kind: 'speed', wpm: result.wpm }]} />}<i className="legend-miss"></i>mistake</span></header>
        <figure className="run-card-graph">
          <div id="speed-graph" className="speed-graph" role="img" aria-label="Speed over time"></div>
        </figure>
      </section>
      <section className="panel run-card-wordlist" aria-labelledby="typed-title">
        <header className="panel-head"><h3 id="typed-title" className="panel-title">typed</h3><button id="practice-words" className="run-card-practice" type="button" data-action="practice-words" hidden={!result?.practiceWords.length} onClick={commands.practiceWords}>{result?.practiceWords.length === 1 ? 'Practice this word' : result ? `Practice these ${result.practiceWords.length} words` : 'Practice missed words'}</button></header>
        <ResultWords result={result} />
      </section>
      <div className="result-actions">
        <div className="result-buttons">
          <button id="run-again" className="btn btn-primary" type="button" data-action="run-again" onClick={commands.runAgain} onKeyDown={(event) => commands.resultKeyDown(event.nativeEvent)} onKeyUp={(event) => commands.resultKeyUp(event.nativeEvent)}>{result?.againLabel ?? 'Run again'}</button>
          <button id="result-drill" className="btn btn-secondary" type="button" hidden={!result?.drillLabel} onClick={commands.drill}>{result?.drillLabel ?? 'Drill'}</button>
          <button id="watch-replay" className="btn btn-ghost" type="button" data-action="watch-replay" hidden={!result?.replay} onClick={commands.watchReplay}>Watch replay</button>
        </div>
        <div className="result-context">
          <p className="condition-copy" id="result-conditions">{result ? <Copy parts={result.conditions} /> : 'english · common words'}</p>
        </div>
      </div>
    </article>
  </>;
}
