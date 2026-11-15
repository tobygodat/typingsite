// Train's cost figures written the way the approved prototype computes them (design/prototypes/touchup/shared.js,
// wpmCost and P.step), rescanning everything for each step. Kept only as the reference that train-cost.test.js
// compares src/train-cost.ts with. Not served, not used by the app.
import { evidenceRun } from '../src/insights.js';
import { keyboardOf } from '../src/learner.js';

const prototypeCost = (pace, lost) => 12000 / (pace - lost) - 12000 / pace;

function referencePace(runs, keyboard) {
  const measured = runs.filter((run) => evidenceRun(run) && keyboardOf(run.conditions) === keyboard)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : 1));

  const speeds = measured.slice(-10).map((run) => run.score.wpm).sort((a, b) => a - b);

  if (!speeds.length) return null;
  const mid = Math.floor(speeds.length / 2);
  const wpm = speeds.length % 2 ? speeds[mid] : (speeds[mid - 1] + speeds[mid]) / 2;

  return 12000 / wpm;
}

// The cost of each step to do, and what each step behind you won back, as plain numbers (null where none).
export function referenceFigures({ model, path, runs, keyboard }) {
  const pace = referencePace(runs, keyboard);
  const estimate = (unit) => model.units.find((item) => item.unit === unit);

  const cost = (lost) => (pace === null || lost >= pace ? null : prototypeCost(pace, lost));
  const todo = (unit) => cost(estimate(unit).gain * model.missCost * pace);

  const lostAt = (unit, basis, figure) => {
    const share = estimate(unit).frequency;

    if (basis === 'slow') return share * Math.max(0, figure);

    return figure.observations > 0 ? share * Math.max(0, figure.errors / figure.observations - model.errorRate) * model.missCost * pace : null;
  };

  const won = (step) => {
    if (pace === null || !step.retest) return null;
    const [before, after] = [lostAt(step.unit, step.basis, step.retest.was), lostAt(step.unit, step.basis, step.retest.now)];

    return before === null || after === null ? null : cost(before) - cost(after);
  };

  return {
    current: path.current.unit && pace !== null ? todo(path.current.unit) : null,
    ahead: path.ahead.map((step) => (pace === null ? null : todo(step.unit))),
    behind: path.behind.map(won),
  };
}
