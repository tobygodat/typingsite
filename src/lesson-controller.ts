import { flushSync } from 'react-dom';
import { at as indexed } from './domain-values.js';
import { isDefaultLayout } from './layouts.js';
import { LESSONS, LESSON_ACCURACY, fingerFor, keysLabel, lessonKeys, lessonOutcome, lessonUnlocked, makeupCopy, nextLessonIndex, recordLessonRun } from './lessons.js';
import { recordPracticeTime } from './insights.js';
import { copyParts, plain } from './native-copy.js';
import type { NativeCopy } from './native-copy.js';
import { formatSpeed, speedFigure } from './units.js';
import type { LearningStore, LessonFactView, LessonRowView } from './learning-store.js';
import type { ProfileSync } from './profile-sync.js';
import type { CompletedAttempt, Score } from './typing.js';
import type { LessonProgress } from './profile-types.js';

type Lesson = typeof LESSONS[number];

type LessonOutcome = ReturnType<typeof lessonOutcome>;

type LessonAction = [string, () => void];

interface LessonResult {
  failed: CompletedAttempt['failed']; index: number; score: Score; elapsedMs: number; errors: number;
  outcome: LessonOutcome | null; firstPass: boolean; recorded: boolean; at: string; touch: boolean; saved: boolean; valid: boolean;
}

interface LessonPorts {
  beforeStart(): void;
  reset(kind: 'lesson' | 'practice', options: { focus: boolean }): void;
  learn(): void;
  openLearn(): void;
  announce(message: string): void;
}

function host(id: string) {
  const element = document.getElementById(id);

  if (!element) throw new Error(`Missing lesson host ${id}`);

  return element;
}

function outcomeOf(result: LessonResult) {
  if (!result.outcome) throw new Error('A valid lesson result requires its outcome');

  return result.outcome;
}

export function createLessonController(learning: LearningStore, sync: ProfileSync, ports: LessonPorts) {
  let lessonIndex = 0;
  let lessonResult: LessonResult | null = null;

  const handoffCopy = () => `That’s the whole keyboard. From here the training loop takes over: take a practice run, and Train suggests a ${learning.preferences.drillSeconds}-second drill from your own mistakes once there’s enough evidence${learning.preferences.retest ? ', then retests you on fresh text' : ''}.`;

  function lessonCopy(index: number, current: (NonNullable<Parameters<typeof makeupCopy>[1]> & { lessonId?: string }) | null = null) {
    return `${indexed(LESSONS, index).focus} ${makeupCopy(index, current?.lessonId === indexed(LESSONS, index).id ? current : null)}`;
  }

  const lessonFingers = (lesson: Lesson) => lesson.keys.map((key) => `${key} ${fingerFor(key)}`).join(' · ');

  // "left and right index" for a mirrored pair, otherwise each finger in key order.
  function fingerNames(lesson: Lesson) {
    const fingers = lesson.keys.map((key) => fingerFor(key));

    const [a, b] = fingers.map((name) => {
      if (name === null) throw new Error('A lesson key requires a finger');

      return name.split(' ');
    });

    return a && b && a[0] !== b[0] && a[1] === b[1] ? `${a[0]} and ${b[0]} ${a[1]}` : fingers.join(' and ');
  }

  function lessonMeta(index: number) {
    const lesson = indexed(LESSONS, index);
    const tries = learning.profile.lessons[lesson.id]?.tries;

    return [`${lessonFingers(lesson)} · pass at ${LESSON_ACCURACY}% accuracy and `, speedFigure(lesson.wpm), ` in one run${tries ? ` · ${tries} ${tries === 1 ? 'try' : 'tries'} so far` : ''}`];
  }

  // Like every run, a lesson is classed by the press that started it (resetSession reads activationInput).
  function startLesson(index: number) {
    if (!lessonUnlocked(learning.profile.lessons, index)) return;

    ports.beforeStart();
    lessonIndex = index;
    ports.reset('lesson', { focus: true });
    // From a scrolled learn screen too, a lesson starts with its title, label and finger map in view.
    scrollTo({ top: 0, behavior: 'instant' });
  }

  // The in-page links sit in a screen that is about to hide, so focus moves to the learn screen's action.
  function openLessons() {
    ports.openLearn();
    host('lesson-primary').focus({ preventScroll: true });
  }

  // Every letter is in: the training loop (practice → recommendation → drill → retest) takes over.
  function startTrainingLoop() {
    lessonResult = null;
    ports.reset('practice', { focus: true });
  }

  function finishLesson(completed: CompletedAttempt, valid: boolean) {
    const { score, elapsedMs, firstAttempts } = completed.summary;
    const touch = completed.conditions.inputClass === 'touch';
    let outcome: LessonOutcome | null = null;
    let firstPass = false;
    let recorded = false;
    let saved = true;
    const at = new Date().toISOString();

    if (valid) {
      const run = recordLessonRun(learning.profile.lessons, lessonIndex, score, at, completed.conditions.inputClass);
      // A lesson that was locked when it finished saves nothing, but still shows its numbers.
      outcome = run.outcome || lessonOutcome(lessonIndex, score);
      firstPass = run.firstPass;
      recorded = run.recorded;

      if (recorded) {
        learning.profile.lessons = run.progress;
        learning.profile.practiceDays = recordPracticeTime(learning.profile.practiceDays, at, elapsedMs);
        saved = sync.saveProfile();
      }
    }

    lessonResult = { failed: completed.failed, index: lessonIndex, score, elapsedMs, errors: firstAttempts.filter((item) => !item.correct).length, outcome, firstPass, recorded, at, touch, saved, valid };
    ports.learn();
    ports.announce(`${plain(lessonHeadline(lessonResult))} ${score.accuracy}% accuracy, ${formatSpeed(score.wpm)}.`);
    // Show the result from the top of the page, or from the result itself when the page is too short.
    scrollTo({ top: 0, behavior: 'instant' });

    if (host('lesson-current').getBoundingClientRect().bottom > innerHeight) host('lesson-current').scrollIntoView({ block: 'start', behavior: 'instant' });
    host('lesson-primary').focus({ preventScroll: true });
  }

  // Whether progress still holds what a lesson result shows: its lesson open and, if the run was saved, that very
  // try. A newer account row adopted at load replaces tries made here before the check, whatever it unlocks.
  function lessonResultHeld(result: LessonResult, progress: LessonProgress) {
    if (!lessonUnlocked(progress, result.index)) return false;
    const entry = progress[indexed(LESSONS, result.index).id];

    return !result.recorded || [entry?.last?.at, entry?.passed?.at].includes(result.at);
  }

  function lessonHeadline(result: LessonResult) {
    const n = result.index + 1;

    if (!result.valid) return result.failed ? `Lesson ${n} failed · ${result.failed} · not counted` : `Lesson ${n} interrupted · not counted`;

    if (!result.recorded) return `Lesson ${n} is locked · not counted`;

    if (result.touch) return `Lesson ${n} on touch input · doesn’t unlock`;
    const next = nextLessonIndex(learning.profile.lessons);

    if (result.outcome?.passed) {
      if (!result.firstPass) return `Lesson ${n} passed again.`;

      if (next >= LESSONS.length) return `Lesson ${n} passed. Every letter is in.`;
      const keys = indexed(LESSONS, next).keys;

      return `Lesson ${n} passed. ${keysLabel(keys)} ${keys.length > 1 ? 'are' : 'is'} next.`;
    }

    const { accuracyMet, speedMet, accuracyTarget, wpmTarget } = outcomeOf(result);
    const needs = [accuracyMet ? '' : `${accuracyTarget}% accuracy`, !accuracyMet && !speedMet ? ' and ' : '', speedMet ? '' : speedFigure(wpmTarget)];

    return [`Not yet. Lesson ${n} needs `, needs, ' in one run.'];
  }

  function renderLessons() {
    const progress = learning.profile.lessons;
    const next = nextLessonIndex(progress);
    const complete = next >= LESSONS.length;
    const result = lessonResult;
    let status: [string, string] | null = null;
    let heading: NativeCopy;
    let copy: string;
    let meta: NativeCopy = '';
    let primary: LessonAction;
    let secondary: LessonAction | null = null;
    const start = (index: number) => () => startLesson(index);

    if (result) {
      const n = result.index + 1;
      const repeat: LessonAction = [`Repeat lesson ${n}`, start(result.index)];
      heading = lessonHeadline(result);

      if (!result.valid) {
        status = [result.failed ? 'failed' : 'interrupted', 'badge-warning'];
        copy = result.failed ? 'The correction setting ended this lesson, so it doesn’t count toward unlocking.' : 'Focus or input changed during the run, so it doesn’t count toward unlocking.';
        primary = [`Try lesson ${n} again`, start(result.index)];
      } else if (!result.recorded) {
        status = ['not counted', 'badge-neutral'];
        copy = 'Your lesson progress changed during this run (history was cleared here or on another device), so this lesson is locked and nothing was saved.';
        primary = complete ? ['Take a practice run', startTrainingLoop] : [`Start lesson ${next + 1}`, start(next)];
      } else if (result.touch) {
        status = ['touch input', 'badge-neutral'];
        copy = 'Lessons teach finger positions on a physical keyboard, so only a physical-keyboard run unlocks the next keys. This run is kept as a touch try.';
        primary = [`Try lesson ${n} again`, start(result.index)];

        if (complete) secondary = ['Take a practice run', startTrainingLoop];
        else if (next !== result.index) secondary = [`Start lesson ${next + 1}`, start(next)];
      } else if (result.outcome?.passed) {
        status = ['passed', 'badge-success'];
        copy = complete ? handoffCopy() : lessonCopy(next);

        if (!complete) meta = lessonMeta(next);
        primary = complete ? ['Take a practice run', startTrainingLoop] : [`Start lesson ${next + 1}`, start(next)];
        secondary = repeat;
      } else {
        status = ['not yet', 'badge-neutral'];
        const lesson = indexed(LESSONS, result.index);
        const after = LESSONS[result.index + 1]?.keys;

        if (progress[lesson.id]?.passed) copy = 'You passed this lesson before; this try doesn’t change that.';
        else if (after) copy = `${keysLabel(after)} ${after.length > 1 ? 'stay' : 'stays'} locked until one run meets both numbers.`;
        else copy = 'Every letter is in once one run meets both numbers.';
        primary = [`Try lesson ${n} again`, start(result.index)];

        if (complete) secondary = ['Take a practice run', startTrainingLoop];
        else if (next !== result.index) secondary = [`Start lesson ${next + 1}`, start(next)];
      }

      if (!result.saved) meta = [meta, meta ? ' · ' : '', 'Couldn’t save on this device.'];
    } else if (complete) {
      status = ['all letters in', 'badge-success'];
      heading = 'Every letter is in.';
      copy = handoffCopy();
      primary = ['Take a practice run', startTrainingLoop];
    } else {
      heading = `Lesson ${next + 1} · ${keysLabel(indexed(LESSONS, next).keys)}`;
      copy = lessonCopy(next);
      meta = lessonMeta(next);
      primary = [`Start lesson ${next + 1}`, start(next)];
    }

    learning.commands.lessonPrimary = primary[1];
    learning.commands.lessonSecondary = secondary?.[1] || (() => {});
    learning.commands.lesson = startLesson;

    const facts: LessonFactView[] = result?.valid ? [
      { label: 'accuracy', value: [result.score.accuracy + '%'], need: [outcomeOf(result).accuracyTarget + '% needed'], met: outcomeOf(result).accuracyMet },
      { label: 'speed', speedUnit: true, value: copyParts(speedFigure(result.score.wpm, { bare: true })), need: copyParts([speedFigure(outcomeOf(result).wpmTarget, { bare: true }), ' needed']), met: outcomeOf(result).speedMet },
      { label: 'first-try errors', value: [String(result.errors)], need: [], met: null },
      { label: 'time', value: [(result.elapsedMs / 1000).toFixed(1) + ' s'], need: [], met: null },
    ] : [];

    const rows: LessonRowView[] = LESSONS.map((lesson, index) => {
      const entry = progress[lesson.id];
      const passed = entry?.passed;
      const open = !passed && index <= next;

      const numbers = passed ? [speedFigure(passed.wpm), ' · ' + passed.accuracy + '%']
        : entry?.last ? [entry.tries + ' ' + (entry.tries === 1 ? 'try' : 'tries') + ' · last ', speedFigure(entry.last.wpm), ' · ' + entry.last.accuracy + '%' + (entry.last.inputClass === 'touch' ? ' · touch input' : '')] : '';

      const action = passed ? 'Repeat' : open ? 'Start' : '';

      return { id: lesson.id, index, keys: lesson.keys, fingers: fingerNames(lesson), state: passed ? 'passed' : open ? 'next' : 'locked', numbers: copyParts(numbers), action, actionLabel: action + ' lesson ' + (index + 1) + ', ' + keysLabel(lesson.keys) };
    });

    flushSync(() => learning.lessons.publish({
      status: status ? { label: status[0], tone: status[1] } : null,
      heading: copyParts(heading), copy, meta: copyParts(meta), facts,
      primary: primary[0], secondary: secondary?.[0] || '',
      known: lessonKeys(complete ? LESSONS.length - 1 : next - 1), fresh: complete ? [] : indexed(LESSONS, next).keys,
      caption: complete ? 'every key learned' : 'green edge: lesson ' + (next + 1) + '’s keys',
      saveNote: isDefaultLayout(learning.preferences.layout) ? '' : 'Lessons teach QWERTY finger positions. Use QWERTY in your operating system for these lessons.', rows,
    }));
  }


  return {
    get index() { return lessonIndex; },
    set index(value: number) { lessonIndex = value; },
    lessonCopy, startLesson, openLessons, startTrainingLoop, finishLesson, renderLessons,
    follow() { if (lessonResult && !lessonResultHeld(lessonResult, learning.profile.lessons)) lessonResult = null; },
  };
}
