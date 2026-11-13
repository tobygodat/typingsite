import type { LearningStore } from './learning-store.js';
import type { PracticeSession, SessionKind } from './practice-session.js';
import type { TrainingMemory } from './training-memory.js';
import type { createLocalRace } from './local-race.js';
import type { OnlineRaceController } from './online-race.js';
import type { createGhostResult } from './ghost-result.js';
import type { createNavigation } from './navigation.js';
import type { Conditions } from './typing.js';
import { STANDARD_SECONDS } from './typing.js';
import { isRecord } from './domain-values.js';

type RuleKind = SessionKind | 'race';

interface RuleSession { kind: RuleKind; run: Conditions; fixed?: boolean }

interface RuleLimits { fixed: RuleKind | 'standard' | ''; quickEnd: 'drill' | 'timed' | 'stopOnError' | '' }

interface ConditionsPorts {
  conditions(): Conditions;
  daily(): Conditions;
  custom(): Conditions;
  lesson(): Conditions;
  ghost(): Conditions;
  race(): Conditions;
}

const FIXED_RULE_KINDS: readonly RuleKind[] = ['daily', 'retest', 'custom', 'lesson', 'missed', 'challenge'];

export function createSessionRules(learning: LearningStore, practice: PracticeSession, training: TrainingMemory,
  local: ReturnType<typeof createLocalRace>, online: OnlineRaceController, ghost: ReturnType<typeof createGhostResult>,
  navigation: ReturnType<typeof createNavigation>, ports: ConditionsPorts) {
  const restartKind = () => practice.sessionKind === 'custom' && learning.preferences.customText ? 'custom' : 'practice';
  const raceUnderWay = () => Boolean(local.state.conditions) && local.state.results.length < 2;

  const drillLength = () => training.context?.drill?.duration
    || (practice.attempt && (practice.attempt.status === 'ready' || practice.attempt.status === 'running') && practice.attempt.drillSeconds)
    || learning.preferences.drillSeconds;

  function sessionDurationMs(kind: RuleKind = practice.sessionKind) {
    if (kind === 'challenge') return ghost.race?.duration ? ghost.race.duration * 1000 : null;

    if (['daily', 'lesson', 'missed', 'race'].includes(kind)) return null;

    if (kind === 'drill') return drillLength() * 1000;

    if (kind === 'custom') return null;

    if (learning.preferences.mode === 'time') return Number(learning.preferences.duration) * 1000;

    if (learning.preferences.mode === 'standard') return STANDARD_SECONDS * 1000;

    return null;
  }

  function ruleLimits({ kind, run, fixed = FIXED_RULE_KINDS.includes(kind) }: RuleSession): RuleLimits {
    return {
      fixed: run.mode === 'standard' ? 'standard' : fixed ? kind : '',
      quickEnd: sessionDurationMs(kind) !== null ? kind === 'drill' ? 'drill' : 'timed'
        : run.correctionPolicy === 'relaxed' ? '' : 'stopOnError',
    };
  }

  function ruleSession(): RuleSession {
    if (navigation.view.getSnapshot().screen === 'compete' && online.mode === 'local') {
      return local.state.conditions && local.state.results.length < 2
        ? { kind: 'race', run: local.state.conditions, fixed: true } : { kind: 'race', run: ports.race() };
    }

    if (practice.attempt && (practice.attempt.status === 'ready' || practice.attempt.status === 'running')) return { kind: practice.sessionKind, run: practice.attempt.conditions };
    const kind = practice.sessionKind === 'daily' ? 'daily' : restartKind();

    return { kind, run: sessionConditions(kind) };
  }

  function sessionConditions(kind: RuleKind, run = ports.conditions()) {
    if (kind === 'daily') return ports.daily();

    if (kind === 'custom') return ports.custom();

    if (kind === 'lesson') return ports.lesson();

    if (kind === 'challenge') return ports.ghost();

    if (kind === 'missed') return { ...run, strictSpace: false, quickEnd: true };

    if (kind === 'retest' && training.baseline) {
      const baseline = training.baseline.conditions;

      if (!isRecord(baseline)) throw new TypeError('A retest requires its baseline conditions');
      run.strictSpace = baseline.strictSpace === true;
      run.quickEnd = baseline.quickEnd !== false;
    }

    if (ruleLimits({ kind, run }).quickEnd) run.quickEnd = true;

    return run;
  }

  return { restartKind, drillLength, sessionDurationMs, ruleLimits, ruleSession, sessionConditions, raceUnderWay };
}
