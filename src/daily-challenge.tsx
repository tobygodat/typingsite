import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createStore } from './store.js';
import { CORPUS_VERSION, conditionKey } from './typing.js';
import type { Conditions } from './typing.js';
import { dailyPassage, validRun } from './insights.js';
import type { ConditionLabelSource } from './insights.js';
import { isScoredRun } from './domain-history.js';
import { isDefaultLayout, layoutLabel } from './layouts.js';
import { Copy } from './results-card.js';
import type { CopyPart } from './practice-session.js';
import type { LearningStore } from './learning-store.js';

interface DailyPorts { conditions(): Conditions; inputLabel(value: ConditionLabelSource | undefined): string; start(): void }

interface DailyView { date: string; tile: string; status: CopyPart[]; rows: { id?: string; wpm: number; accuracy: number; detail: string }[] }

// Challenge's Daily passage tile: the passage's UTC day and whether today's status has a completed attempt, "Nov 15 · not typed".
export function dailyTileLine(day: string, typed: boolean) {
  const date = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  return `${date} · ${typed ? 'typed' : 'not typed'}`;
}

export function createDailyChallenge(learning: LearningStore) {
  const view = createStore<DailyView>({ date: '', tile: '', status: [], rows: [] });
  let ports: DailyPorts | null = null;

  return {
    view,
    configure(next: DailyPorts) { ports = next; },
    start() { ports?.start(); },
    passage() {
      const daily = dailyPassage();

      return { ...daily, id: daily.sourceTextId, challengeId: daily.id, corpus: CORPUS_VERSION,
        firstDailyAttempt: !learning.profile.seenTextIds.includes(daily.id), fresh: !learning.profile.seenTextIds.includes(daily.sourceTextId) };
    },
    refresh() {
      const currentPorts = ports;

      if (!currentPorts) return;
      const daily = dailyPassage();
      const completed = learning.profile.runs.filter(isScoredRun).filter((run) => run.kind === 'daily' && validRun(run));
      const today = completed.filter((run) => run.challengeDate === daily.day && conditionKey(run.conditions) === conditionKey(currentPorts.conditions()));
      const best = [...today].sort((a, b) => b.score.wpm - a.score.wpm || b.score.accuracy - a.score.accuracy)[0];
      const layout = isDefaultLayout(learning.preferences.layout) ? '' : ` in ${layoutLabel(learning.preferences.layout)}`;
      const status: CopyPart[] = best ? ['Today’s best: ', { kind: 'speed', wpm: best.score.wpm }, ` · ${best.score.accuracy}% accuracy${layout}.`] : [`No completed physical-keyboard attempt${layout} today.`];

      const rows = [...completed].reverse().slice(0, 30).map((run) => ({ id: run.id, wpm: run.score.wpm, accuracy: run.score.accuracy,
        detail: `${run.challengeDate} · ${(run.firstDailyAttempt ?? run.fresh) ? 'first attempt' : 'repeat attempt'}${run.firstDailyAttempt && !run.fresh ? ' · previously displayed passage' : ''} · ${currentPorts.inputLabel(run.conditions)}` }));

      flushSync(() => view.publish({ date: `${daily.day} · english · resets 00:00 UTC`, tile: dailyTileLine(daily.day, Boolean(best)), status, rows }));
    },
  };
}

export type DailyChallengeController = ReturnType<typeof createDailyChallenge>;

export function DailyChallenge({ controller }: { controller: DailyChallengeController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <section id="daily-challenge" className="panel daily-challenge" aria-labelledby="daily-heading">
    <div className="panel-head daily-heading"><h2 id="daily-heading" className="panel-title" tabIndex={-1}>daily passage</h2><p id="daily-date" className="condition-copy">{view.date}</p></div>
    <div className="daily-start"><p id="daily-status" className="result-note" aria-live="polite"><Copy parts={view.status} /></p>
    <button id="start-daily" className="btn btn-primary" type="button" onClick={() => controller.start()}>Start daily challenge</button></div>
    <details id="daily-history-panel" hidden={!view.rows.length}><summary>Your daily results</summary><div id="daily-history">{view.rows.map((run, index) => <div key={run.id ?? index} className="daily-result"><strong className="num"><Copy parts={[{ kind: 'speed', wpm: run.wpm }, ` · ${run.accuracy}%`]} /></strong><span>{run.detail}</span></div>)}</div></details>
  </section>;
}
