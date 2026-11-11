// A signed-in person with a history synced from another device: six runs that name "th", "an", "er", "in" and "ou",
// and earlier drills behind them on Train's path (TOB-420). Shared by the Train specs.
import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { DEFAULT_POLICY, englishFrequency } from '../src/learner.js';
import { expect, openApp, chooseWords, completePassage, signInWithEmail } from './fixtures.js';

export const conditions = { mode: 'words', count: 10, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

// Every other pair clean at the run's pace; the named ones typed only where a run names them.
export const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);
export const NAMED = ['th', 'an', 'er', 'in', 'ou'];
export const at = (day) => `2026-11-${String(day).padStart(2, '0')}T12:00:00.000Z`;

export const run = (id, day, rows, missedWords = []) => ({ id, at: at(day), day: at(day).slice(0, 10), kind: 'test', status: 'complete', interrupted: false, fresh: true,
  conditions, textId: id, score: { wpm: 62, accuracy: 96 }, elapsedMs: 25_000, errors: 3, target: null, keys: [], keysVersion: 0, missedWords,
  patterns: [...BACKGROUND.filter((pair) => !NAMED.includes(pair) && !rows.some((row) => row[0] === pair)).map((pair) => [pair, 3, 0, 3, 200, 0]), ...rows] });

export const loop = (id, target, after, extra) => ({ id, at: after.at, beforeAttemptId: null, afterAttemptId: after.id, target, recommendationKind: 'targeted',
  policy: DEFAULT_POLICY, focus: 'balanced', drillCompleted: true, conditions, comparison: { comparable: true, state: 'improved', wpmDelta: 3, accuracyDelta: 1.5 },
  targetTiming: null, targetMisses: null, targetPace: null, drill: { target, duration: 30, wordList: '200' }, ...extra });

// Six runs that miss "an" and "er" and slow "th" by 90 ms, and `drills` earlier drills behind you, oldest first. "qu" and
// "ck" are clean in two runs since their retests (fixed); the rest are drilled. The learner queues th, an, er, in, ou.
export function history(drills = 4) {
  const units = ['qu', 'ck', 'ol', 'wh', 'sp', 'ly', 'ge', 'bo'].slice(0, drills);
  const retests = units.map((unit, i) => run(`retest-${unit}`, 1 + (i % 4), [[unit, 12, unit === 'ol' ? 1 : 0, 12, 200, 0]]));
  const after = [5, 6].map((day) => run(`after-${day}`, day, [['qu', 12, 0, 12, 200, 0], ['ck', 12, 0, 12, 200, 0]]));

  const runs = Array.from({ length: 6 }, (_, i) => run(`run-${i}`, 5 + i, [['th', 8, 0, 8, 290, 90], ['an', 8, 3, 8, 200, 0], ['er', 8, 2, 8, 200, 0],
    ['in', 10, i % 2, 10, 200, 0], ['ou', 10, i % 3 ? 0 : 1, 10, 200, 0]], ['another', 'than', 'and', 'other', 'every', 'there']));

  const loops = units.map((unit, i) => loop(`loop-${unit}`, unit, retests[i], { targetBasis: 'errors',
    targetMisses: { target: unit, was: { errors: 6, observations: 22 }, now: { errors: unit === 'ol' ? 1 : 0, observations: 12 } } }));

  return { version: 2, preferences: { mode: 'words', count: 10 }, attempts: [], runs: [...retests, ...after, ...runs], loops, seenTextIds: [], bests: {},
    updatedAt: '2026-11-10T12:00:00Z' };
}

// Signed in with that history synced from another device, and one 10-word run here as the retest's baseline.
export async function withHistory(page, supabase, email, drills = 4) {
  const user = supabase.addUser(email);
  supabase.profiles.set(user.id, { data: history(drills) });
  await openApp(page);
  await signInWithEmail(page, email);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await chooseWords(page, 10);
  await completePassage(page);

  return user;
}

export const units = (page, kind) => page.locator(`#train-path > .is-${kind} .path-unit`).evaluateAll((nodes) => nodes.filter((node) => node.offsetParent).map((node) => node.firstChild.textContent));
export const behindUnits = (page) => page.locator('#train-path > .is-behind:not(#comparison-panel) .path-unit').evaluateAll((nodes) => nodes.map((node) => node.firstChild.textContent));
