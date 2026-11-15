import { Component, Fragment, createRef, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import type { LearningStore, StepDetail, TrainView } from './learning-store.js';
import { costText, perMinuteText, plotAt, readText, wonText } from './train-cost.js';
import { aheadCopy } from './train-path.js';
import type { Drilled, Read, Timings, Todo } from './train-cost.js';
import { formatSpeed, unitText } from './units.js';

// Train (TOB-470): the queue of steps still to do, with what each costs, the steps drilled folded under it with what
// each won back, and the chosen step's detail beside them. The open step is chosen when the page opens, and the step
// just retested while its comparison shows.

type Step =
  | { kind: 'current'; key: 'current' }
  | { kind: 'just'; key: 'just'; unit: string }
  | { kind: 'ahead'; key: string; unit: string; figures: Todo; index: number; evidence: string }
  | { kind: 'behind'; key: string; unit: string; figures: Drilled | undefined; state: string };

const OPEN: Step = { kind: 'current', key: 'current' };

const FIGURE = /(?:\d+(?:%| of \d+)(?: missed)?|\d+ ms (?:slower|faster)|\d+ (?:clean )?intervals?|at your pace)(?: →)?/g;

function Figures({ text }: { text: string }) {
  let at = 0;
  const parts = [];

  for (const match of text.matchAll(FIGURE)) {
    parts.push(<Fragment key={match.index}>{text.slice(at, match.index)}<span className="train-figure">{match[0]}</span></Fragment>);
    at = match.index + match[0].length;
  }

  return <>{parts}{text.slice(at)}</>;
}

const kindOf = (unit: string) => (unit.length === 1 ? 'key' : 'pair');
const shownUnit = () => unitText('{unit}');

function Marked({ word, unit }: { word: string; unit: string | null }) {
  const at = unit ? word.indexOf(unit) : -1;

  return at < 0 || !unit ? <span>{word}</span> : <span>{word.slice(0, at)}<b>{unit}</b>{word.slice(at + unit.length)}</span>;
}

function Cost({ wpm }: { wpm: number | null }) {
  return wpm === null ? <span className="q-cost">—</span>
    : <span className="q-cost"><data value={wpm}>{costText(wpm, shownUnit())}</data> <span data-speed-unit="">{shownUnit()}</span></span>;
}

function Won({ wpm }: { wpm: number | null }) {
  return wpm === null ? <span className="q-cost"></span>
    : <span className={`q-cost${wpm > 0 ? ' is-up' : ''}`}><data value={wpm}>{wonText(wpm, shownUnit())}</data> <span data-speed-unit="">{shownUnit()}</span></span>;
}

function Cell({ label, figure, unit = '', note = '', id }: { label: string; figure: string; unit?: string; note?: string; id?: string }) {
  return <div className="cell" id={id}>
    <span className="cell-label">{label}</span>
    <p className="cell-value"><b className="cell-figure">{figure}</b>{unit && <i className="cell-unit">{unit}</i>}</p>
    {note && <span className="cell-note">{note}</span>}
  </div>;
}

const readCell = (label: string, read: Read | null, note = '') => (read?.basis === 'slow'
  ? <Cell key={label} label={label === 'missed' ? 'slower' : label} figure={readText(read)} unit="ms" note={note} />
  : <Cell key={label} label={label} figure={read ? readText(read) : '—'} note={note} />);

interface PlotStyle extends CSSProperties { '--tall': string }

interface DotStyle extends CSSProperties { '--stack': string }

function TimingPlot({ timings }: { timings: Timings }) {
  const { unit, pace, own, low, high } = timings;
  const flipped = own < pace;
  const plot: PlotStyle = { '--tall': String(timings.tall) };
  const dot = (left: number, stack: number): DotStyle => ({ left: `${left}%`, '--stack': String(stack) });

  return <section className="panel train-timings" aria-labelledby="train-timings-title">
    <header className="panel-head"><h3 id="train-timings-title" className="panel-title">timings, ms</h3><span className="panel-note">{timings.intervals} in {timings.runs} {timings.runs === 1 ? 'run' : 'runs'}</span></header>
    <div className={`timing-plot${flipped ? ' is-flipped' : ''}`} role="img" aria-label={`${unit}: ${own} ms against your pace of ${pace} ms, one dot for each of ${timings.runs} ${timings.runs === 1 ? 'run' : 'runs'}`} style={plot}>
      <span className="timing-mark is-pace" style={{ left: `${plotAt(timings, pace)}%` }}><b>pace</b>{pace}</span>
      <span className="timing-mark is-own" style={{ left: `${plotAt(timings, own)}%` }}><b>{unit}</b>{own}</span>
      <div className="timing-dots">{timings.dots.map((item, index) => <i key={index} style={dot(item.left, item.stack)}></i>)}</div>
    </div>
    <div className="timing-axis" aria-hidden="true"><span>{low} ms</span><span>{(low + high) / 2}</span><span>{high} ms</span></div>
  </section>;
}

function Comparison({ learning }: { learning: LearningStore }) {
  const value = useSyncExternalStore(learning.comparison.subscribe, learning.comparison.getSnapshot, learning.comparison.getSnapshot);

  return <section id="comparison-panel" className={`train-comparison${value.compared ? '' : ' is-uncompared'}`} data-outcome={value.outcome} aria-labelledby="comparison-status">
    <h2 id="comparison-status" tabIndex={-1}>{value.heading}</h2>
    <dl className="cells train-cells comparison-rows">
      <div id="comparison-target-row" className="cell" hidden={!value.target}><dt id="comparison-target-label" className="cell-label">{value.target?.label ?? 'missed'}</dt><dd className="cell-value"><strong id="comparison-target" className="cell-figure">{value.target?.value ?? '—'}</strong><span id="comparison-target-was" className="cell-note">{value.target?.was}</span></dd></div>
      <div className="cell"><dt className="cell-label">accuracy</dt><dd className="cell-value"><strong className="cell-figure"><span id="comparison-accuracy-now">{value.accuracy ?? '—'}</span></strong><i className="cell-unit">%</i><span id="comparison-accuracy" className="cell-note">{value.accuracyDelta}</span></dd></div>
      <div className="cell"><dt className="cell-label" data-speed-unit="">{unitText('{unit}')}</dt><dd className="cell-value"><strong id="comparison-wpm-now" className="cell-figure" data-bare="" data-wpm={value.wpm ?? undefined}>{value.wpm === null ? '—' : formatSpeed(value.wpm, { bare: true })}</strong><span id="comparison-wpm" className="cell-note" data-bare="" data-signed="" data-wpm={value.wpmDelta ?? undefined}>{value.wpmDelta === null ? '—' : formatSpeed(value.wpmDelta, { bare: true, signed: true })}</span></dd></div>
    </dl>
    <p id="comparison-conditions" className="condition-copy">{value.conditions}</p>
    <p id="comparison-caveat">{value.caveat}</p>
  </section>;
}

// The open step's buttons, as Train has always had them: drill it (or, after a retest, Next), and back to practice
// while a comparison shows.
function OpenActions({ view, learning }: { view: TrainView | null; learning: LearningStore }) {
  return <>
    <button id="start-drill" className="btn btn-primary" type="button" data-action="start-drill" hidden={view?.next} onClick={() => learning.commands.start()}>{view?.startLabel ?? 'Drill and retest'}</button>
    <button id="comparison-next" className="btn btn-primary" type="button" hidden={!view?.next} onClick={() => learning.commands.next()}>Next: “{view?.path.current.unit}”</button>
    <button id="comparison-back" className="btn btn-ghost" type="button" hidden={!view?.hasComparison} onClick={() => learning.commands.back()}>Back to practice</button>
  </>;
}

// The open step's evidence: the learner's line, what changed since it was last drilled, and the missed words holding it.
function OpenEvidence({ view }: { view: TrainView | null }) {
  const unit = view?.path.current.unit ?? null;

  return <div id="train-next" className="train-evidence">
    <p id="train-evidence" data-text={view?.evidence} hidden={!view?.evidence}><Figures text={view?.evidence ?? ''} /></p>
    <p id="train-last" data-text={view?.since} hidden={!view?.since}><Figures text={view?.since ?? ''} /></p>
    <p id="train-words" className="train-words" hidden={!view?.words.length}>{view?.words.map((word) => <Fragment key={word}><Marked word={word} unit={unit} /> </Fragment>)}</p>
  </div>;
}

function Detail({ view, step, learning }: { view: TrainView | null; step: Step; learning: LearningStore }) {
  const current = view?.path.current;
  const unit = step.kind === 'current' ? current?.unit ?? null : step.unit;
  const detail: StepDetail | undefined = view?.details.get(unit ?? '');
  const starts = <span id="train-starts" className="train-starts">{view?.starts}</span>;

  if (step.kind === 'just') {
    return <div className="train-step is-just">
      <header className="train-step-head"><div><span className="cell-label">retest{step.unit.length <= 2 ? ` · ${kindOf(step.unit)}` : ''}</span><p id="comparison-unit" className={`train-step-unit${step.unit.length > 2 ? ' is-label' : ''}`}>{step.unit}</p></div></header>
      <Comparison learning={learning} />
      <div className="train-actions"><OpenActions view={view} learning={learning} />{starts}</div>
      <OpenEvidence view={view} />
    </div>;
  }

  const behind = step.kind === 'behind' ? step : null;
  const todo = step.kind === 'ahead' ? step.figures : step.kind === 'current' ? view?.figures.current ?? null : null;
  const eyebrow = !unit ? 'next' : step.kind === 'current' ? `next · ${kindOf(unit)}` : behind ? `${behind.state} · ${kindOf(unit)}` : kindOf(unit);

  const go = step.kind === 'current' ? <OpenActions view={view} learning={learning} />
    : <button id="start-drill" className={`btn ${behind ? 'btn-secondary' : 'btn-primary'}`} type="button" data-action="start-drill" onClick={() => learning.commands.target(unit ?? '')}>Drill “{unit}”{behind ? ' again' : ''}</button>;

  return <div className={`train-step is-${step.kind}${unit ? '' : ' is-general'}`}>
    <header className="train-step-head">
      <div>
        <span className="cell-label">{eyebrow}</span>
        <h2 className={`train-step-unit${unit ? '' : ' is-label'}`}>{unit ?? current?.title ?? 'General drill'}</h2>
        {detail?.preview.length ? <p className="train-preview" aria-label="Drill text">{detail.preview.map((word, index) => <Fragment key={index}>{index ? ' ' : ''}<Marked word={word} unit={unit} /></Fragment>)}</p> : null}
      </div>
      <div className="train-actions">{go}{starts}</div>
    </header>
    {todo && <div className="cells train-cells">
      <Cell label="cost" figure={todo.cost === null ? '—' : `≈${costText(todo.cost, shownUnit())}`} unit={todo.cost === null ? '' : shownUnit()} />
      {todo.slower ? <Cell label="slower" figure={String(todo.slower.ms)} unit="ms" note={todo.slower.own === null ? '' : `${todo.slower.own} vs ${todo.slower.pace}`} />
        : <Cell label="missed" figure={todo.missed ? `${todo.missed.errors}/${todo.missed.tries}` : '—'} />}
      <Cell label="frequency" figure={todo.frequency.perMinute === null ? '—' : perMinuteText(todo.frequency.perMinute)} unit={todo.frequency.perMinute === null ? '' : '/min'} note={todo.frequency.every ? `1 in ${todo.frequency.every} letters` : ''} />
    </div>}
    {behind?.figures && <div className="cells train-cells">
      <Cell label="won back" figure={behind.figures.won === null ? '—' : wonText(behind.figures.won, shownUnit())} unit={behind.figures.won === null ? '' : shownUnit()} />
      {readCell('missed', behind.figures.now?.read ?? null, behind.figures.now ? (behind.figures.now.since ? 'since the drill' : 'retest') : '')}
      {readCell('before', behind.figures.before)}
    </div>}
    {step.kind === 'current'
      ? <OpenEvidence view={view} />
      : <div className="train-evidence">
        {detail?.evidence ? <p data-text={detail.evidence}><Figures text={detail.evidence} /></p> : null}
        {detail?.words.length ? <p className="train-words">{detail.words.map((word) => <Fragment key={word}><Marked word={word} unit={unit} /> </Fragment>)}</p> : null}
        {detail?.lines.map((line, index) => <p key={index} className="path-line" data-text={line}><Figures text={line} /></p>)}
      </div>}
    {todo?.timings && <TimingPlot timings={todo.timings} />}
  </div>;
}

interface StepsProps { view: TrainView | null; learning: LearningStore }

interface StepsState { chosen: string | null; open: boolean; resetAt: number }

interface StepsSnapshot { had: HTMLElement | null; key: string | undefined }

class TrainSteps extends Component<StepsProps, StepsState, StepsSnapshot | null> {
  root = createRef<HTMLDivElement>();
  detail = createRef<HTMLDivElement>();
  state: StepsState = { chosen: null, open: false, resetAt: -1 };

  // Opening Train, and each retest's comparison, choose afresh: the open step, or the step just retested with its fold open.
  static getDerivedStateFromProps({ view }: StepsProps, state: StepsState): Partial<StepsState> | null {
    if (!view || !(view.fresh || view.advance) || view.revision === state.resetAt) return null;

    return { chosen: null, open: Boolean(view.path.just), resetAt: view.revision };
  }

  steps(): Step[] {
    const { view } = this.props;

    if (!view) return [OPEN];
    const { path, figures } = view;
    const ahead = figures.ahead.map((todo, index): Step => ({ kind: 'ahead', key: `ahead:${todo.unit}`, unit: todo.unit, figures: todo, index, evidence: aheadCopy(path.ahead[index]?.was ?? { errors: 0, observations: 0 }) }));
    const behind = path.behind.map((item, index): Step => ({ kind: 'behind', key: `behind:${item.unit}`, unit: item.unit ?? '', figures: figures.behind[index], state: item.state }));
    const just: Step[] = path.just ? [{ kind: 'just', key: 'just', unit: this.justUnit() }] : [];

    return [OPEN, ...ahead, ...behind, ...just];
  }

  justUnit() {
    return this.props.learning.comparison.getSnapshot().unit || this.props.view?.path.just?.unit || 'Retest';
  }

  chosen(steps: Step[]) {
    const fallback = this.props.view?.path.just ? 'just' : 'current';

    return steps.find((step) => step.key === this.state.chosen) ?? steps.find((step) => step.key === fallback) ?? OPEN;
  }

  choose(key: string) {
    this.setState({ chosen: key }, () => {
      if (matchMedia('(max-width: 900px)').matches) this.detail.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
  }

  getSnapshotBeforeUpdate(): StepsSnapshot | null {
    const root = this.root.current;
    const had = root && document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;

    return { had, key: had?.closest<HTMLElement>('[data-key]')?.dataset.key };
  }

  componentDidUpdate(previous: Readonly<StepsProps>, _state: Readonly<StepsState>, snapshot: StepsSnapshot | null) {
    const root = this.root.current;
    const { view } = this.props;

    if (!root || !view || previous.view === view) return;
    const narrow = matchMedia('(max-width: 900px)').matches;

    if (view.fresh && narrow) root.querySelector('.train-step .train-actions')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });

    if (view.advance && narrow) this.detail.current?.scrollIntoView({ block: 'start', behavior: 'instant' });

    // A redraw keeps focus on the step that had it, or gives it to the open step's button when that step is gone.
    if (snapshot?.had && !(snapshot.had.isConnected && snapshot.had.getClientRects().length)) {
      const same = snapshot.key ? root.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(snapshot.key)}"] .q-row`) : null;
      const open = root.querySelector<HTMLButtonElement>(view.next ? '#comparison-next' : '#start-drill');
      (same?.getClientRects().length ? same : open)?.focus({ preventScroll: true });
    }
  }

  render() {
    const { view, learning } = this.props;
    const steps = this.steps();
    const chosen = this.chosen(steps);
    const current = view?.path.current;
    const figures = view?.figures;
    const drilled = steps.filter((step) => step.kind === 'behind' || step.kind === 'just');
    const open = this.state.open || chosen.kind === 'behind' || chosen.kind === 'just';
    const pressed = (step: Step) => step.key === chosen.key;

    return <div ref={this.root} className="train-layout">
      <section className="panel train-queue" aria-labelledby="train-queue-title">
        <header className="panel-head"><h2 id="train-queue-title" className="panel-title">queue</h2><span className="panel-title" aria-hidden="true">cost</span></header>
        <ol id="train-path" className="queue" aria-labelledby="train-queue-title">
          <li id="train-current" className={`queue-step is-current${current?.unit ? '' : ' is-general'}`} aria-current="step" data-key="current" data-unit={current?.unit ?? undefined}>
            <button className="q-row" type="button" aria-pressed={chosen.kind === 'current'} onClick={() => this.choose('current')}>
              <span className="q-n" aria-hidden="true">1</span>
              <b id="train-unit" className="q-unit">{view?.named ? current?.unit : current?.title ?? 'General drill'}</b>
              {figures?.current && <><span className="q-why">{figures.current.basis === 'slow' ? 'slow' : 'missed'}</span><Cost wpm={figures.current.cost} /></>}
            </button>
          </li>
          {steps.flatMap((step) => (step.kind === 'ahead' ? [<li key={step.key} className="queue-step is-ahead" data-key={step.key} data-unit={step.unit}>
            <button className="q-row" type="button" aria-pressed={pressed(step)} title={step.evidence} onClick={() => this.choose(step.key)}>
              <span className="q-n" aria-hidden="true">{step.index + 2}</span>
              <b className="q-unit">{step.unit}</b>
              <span className="q-why">{step.figures.basis === 'slow' ? 'slow' : 'missed'}</span>
              <Cost wpm={step.figures.cost} />
            </button>
          </li>] : []))}
        </ol>
        {drilled.length ? <>
          <button id="train-drilled-toggle" className="q-fold" type="button" aria-expanded={open} aria-controls="train-drilled" onClick={() => this.setState({ open: !open, chosen: open && (chosen.kind === 'behind' || chosen.kind === 'just') ? 'current' : this.state.chosen })}>
            <svg className="q-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
            <span>drilled</span><span className="q-count">{drilled.length}</span><Won wpm={figures?.won ?? null} />
          </button>
          <ol id="train-drilled" className="queue is-done" aria-label="drilled" hidden={!open}>
            {drilled.map((step) => (step.kind === 'behind'
              ? <li key={step.key} className={`queue-step is-behind is-${step.state}`} data-key={step.key} data-unit={step.unit}>
                <button className="q-row" type="button" aria-pressed={pressed(step)} title={view?.details.get(step.unit)?.lines.join(' · ')} onClick={() => this.choose(step.key)}>
                  <span className="q-n" aria-hidden="true">{step.state === 'fixed' ? <svg className="q-check" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7" /></svg> : <i className="q-ring"></i>}</span>
                  <b className="q-unit">{step.unit}</b>
                  <span className="q-why"><span className="q-state">{step.state}</span></span>
                  <Won wpm={step.figures?.won ?? null} />
                </button>
              </li>
              : <li key={step.key} className="queue-step is-behind is-just" data-key={step.key}>
                <button className="q-row" type="button" aria-pressed={pressed(step)} onClick={() => this.choose(step.key)}>
                  <span className="q-n" aria-hidden="true"><i className="q-ring"></i></span>
                  <b className="q-unit">{step.kind === 'just' ? step.unit : ''}</b>
                  <span className="q-why"><span className="q-state">retest</span></span>
                </button>
              </li>))}
          </ol>
        </> : null}
      </section>
      <div ref={this.detail} id="train-detail" className="train-detail">
        <Detail view={view} step={chosen} learning={learning} />
      </div>
    </div>;
  }
}

export function TrainScreen({ learning, visible = false }: { learning: LearningStore; visible?: boolean }) {
  const view = useSyncExternalStore(learning.train.subscribe, learning.train.getSnapshot, learning.train.getSnapshot);

  return <section id="train-screen" className="screen train-screen" data-screen="train" aria-labelledby="train-heading" hidden={!visible}>
    <h1 id="train-heading" className="sr-only" tabIndex={-1}>{view?.path.current.title ?? 'General drill'}</h1>
    <TrainSteps view={view} learning={learning} />
  </section>;
}
