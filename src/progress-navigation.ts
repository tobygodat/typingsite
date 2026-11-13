import { flushSync } from 'react-dom';
import { at } from './domain-values.js';
import { createStore } from './store.js';
import type { ProgressDetail, ProgressPeriod } from './progress-filters.js';

export type ProgressTrend = 'speed' | 'accuracy' | 'consistency';

export const PROGRESS_DETAILS: Record<ProgressDetail, string> = { '': '', runs: 'Runs', trends: 'Trends', keys: 'Keys', calendar: 'Practice', standard: 'Standard score', compose: 'Composing' };

type Opener = HTMLElement | (() => HTMLElement | null) | null;

interface ProgressNavigationState { period: ProgressPeriod; key: string; view: ProgressTrend; allRuns: boolean; detail: ProgressDetail; moversOpen: boolean }

interface ProgressNavigationPorts {
  history(): void;
  draw(): void;
  focusShown(element: HTMLElement): void;
  landFocus(options: { scroll: boolean }): void;
}

function host(id: string) {
  const element = document.getElementById(id);

  if (!element) throw new Error(`Missing progress host ${id}`);

  return element;
}

export function createProgressNavigation() {
  const state: ProgressNavigationState = {
    period: '30', key: '', view: 'speed', allRuns: false, detail: '', moversOpen: false,
  };

  const view = createStore({ detail: state.detail, tab: state.view });
  let opener: Opener = null;
  let ports: ProgressNavigationPorts | null = null;
  const publish = () => flushSync(() => view.publish({ detail: state.detail, tab: state.view }));

  function showDetail({ focus = false } = {}) {
    publish();
    ports?.draw();

    if (focus && state.detail) ports?.focusShown(host('progress-detail-heading'));
  }

  function open(detail: ProgressDetail, { opener: from = null, focus = true }: { opener?: Opener; focus?: boolean } = {}) {
    state.detail = detail;
    opener = from;
    showDetail({ focus });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function close() {
    const back = opener;
    state.detail = '';
    opener = null;
    ports?.history();
    const target = typeof back === 'function' ? back() : back;

    if (target?.isConnected && !target.hidden) target.focus();
    else ports?.landFocus({ scroll: true });
  }

  function selectTab(tab: ProgressTrend, { focus = false } = {}) {
    state.view = tab;
    publish();

    if (focus) host(`tab-${tab}`).focus();
  }

  function showView(tab: ProgressTrend, options: { focus?: boolean } = {}) {
    selectTab(tab, options);
    ports?.draw();
  }

  function openTrend(tab: ProgressTrend) {
    selectTab(tab);
    open('trends', { opener: () => host(tab === 'speed' ? 'week-speed' : 'week-accuracy').querySelector('button') });
  }

  function move(event: Pick<KeyboardEvent, 'target' | 'key' | 'preventDefault'>) {
    const tabs = [...host('progress-tabs').querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const from = tabs.findIndex((tab) => tab === event.target);
    const to = event.key === 'ArrowRight' ? from + 1 : event.key === 'ArrowLeft' ? from - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;

    if (from < 0 || to === undefined) return;
    event.preventDefault();
    const tab = at(tabs, (to + tabs.length) % tabs.length).dataset.viewTab;

    if (tab === 'speed' || tab === 'accuracy' || tab === 'consistency') showView(tab, { focus: true });
  }

  return {
    state, view, open, close, showDetail, showView, openTrend, move,
    configure(next: ProgressNavigationPorts) { ports = next; },
    forgetOpener() { opener = null; },
  };
}
