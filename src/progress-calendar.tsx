import { Component, createRef, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { createStore } from './store.js';

export interface CalendarDay { day: string; level: string; met: boolean; label: string; caption: string }

interface CalendarView { days: CalendarDay[]; months: string[]; weeks: number; coarse: boolean; label: string; today: string }

interface Figure { label: string; value: string; unit: string; note?: string }

export function createProgressCalendar() {
  return { visible: createStore(false), view: createStore<CalendarView>({ days: [], months: [], weeks: 26, coarse: false, label: '', today: '' }), figures: createStore<Figure[]>([]) };
}

export type CalendarController = ReturnType<typeof createProgressCalendar>;

interface CalendarState { selected: string; caption: string; active: string }

interface CalendarSnapshot { grid: boolean; picker: boolean }

class Calendar extends Component<{ view: CalendarView }, CalendarState, CalendarSnapshot | null> {
  state: CalendarState = { selected: '', caption: '', active: '' };
  grid = createRef<HTMLDivElement>();
  picker = createRef<HTMLSelectElement>();
  cells = new Map<string, HTMLSpanElement>();
  getSnapshotBeforeUpdate(previous: Readonly<{ view: CalendarView }>): CalendarSnapshot | null {
    if (previous.view === this.props.view) return null;

    return { grid: Boolean(this.grid.current?.contains(document.activeElement)), picker: document.activeElement === this.picker.current };
  }
  componentDidUpdate(_previous: Readonly<{ view: CalendarView }>, _state: Readonly<CalendarState>, snapshot: CalendarSnapshot | null) {
    if (!snapshot) return;
    const { view } = this.props;
    const selected = view.days.some((day) => day.day === this.state.selected) ? this.state.selected : view.today;
    const last = view.days[view.days.length - 1]?.day ?? '';
    this.setState({ selected, active: last, caption: snapshot.picker ? view.days.find((day) => day.day === selected)?.caption ?? '' : '' }, () => { if (snapshot.grid && !view.coarse) this.cells.get(last)?.focus(); });
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
    const focusedCaption = () => document.activeElement instanceof HTMLElement ? view.days.find((day) => day.day === document.activeElement?.getAttribute('data-day'))?.caption ?? '' : '';
    const captionSelected = () => this.setState({ caption: view.days.find((day) => day.day === selected)?.caption ?? '' });

    return <div className="practice-calendar"><div className="goal-chart"><div id="goal-months" className="goal-months" aria-hidden="true" style={style}>{view.months.map((month, index) => <span key={index}>{month}</span>)}</div><div className="goal-weekdays" aria-hidden="true"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
      <div ref={this.grid} id="goal-calendar" className="goal-calendar" role="group" aria-label={view.label} aria-hidden={view.coarse ? 'true' : undefined} style={style} onKeyDown={(event) => this.move(event)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) this.setState({ caption: '' }); }} onPointerLeave={() => this.setState({ caption: focusedCaption() })} onPointerOver={(event) => { const cell = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.goal-day') : null; this.setState({ caption: cell?.dataset.caption ?? focusedCaption() }); }}>{view.days.map((day) => <span key={day.day} ref={(node) => { if (node) this.cells.set(day.day, node); else this.cells.delete(day.day); }} className="goal-day" data-level={day.level} data-goal={day.met ? 'met' : undefined} data-day={day.day} data-caption={day.caption} role="img" tabIndex={view.coarse ? undefined : active === day.day ? 0 : -1} aria-label={day.label} onFocus={() => this.setState({ active: day.day, caption: day.caption })}></span>)}</div></div>
      <p className="goal-legend" aria-hidden="true">less <span data-level="0"></span><span data-level="1"></span><span data-level="2"></span><span data-level="3"></span><span data-level="4"></span> more practice</p>
      <div className="goal-day-picker"><label className="sr-only" htmlFor="goal-day-select">Practice day</label><select ref={this.picker} id="goal-day-select" className="input select" value={selected} onChange={(event) => { const day = event.currentTarget.value; this.setState({ selected: day, caption: view.days.find((item) => item.day === day)?.caption ?? '' }); }} onFocus={captionSelected}>{view.days.map((day) => <option key={day.day} value={day.day}>{day.label}</option>)}</select></div><p id="goal-caption" className="goal-caption" aria-hidden="true">{this.state.caption}</p></div>;
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

export function PracticeProgress({ controller }: { controller: CalendarController }) {
  const visible = useSyncExternalStore(controller.visible.subscribe, controller.visible.getSnapshot, controller.visible.getSnapshot);

  return <div id="practice-goal" className="practice-goal" hidden={!visible}><div className="practice-layout"><ProgressCalendar controller={controller} /><ProgressPracticeFigures controller={controller} /></div><div id="practice-runs" className="practice-runs"></div></div>;
}
