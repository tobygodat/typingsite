import { at } from './domain-values.js';
export type Hand = 'left' | 'right' | 'both';
export type Finger = 'index' | 'middle' | 'ring' | 'pinky' | 'thumb';
export interface KeyboardKey { key: string; hand: Hand; finger: Finger; column: number }
interface Layout { label: string; rows: string[]; angle?: boolean }
// Keyboard layouts for the on-screen keyboard legend and its optional finger map.
// Typed characters are never remapped: people who switch layouts do it in the operating
// system, so the engine scores whatever characters arrive. The layout is recorded in the
// test conditions so bests and retests never mix layouts.

export const DEFAULT_LAYOUT = 'qwerty';

// The thirty main keys of a row-staggered (ANSI) keyboard, top, home and bottom row, as each
// layout labels them. Colemak-DH uses its recommended ANSI form with the angle mod (bottom row
// x c d v z), which shifts the left hand's bottom-row fingers one key over.
const LAYOUTS: Record<string, Layout> = {
  qwerty: { label: 'qwerty', rows: ['qwertyuiop', 'asdfghjkl;', 'zxcvbnm,./'] },
  dvorak: { label: 'dvorak', rows: ["',.pyfgcrl", 'aoeuidhtns', ';qjkxbmwvz'] },
  colemak: { label: 'colemak', rows: ['qwfpgjluy;', 'arstdhneio', 'zxcvbkm,./'] },
  'colemak-dh': { label: 'colemak-dh', rows: ['qwfpbjluy;', 'arstgmneio', 'xcdvzkh,./'], angle: true },
  workman: { label: 'workman', rows: ['qdrwbjfup;', 'ashtgyneoi', 'zxmcvkl,./'] },
};

export const layoutIds = Object.keys(LAYOUTS);

// Touch typing assigns each column to one finger; both index fingers also take the inner column.
const COLUMN_FINGERS: [Hand, Finger][] = [
  ['left', 'pinky'], ['left', 'ring'], ['left', 'middle'], ['left', 'index'], ['left', 'index'],
  ['right', 'index'], ['right', 'index'], ['right', 'middle'], ['right', 'ring'], ['right', 'pinky'],
];

// With the angle mod the left hand's bottom row moves one finger inward: ring, middle, index, index, index.
const ANGLE_FINGERS: [Hand, Finger][] = [
  ['left', 'ring'], ['left', 'middle'], ['left', 'index'], ['left', 'index'], ['left', 'index'],
  ...COLUMN_FINGERS.slice(5),
];

export const FINGERS = ['index', 'middle', 'ring', 'pinky'];

export function normalizeLayout(id: unknown) {
  return typeof id === 'string' && layoutIds.includes(id) ? id : DEFAULT_LAYOUT;
}

// Runs saved before layouts existed have none, and read as QWERTY.
export function isDefaultLayout(id: unknown) {
  return !id || id === DEFAULT_LAYOUT;
}

export function layoutLabel(id: string | undefined) {
  return LAYOUTS[id ?? DEFAULT_LAYOUT]?.label || String(id || DEFAULT_LAYOUT);
}

// Rows of { key, hand, finger, column } for the legend, ending with the space bar (both thumbs).
export function keyboardRows(id: unknown): KeyboardKey[][] {
  const layout = LAYOUTS[normalizeLayout(id)] ?? at(Object.values(LAYOUTS), 0);

  const rows = layout.rows.map((row, rowIndex) => [...row].map((key, column) => {
    const [hand, finger] = at(layout.angle && rowIndex === 2 ? ANGLE_FINGERS : COLUMN_FINGERS, column);

    return { key, hand, finger, column };
  }));

  return [...rows, [{ key: ' ', hand: 'both', finger: 'thumb', column: 0 }]];
}

export function fingerFor(id: unknown, character: unknown) {
  const char = String(character || '').toLowerCase();

  for (const row of keyboardRows(id)) {
    const key = row.find((entry) => entry.key === char);

    if (key) return { hand: key.hand, finger: key.finger };
  }

  return null;
}
