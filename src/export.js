// Pure serialisers for "Download my data". No DOM here; app.js turns the strings into downloads.

export const CSV_COLUMNS = ['date', 'mode', 'length', 'word list', 'punctuation', 'correction policy', 'wpm', 'accuracy', 'errors', 'duration', 'kind', 'interrupted'];

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
  return [
    run.at || '',
    c.mode || '',
    runLength(c),
    c.wordList || '',
    c.punctuation ? 'yes' : 'no',
    c.correctionPolicy === 'relaxed' ? 'continue on error' : 'stop on error',
    run.score?.wpm ?? '',
    run.score?.accuracy ?? '',
    run.errors ?? '',
    Number.isFinite(run.elapsedMs) ? (run.elapsedMs / 1000).toFixed(1) : '',
    run.kind || '',
    run.interrupted ? 'yes' : 'no',
  ];
}

export function runsToCsv(runs = []) {
  return [CSV_COLUMNS, ...runs.map(runRow)].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function exportFilename(kind, ext, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `stilltype-${kind}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.${ext}`;
}
