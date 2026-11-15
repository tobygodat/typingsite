import { Component, createRef, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { createStore } from './store.js';
import { formatSpeed } from './units.js';

// A day of the calendar. `caption` is its date and minutes, as the label reads; `runs` and `best` are what the kept
// runs say of it (their count and fastest speed in wpm), null for a day older than every kept run, which shows its
// minutes only.
export interface CalendarDay { day: string; level: string; met: boolean; label: string; caption: string; runs: number | null; best: number | null }

// The tip's first line, in the speed unit showing.
const runsLine = ({ runs, best }: CalendarDay) => (!runs ? '' : `${runs} ${runs === 1 ? 'run' : 'runs'}${best === null ? '' : ` · best ${formatSpeed(best, { whole: true })}`}`);

interface CalendarView { days: CalendarDay[]; months: string[]; weeks: number; coarse: boolean; label: string; today: string; summary: string }

interface Figure { label: string; value: string; unit: string; note?: string }

export function createProgressCalendar() {
  return { visible: createStore(false), view: createStore<CalendarView>({ days: [], months: [], weeks: 53, coarse: false, label: '', today: '', summary: '' }), figures: createStore<Figure[]>([]) };
}

export type CalendarController = ReturnType<typeof createProgressCalendar>;

// `shown` is the day whose tip shows: the hovered day, else the focused or picked one.
interface CalendarState { selected: string; shown: string; active: string }

interface CalendarSnapshot { grid: boolean; picker: boolean }

class Calendar extends Component<{ view: CalendarView }, CalendarState, CalendarSnapshot | null> {
  state: CalendarState = { selected: '', shown: '', active: '' };
  frame = createRef<HTMLDivElement>();
  grid = createRef<HTMLDivElement>();
  picker = createRef<HTMLSelectElement>();
  tip = createRef<HTMLDivElement>();
  scroller = createRef<HTMLDivElement>();
  months = createRef<HTMLDivElement>();
  cells = new Map<string, HTMLSpanElement>();
  // A month's name is wider than its week, so it shows only while its week is whole in view: a week past the
  // scroller's edge would otherwise leave a sliver of its name there.
  labels: IntersectionObserver | null = null;
  // A finger leaves the calendar as it lifts, so a tapped day's tip stays until a tap lands elsewhere.
  dismiss = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' && event.target instanceof Node && !this.grid.current?.contains(event.target)) this.setState({ shown: this.focusedDay() });
  };
  componentDidMount() {
    document.addEventListener('pointerdown', this.dismiss);
    this.labels = new IntersectionObserver((entries) => { for (const { target, intersectionRatio } of entries) target.toggleAttribute('data-cut', intersectionRatio < 1); }, { root: this.scroller.current, threshold: 1 });
    this.watchLabels();
  }
  componentWillUnmount() {
    document.removeEventListener('pointerdown', this.dismiss);
    this.labels?.disconnect();
  }
  watchLabels() {
    this.labels?.disconnect();

    for (const label of this.months.current?.children ?? []) this.labels?.observe(label);
  }
  focusedDay() { return document.activeElement instanceof HTMLElement && this.grid.current?.contains(document.activeElement) ? document.activeElement.dataset.day ?? '' : ''; }
  getSnapshotBeforeUpdate(previous: Readonly<{ view: CalendarView }>): CalendarSnapshot | null {
    if (previous.view === this.props.view) return null;

    return { grid: Boolean(this.grid.current?.contains(document.activeElement)), picker: document.activeElement === this.picker.current };
  }
  componentDidUpdate(previous: Readonly<{ view: CalendarView }>, _state: Readonly<CalendarState>, snapshot: CalendarSnapshot | null) {
    this.placeTip();

    if (previous.view.months.length !== this.props.view.months.length) this.watchLabels();

    if (!snapshot) return;
    const { view } = this.props;
    const selected = view.days.some((day) => day.day === this.state.selected) ? this.state.selected : view.today;
    const last = view.days[view.days.length - 1]?.day ?? '';
    this.setState({ selected, active: last, shown: snapshot.picker ? selected : '' }, () => { if (snapshot.grid && !view.coarse) this.cells.get(last)?.focus(); });
  }
  // The tip stands over its day, kept inside the calendar's width. It moves at once and never animates.
  placeTip() {
    const tip = this.tip.current;
    const frame = this.frame.current;
    const cell = this.cells.get(this.state.shown);

    if (!tip || !frame || !cell || tip.hidden) return;
    const box = frame.getBoundingClientRect();
    const at = cell.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const x = Math.max(half, Math.min(box.width - half, at.left + at.width / 2 - box.left));
    tip.style.transform = `translate(${x - half}px, ${at.top - box.top - tip.offsetHeight - 6}px)`;
  }
  focusDay(day: string) { this.setState({ active: day }, () => this.cells.get(day)?.focus()); }
  move(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement)) return;
    const days = this.props.view.days;
    const target = event.target;
    const from = days.findIndex((day) => day.day === target.dataset.day);
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7, Home: -from, End: days.length - 1 - from }[event.key];

    if (from < 0 || step === undefined) return;
    event.preventDefault();

    if ((event.key === 'ArrowUp' && from % 7 === 0) || (event.key === 'ArrowDown' && from % 7 === 6)) return;
    const to = days[from + step];

    if (to) this.focusDay(to.day);
  }
  render() {
    const { view } = this.props;
    const selected = view.days.some((day) => day.day === this.state.selected) ? this.state.selected : view.today;
    const active = view.days.some((day) => day.day === this.state.active) ? this.state.active : view.days[view.days.length - 1]?.day;
    const style: CSSProperties & { '--weeks': number } = { '--weeks': view.weeks };
    const shown = view.days.find((day) => day.day === this.state.shown);

    return <div ref={this.frame} className="practice-calendar">
      <div className="goal-chart">
        <div className="goal-weekdays" aria-hidden="true"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
        <div className="goal-frame"><div ref={this.scroller} className="goal-scroll">
          <div className="goal-weeks" style={style}>
            <div ref={this.months} id="goal-months" className="goal-months" aria-hidden="true">{view.months.map((month, index) => <span key={index}>{month}</span>)}</div>
            <div ref={this.grid} id="goal-calendar" className="goal-calendar" role="group" aria-label={view.label} aria-hidden={view.coarse ? 'true' : undefined} onKeyDown={(event) => this.move(event)}
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) this.setState({ shown: '' }); }}
              onPointerLeave={(event) => { if (event.pointerType === 'mouse') this.setState({ shown: this.focusedDay() }); }}
              onPointerOver={(event) => { const cell = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.goal-day') : null; this.setState({ shown: cell?.dataset.day ?? this.focusedDay() }); }}>
              {view.days.map((day) => <span key={day.day} ref={(node) => { if (node) this.cells.set(day.day, node); else this.cells.delete(day.day); }} className="goal-day" data-level={day.level} data-goal={day.met ? 'met' : undefined} data-day={day.day} role="img" tabIndex={view.coarse ? undefined : active === day.day ? 0 : -1} aria-label={day.label} onFocus={() => this.setState({ active: day.day, shown: day.day })}></span>)}
            </div>
          </div>
        </div></div>
      </div>
      <p className="goal-legend" aria-hidden="true">less <span data-level="0"></span><span data-level="1"></span><span data-level="2"></span><span data-level="3"></span><span data-level="4"></span> more</p>
      <div className="goal-day-picker"><label className="sr-only" htmlFor="goal-day-select">Practice day</label><select ref={this.picker} id="goal-day-select" className="input select" value={selected} onChange={(event) => this.setState({ selected: event.currentTarget.value, shown: event.currentTarget.value })} onFocus={() => this.setState({ shown: selected })} onBlur={() => this.setState({ shown: '' })}>{view.days.map((day) => <option key={day.day} value={day.day}>{day.label}</option>)}</select></div>
      <div ref={this.tip} className="calendar-tip" aria-hidden="true" hidden={!shown}>{shown && runsLine(shown) && <b className="tip-runs">{runsLine(shown)}</b>}<span id="goal-caption" className="goal-caption" aria-hidden="true">{shown?.caption ?? ''}</span></div>
    </div>;
  }
}

export function ProgressCalendar({ controller }: { controller: CalendarController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <Calendar view={view} />;
}

export function ProgressPracticeFigures({ controller }: { controller: CalendarController }) {
  const figures = useSyncExternalStore(controller.figures.subscribe, controller.figures.getSnapshot, controller.figures.getSnapshot);

  return <dl id="practice-stats" className="progress-stats practice-stats">{figures.map((figure) => <div key={figure.label} className="progress-figure"><dt>{figure.label}</dt><dd className="num figure-value"><span>{figure.value}</span> <span className="figure-unit">{figure.unit}</span></dd>{figure.note && <dd className="figure-note">{figure.note}</dd>}</div>)}</dl>;
}

// The overview's calendar: a year of days in week columns, Sunday first, the oldest weeks clipped first where the
// page is narrower than a year.
// The practice figures (streaks, time typing, runs started) are one step away, from the panel's head.
export function PracticeCalendarPanel({ controller, onOpen }: { controller: CalendarController; onOpen(opener: HTMLElement): void }) {
  const visible = useSyncExternalStore(controller.visible.subscribe, controller.visible.getSnapshot, controller.visible.getSnapshot);
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <section id="practice-goal" className="panel calendar-panel" aria-labelledby="calendar-title" hidden={!visible}>
    <header className="panel-head"><h2 id="calendar-title" className="panel-title">calendar</h2><span className="panel-tools"><span id="calendar-summary" className="panel-count">{view.summary}</span><button id="open-practice" className="quiet-action" type="button" data-progress-open="calendar" onClick={(event) => onOpen(event.currentTarget)}>streaks</button></span></header>
    <ProgressCalendar controller={controller} />
  </section>;
}
