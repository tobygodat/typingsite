import { flushSync } from 'react-dom';
import { isRecord } from './domain-values.js';
import type { AnalysisRun, HistoricalLoop } from './profile-types.js';
import type { LearningStore, LoopView } from './learning-store.js';
import type { ConditionLabelSource } from './insights.js';
import { paceShift } from './learner.js';
import { copyParts } from './native-copy.js';
import type { NativeCopy } from './native-copy.js';
import { signedNumber, speedFigure } from './units.js';

interface LoopPorts {
  describe(source?: ConditionLabelSource): string;
  practice(target: string, source: ConditionLabelSource): void;
}

function field(value: unknown, key: string): unknown {
  if (value === null || value === undefined) throw new TypeError(`Cannot read ${key} from an absent historical value`);
  const boxed: unknown = Object(value);

  return isRecord(boxed) ? boxed[key] : undefined;
}

const optionalField = (value: unknown, key: string) => value === null || value === undefined ? undefined : field(value, key);
const domText = (value: unknown) => value === null || value === undefined ? '' : String(value);
const plural = (count: unknown, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const signed = (value: unknown, unit: string) => `${signedNumber(Number(value))} ${unit}`;

function jsonAdd(left: unknown, right: unknown) {
  const a = left !== null && (typeof left === 'object' || typeof left === 'function') ? String(left) : left;
  const b = right !== null && (typeof right === 'object' || typeof right === 'function') ? String(right) : right;

  if (typeof a === 'symbol' || typeof b === 'symbol') throw new TypeError('A timing count cannot add a symbol');

  if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b);

  if (typeof a === 'bigint' && typeof b === 'bigint') return a + b;

  if (typeof a === 'bigint' || typeof b === 'bigint') throw new TypeError('A timing count cannot mix big integers');

  return Number(a) + Number(b);
}

function nativeCopy(value: unknown): NativeCopy {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Node) return value;

  if (Array.isArray(value)) return value.map(nativeCopy);
  throw new TypeError('Historical copy cannot render an object');
}

function historicalDate(value: string | null | undefined) {
  return new Date(value === null ? 0 : value === undefined ? NaN : value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function createLoopHistory(learning: LearningStore, ports: LoopPorts) {
  function speed(value: unknown) {
    if (typeof value === 'number' || value === null || value === undefined) return speedFigure(value);

    if (learning.preferences.speedUnit !== 'cpm' || typeof value === 'bigint' || typeof value === 'symbol') throw new TypeError('A speed figure needs a numeric value');
    const figure = speedFigure(Number(value));
    figure.dataset.wpm = String(value);
    figure.setAttribute('value', String(value));

    return figure;
  }

  function render(loops: readonly (HistoricalLoop & AnalysisRun)[]) {
    const rows: LoopView[] = loops.map((loop) => {
      const target = loop.target || null;
      const source = loop.conditions;
      const drilled = loop.drillCompleted || Boolean(field(loop, 'drill'));
      let conditions = ports.describe(loop.conditions);
      const pace = field(loop, 'targetPace');
      const candidate = field(loop, 'targetTiming');
      const timing = optionalField(candidate, 'target') && Number(jsonAdd(field(candidate, 'beforeCount'), field(candidate, 'afterCount'))) > 0 ? candidate : null;
      const misses = field(loop, 'targetMisses');

      if (pace) {
        const now = field(pace, 'now');
        const was = field(pace, 'was');
        const nowPace = field(now, 'slowMs');
        const wasPace = field(was, 'slowMs');
        conditions += ` · ${field(pace, 'target')} ${paceShift(Number(nowPace ?? 0))} over ${plural(field(now, 'timed'), 'interval')}, was ${paceShift(Number(wasPace ?? 0))} over ${field(was, 'timed')}`;
      } else if (misses) {
        const now = field(misses, 'now');
        const was = field(misses, 'was');
        conditions += ` · ${field(misses, 'target')} missed ${field(now, 'errors')} of ${field(now, 'observations')}, was ${field(was, 'errors')} of ${field(was, 'observations')}`;
      } else if (timing) conditions += ` · ${field(timing, 'target')} · ${field(timing, 'beforeCount')} before · ${field(timing, 'afterCount')} after`;
      const notes: ReturnType<typeof copyParts>[] = [];

      if (timing) notes.push(copyParts(`“${field(timing, 'target')}” clean intervals: ${field(timing, 'beforeCount')} before / ${field(timing, 'afterCount')} after. ${field(timing, 'deltaMs') === null ? 'Too few samples to call a timing change.' : `${signed(field(timing, 'deltaMs'), 'ms')} median timing change.`}`));
      const comparison = loop.comparison;
      notes.push(copyParts(nativeCopy(field(comparison, 'reason') || 'One retest is feedback, not proof.')));

      if (loop.beforeAttemptId && loop.afterAttemptId) notes.push(copyParts(`Baseline ${loop.beforeAttemptId} · retest ${loop.afterAttemptId}. Open their run entries above for saved details.`));
      const before = field(comparison, 'before');
      const after = field(comparison, 'after');
      const state = field(comparison, 'state');

      return {
        id: loop.id, date: historicalDate(loop.at),
        title: drilled ? loop.target ? `“${loop.target}” drill and retest` : 'General drill and retest' : 'Fresh-text check',
        conditions, accuracy: signed(field(comparison, 'accuracyDelta'), 'pp'), delta: field(comparison, 'wpmDelta'), state: domText(state),
        tone: state === 'improved' ? 'success' : state === 'regressed' ? 'danger' : 'neutral',
        facts: [
          { label: 'before', parts: copyParts(before ? [speed(field(before, 'wpm')), ` · ${field(before, 'accuracy')}%`] : 'Not retained in this older comparison') },
          { label: 'after', parts: copyParts(after ? [speed(field(after, 'wpm')), ` · ${field(after, 'accuracy')}%`] : 'Not retained in this older comparison') },
          { label: 'drill', parts: copyParts(loop.drillCompleted ? `${optionalField(field(loop, 'drill'), 'duration') || 60} s · ${loop.target || 'general'}` : drilled ? `interrupted · ${loop.target || 'general'}` : 'Skipped') },
        ], notes, target,
        practice() {
          if (!target) return;

          if (typeof target !== 'string' || !isRecord(source)) throw new TypeError('A loop action requires its target and conditions');
          ports.practice(target, source);
        },
      };
    });

    flushSync(() => learning.loops.publish(rows));
  }

  return { render };
}
