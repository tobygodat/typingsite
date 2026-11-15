import { flushSync } from 'react-dom';
import { goalMinutes, periodStats, runDay } from './insights.js';
import { copyParts } from './native-copy.js';
import type { NativeCopy } from './native-copy.js';
import { speedFigure, speedValue, unitLabel, unitText } from './units.js';
import { SHOWN_MOVERS, WEEK_MIN_RUNS, moverCopy, moverSample } from './week-change.js';
import type { weekChange } from './week-change.js';
import type { LearningStore } from './learning-store.js';
import type { MoverView } from './progress-sections.js';
import type { AnalysisRun } from './profile-types.js';

const plural = (count: number | undefined, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function medianValue(value: number | null) {
  if (value === null) throw new Error('A settled week requires its median');

  return value;
}

export function createProgressFigures(learning: LearningStore) {
  function renderLead(lead: ReturnType<typeof weekChange>['lead']) {
    const whole = (wpm: number | null) => Math.round(speedValue(Number(wpm)));
    const bare = (wpm: number | null) => speedFigure(medianValue(wpm), { bare: true, whole: true });
    const day = (key: string | null) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const runs = (count: number) => plural(count, 'run');
    const percent = (value: number | null) => (value === null ? null : String(Number(value.toFixed(1))));
    const signed = (change: number) => `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}`;
    const { current, previous } = lead;
    let week = '';
    let figure: string | null = null;
    let change: string | null = null;
    let accuracy: number | null = null;
    let accuracyChange: string | null = null;
    let spoken = '';
    let sentence: NativeCopy = [];
    let sample = '';
    let note = '';
    let tone = 'none';

    if (lead.state === 'change') {
      const difference = whole(current.median) - whole(previous.median);
      tone = difference > 0 ? 'gain' : difference < 0 ? 'drop' : 'flat';
      week = 'this week';
      figure = String(whole(current.median));
      change = signed(difference);
      accuracy = current.accuracy;
      const [now, before] = [percent(current.accuracy), percent(previous.accuracy)];

      if (now !== null && before !== null) accuracyChange = signed(Math.round((Number(now) - Number(before)) * 10) / 10);
      spoken = difference ? `${Math.abs(difference)} ${unitText('{unit}')} ${difference > 0 ? 'faster' : 'slower'} than the week before.` : 'The same as the week before.';
      sentence = [bare(current.median), ' this week, ', bare(previous.median), ' the week before'];
      sample = `medians of ${current.count} and ${runs(previous.count)}`;
    } else if (lead.state === 'this-week') {
      week = 'this week';
      figure = String(whole(current.median));
      accuracy = current.accuracy;
      sentence = ['this week so far'];
      sample = `median of ${runs(current.count)}`;
      note = previous.count ? `${runs(previous.count)} last week` : '';
    } else if (lead.state === 'last-week') {
      week = 'last week';
      figure = String(whole(previous.median));
      accuracy = previous.accuracy;
      sentence = ['the week before'];
      sample = `median of ${runs(previous.count)}`;
      note = current.count ? `${runs(current.count)} this week` : 'No runs this week yet.';
    } else if (lead.state === 'thin') {
      if (!lead.latest) throw new Error('A thin week requires its latest run');
      week = 'latest run';
      figure = String(whole(lead.latest.score.wpm));
      accuracy = lead.latest.score.accuracy;
      sentence = [current.count ? 'your latest run' : `your latest run, ${day(runDay(lead.latest))}`];
      sample = current.count ? `${runs(current.count)} this week` : `${runs(previous.count)} the week before`;
      note = `A week has a median from ${WEEK_MIN_RUNS} runs.`;
    } else {
      note = 'No runs at these conditions in the last two weeks.';
    }

    flushSync(() => learning.progress.lead.publish({ week, figure, change, spoken, sentence: copyParts(sentence), sample, note, state: lead.state, tone, accuracy: percent(accuracy), accuracyChange }));
  }

  // What moved it: the units fixed this week, ranked (weekMovers), the first SHOWN_MOVERS shown and the rest behind one
  // "more"; and the practice cell, minutes this week with the week before's and the streak.
  function renderMovers(week: ReturnType<typeof weekChange>) {
    const open = learning.progress.navigation.state.moversOpen;

    const rows: MoverView[] = week.movers.map((mover) => {
      const copy = moverCopy(mover);

      return { unit: mover.unit, before: copy.before, after: copy.after,
        tail: [copy.tail || 'over ' + plural('intervals' in mover.after ? mover.after.intervals : undefined, 'clean interval'), mover.split === 'drill' && 'since your drill'].filter(Boolean).join(' '),
        title: moverSample(mover), status: 'fixed' };
    });

    const practice = week.practice;
    const streak = practice?.streak ? plural(practice.streak, 'day') + ' in a row' + (practice.goal ? ' at ' + practice.goal + ' min' : '') : '';

    flushSync(() => learning.progress.movers.publish({ rows, open, extra: week.movers.length - SHOWN_MOVERS, shown: SHOWN_MOVERS,
      practice: { minutes: goalMinutes(practice?.current ?? 0), note: practice ? [goalMinutes(practice.previous) + ' min last week', streak].filter(Boolean).join(' · ') : '' } }));
  }


  function renderTrendFigures(runs: readonly AnalysisRun[], note: string) {
    const stats = periodStats(runs);
    const speed = (wpm: number) => [speedFigure(wpm, { bare: true, whole: true }), ' ', unitLabel()];
    const day = stats.best?.at ? ` on ${new Date(stats.best.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ', date unavailable';

    let parts: NativeCopy[] = [];

    if (stats.count) {
      if (stats.wpm === null || stats.accuracy === null || !stats.best) throw new Error('Counted trend statistics require their scores');
      parts = [
        ['median ', ...speed(stats.wpm)],
        [`${Number(stats.accuracy.toFixed(1))}% accuracy`],
        ['best run ', ...speed(stats.best.score.wpm), day],
        [plural(stats.count, 'run')],
      ];
    }

    flushSync(() => learning.progress.trends.publish({ parts: parts.map(copyParts), note }));
  }


  return { renderLead, renderMovers, renderTrendFigures };
}
