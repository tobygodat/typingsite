// Runs started and finished, for the Practice figures on Progress. A run starts with the key that sets
// body[data-running] (practice, custom, daily, drills, retests, lessons and ghost races alike) and is
// finished when it reaches its end as a counted run; a restart, an abandoned run or one a correction rule
// or minimum failed is started and never finished. Scoring never reads these.
//
// profile.runCounts: { [counter]: { [day]: [started, finished] } }. Every tab mints its own counter the
// first time it counts a run, and only that tab ever writes it, so each number only grows and copies
// merge exactly by taking the larger of each (mergeRunCounts): two tabs or two devices counting at once
// write different counters and both are kept, and a copy that has already been merged adds nothing twice.
// A finish is counted on the day its run started, so a period never finishes more than it started.
import { MAX_PRACTICE_DAYS } from './insights.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const count = (value) => (Number.isInteger(value) && value > 0 ? value : 0);

export function validRunCounts(value) {
  const counts = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return counts;
  for (const [counter, days] of Object.entries(value)) {
    if (!days || typeof days !== 'object' || Array.isArray(days)) continue;
    for (const [day, pair] of Object.entries(days)) {
      if (!DAY.test(day) || !Array.isArray(pair)) continue;
      const [started, finished] = [count(pair[0]), count(pair[1])];
      if (started || finished) (counts[counter] ||= {})[day] = [started, finished];
    }
  }
  return counts;
}

// Only the newest MAX_PRACTICE_DAYS counted days are kept, as for the practice archive. The days kept
// depend only on the days held, so copies that merge drop the same ones and settle.
export function retainRunCounts(value) {
  const counts = validRunCounts(value);
  const days = [...new Set(Object.values(counts).flatMap(Object.keys))].sort();
  if (days.length <= MAX_PRACTICE_DAYS) return counts;
  const oldest = days.at(-MAX_PRACTICE_DAYS);
  return keepDays(counts, (day) => day >= oldest);
}

// The counts on the days `keep` accepts: a clear takes the days through its own from a copy that hadn't
// applied it, as it does archived practice time.
export function keepDays(value, keep) {
  const counts = {};
  for (const [counter, days] of Object.entries(validRunCounts(value))) {
    const kept = Object.entries(days).filter(([day]) => keep(day));
    if (kept.length) counts[counter] = Object.fromEntries(kept);
  }
  return counts;
}

export function mergeRunCounts(a, b) {
  const merged = validRunCounts(a);
  for (const [counter, days] of Object.entries(validRunCounts(b))) {
    for (const [day, [started, finished]] of Object.entries(days)) {
      const [s, f] = merged[counter]?.[day] || [0, 0];
      (merged[counter] ||= {})[day] = [Math.max(s, started), Math.max(f, finished)];
    }
  }
  return retainRunCounts(merged);
}

// Totals from `from` to `to` (local days, either open).
export function runCountTotals(value, { from = null, to = null } = {}) {
  let [started, finished] = [0, 0];
  for (const days of Object.values(validRunCounts(value))) {
    for (const [day, [s, f]] of Object.entries(days)) {
      if ((from && day < from) || (to && day > to)) continue;
      started += s;
      finished += f;
    }
  }
  return { started, finished };
}

const mintCounter = () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
};

// One tab's counter. It remembers what it has written, so it can tell when a clear (here or merged in from
// elsewhere) has taken its numbers away: counting on from what the clear left would write numbers lower
// than ones other copies may still hold (an Undo's, or a stale copy's), and the larger would hide the new
// runs. It mints a fresh counter instead, and the old one's numbers stand or go with the clear.
// start() and finish() take the profile's counts and return them with the run added; start() also returns
// the run's ticket for finish(). A finish whose start a clear has taken counts the start again with it, as
// the clear left the run itself in place.
export function createRunCounter(mint = mintCounter) {
  let counter = null;
  let written = {};
  const intact = (counts) => counter !== null && Object.entries(written)
    .every(([day, [s, f]]) => (counts[counter]?.[day]?.[0] ?? 0) >= s && (counts[counter]?.[day]?.[1] ?? 0) >= f);
  const add = (value, day, started, finished) => {
    const counts = validRunCounts(value);
    if (!intact(counts)) {
      counter = mint();
      written = {};
    }
    const [s, f] = counts[counter]?.[day] || [0, 0];
    written[day] = [s + started, f + finished];
    return { ...counts, [counter]: { ...counts[counter], [day]: written[day] } };
  };
  return {
    start(value, day) {
      const counts = add(value, day, 1, 0);
      return { counts, ticket: { counter, day } };
    },
    finish(value, ticket) {
      const kept = ticket.counter === counter && intact(validRunCounts(value));
      return add(value, ticket.day, kept ? 0 : 1, 1);
    },
  };
}
