import { Fragment, useSyncExternalStore } from 'react';
import { createStore } from './store.js';
import { ProgressLeadCopy } from './progress-sections.js';
import type { ProgressSections } from './progress-sections.js';

export type ProgressPeriod = '7' | '30' | 'all';

export type ProgressDetail = '' | 'runs' | 'trends' | 'keys' | 'calendar' | 'standard' | 'compose';

interface FilterView {
  tests: { id: string; mode: string; text: string; label?: string; key?: string; selected: boolean; disabled: boolean }[];
  variants: { key: string; label: string }[];
  key: string; conditions: string; hasSource: boolean; period: ProgressPeriod;
}

export function createProgressFilters() {
  return {
    view: createStore<FilterView>({ tests: [], variants: [], key: '', conditions: '', hasSource: false, period: '30' }),
    open: createStore(false),
    commands: { choose(choice: { key?: string; period?: ProgressPeriod }) { void choice; } },
  };
}

export function ProgressFilters({ progress }: { progress: ProgressSections }) {
  const view = useSyncExternalStore(progress.filters.view.subscribe, progress.filters.view.getSnapshot, progress.filters.view.getSnapshot);

  const open = useSyncExternalStore(progress.filters.open.subscribe, progress.filters.open.getSnapshot, progress.filters.open.getSnapshot);

  return <div id="progress-filters" className="progress-filters" hidden={!view.hasSource}><details className="conditions-disclosure" open={open} onToggle={(event) => progress.filters.open.publish(event.currentTarget.open)}><summary><ProgressLeadCopy progress={progress} part="sample" /><span className="sr-only">conditions: </span><span id="progress-conditions" className="progress-conditions">{view.conditions}</span></summary><div className="conditions-panel"><div id="progress-tests" className="pill-row" role="group" aria-label="Test">{view.tests.map((test, index) => <Fragment key={test.id}>{index > 0 && test.mode !== view.tests[index - 1]?.mode && <span className="pill-rule" aria-hidden="true"></span>}<button className="pill" type="button" data-shape={test.id} aria-pressed={test.selected} disabled={test.disabled} aria-label={test.label || undefined} onClick={() => { if (test.key) progress.filters.commands.choose({ key: test.key }); }}>{test.text}</button></Fragment>)}</div><select id="progress-variants" className="select variant-select" aria-label="Conditions" hidden={view.variants.length < 2} value={view.key} onChange={(event) => progress.filters.commands.choose({ key: event.currentTarget.value })}>{view.variants.length >= 2 && view.variants.map((variant) => <option key={variant.key} value={variant.key}>{variant.label}</option>)}</select></div></details></div>;
}

export function ProgressPeriodControl({ progress }: { progress: ProgressSections }) {
  const view = useSyncExternalStore(progress.filters.view.subscribe, progress.filters.view.getSnapshot, progress.filters.view.getSnapshot);

  return <div id="progress-period" className="pill-row period-row" role="group" aria-label="Period">{(['7', '30', 'all'] satisfies ProgressPeriod[]).map((period) => <button key={period} className="pill" type="button" data-period={period} aria-pressed={view.period === period} onClick={() => progress.filters.commands.choose({ period })}>{period === 'all' ? 'All' : `${period} days`}</button>)}</div>;
}
