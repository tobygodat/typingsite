// Pure serialisers for "Download my data". No DOM here; app.js turns the strings into downloads.
import { CORPUS_VERSION, METRIC_VERSION } from './typing.js';

// Every field conditionKey() compares is a column, so rows from different conditions stay distinguishable,
// and so is the passage identity runRecord() keeps, so repeated text never reads as fresh evidence.
export const CSV_COLUMNS = ['date', 'mode', 'length', 'word list', 'punctuation', 'difficulty', 'input', 'correction policy', 'corpus', 'metric version', 'wpm', 'accuracy', 'errors', 'duration', 'kind', 'interrupted', 'challenge date', 'first daily attempt', 'text id', 'fresh text'];

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function runLength(c = {}) {
  if (c.mode === 'time' && c.duration) return `${c.duration}s`;
  if (c.mode === 'words' && c.count) return `${c.count} words`;
  if (c.mode === 'quote') return c.quoteLength || '';
  return c.duration ? `${c.duration}s` : '';
}

export function runRow(run) {
  const c = run.conditions || {};
  // A drill is always one minute of generated, unpunctuated words, whatever its baseline conditions were.
  const drill = run.kind === 'drill';
  return [
    run.at || '',
    drill ? 'time' : c.mode || '',
    drill ? '60s' : runLength(c),
    c.wordList || '',
    c.punctuation && !drill ? 'yes' : 'no',
    drill ? '' : c.difficulty || '',
    c.inputClass === 'touch' ? 'touch input' : 'physical keyboard',
    c.correctionPolicy === 'relaxed' ? 'continue on error' : 'stop on error',
    c.corpus || CORPUS_VERSION,
    c.metricVersion || METRIC_VERSION,
    run.score?.wpm ?? '',
    run.score?.accuracy ?? '',
    run.errors ?? '',
    Number.isFinite(run.elapsedMs) ? (run.elapsedMs / 1000).toFixed(1) : '',
    run.kind || '',
    run.interrupted ? 'yes' : 'no',
    // The challenge's own day, which a run finishing after midnight UTC would otherwise lose.
    run.challengeDate || '',
    // Older daily runs predate firstDailyAttempt; the history view falls back to fresh the same way.
    run.kind === 'daily' ? ((run.firstDailyAttempt ?? run.fresh) ? 'yes' : 'no') : '',
    run.textId || '',
    run.fresh === false ? 'no' : 'yes',
  ];
}

export function runsToCsv(runs = []) {
  return [CSV_COLUMNS, ...runs.map(runRow)].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function exportFilename(kind, ext, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `stilltype-${kind}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.${ext}`;
}
