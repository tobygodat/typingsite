import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import * as account from './account.js';
import { normalizeProfile } from './profile.js';
import type { LearningStore } from './learning-store.js';
import type { PracticeSession } from './practice-session.js';
import type { ProfileSync } from './profile-sync.js';
import { createStore } from './store.js';

interface PassageLabel { fresh?: boolean; exhausted?: boolean }

interface ClearPorts { dismissFilters(): void; passageLabel(): PassageLabel; labelPassage(fresh?: boolean, exhausted?: boolean): void; forgetTraining(): void; afterClear(): void; afterUndo(): void }

interface ClearHost { open(): void; close(): void; focusInput(): void; focusUndo(): void }

export function createHistoryClear(learning: LearningStore, practice: PracticeSession, sync: ProfileSync) {
  const view = createStore({ value: '', toast: false, feedback: 'Local history cleared.', undo: false });
  let host: ClearHost | null = null;
  let ports: ClearPorts | null = null;
  let snapshot: string | null = null;
  let queuedLabel: (PassageLabel & { attemptId: string }) | null = null;
  let marker: string | null = null;
  let timer = 0;
  let disposed = false;
  const publish = (next: ReturnType<typeof view.getSnapshot>) => { if (!disposed) flushSync(() => view.publish(next)); };

  return {
    view,
    configure(next: ClearPorts) { ports = next; },
    attach(next: ClearHost) { host = next;

 return () => { if (host === next) host = null; }; },
    open() { ports?.dismissFilters(); publish({ ...view.getSnapshot(), value: '' }); host?.open(); host?.focusInput(); },
    close() { host?.close(); },
    edit(value: string) { publish({ ...view.getSnapshot(), value }); },
    clear() {
      snapshot = JSON.stringify(learning.profile);
      const queued = practice.sessionKind === 'practice' && practice.attempt?.status === 'ready' ? practice.attempt : null;
      const label = ports?.passageLabel();
      queuedLabel = queued ? { attemptId: queued.id, ...label } : null;
      learning.profile = account.clearProfile(learning.profile);

      if (queued?.textId) learning.profile.seenTextIds = [queued.textId];

      if (queued && label?.fresh === false) ports?.labelPassage(true, false);
      marker = learning.profile.historyClearedAt ?? null;

      if (!marker) throw new Error('History clear did not create its marker');
      const previous: unknown = JSON.parse(snapshot);
      sync.state.heldClears = account.joinHolds(sync.state.heldClears, { [marker]: [normalizeProfile(previous)] });
      ports?.forgetTraining();
      const saved = sync.saveProfile();
      host?.close();
      publish({ ...view.getSnapshot(), toast: true, feedback: saved ? 'History cleared.' : 'Cleared in this tab, but storage is unavailable.', undo: true });
      host?.focusUndo();
      clearTimeout(timer);
      timer = window.setTimeout(() => { publish({ ...view.getSnapshot(), toast: false }); snapshot = null; queuedLabel = null; }, 5000);
      ports?.afterClear();
    },
    undo() {
      if (!snapshot || !marker) return;
      let before;

      try { const raw: unknown = JSON.parse(snapshot); before = normalizeProfile(raw); } catch { return; }

      const restored = account.undoClearHere(sync.state.heldClears, learning.profile, marker, before);
      learning.profile = restored.merged;
      sync.state.heldClears = restored.holds;

      if (queuedLabel && practice.attempt?.id === queuedLabel.attemptId && practice.attempt.status === 'ready') ports?.labelPassage(queuedLabel.fresh, queuedLabel.exhausted);
      queuedLabel = null;
      sync.saveProfile();
      snapshot = null;
      clearTimeout(timer);
      publish({ ...view.getSnapshot(), feedback: 'History restored.', undo: false });
      ports?.afterUndo();
      timer = window.setTimeout(() => publish({ ...view.getSnapshot(), toast: false }), 1600);
    },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}

export type HistoryClear = ReturnType<typeof createHistoryClear>;

export function HistoryClearDialog({ controller }: { controller: HistoryClear }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => controller.attach({ open() { dialog.current?.showModal(); }, close() { dialog.current?.close(); }, focusInput() { input.current?.focus(); }, focusUndo() { document.getElementById('undo-clear')?.focus(); } }), [controller]);

  return <dialog ref={dialog} id="clear-dialog" aria-labelledby="clear-dialog-title"><form method="dialog" className="dialog-content"><div><h2 id="clear-dialog-title">Clear your practice history?</h2><p>Runs, drills, comparisons, composing numbers and lesson progress will be removed.</p></div><label htmlFor="confirm-clear-input">Type <strong>clear</strong> to confirm<input ref={input} id="confirm-clear-input" className="input" type="text" autoComplete="off" value={view.value} onChange={(event) => controller.edit(event.currentTarget.value)} /></label><div className="dialog-actions"><button id="cancel-clear" className="btn btn-ghost" value="cancel" onClick={() => controller.close()}>Cancel</button><button id="confirm-clear" className="btn btn-danger" type="button" disabled={view.value !== 'clear'} onClick={() => controller.clear()}>Clear history</button></div></form></dialog>;
}

export function HistoryToast({ controller }: { controller: HistoryClear }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <div id="history-toast" className="toast" role="status" hidden={!view.toast}><span className="status-dot" aria-hidden="true"></span><span id="history-feedback">{view.feedback}</span><button id="undo-clear" className="btn btn-ghost btn-sm" type="button" hidden={!view.undo} onClick={() => controller.undo()}>Undo</button></div>;
}
