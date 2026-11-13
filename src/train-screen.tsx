import { Component, Fragment, createRef, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import type { LearningStore, TrainView } from './learning-store.js';
import { aheadCopy, behindCopy } from './train-path.js';
import { formatSpeed, unitText } from './units.js';

const FIGURE = /(?:\d+(?:%| of \d+)(?: missed)?|\d+ ms (?:slower|faster)|\d+ (?:clean )?intervals?|at your pace)(?: →)?/g;

function Figures({ text }: { text: string }) {
  let at = 0;
  const parts = [];

  for (const match of text.matchAll(FIGURE)) {
    parts.push(<Fragment key={match.index}>{text.slice(at, match.index)}<span className="path-figure">{match[0]}</span></Fragment>);
    at = match.index + match[0].length;
  }

  return <>{parts}{text.slice(at)}</>;
}

function Comparison({ learning }: { learning: LearningStore }) {
  const value = useSyncExternalStore(learning.comparison.subscribe, learning.comparison.getSnapshot, learning.comparison.getSnapshot);
  const train = useSyncExternalStore(learning.train.subscribe, learning.train.getSnapshot, learning.train.getSnapshot);

  return <li id="comparison-panel" className={`path-step is-behind is-just${value.compared ? '' : ' is-uncompared'}`} data-outcome={value.outcome} hidden={!train?.hasComparison}>
    <div className="path-head"><span className="path-node" aria-hidden="true"></span><span id="comparison-unit" className="path-unit">{value.unit}</span></div>
    <h2 id="comparison-status" tabIndex={-1}>{value.heading}</h2>
    <dl className="comparison-rows">
      <div id="comparison-target-row" hidden={!value.target}><dt id="comparison-target-label">{value.target?.label ?? 'missed'}</dt><dd><strong id="comparison-target" className="num">{value.target?.value ?? '—'}</strong><span id="comparison-target-was">{value.target?.was}</span></dd></div>
      <div><dt>accuracy</dt><dd><strong className="num"><span id="comparison-accuracy-now">{value.accuracy ?? '—'}</span><b>%</b></strong><span id="comparison-accuracy" className="num">{value.accuracyDelta}</span></dd></div>
      <div><dt data-speed-unit="">{unitText('{unit}')}</dt><dd><strong id="comparison-wpm-now" className="num" data-bare="" data-wpm={value.wpm ?? undefined}>{value.wpm === null ? '—' : formatSpeed(value.wpm, { bare: true })}</strong><span id="comparison-wpm" className="num" data-bare="" data-signed="" data-wpm={value.wpmDelta ?? undefined}>{value.wpmDelta === null ? '—' : formatSpeed(value.wpmDelta, { bare: true, signed: true })}</span></dd></div>
    </dl>
    <p id="comparison-conditions" className="condition-copy">{value.conditions}</p>
    <p id="comparison-caveat">{value.caveat}</p>
  </li>;
}

interface PathSnapshot {
  had: HTMLElement | null;
  unit: string | undefined;
  fromEnd: number;
}

interface PathStyle extends CSSProperties { '--open': string; '--columns': string }

interface PathState { unused?: never }

class TrainPath extends Component<{ view: TrainView | null; learning: LearningStore }, PathState, PathSnapshot | null> {
  list = createRef<HTMLOListElement>();

  getSnapshotBeforeUpdate(): PathSnapshot | null {
    const list = this.list.current;

    if (!list) return null;
    const had = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;

    return { had, unit: had?.closest<HTMLElement>('[data-unit]')?.dataset.unit, fromEnd: list.scrollWidth - list.scrollLeft };
  }

  componentDidUpdate(_previous: Readonly<{ view: TrainView | null; learning: LearningStore }>, _state: Readonly<PathState>, snapshot: PathSnapshot | null) {
    const list = this.list.current;
    const view = this.props.view;

    if (!list || !view) return;
    list.scrollLeft = view.fresh || view.advance ? list.scrollWidth : list.scrollWidth - (snapshot?.fromEnd ?? list.clientWidth);

    if (list.scrollWidth > list.clientWidth + 1) list.tabIndex = 0;
    else list.removeAttribute('tabindex');
    list.toggleAttribute('data-more-behind', list.scrollLeft > 1);
    list.toggleAttribute('data-more-ahead', list.scrollLeft < list.scrollWidth - list.clientWidth - 1);

    if (view.fresh && matchMedia('(max-width: 900px)').matches) list.querySelector('.train-actions')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });

    if (snapshot?.had) {
      const open = list.querySelector<HTMLButtonElement>(view.path.just && view.path.current.kind === 'targeted' ? '#comparison-next' : '#start-drill');
      const same = snapshot.unit ? list.querySelector<HTMLButtonElement>(`[data-unit="${CSS.escape(snapshot.unit)}"] .path-choose`) : snapshot.had;
      const back = same?.isConnected && same.getClientRects().length && (same !== list || list.tabIndex === 0) ? same : open;
      back?.focus({ preventScroll: true });
    }

    list.classList.remove('is-advancing');

    if (view.advance) {
      list.style.setProperty('--advance', `${parseFloat(getComputedStyle(list).gridTemplateColumns)}px`);
      void list.offsetWidth;
      list.classList.add('is-advancing');
    }
  }

  render() {
    const { view, learning } = this.props;
    const path = view?.path;
    const current = path?.current;
    const before = (path?.behind.length ?? 0) + (path?.just ? 2 : 0);
    const places = current?.kind === 'general' ? 3 : 0;
    const head = (unit: string | null) => <div className="path-head"><span className="path-node" aria-hidden="true"></span><span className="path-unit">{unit}</span></div>;
    const style: PathStyle = { '--open': String(before + 1), '--columns': String(Math.max(6, before + 1 + (path?.ahead.length ?? 0) + places)) };

    return <ol ref={this.list} id="train-path" className="train-path" aria-label="Path" style={style}>
      {path?.behind.map((step, index) => <li key={step.loopId} className={`path-step is-behind is-${step.state}`} data-unit={step.unit} data-early={path.behind.length - index > 2 - (path.just ? 1 : 0) ? '' : undefined}>
        <div className="path-head"><span className="path-node" aria-hidden="true"></span><span className="path-unit">{step.unit}<span className="sr-only">, </span><span className={`path-status status badge-${step.state === 'fixed' ? 'success' : 'neutral'}`}>{step.state}</span></span></div>
        {behindCopy(step).map((line, i) => <p key={i} className="path-line" data-text={line}><Figures text={line} /></p>)}
      </li>)}
      <Comparison key="comparison" learning={learning} />
      <li key="current" id="train-current" className="path-step is-current" aria-current="step">
        <div className="path-head"><span className="path-node" aria-hidden="true"></span><span id="train-unit" className="path-unit">{view?.named ? current?.unit : current?.title ?? 'General drill'}</span></div>
        <div id="train-next" className="train-open">
          <p id="train-evidence" className="train-evidence" data-text={view?.evidence} hidden={!view?.evidence}><Figures text={view?.evidence ?? ''} /></p>
          <p id="train-last" className="train-last" data-text={view?.since} hidden={!view?.since}><Figures text={view?.since ?? ''} /></p>
          <p id="train-words" className="train-words" hidden={!view?.words.length}>{view?.words.map((word) => {
            const unit = current?.unit ?? '';
            const at = word.indexOf(unit);

            return <span key={word}>{word.slice(0, at)}<b>{unit}</b>{word.slice(at + unit.length)}</span>;
          })}</p>
          <div className="train-actions">
            <button id="start-drill" className="btn btn-primary" type="button" data-action="start-drill" hidden={view?.next} onClick={() => learning.commands.start()}>{view?.startLabel ?? 'Drill and retest'}</button>
            <button id="comparison-next" className="btn btn-primary" type="button" hidden={!view?.next} onClick={() => learning.commands.next()}>Next: “{current?.unit}”</button>
            <span id="train-starts" className="condition-copy">{view?.starts}</span>
            <button id="comparison-back" className="btn btn-ghost" type="button" hidden={!view?.hasComparison} onClick={() => learning.commands.back()}>Back to practice</button>
          </div>
        </div>
      </li>
      {path?.ahead.map(({ unit, was }) => <li key={unit} className="path-step is-ahead" data-unit={unit}>
        <button className="path-choose" type="button" aria-label={`Drill ${unit}, ${(was ? aheadCopy(was) : '')}`} onClick={() => learning.commands.target(unit)}>
          <span className="path-head"><span className="path-node" aria-hidden="true"></span><span className="path-unit">{unit}</span></span><span className="path-line" data-text={(was ? aheadCopy(was) : '')}><Figures text={(was ? aheadCopy(was) : '')} /></span>
        </button>
      </li>)}
      {Array.from({ length: places }, (_, index) => <li key={`place-${index}`} className="path-step is-ahead is-place" aria-hidden="true">{head(null)}</li>)}
    </ol>;
  }
}

export function TrainScreen({ learning, visible = false }: { learning: LearningStore; visible?: boolean }) {
  const view = useSyncExternalStore(learning.train.subscribe, learning.train.getSnapshot, learning.train.getSnapshot);

  return <section id="train-screen" className="screen train-screen" data-screen="train" aria-labelledby="train-heading" hidden={!visible}>
    <h1 id="train-heading" className="sr-only" tabIndex={-1}>{view?.path.current.title ?? 'General drill'}</h1>
    <TrainPath view={view} learning={learning} />
  </section>;
}
