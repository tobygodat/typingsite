import { FINGER_ZONES, fingerFor } from './lessons.js';

type Hand = 'left' | 'right';

export const FINGER_ROWS = { left: ['qwert', 'asdfg', 'zxcvb'], right: ['yuiop', 'hjkl;', 'nm'] };
export const FINGER_COLUMNS = { left: [['pinky', 1, 1], ['ring', 2, 1], ['middle', 3, 1], ['index', 4, 2]], right: [['index', 1, 2], ['middle', 3, 1], ['ring', 4, 1], ['pinky', 5, 1]] } satisfies Record<Hand, [string, number, number][]>;

export function fingerMapLabel(fresh: readonly string[]) {
  const zones = FINGER_ZONES.map((zone) => `${zone.hand} ${zone.finger}: ${zone.keys.join(' ')}`);

  return `Finger map. ${zones.join('. ')}. Thumbs: space.${fresh.length ? ` New keys: ${fresh.join(' ')}, ${fresh.map((key) => fingerFor(key)).join(' and ')}.` : ''}`;
}

export function FingerMap({ id, known, fresh }: { id: string; known: readonly string[]; fresh: readonly string[] }) {
  const hands: Hand[] = ['left', 'right'];
  const keyClass = (letter: string) => `key${letter === ' ' ? ' space' : ''}${fresh.includes(letter) ? ' target' : ''}${letter === ' ' || known.includes(letter) ? ' is-known' : ''}`;

  return <div id={id} className="keyboard finger-map" role="img" aria-label={fingerMapLabel(fresh)}>
    {hands.map((hand) => <div key={hand} className={`finger-hand finger-hand-${hand}`}>
      {FINGER_ROWS[hand].flatMap((row, rowIndex) => [...row].map((letter, column) => <span key={letter} className={keyClass(letter)} data-key={letter} style={{ gridArea: `${rowIndex + 1} / ${column + 1}` }}>{letter}</span>))}
      {FINGER_COLUMNS[hand].map(([finger, column, span]) => <span key={finger} className="finger-label" style={{ gridArea: `4 / ${column} / 5 / ${column + span}` }}><span className="finger-label-full">{finger}</span><span className="finger-label-short">{finger[0]}</span></span>)}
    </div>)}
    <div className="finger-thumbs"><span className={keyClass(' ')} data-key=" ">space</span><span className="finger-label">thumbs</span></div>
    <span className="finger-legend">p pinky · r ring · m middle · i index</span>
  </div>;
}
