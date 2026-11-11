// One typist, one month, six friends. Every direction of a page reads from this, so the comparison is fair.

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(420);
const noise = (span) => (rand() * 2 - 1) * span;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const start = Date.UTC(2026, 9, 14);
const DAY = 86400000;
export const dayLabel = (i) => {
  const d = new Date(start + i * DAY);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

const gaps = new Set([5, 11, 12, 18, 21]);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const days = [];
for (let i = 0; i < 28; i += 1) {
  if (gaps.has(i)) {
    days.push({ i, label: dayLabel(i), runs: [], minutes: 0 });
    continue;
  }
  const count = i === 27 ? 4 : 3 + Math.floor(rand() * 6);
  const runs = [];
  for (let r = 0; r < count; r += 1) {
    const wpm = Math.round(67.5 + i * 0.46 + noise(5.5));
    const acc = Math.min(99.2, Math.round((93.6 + i * 0.11 + noise(1.6)) * 10) / 10);
    const cons = Math.round(70 + i * 0.26 + noise(4));
    runs.push({ wpm, acc, cons });
  }
  if (i === 23) runs[1].wpm = 91;
  const minutes = i === 27 ? 9 : Math.round(count * 1.4 + (rand() > 0.4 ? 5 : 0) + rand() * 8);
  days.push({ i, label: dayLabel(i), runs, minutes });
}

export const best = { wpm: Math.max(...days.flatMap((d) => d.runs.map((r) => r.wpm))), day: dayLabel(23) };

const weekRuns = (from, to) => days.slice(from, to + 1).flatMap((d) => d.runs);
const thisWeek = weekRuns(21, 27);
const lastWeek = weekRuns(14, 20);
export const week = {
  now: { wpm: Math.round(median(thisWeek.map((r) => r.wpm))), acc: median(thisWeek.map((r) => r.acc)).toFixed(1), cons: Math.round(median(thisWeek.map((r) => r.cons))), runs: thisWeek.length, minutes: days.slice(21).reduce((s, d) => s + d.minutes, 0) },
  then: { wpm: Math.round(median(lastWeek.map((r) => r.wpm))), acc: median(lastWeek.map((r) => r.acc)).toFixed(1), cons: Math.round(median(lastWeek.map((r) => r.cons))), runs: lastWeek.length, minutes: days.slice(14, 21).reduce((s, d) => s + d.minutes, 0) },
};
export const firstWeek = { wpm: Math.round(median(weekRuns(0, 6).map((r) => r.wpm))) };
export const totalRuns = days.reduce((s, d) => s + d.runs.length, 0);

export const series = (key) => days.map((d) => (d.runs.length ? median(d.runs.map((r) => r[key])) : null));
export const dots = (key) => days.flatMap((d) => d.runs.map((r) => ({ i: d.i, v: r[key] })));
export const minutes = days.map((d) => d.minutes);

let streak = 0;
for (let i = 27; i >= 0 && days[i].minutes > 0; i -= 1) streak += 1;
export { streak };
export const goal = 15;
export const conditions = 'english 1k · 25 words · physical keyboard';

const times = ['21:42', '21:39', '21:35', '21:31', '20:58', '20:55', '20:51', '20:47', '20:44', '20:40'];
export const recentRuns = (() => {
  const out = [];
  for (let i = 27; i >= 0 && out.length < 10; i -= 1) {
    for (let r = days[i].runs.length - 1; r >= 0 && out.length < 10; r -= 1) {
      out.push({ ...days[i].runs[r], day: days[i].label, time: times[out.length] });
    }
  }
  return out;
})();

// The skill model (TOB-419): first-try misses, timing against your own median, expected gain.
export const target = { pair: 'br', missed: 7, tries: 31, slow: 140, words: ['bright', 'library', 'brown', 'number', 'bring'] };
export const queue = [
  { pair: 'ce', missed: 5, tries: 40, slow: 95 },
  { pair: 'ex', missed: 4, tries: 18, slow: 120 },
  { pair: 'un', missed: 2, tries: 52, slow: 80 },
  { pair: 'my', missed: 3, tries: 12, slow: 60, unsure: true },
];
export const fixed = [
  { pair: 'qu', before: '6 of 22', after: '1 of 25', what: 'missed' },
  { pair: 'ol', before: '180 ms', after: '60 ms', what: 'over your pace' },
];
export const slipping = { pair: 'ex', before: '1 of 20', after: '4 of 18', what: 'missed' };

export const sessions = [
  { day: 'Nov 9', pair: 'ce', wpm: [76, 79], acc: [95, 97], outcome: 'improved' },
  { day: 'Nov 7', pair: 'qu', wpm: [74, 77], acc: [94, 97], outcome: 'improved' },
  { day: 'Nov 5', pair: 'ol', wpm: [75, 75], acc: [96, 96], outcome: 'steady' },
  { day: 'Nov 2', pair: 'ex', wpm: [73, 71], acc: [95, 96], outcome: 'mixed' },
];

// Per key: share of first tries missed, and tries.
export const keys = {
  q: [1.2, 40], w: [1.4, 310], e: [2.1, 1210], r: [6.2, 640], t: [1.1, 980], y: [2.6, 260], u: [3.4, 420], i: [1.3, 760], o: [1.9, 820], p: [2.2, 220],
  a: [1.0, 900], s: [1.5, 720], d: [1.2, 480], f: [0.9, 260], g: [2.0, 230], h: [1.1, 610], j: [3.1, 30], k: [2.4, 110], l: [1.7, 460],
  z: [3.0, 20], x: [7.4, 34], c: [5.3, 330], v: [2.8, 140], b: [9.1, 212], n: [2.2, 760], m: [4.2, 300],
};
export const keyPairs = {
  b: [['br', 7, 31], ['bl', 2, 22], ['ob', 1, 17], ['be', 1, 38]],
  x: [['ex', 4, 18], ['xp', 1, 8], ['xt', 0, 9]],
  r: [['br', 7, 31], ['ur', 3, 37], ['re', 2, 88], ['ro', 1, 54]],
  c: [['ce', 5, 40], ['ck', 2, 29], ['ec', 1, 26]],
  m: [['my', 3, 12], ['mb', 1, 10], ['me', 1, 44]],
  u: [['un', 2, 52], ['qu', 1, 25], ['ur', 3, 37]],
};
export const keyHeat = (rate) => (rate >= 8 ? 3 : rate >= 5 ? 2 : rate >= 3 ? 1 : 0);
export const pairHeat = (missed, tries) => {
  const rate = (missed / tries) * 100;
  return rate >= 15 ? 3 : rate >= 8 ? 2 : rate >= 4 ? 1 : 0;
};

export const standard = { wpm: 76, runs: 3 };

// Challenge.
export const rating = { value: '1,412', change: '+14', matches: 31 };
export const friends = [
  { name: 'Maya Okafor', week: 86, rating: '1,455', last: { them: 84, you: 82, day: 'Nov 8' }, tally: [3, 4], online: true, ghost: { wpm: 84, left: '6 days left' } },
  { name: 'Sam Achebe', week: 80, rating: '1,398', last: { them: 77, you: 81, day: 'Nov 6' }, tally: [2, 2], online: true },
  { name: 'Priya Raman', week: 94, rating: '1,530', last: { them: 93, you: 80, day: 'Nov 4' }, tally: [1, 6], invite: '2 min ago' },
  { name: 'Lena Ortiz', week: 88, rating: '1,470', last: { them: 87, you: 79, day: 'Oct 31' }, tally: [0, 2] },
  { name: 'Theo Lindqvist', week: 72, rating: '1,301', last: { them: 70, you: 78, day: 'Oct 29' }, tally: [5, 1] },
  { name: 'Jonas Weber', week: 67, rating: '1,262', last: { them: 64, you: 76, day: 'Oct 22' }, tally: [3, 0] },
];
export const daily = {
  date: 'Nov 10',
  players: 214,
  you: { rank: 9, wpm: 82, acc: 96.8 },
  rows: [
    ['kestrel', 128, 98.9], ['amaru', 121, 97.6], ['nadia.k', 117, 99.1], ['fjord', 112, 96.2], ['quillon', 106, 98.0],
    ['tomasz', 101, 97.3], ['ivy_r', 97, 95.8], ['Priya Raman', 88, 98.4], ['you', 82, 96.8], ['hollis', 81, 97.0],
    ['Maya Okafor', 80, 96.1], ['ren', 78, 94.9], ['oduya', 77, 97.7], ['marguerite', 75, 96.6], ['b.salo', 74, 95.2],
    ['wren', 72, 98.2], ['Sam Achebe', 71, 96.4], ['pell', 69, 93.8], ['kaito', 68, 97.1], ['dunmore', 66, 95.5],
  ],
};
