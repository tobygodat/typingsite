import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createStore } from './store.js';
import { isRecord } from './domain-values.js';
import { conditionKey } from './typing.js';
import { validRun } from './insights.js';
import type { ConditionLabelSource } from './insights.js';
import { keyboardOf } from './learner.js';
import type { Recommendation } from './learner.js';
import { evidenceCopy } from './train-path.js';
import type { LearningStore } from './learning-store.js';

type Source = ConditionLabelSource | undefined;

interface PatternRow { unit: string; evidence: string; last: string }

interface PatternView { key: string; options: { key: string; label: string }[]; rows: PatternRow[] }

interface PatternPorts {
  learning: LearningStore;
  conditions(): ConditionLabelSource;
  describe(value: Source, sets: readonly Source[]): string;
  recommendation(source: Source): Recommendation;
  practice(target: string, source: Source, recommendation: Recommendation): void;
  date(at: unknown): string;
}

function conditionsOf(value: unknown): Source {
  if (value === undefined || isRecord(value)) return value;
  throw new TypeError('Historical conditions are not an object');
}

export function createTrainingPatterns() {
  const view = createStore<PatternView>({ key: '', options: [], rows: [] });
  let ports: PatternPorts | null = null;
  let source: Source;
  let recommendation: Recommendation | null = null;

  function refresh() {
    if (!ports) return;
    const current = ports;
    const list = document.getElementById('training-targets');
    const focused = document.activeElement;
    const hadUnit = focused instanceof HTMLElement && list?.contains(focused) ? focused.closest<HTMLElement>('[data-unit]')?.dataset.unit : undefined;
    const prior = view.getSnapshot().key;
    const groups = new Map<string, Source>();
    const runs = current.learning.profile.runs.filter((run) => validRun(run) && (run.kind === 'test' || run.kind === 'retest' || run.kind === 'daily'));

    for (const run of [...runs].reverse()) {
      const value = conditionsOf(run.conditions);
      groups.set(conditionKey(value), value);
    }

    if (!groups.size) {
      const fallback = current.conditions();
      groups.set(conditionKey(fallback), fallback);
    }

    const options = [...groups].map(([key, value]) => ({ key, label: current.describe(value, [...groups.values()]) }));
    const key = groups.has(prior) ? prior : options[0]?.key ?? '';
    source = groups.get(key);
    recommendation = current.recommendation(source);

    const rows = recommendation.queue.slice(0, 8).map(({ unit, was }) => {
      const loop = [...current.learning.profile.loops].reverse().find((item) => item.target === unit && keyboardOf(conditionsOf(item.conditions)) === keyboardOf(source));
      let last = '';

      if (loop) {
        if (!isRecord(loop.comparison)) throw new TypeError('A practiced loop requires its comparison');
        last = `Last practiced ${current.date(loop.at)}. Last retest: ${loop.comparison.state}.`;
      }

      return { unit, evidence: evidenceCopy(was), last };
    });

    flushSync(() => view.publish({ key, options, rows }));

    if (hadUnit !== undefined) {
      const target = list?.querySelector<HTMLButtonElement>(`[data-unit="${CSS.escape(hadUnit)}"] button`) || list?.querySelector<HTMLButtonElement>('button') || document.getElementById('training-conditions');
      target?.focus({ preventScroll: true });
    }
  }

  return {
    view, refresh,
    configure(next: PatternPorts) { ports = next; },
    choose(key: string) { view.publish({ ...view.getSnapshot(), key }); refresh(); },
    practice(unit: string) { if (recommendation) ports?.practice(unit, source, recommendation); },
  };
}

export function TrainingPatterns({ controller }: { controller: ReturnType<typeof createTrainingPatterns> }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <section className="training-memory" aria-labelledby="training-memory-heading"><h3 id="training-memory-heading">Patterns across runs</h3><div className="filter-field"><select id="training-conditions" className="input" aria-label="Test conditions" value={view.key} disabled={!view.options.length} onChange={(event) => controller.choose(event.currentTarget.value)}>{view.options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></div><p id="training-memory-note" className="result-note">{view.rows.length ? '' : 'Not enough evidence yet.'}</p><div id="training-targets">{view.rows.map((row) => <article key={row.unit} className="training-target" data-unit={row.unit}><div><h3>Practice “{row.unit}”</h3><p>{row.evidence}</p>{row.last && <p>{row.last}</p>}</div><button type="button" className="btn btn-secondary" onClick={() => controller.practice(row.unit)}>Practice “{row.unit}” again</button></article>)}</div></section>;
}
