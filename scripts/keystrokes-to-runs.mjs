// Turns the public 136M Keystrokes dataset (Dhakal, Feit, Kristensson and Oulasvirta, CHI 2018) into the app's own
// run records, one sentence a run, read by the same replayAttempt and runRecord that read a real Stilltype run.
// See docs/adr/0030-starting-view-from-public-keystrokes.md. The dataset is never committed: it is free for
// non-commercial use with attribution, and lives outside the repo.
//
//   unzip -p Keystrokes.zip 'Keystrokes/files/*_keystrokes.txt' \
//     | bun run keystrokes:runs -- --metadata metadata_participants.txt --out <dir> [--limit 2000]
//
// Writes <dir>/runs-train.jsonl.gz, runs-validation.jsonl.gz and runs-test.jsonl.gz (one participant a line:
// { id, split, runs }) and <dir>/report.json (what was kept and what each filter dropped).

import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';
import { CORPUS_VERSION, METRIC_VERSION, completeAttempt } from '../src/typing.js';
import { runRecord } from '../src/insights.js';

export const MIN_SENTENCES = 10;
export const KEPT_KEYBOARDS = new Set(['full', 'laptop']);
export const KEPT_LAYOUT = 'qwerty';

const COLUMNS = 9;
const SPLIT_BUCKETS = 100n;
const TRAIN_BELOW = 80;
const VALIDATION_BELOW = 90;

// A sentence in the dataset is typed text with punctuation and capitals, corrected at will.
const CONDITIONS = { mode: 'words', punctuation: true, numbers: false, wordList: '136m-keystrokes', inputClass: 'physical-keyboard',
  correctionPolicy: 'relaxed', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: KEPT_LAYOUT };

// Whole participants go to one split, by a hash of their id (ADR 0030).
export function splitOf(participant) {
  const bucket = Number(BigInt(`0x${createHash('sha256').update(String(participant)).digest('hex')}`) % SPLIT_BUCKETS);

  return bucket < TRAIN_BELOW ? 'train' : bucket < VALIDATION_BELOW ? 'validation' : 'test';
}

// One row of a <participant>_keystrokes.txt file, or null when it is a header or cannot be read.
export function parseRow(line) {
  const fields = line.split('\t');

  if (fields.length !== COLUMNS || fields[0] === 'PARTICIPANT_ID') return null;
  const [participant, section, sentence, input, keystroke, press, release, letter, code] = fields;
  const pressMs = Number(press);

  return Number.isFinite(pressMs) ? { participant, section, sentence, input, keystroke: Number(keystroke), pressMs, releaseMs: Number(release), letter, code: Number(code) } : null;
}

const byPress = (a, b) => a.pressMs - b.pressMs || a.keystroke - b.keystroke;

const KEY_A = 65;
const KEY_Z = 90;
const KEY_SHIFT = 16;
const KEY_BACKSPACE = 8;

// US QWERTY keys the dataset sometimes logs with no letter: [plain, with Shift], by JavaScript keyCode.
const UNLETTERED = new Map([[32, [' ', ' ']], [188, [',', '<']], [190, ['.', '>']], [191, ['/', '?']], [222, ["'", '"']], [186, [';', ':']], [59, [';', ':']],
  [189, ['-', '_']], [173, ['-', '_']], [49, ['1', '!']]]);

// The character a row typed, null for a key that types none, or 'BKSP'. The dataset's LETTER is sometimes empty
// or wrong for a letter key ("," logged for keyCode 77), so a letter key is read from its keyCode, with its case
// from LETTER when that names the same letter and from Shift otherwise. sentenceRun's check against what the
// participant submitted decides whether the reading was right.
export function keyOf({ letter, code }, shifted) {
  if (letter === 'BKSP' || code === KEY_BACKSPACE) return 'BKSP';

  if (code >= KEY_A && code <= KEY_Z) {
    const plain = String.fromCharCode(code).toLowerCase();

    return letter.toLowerCase() === plain ? letter : shifted ? plain.toUpperCase() : plain;
  }

  if (letter === '') return UNLETTERED.get(code)?.[shifted ? 1 : 0] ?? null;

  return [...letter].length === 1 && letter >= ' ' ? letter : null;
}

// One sentence's rows as the app's events: a printable key inserts at the end of what is typed, BKSP deletes one,
// and every other key (SHIFT, arrows and the rest) adds nothing. `typed` is what those events leave.
export function sentenceEvents(rows) {
  const ordered = rows.toSorted(byPress);
  const start = ordered[0].pressMs;
  const shifts = ordered.filter((row) => row.code === KEY_SHIFT);
  const events = [];
  let typed = '';

  for (const row of ordered) {
    const offsetMs = row.pressMs - start;
    const key = keyOf(row, shifts.some((shift) => shift.pressMs <= row.pressMs && row.pressMs <= shift.releaseMs));

    if (key === 'BKSP') {
      typed = typed.slice(0, -1);
      events.push({ type: 'delete', count: 1, offsetMs });
    } else if (key !== null) {
      typed += key;
      events.push({ type: 'insert', text: key, offsetMs });
    }
  }

  return { events, typed, start };
}

// One sentence as a run record, or the reason it is left out. A sentence is kept when the events rebuild exactly
// what the participant submitted (so no mouse, selection, arrow or word-delete edit moved a position) and what
// they submitted is the sentence (so no slip left every later position reading as a miss).
export function sentenceRun(rows) {
  const [{ participant, section, sentence, input }] = rows;
  const { events, typed, start } = sentenceEvents(rows);

  if (!events.some((event) => event.type === 'insert')) return { dropped: 'no-keys' };

  if (typed !== input) return { dropped: 'replay-differs' };

  if (input !== sentence) return { dropped: 'not-the-sentence' };
  const id = `${participant}-${section}`;
  const conditions = { ...CONDITIONS, count: sentence.split(' ').length };

  const attempt = completeAttempt({ id, kind: 'test', status: 'complete', conditions, textId: id, fresh: true, text: sentence, events, startedAt: 0 },
    { endedAt: events.at(-1).offsetMs });

  return { run: runRecord(attempt, new Date(start).toISOString()), attempt };
}

// A wrong first try that sits in a run of three or more wrong first tries in a row: a slip that moved every later
// position, not three misses. Counted for the report, since the app shows a wrong letter at once and the test did not.
export function shiftedMisses(firstAttempts) {
  const wrong = new Set(firstAttempts.filter((item) => !item.correct).map((item) => item.position));
  let shifted = 0;

  for (const position of wrong) {
    let length = 1;

    for (let p = position - 1; wrong.has(p); p -= 1) length += 1;

    for (let p = position + 1; wrong.has(p); p += 1) length += 1;

    if (length >= 3) shifted += 1;
  }

  return { misses: wrong.size, shifted };
}

// Each sentence's timestamp checks, in the order the file lists them. `releaseBeforePress` counts rows released before
// they were pressed. `startsBeforePreviousEnd` is set when the sentence's first press is before the last release of the
// sentence listed before it. `outOfOrderRows` counts rows listed after a later press: file disorder, benign because
// the replay sorts by press.
export function timestampFlags(sections) {
  let previousEnd = null;

  return sections.map((rows) => {
    const start = Math.min(...rows.map((row) => row.pressMs));
    const end = Math.max(...rows.map((row) => (Number.isFinite(row.releaseMs) ? Math.max(row.releaseMs, row.pressMs) : row.pressMs)));
    const releaseBeforePress = rows.filter((row) => row.releaseMs < row.pressMs).length;
    const outOfOrderRows = rows.filter((row, at) => at > 0 && row.pressMs < rows[at - 1].pressMs).length;
    const flags = { rows: rows.length, releaseBeforePress, outOfOrderRows, startsBeforePreviousEnd: previousEnd !== null && start < previousEnd };

    previousEnd = end;

    return flags;
  });
}

export const emptyAnomalies = () => ({ sentences: 0, rows: 0, releaseBeforePressRows: 0, sentencesReleaseBeforePress: 0, outOfOrderRows: 0, sentencesOutOfOrder: 0,
  sentencesStartingBeforePreviousEnd: 0, sentencesWithTimestampAnomaly: 0, sentencesOnlyOutOfOrder: 0 });

// Adds sentences' flags to a running tally. A timestamp anomaly is a release before a press or a start before the
// previous end; a sentence with only out-of-order rows is counted apart.
export function addAnomalies(tally, flagged) {
  for (const flags of flagged) {
    const anomaly = flags.releaseBeforePress > 0 || flags.startsBeforePreviousEnd;
    tally.sentences += 1;
    tally.rows += flags.rows;
    tally.releaseBeforePressRows += flags.releaseBeforePress;
    tally.sentencesReleaseBeforePress += flags.releaseBeforePress > 0 ? 1 : 0;
    tally.outOfOrderRows += flags.outOfOrderRows;
    tally.sentencesOutOfOrder += flags.outOfOrderRows > 0 ? 1 : 0;
    tally.sentencesStartingBeforePreviousEnd += flags.startsBeforePreviousEnd ? 1 : 0;
    tally.sentencesWithTimestampAnomaly += anomaly ? 1 : 0;
    tally.sentencesOnlyOutOfOrder += !anomaly && flags.outOfOrderRows > 0 ? 1 : 0;
  }

  return tally;
}

// A participant's sentences as runs in the order typed, with what was dropped and why, and the timestamp flags of
// every sentence read (`flags`) and of each one kept (on `kept[i].flags`). With `dropBadTimestamps`, a sentence with
// a timestamp anomaly is dropped first, as 'bad-timestamps'.
export function participantRuns(rows, { dropBadTimestamps = false } = {}) {
  const sections = Map.groupBy(rows, (row) => row.section);
  const lists = [...sections.values()];
  const flags = timestampFlags(lists);
  const dropped = {};
  const kept = [];

  lists.forEach((sectionRows, at) => {
    const bad = flags[at].releaseBeforePress > 0 || flags[at].startsBeforePreviousEnd;
    const result = dropBadTimestamps && bad ? { dropped: 'bad-timestamps' } : sentenceRun(sectionRows);

    if (result.run) kept.push({ ...result, flags: flags[at] });
    else dropped[result.dropped] = (dropped[result.dropped] ?? 0) + 1;
  });

  kept.sort((a, b) => a.run.at.localeCompare(b.run.at));

  return { kept, dropped, sentences: sections.size, flags };
}

// The participants ADR 0030 keeps: QWERTY on a full or laptop keyboard.
export function keptParticipants(metadata) {
  const [header, ...lines] = metadata.split('\n');
  const names = header.trim().split('\t');
  const at = (name) => names.indexOf(name);
  const kept = new Set();

  for (const line of lines) {
    const fields = line.split('\t');

    if (fields[at('LAYOUT')] === KEPT_LAYOUT && KEPT_KEYBOARDS.has(fields[at('KEYBOARD_TYPE')])) kept.add(fields[at('PARTICIPANT_ID')]);
  }

  return kept;
}

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? fallback : process.argv[index + 1];
}

const emptyTally = () => ({ participants: 0, kept: 0, tooFewSentences: 0, sentences: 0, runs: 0, dropped: {}, misses: 0, shiftedMisses: 0, tries: 0,
  anomalies: { beforeReplay: emptyAnomalies(), retained: emptyAnomalies() } });

async function main() {
  const out = option('out', null);
  const metadata = option('metadata', null);
  const limit = Number(option('limit', Infinity));
  const dropBadTimestamps = process.argv.includes('--drop-bad-timestamps');

  if (!out || !metadata) throw new Error('usage: --metadata <metadata_participants.txt> --out <dir> [--limit n] [--drop-bad-timestamps], with the keystroke rows on stdin');
  mkdirSync(out, { recursive: true });
  const wanted = keptParticipants(readFileSync(metadata, 'utf8'));
  const report = { minSentences: MIN_SENTENCES, dropBadTimestamps, wrongKeyboardOrLayout: 0, unreadableRows: 0, splits: { train: emptyTally(), validation: emptyTally(), test: emptyTally() } };

  const writers = Object.fromEntries(Object.keys(report.splits).map((split) => {
    const gzip = createGzip();
    const file = createWriteStream(join(out, `runs-${split}.jsonl.gz`));
    gzip.pipe(file);

    return [split, { gzip, file }];
  }));

  let current = null;
  let rows = [];
  let seen = 0;

  const flush = async () => {
    if (!rows.length) return;

    if (!wanted.has(current)) {
      report.wrongKeyboardOrLayout += 1;

      return;
    }

    const split = splitOf(current);
    const tally = report.splits[split];
    const { kept, dropped, sentences, flags } = participantRuns(rows, { dropBadTimestamps });
    tally.participants += 1;
    addAnomalies(tally.anomalies.beforeReplay, flags);
    tally.sentences += sentences;

    for (const [reason, count] of Object.entries(dropped)) tally.dropped[reason] = (tally.dropped[reason] ?? 0) + count;

    if (kept.length < MIN_SENTENCES) {
      tally.tooFewSentences += 1;

      return;
    }

    tally.kept += 1;
    tally.runs += kept.length;
    addAnomalies(tally.anomalies.retained, kept.map((item) => item.flags));

    for (const { attempt } of kept) {
      const counts = shiftedMisses(attempt.summary.firstAttempts);
      tally.tries += attempt.summary.firstAttempts.length;
      tally.misses += counts.misses;
      tally.shiftedMisses += counts.shifted;
    }

    if (!writers[split].gzip.write(`${JSON.stringify({ id: current, split, runs: kept.map((item) => item.run) })}\n`)) {
      await new Promise((resolve) => { writers[split].gzip.once('drain', resolve); });
    }
  };

  let rest = '';
  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop();

    for (const line of lines) {
      const row = parseRow(line.endsWith('\r') ? line.slice(0, -1) : line);

      if (!row) {
        if (!line.startsWith('PARTICIPANT_ID') && line.trim()) report.unreadableRows += 1;
        continue;
      }

      if (row.participant !== current) {
        await flush();
        seen += current === null ? 0 : 1;
        current = row.participant;
        rows = [];
      }

      rows.push(row);
    }

    if (seen >= limit) break;
  }

  if (seen < limit) await flush();
  await Promise.all(Object.values(writers).map(({ gzip, file }) => new Promise((resolve) => {
    file.once('finish', resolve);
    gzip.end();
  })));
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
