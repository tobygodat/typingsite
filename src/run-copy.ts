import { STANDARD_VERSION, DRILL_SECONDS, standardConditions } from './typing.js';
import type { Attempt, MinimumFailure } from './typing.js';
import { conditionParts, correctionLabel } from './insights.js';
import type { ConditionLabelSource } from './insights.js';
import { at as indexed, isRecord } from './domain-values.js';
import { bookPage } from './books.js';
import { LESSONS, LESSON_ACCURACY, lessonKeys, makeupShort } from './lessons.js';
import { speedFigure } from './units.js';
import type { NativeCopy } from './native-copy.js';
import type { LearningStore } from './learning-store.js';

type RunDescription = Omit<Partial<Attempt>, 'minimums' | 'conditions' | 'kind' | 'status' | 'stopped'> & { kind?: string; minimums?: unknown; conditions?: ConditionLabelSource };

export function createRunCopy(learning: LearningStore, conditions: () => ConditionLabelSource) {
  const customOrderLabel = (order: unknown) => String(Reflect.get({ shuffled: 'shuffled words', random: 'random words' }, String(order)) || 'as written');

  const recipeLabel = (recipe = STANDARD_VERSION) => recipe.replace('-', ' ');
  const recipeSummary = (value = standardConditions()) => `${recipeLabel(value.recipe)} · ${value.duration} s · english 1k–10k mix · punctuation, numbers, one quote`;

  function conditionTail(value: ConditionLabelSource) {
    const { language, length, text, ...tail } = conditionParts(value);

    return Object.values(tail).join(' · ');
  }

  const inputName = (value: ConditionLabelSource = conditions()) => inputLabel(value);

  function describeConditions(value: ConditionLabelSource = conditions(), sets: readonly (ConditionLabelSource | undefined)[] = []) {
    const { language, length, text, ...tail } = conditionParts(value, sets);

    if (value.mode === 'standard') return [length, '1k–10k mix', ...Object.values(tail)].join(' · ');

    if (value.mode === 'code') return [length, ...Object.values(tail), 'not counted toward bests'].join(' · ');

    if (value.mode === 'book') return [length, ...Object.values(tail)].join(' · ');

    return [language, length, text, ...Object.values(tail)].join(' · ');
  }

  function rawSpeedFigure(value: unknown) {
    if (typeof value === 'number' || value === null || value === undefined) return speedFigure(value);

    if (learning.preferences.speedUnit !== 'cpm' || typeof value === 'bigint' || typeof value === 'symbol') throw new TypeError('A speed figure needs a numeric value');

    const figure = speedFigure(Number(value));
    figure.dataset.wpm = String(value);
    figure.setAttribute('value', String(value));

    return figure;
  }

  function describeMinimums(minimums: unknown) {
    const accuracyValue = isRecord(minimums) ? minimums.accuracy : undefined;
    const wpm = isRecord(minimums) ? minimums.wpm : undefined;
    const accuracy: NativeCopy[] = accuracyValue ? [`min ${accuracyValue}% accuracy`] : [];

    return wpm ? [...accuracy, accuracy.length ? ' · min ' : 'min ', rawSpeedFigure(wpm)] : accuracy;
  }

  function stopReason(stop: MinimumFailure) {
    if (stop.atEnd) return ['Finished under your ', ...(stop.metric === 'accuracy' ? [`${stop.minimum}% minimum accuracy`] : [rawSpeedFigure(stop.minimum), ' minimum speed'])];

    return ['Stopped: ', ...(stop.metric === 'accuracy' ? [`accuracy fell below ${stop.minimum}%`] : ['speed fell below ', rawSpeedFigure(stop.minimum)])];
  }

  function describeRules(value: ConditionLabelSource) {
    const { strictSpace, quickEnd } = conditionParts(value);

    return [strictSpace, quickEnd].flatMap((rule) => (rule ? [` · ${rule}`] : [])).join('');
  }

  function inputLabel(value: ConditionLabelSource = conditions()) {
    const { input, layout } = conditionParts(value);

    return layout ? `${input} · ${layout}` : String(input);
  }

  function requiredConditions(run: RunDescription) {
    if (!run.conditions) throw new TypeError('This run requires its conditions');

    return run.conditions;
  }

  function describeRun(run: RunDescription) {
    if (run.kind === 'lesson') return describeLesson(run);

    if (run.kind === 'challenge') return `ghost race · ${describeConditions(run.conditions)}`;

    if (run.kind === 'daily') return `daily · ${run.challengeDate} · ${run.firstDailyAttempt ? 'first attempt' : 'repeat attempt'}${run.firstDailyAttempt && !run.fresh ? ' · previously displayed passage' : ''} · ${describeConditions(run.conditions)}`;

    if (run.kind === 'missed') return `missed words · not counted · ${run.text?.split(' ').length || 40} words${requiredConditions(run).punctuation ? ' · punctuation' : ''}${requiredConditions(run).numbers ? ' · numbers' : ''} · ${requiredConditions(run).inputClass === 'touch' ? 'touch input' : 'physical keyboard'} · ${correctionLabel(requiredConditions(run).correctionPolicy)}`;

    if (run.kind === 'custom') return `custom text · ${customOrderLabel(requiredConditions(run).customOrder)} · ${requiredConditions(run).inputClass === 'touch' ? 'touch input' : 'physical keyboard'} · ${correctionLabel(requiredConditions(run).correctionPolicy)} · not counted`;

    if (run.adaptive) return `adaptive · ${describeConditions(run.conditions)}`;

    if (run.kind !== 'drill') {
      const minimums = describeMinimums(run.minimums);
      const page = run.conditions?.mode === 'book' && bookPage(run.textId);

      return [`${run.fresh === false ? 'repeated text · ' : ''}${page ? `page ${page} · ` : ''}${describeConditions(run.conditions)}`, ...(minimums.length ? [' · ', ...minimums] : [])];
    }

    return `drill · ${run.drillSeconds || DRILL_SECONDS} s · english · ${inputLabel(requiredConditions(run))} · ${correctionLabel(requiredConditions(run).correctionPolicy)}${describeRules(requiredConditions(run))}`;
  }

  function describeLesson(run: RunDescription) {
    const index = LESSONS.findIndex((lesson) => lesson.id === requiredConditions(run).lesson);

    return [`lesson ${index + 1} of ${LESSONS.length} · keys ${lessonKeys(index).join(' ')} · ${makeupShort(index, run.lesson)} · pass at ${LESSON_ACCURACY}% accuracy and `,
      speedFigure(indexed(LESSONS, index).wpm), ` · ${inputName(requiredConditions(run))} · ${correctionLabel(requiredConditions(run).correctionPolicy)}`];
  }

  return { recipeLabel, recipeSummary, conditionTail, describeConditions, describeMinimums, stopReason, describeRun, inputLabel };
}
