import { conditionKey, printable, replayAttempt, summarizePatterns, textId } from './typing.js';

export const MAX_RUN_SUMMARIES = 1000;
export const MAX_PATTERN_RUNS = 120;
// Per-letter first-attempt counts saved with each run. Summaries without this version predate
// them and fall back to pair-derived counts, which miss letters at the start of a word.
export const KEY_COUNTS_VERSION = 1;

// [letter, tries, first-try errors] for every a–z first attempt, whatever came before it.
function keyCounts(replay) {
  const keys = new Map();
  for (const first of replay.firstAttempts) {
    const letter = (first.expected || '').toLowerCase();
    if (!/^[a-z]$/.test(letter)) continue;
    const k = keys.get(letter) || [letter, 0, 0];
    k[1] += 1;
    if (!first.correct) k[2] += 1;
    keys.set(letter, k);
  }
  return [...keys.values()];
}

export const MAX_MISSED_WORDS = 12;

// Run kinds that are never compared, used as a baseline or mined for patterns (custom text, missed-word
// practice, and a ghost race against a friend's recorded run). They keep no trace or pattern evidence and
// are retained on their own small budget, so they can never push comparable history out of the summary and
// pattern windows. Extend this set for any other kind like that.
export const NON_COMPARABLE_KINDS = new Set(['custom', 'missed', 'challenge']);
export const MAX_NON_COMPARABLE_RUNS = 50;
export const comparableKind = (kind) => !NON_COMPARABLE_KINDS.has(kind);

// Run kinds that measure typing on ordinary text at the run's own conditions: practice tests, retests and daily
// runs. Only these can be evidence (see evidenceRun). Narrower than comparableKind, which only splits retention
// budgets and so includes drills: their synthetic, target-heavy text is never measured.
export const MEASURED_KINDS = new Set(['test', 'retest', 'daily']);
export const measuredKind = (kind) => MEASURED_KINDS.has(kind);

export function runRecord(attempt, at = attempt.at || null) {
  const replay = attempt.summary || replayAttempt(attempt);
  const record = {
    id: attempt.id, at, kind: attempt.kind, status: attempt.status,
    conditions: attempt.conditions, textId: attempt.textId, fresh: attempt.fresh,
    interrupted: Boolean(attempt.interrupted || attempt.unsupportedInput),
    score: replay.score, elapsedMs: replay.elapsedMs,
    errors: replay.firstAttempts.filter((item) => !item.correct).length,
    target: attempt.target || null, challengeDate: attempt.challengeDate || null,
    firstDailyAttempt: attempt.firstDailyAttempt,
  };
  // Pattern counts only feed recurring targets, which never read custom text or missed-word practice.
  if (!comparableKind(attempt.kind)) return record;
  const evidence = summarizePatterns([attempt]);
  // Keep counts and each run's measured median, rather than another keystroke log.
  record.patterns = evidence.pairs.map((p) => [p.pair, p.observations, p.errors, p.timings.length, p.medianMs, p.slowdownMs]);
  // Same eligibility as patterns (no drills, races, repeated dailies or non-comparable kinds).
  record.keys = evidence.attemptCount ? keyCounts(replay) : [];
  record.keysVersion = KEY_COUNTS_VERSION;
  // The words missed on the first try, for "words you keep missing": only from runs pattern memory
  // reads, so a run without the field (older, trimmed or not eligible) is no evidence either way.
  if (evidenceRun(record)) record.missedWords = missedAndSlowWords(attempt, 0).missed.slice(0, MAX_MISSED_WORDS);
  return record;
}

// Comparable runs keep the newest 1,000 summaries, the newest 120 with pattern evidence; other kinds keep their
// newest 50. Order stays chronological, and a profile with only comparable runs is retained exactly as before.
// Missed words stay only on the newest 120 runs the list counts, so the profile stays small. Counting those
// from the end means drills between them never push counted runs out of the list's window (word practice and
// custom text are on their own budget anyway).
export function retainRuns(runs) {
  const comparable = runs.filter((run) => comparableKind(run.kind));
  const other = runs.filter((run) => !comparableKind(run.kind));
  const kept = new Set([...comparable.slice(-MAX_RUN_SUMMARIES), ...other.slice(-MAX_NON_COMPARABLE_RUNS)]);
  const withPatterns = new Set(comparable.slice(-MAX_PATTERN_RUNS));
  const withWords = new Set(comparable.filter((run) => kept.has(run) && missedWordsRun(run)).slice(-MAX_PATTERN_RUNS));
  return runs.filter((run) => kept.has(run)).map((run) => {
    const trimPatterns = comparableKind(run.kind) && !withPatterns.has(run);
    const trimWords = 'missedWords' in run && !withWords.has(run);
    if (!trimPatterns && !trimWords) return run;
    // Drop missed words rather than empty them: an empty list would read as a run with no misses.
    const { missedWords, ...rest } = run;
    return { ...(trimWords ? rest : run), ...(trimPatterns ? { patterns: [], keys: [] } : {}) };
  });
}

export const validRun = (run) => run.status === 'complete' && !run.interrupted;
export const trendRun = (run) => validRun(run) && ['test', 'retest'].includes(run.kind);
// A run that counts as evidence about the person's typing: complete, uninterrupted and of a measured kind, and
// never a daily passage shown before (a repeat attempt types known text). Recurring patterns, missed words to
// practise and the words you keep missing all read only these; drills, races, word practice and custom text never
// count. Works on a stored run summary or a just-finished attempt.
export const evidenceRun = (run) => validRun(run) && measuredKind(run.kind) && (run.kind !== 'daily' || run.fresh !== false);
// The runs "words you keep missing" counts: those pattern memory reads that recorded missed words.
const missedWordsRun = (run) => evidenceRun(run) && Array.isArray(run.missedWords);
const inputClassOf = (run) => run?.conditions?.inputClass || 'physical-keyboard';

export function filterRuns(runs, key, days = 'all', date = new Date()) {
  const cutoff = days === 'all' ? null : date.getTime() - Number(days) * 86400000;
  return runs.filter((run) => (!key || conditionKey(run.conditions) === key)
    && (cutoff === null || (run.at && new Date(run.at).getTime() >= cutoff)));
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function weeklyChange(runs, key, date = new Date()) {
  const eligible = runs.filter(trendRun);
  const fortnight = filterRuns(eligible, key, 14, date);
  const current = filterRuns(fortnight, key, 7, date);
  const ids = new Set(current.map((r) => r.id));
  const previous = fortnight.filter((r) => !ids.has(r.id));
  return { current, previous,
    wpm: current.length && previous.length ? median(current.map((r) => r.score.wpm)) - median(previous.map((r) => r.score.wpm)) : null,
    accuracy: current.length && previous.length ? median(current.map((r) => r.score.accuracy)) - median(previous.map((r) => r.score.accuracy)) : null,
  };
}

export const STANDARD_RECENT_RUNS = 10;
export const STANDARD_MIN_RUNS = 3;

// The standard score headline: the best at one standard key, plus the median wpm of the most recent
// completed runs there. Below three runs there is no median, so one run can't stand in for a score.
// Only comparable kinds count: a custom run is never a standard run, whatever conditions it carries.
export function standardScore(runs, key, best = null) {
  const eligible = runs.filter((run) => comparableKind(run.kind) && trendRun(run) && conditionKey(run.conditions) === key);
  const recent = eligible.slice(-STANDARD_RECENT_RUNS);
  const settled = recent.length >= STANDARD_MIN_RUNS;
  return {
    total: eligible.length,
    recent: recent.length,
    best: best ?? (eligible.length ? Math.max(...eligible.map((run) => run.score.wpm)) : null),
    median: settled ? median(recent.map((run) => run.score.wpm)) : null,
    settled,
  };
}

// Which input class heads the standard score, given standardScore for each. Totals count only runs
// still in the kept summaries, while bests outlive them, so totals alone can't stand for lifetime
// practice. Physical keyboard is the default. Touch heads only when the keyboard has nothing at all,
// or once touch has a settled median from more kept runs, so one touch run can't replace a keyboard score.
export function standardInputClass(keyboard, touch) {
  const keyboardEmpty = !keyboard.total && keyboard.best === null;
  const touchHasScore = touch.total > 0 || touch.best !== null;
  if (keyboardEmpty && touchHasScore) return 'touch';
  return touch.settled && touch.total > keyboard.total ? 'touch' : 'physical-keyboard';
}

export function recurringTargets(runs, loops, compatibleConditions) {
  const key = conditionKey(compatibleConditions);
  const eligible = runs.filter((r) => evidenceRun(r) && conditionKey(r.conditions) === key).slice(-MAX_PATTERN_RUNS);
  const pairs = new Map();
  for (const run of eligible) {
    for (const [pair, observations, errors, timingCount, medianMs, slowdownMs] of run.patterns || []) {
      const p = pairs.get(pair) || { pair, observations: 0, errors: 0, runs: 0, errorRuns: 0, slowRuns: 0, lastAt: null };
      p.observations += observations;
      p.errors += errors;
      p.runs += 1;
      if (errors) p.errorRuns += 1;
      if (timingCount >= 10 && slowdownMs > 0 && medianMs !== null) p.slowRuns += 1;
      p.lastAt = run.at;
      pairs.set(pair, p);
    }
  }
  return [...pairs.values()].filter((p) => p.observations >= 10 && (p.errorRuns >= 2 || p.slowRuns >= 2))
    .map((p) => {
      const checks = loops.filter((l) => l.target === p.pair && conditionKey(l.conditions) === key);
      const lastCheck = checks.at(-1);
      const drilled = runs.filter((r) => r.kind === 'drill' && validRun(r) && r.target === p.pair
        && conditionKey(r.conditions) === key);
      const lastPracticed = [drilled.at(-1)?.at, lastCheck?.drillCompleted ? lastCheck.at : null].filter(Boolean).sort().at(-1) || null;
      const laterRuns = eligible.filter((r) => lastPracticed && r.at > lastPracticed && r.fresh !== false);
      const laterObservations = laterRuns.reduce((n, r) => n + (r.patterns?.find((v) => v[0] === p.pair)?.[1] || 0), 0);
      return { ...p, lastPracticed, lastCheck, laterObservations, laterRuns: laterRuns.length,
        review: Boolean(lastPracticed && laterObservations >= 10) };
    })
    .sort((a, b) => Number(b.review) - Number(a.review) || b.errors / b.observations - a.errors / a.observations
      || b.slowRuns - a.slowRuns || a.pair.localeCompare(b.pair));
}

// Words missed on the first try in at least two of the newest 120 runs that recorded missed words,
// on one input class (the newest such run's: touch is never pooled with a physical keyboard) and
// across all other test conditions. `runs` is how many runs were counted, so a row can say "missed
// in 3 of the last 41 runs". Ranked by the number of runs missed in, then the most recent miss (by
// run order, since older summaries can lack a date).
// One word across runs: lower case, without punctuation before or after it (inner marks, as in "9:30"
// or "don't", stay). A token that is all punctuation keeps itself.
export const missedWordKey = (word) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || word;

export function recurringMissedWords(runs, limit = 8) {
  const recent = runs.filter(missedWordsRun).slice(-MAX_PATTERN_RUNS);
  const inputClass = inputClassOf(recent.at(-1));
  const counted = recent.filter((run) => inputClassOf(run) === inputClass);
  // Counted as one word whatever its case or the punctuation around it ("The", "the", "the,"), and
  // practised as most recently written: a run's first form of it, from the newest run that missed it.
  const words = new Map();
  counted.forEach((run, index) => {
    const seen = new Set();
    for (const written of run.missedWords) {
      const key = missedWordKey(written);
      if (seen.has(key)) continue;
      seen.add(key);
      const item = words.get(key) || { word: written, runs: 0, lastIndex: -1 };
      item.runs += 1;
      item.lastIndex = index;
      item.word = written;
      words.set(key, item);
    }
  });
  const recurring = [...words.values()].filter((item) => item.runs >= 2)
    .sort((a, b) => b.runs - a.runs || b.lastIndex - a.lastIndex || a.word.localeCompare(b.word));
  return { runs: counted.length, inputClass, recurring: recurring.length, words: recurring.slice(0, limit) };
}

// The seen-text id that marks a day's challenge as attempted (the passage itself has its own id).
export const dailyChallengeId = (day) => `daily-${day}-v1`;

// Only the earliest attempt at a day's challenge (by date, then id, the order every copy sorts by) can
// be its first attempt. Two devices that each tried the day before either held the other's copy both
// label their own try first; once their runs meet, the later one becomes a repeat. Flags are only
// ever cleared, never set, so a label stays conservative. Returns the records, changed ones copied.
export function settleDailyFirsts(records) {
  const earliest = new Map();
  const before = (a, b) => (a.at || '') < (b.at || '') || ((a.at || '') === (b.at || '') && String(a.id) < String(b.id));
  for (const record of records) {
    if (record?.kind !== 'daily' || !record.challengeDate) continue;
    const held = earliest.get(record.challengeDate);
    if (!held || before(record, held)) earliest.set(record.challengeDate, record);
  }
  return records.map((record) => (record?.kind === 'daily' && record.firstDailyAttempt
    && earliest.get(record.challengeDate) !== record ? { ...record, firstDailyAttempt: false } : record));
}

// Stable UTC selection from a frozen text pool: preferences and seen history never change it.
export function dailyPassage(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const index = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
  const text = DAILY_TEXTS[((index % DAILY_TEXTS.length) + DAILY_TEXTS.length) % DAILY_TEXTS.length];
  return { id: dailyChallengeId(day), sourceTextId: `daily-${textId(text)}`, textVersion: `daily-${textId(text)}@1`, day, text, difficulty: 'steady',
    resetAt: new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString() };
}

const DAILY_TEXTS = [
  'The station clock was a minute slow, but nobody waiting on the platform seemed to mind. A porter moved a trolley past the benches. Somewhere beyond the tracks, a door opened and the smell of fresh bread drifted into the morning air.',
  'We carried the table outside before the rain arrived. There was just enough room beneath the old apple tree for six chairs and a bowl of pears. When the first drops fell, someone opened an umbrella over the bread and everyone laughed.',
  'A good question can change the shape of an afternoon. You set aside the answer you expected, look again at the evidence, and find a detail that had escaped you. The work becomes more interesting as soon as you allow yourself to be surprised.',
  'The bicycle had spent winter behind a stack of boxes. We brushed the dust from its frame, filled the tires, and tightened the loose bell. By noon it was carrying a basket of groceries down the same street where it had once carried schoolbooks.',
  'At the edge of the garden, a narrow gate opened onto a path we had never noticed. It followed the wall for a while, then turned toward a field. We walked until the houses disappeared behind the trees and the wind became the loudest thing around us.',
  'The first draft left plenty of room for improvement. That was useful: a rough page gave us something real to discuss. We moved a paragraph, removed a repeated sentence, and found that the clearest idea had been hiding near the end all along.',
  'Every shelf in the shop told a different story. There were maps folded along old creases, cups with painted handles, and a box of keys without locks. The owner knew where most things came from, but enjoyed letting visitors imagine the rest.',
  'After lunch, the river changed color as clouds crossed the sun. Small boats moved between the bridges, leaving trails that widened and vanished. We sat on the steps with our coats beside us, watching an ordinary afternoon become something we would remember.',
  'Someone had written the recipe on the back of an envelope. The quantities were vague, and the final instruction simply said to wait. We measured what we could, trusted the rest, and learned more from the smell of the oven than from the faded ink.',
  'The workshop window faced a quiet courtyard. Each morning, light reached the same corner of the bench before moving across the tools. Over the years, that small patch of sun had marked the beginning of more useful work than any clock on the wall.',
  'A shelf of unfinished projects can feel like a record of failure. Look more closely and it becomes a record of questions: what would happen if this piece were lighter, that seam stronger, or the whole idea simpler? Sometimes the next attempt begins with an old one.',
  'We reached the hill before sunset and found a place among the tall grass. Below us, lights appeared in scattered windows. There was nothing to solve and nowhere else to be. For a few minutes, watching the day end was enough to fill our attention.',
  'The letter arrived without an explanation for its long journey. Its corners were soft, and the stamp had almost faded. Inside was a short account of a summer by the sea, written by someone who had thought an ordinary day was worth sharing.',
  'When the power returned, we left the candles burning for a little longer. The room looked familiar again, but conversation had found a different pace. Nobody reached for a screen until the last story was finished and the kettle began to sing.',
];

// Stilltype rule: no confident per-key or per-pair claim below this many first attempts.
export const MIN_PATTERN_SAMPLES = 10;

const directKeys = (run) => run.keysVersion === KEY_COUNTS_VERSION && Array.isArray(run.keys) ? run.keys : null;

// Compact run memory → per-key and per-pair totals. A key's miss rate is first-attempt errors on
// that letter over its tries. Older summaries without per-letter counts fall back to their pairs
// (a pair's first attempt is a try at its second letter), so they only count letters typed after
// another letter; pairDerivedRuns says how many runs that applies to. Non-comparable kinds (custom text) are
// never mined, even if a record carries counts.
export function keyAnalysis(runs, limit = 8) {
  const recent = runs.filter((r) => comparableKind(r.kind) && validRun(r) && ((r.patterns || []).length || directKeys(r)?.length))
    .slice(-MAX_PATTERN_RUNS);
  const keys = new Map();
  const pairs = new Map();
  let pairDerivedRuns = 0;
  const addKey = (key, samples, errors) => {
    const k = keys.get(key) || { key, samples: 0, errors: 0 };
    k.samples += samples;
    k.errors += errors;
    keys.set(key, k);
  };
  for (const run of recent) {
    const direct = directKeys(run);
    if (direct) for (const [key, samples, errors] of direct) addKey(key, samples, errors);
    else pairDerivedRuns += 1;
    for (const [pair, observations, errors, timingCount, medianMs, slowdownMs] of run.patterns || []) {
      if (!direct) addKey(pair[1], observations, errors);
      const p = pairs.get(pair) || { pair, samples: 0, errors: 0, slowRuns: 0, timedRuns: 0, runs: 0 };
      p.samples += observations;
      p.errors += errors;
      p.runs += 1;
      // Only runs with enough clean intervals can say slow or not; the rest stay unknown.
      const timed = timingCount >= MIN_PATTERN_SAMPLES && medianMs !== null && slowdownMs !== null;
      if (timed) p.timedRuns += 1;
      if (timed && slowdownMs > 0) p.slowRuns += 1;
      pairs.set(pair, p);
    }
  }
  const rate = (v) => ({ ...v, missRate: v.samples ? v.errors / v.samples : 0, enough: v.samples >= MIN_PATTERN_SAMPLES });
  return {
    runs: recent.length,
    pairDerivedRuns,
    keys: Object.fromEntries([...keys.values()].map((k) => [k.key, rate(k)])),
    pairs: [...pairs.values()].map(rate).filter((p) => p.enough && (p.errors > 0 || p.slowRuns > 0))
      .sort((a, b) => b.missRate - a.missRate || b.slowRuns - a.slowRuns || b.samples - a.samples || a.pair.localeCompare(b.pair))
      .slice(0, limit),
  };
}

// The bare word: a word without the punctuation around it, lowercased ("Table," → "table").
// Punctuation inside stays ("9:30", "don't"), so no merged, made-up tokens. `same[k]` is true where
// the bare word keeps the written character at k unchanged (not a dropped comma, not a capital), and
// `lead` is where the bare word starts in `raw`.
function bareWord(raw) {
  const lead = raw.search(/[\p{L}\p{N}]/u);
  const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
  const same = Array.from({ length: raw.length }, (_, k) => lead >= 0 && k >= lead && word[k - lead] === raw[k]);
  return { word, same, lead };
}

// The token that practises these misses: the bare word when every miss was on a character it keeps
// as typed, else the word as written ("table," for a missed comma, "The" for a missed capital). A
// miss on the space after the word goes with the character before it, since the practice passage
// puts a space after every word: "the" for "The ", "table," for "table, ".
function missedToken(raw, misses) {
  const { word, same } = bareWord(raw);
  return word && misses.every((k) => same[Math.min(k, raw.length - 1)]) ? word : raw;
}

// When each letter kept at the finish was typed, mirroring replayAttempt's kept text: a mistyped
// and corrected space times the next word from the space that stayed, not the one deleted.
function keptOffsets(attempt) {
  const times = [];
  for (const event of attempt.events || []) {
    if (event.type === 'delete') {
      times.splice(Math.max(0, times.length - Math.max(1, event.count || 1)));
      continue;
    }
    if (event.type !== 'insert' || !printable(event.text)) continue;
    for (const _char of event.text) {
      const position = Number.isInteger(event.position) ? event.position : times.length;
      if (position >= attempt.text.length) break;
      if (event.accepted !== false) times.push(event.offsetMs);
    }
  }
  return times;
}

// Missed words had any wrong first try, counting the space after the word as the run card's word
// history does (the last word has none). The slowest are this run's slowest clean words by per-word
// wpm: one timing each, so they carry their speed and the run's median for comparison, not a verdict.
// Clean means right on every first try and still right at the finish, the spaces after it included,
// as the run card's word list reads it. With continue on error, a right letter can be deleted and
// replaced by a wrong one: its first try stays right, so the word isn't a first-try miss, but it isn't
// clean either, and its kept keystrokes would time the wrong letter, so it is left out of the timing.
//
// Per-word pace, one rule for every word: each counted character's interval is the time since the
// previous kept keystroke, and wpm = (counted characters / 5) / (sum of their intervals). A word
// counts only the characters its bare word keeps as written, so "table," is timed on t-a-b-l-e (the
// comma's interval is left out) and "The" on h-e, matching what is reported and drilled. A dropped
// leading quote takes the next interval with it, so '"the' is timed on h-e too: the drill never types
// the quote-to-t step. The run's first character has no previous keystroke, so it is never counted: a
// first word is timed from its second letter, and a word left with no counted characters (a one-letter
// first word) isn't timed.
export function missedAndSlowWords(attempt, slowLimit = 5) {
  const replay = attempt.summary || replayAttempt(attempt);
  const first = new Map(replay.firstAttempts.map((item) => [item.position, item]));
  const kept = keptOffsets(attempt);
  const { typed } = replay;
  const missed = [];
  const timed = [];
  let start = 0;
  for (const raw of attempt.text.split(' ')) {
    const end = start + raw.length;
    const { word, same, lead } = bareWord(raw);
    const tries = [];
    for (let i = start; i < end; i += 1) if (first.has(i)) tries.push(first.get(i));
    const misses = tries.filter((item) => !item.correct).map((item) => item.position - start);
    // The spaces after a word are part of typing it: a wrong first try there marks the word.
    for (let i = end; raw && attempt.text[i] === ' '; i += 1) if (first.get(i)?.correct === false) misses.push(i - start);
    // Still right at the finish: the word as typed, and each space after it that was typed.
    let right = typed.slice(start, end) === raw;
    for (let i = end; right && raw && attempt.text[i] === ' ' && i < typed.length; i += 1) right = typed[i] === ' ';
    if (misses.length) {
      const token = missedToken(raw, misses);
      if (!missed.includes(token)) missed.push(token);
    } else if (word && tries.length === raw.length && right) {
      let count = 0;
      let ms = 0;
      for (let k = 0; k < raw.length; k += 1) {
        if (!same[k] || (k === lead && k > 0) || start + k === 0) continue;
        count += 1;
        ms += kept[start + k] - kept[start + k - 1];
      }
      if (count && ms > 0) timed.push({ word, wpm: (count / 5) / (ms / 60000) });
    }
    start = end + 1;
  }
  timed.sort((a, b) => a.wpm - b.wpm);
  const slow = [];
  for (const item of timed) {
    if (slow.length >= slowLimit) break;
    if (!missed.includes(item.word) && !slow.some((s) => s.word === item.word)) slow.push({ word: item.word, wpm: Math.round(item.wpm) });
  }
  const mid = timed.length >> 1;
  const medianWpm = !timed.length ? null : Math.round(timed.length % 2 ? timed[mid].wpm : (timed[mid - 1].wpm + timed[mid].wpm) / 2);
  return { missed, slow, timedCount: timed.length, medianWpm };
}

// What a word-practice passage asks for beyond plain letters, as test conditions: punctuation is any
// character that isn't a letter, digit or space (a capital is a letter, so "The" alone isn't punctuation),
// and numbers is any digit, which is never punctuation.
export function practiceTextConditions(text) {
  return { punctuation: /[^\p{L}\p{N} ]/u.test(text), numbers: /\p{N}/u.test(text) };
}

// Deterministic: the same words always build the same practice passage. It grows past `length`
// when there are more words, so every word offered is in it.
export function practiceWordsPassage(words, length = 40) {
  if (!words.length) return '';
  length = Math.max(length, words.length);
  let seed = 2166136261;
  for (const char of words.join(' ')) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  while (out.length < length) {
    const round = [...words];
    for (let i = round.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [round[i], round[j]] = [round[j], round[i]];
    }
    // Avoid the same word twice in a row across rounds.
    if (round.length > 1 && round[0] === out.at(-1)) round.push(round.shift());
    out.push(...round);
  }
  return out.slice(0, length).join(' ');
}
