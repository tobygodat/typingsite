import type { CalendarDay } from './progress-calendar.js';
import { flushSync } from 'react-dom';
import type { LearningStore } from './learning-store.js';
import { dayKey, minutesByDay, practiceLevel, goalMinutes, periodDays, practiceStats, practiceStreak } from './insights.js';
import { monthLabels } from './progress-view.js';
import { runCountTotals } from './run-counts.js';
import { promptText } from './compose.js';
import type { ProgressPeriod } from './progress-filters.js';

interface PracticeProgressPorts {
  calendarWeeks(): number; coarse(): boolean; period(): ProgressPeriod;
  dateCopy(at: string | null): string;
}

export function createPracticeProgress(learning: LearningStore, ports: PracticeProgressPorts) {
  let goalDay = '';
  let practicePerDay: ReturnType<typeof practiceStats>['runsPerDay'] = [];
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function renderGoal(date = new Date()) {
  goalDay = dayKey(date);
  const byDay = minutesByDay(learning.profile.runs, learning.profile.practiceDays);
  const coarse = ports.coarse();
  flushSync(() => learning.progress.calendar.visible.publish(Object.keys(byDay).length > 0));
  const goal = learning.preferences.dailyGoal;
  const weeks = ports.calendarWeeks();
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (weeks - 1) * 7 - date.getDay());
  const days: CalendarDay[] = [];

  for (const day = new Date(start); day <= date; day.setDate(day.getDate() + 1)) {
    const minutes = byDay[dayKey(day)] || 0;
    const met = goal > 0 && minutes >= goal;
    days.push({ day: dayKey(day), level: String(practiceLevel(minutes, goal)), met,
      label: day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ': ' + goalMinutes(minutes) + ' min' + (met ? ', goal met' : ''),
      caption: [day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), goalMinutes(minutes) + ' min', met && 'goal met'].filter(Boolean).join(' · ') });
  }

  const practised = days.filter((day) => day.level !== '0').length;
  flushSync(() => learning.progress.calendar.view.publish({ days, months: monthLabels(days.map((day) => day.day)), weeks, coarse, today: goalDay,
    label: 'Practice minutes per day, last ' + weeks + ' weeks: ' + plural(practised, 'day') + ' with practice. Arrow keys move between days.' }));
  renderPracticeStats(ports.period(), date);
}

function renderPracticeStats(period: ProgressPeriod, date = new Date()) {
  const byDay = minutesByDay(learning.profile.runs, learning.profile.practiceDays);
  const first = Object.keys(byDay).sort()[0] || null;
  const days = periodDays(period, date, first);
  const goal = learning.preferences.dailyGoal;
  const stats = practiceStats(byDay, learning.profile.runs, days, goal);
  practicePerDay = stats.runsPerDay;
  const runs = stats.runsPerDay.reduce((sum, d) => sum + d.runs, 0);
  const current = practiceStreak(byDay, goal, date);

  const figure = (label: string, value: string, unit: string, note?: string) => ({ label, value, unit, note });

  const daysWord = (n: number) => (n === 1 ? 'day' : 'days');
  const runDays = stats.runsPerDay.filter((d) => d.runs).length;
  const counted = runCountTotals(learning.profile.runCounts, { from: period === 'all' ? null : days[0], to: days.at(-1) });
  flushSync(() => learning.progress.calendar.figures.publish([
    figure('Active days', String(stats.active), `of ${days.length}`, runDays ? `${plural(Number((runs / runDays).toFixed(1)), 'run')} a day when you practise` : 'no runs in this period'),
    figure('Longest streak', String(stats.longest), daysWord(stats.longest), goal ? `at ${goal} min a day` : 'in this period'),
    figure('Current streak', String(current), daysWord(current), `today ${goalMinutes(byDay[dayKey(date)])}${goal ? ` of ${goal}` : ''} min`),
    figure('Time typing', goalMinutes(stats.minutes), 'min', period === 'all' ? `since ${new Date(`${days[0]}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : `in the last ${days.length} days`),
    figure('Runs started', String(counted.started), `${counted.finished} finished`),
  ]));
}

function renderComposeHistory() {
  const list = learning.profile.compositions;
  const shown = [...list].reverse().slice(0, 10);

  const rows = shown.map((item) => {
    const prompt = promptText(item.promptId);

    return { id: item.id, wpm: item.wpm, backspaceRate: item.backspaceRate, prompt: prompt ? '“' + prompt + '”' : 'A prompt no longer offered',
      detail: ports.dateCopy(item.at) + ' · ' + item.characters + ' characters · ' + item.backspaces + ' ' + (item.backspaces === 1 ? 'backspace' : 'backspaces') + ' in ' + item.keystrokes + ' keystrokes · ' + (item.activeMs / 1000).toFixed(1) + ' s active of ' + (item.elapsedMs / 1000).toFixed(1) + ' s · ' + (item.inputClass === 'touch' ? 'touch input' : 'physical keyboard') };
  });

  flushSync(() => learning.progress.composing.publish({ rows, note: list.length > shown.length ? 'newest ' + shown.length + ' of ' + list.length : '' }));
}

return { goal: renderGoal, composing: renderComposeHistory,
  get day() { return goalDay; }, get runsPerDay() { return practicePerDay; } };
}
