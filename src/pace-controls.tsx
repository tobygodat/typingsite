import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { PACE_MIN_WPM, PACE_MAX_WPM, clampPace } from './profile.js';
import { formatSpeed, speedValue, wpmFromSpeed } from './units.js';
import type { SpeedUnit } from './units.js';
import type { CopyPart } from './practice-session.js';
import { Copy } from './results-card.js';
import { createStore } from './store.js';

interface PacePresentation { on: boolean; custom: boolean; wpm: number; fallback: boolean; valueWpm: number; unit: SpeedUnit }

interface PaceView {
  value: string; shown: string | null; unit: SpeedUnit; min: string; max: string; step: string; range: string;
  visible: boolean; note: CopyPart[];
}

interface PacePorts { changed(wpm: number): void; refresh(): void }

export function createPaceControls() {
  const view = createStore<PaceView>({ value: '80', shown: null, unit: 'wpm', min: '10', max: '300', step: '1', range: '10–300 wpm', visible: false, note: [] });
  let field: HTMLInputElement | null = null;
  let detach: (() => void) | null = null;
  let ports: PacePorts | null = null;
  let disposed = false;
  const publish = (patch: Partial<PaceView>) => { if (!disposed) flushSync(() => view.publish({ ...view.getSnapshot(), ...patch })); };

  function sync(presentation: PacePresentation) {
    if (disposed) return;
    const current = view.getSnapshot();
    const replace = document.activeElement !== field || current.value === current.shown;
    const unit = replace ? presentation.unit : current.unit;
    const value = String(speedValue(presentation.valueWpm, unit));
    const note: CopyPart[] = presentation.on && !presentation.custom ? [presentation.fallback ? 'no runs yet — ' : '', { kind: 'speed', wpm: presentation.wpm }] : [];

    const next: Partial<PaceView> = {
      unit, min: String(speedValue(PACE_MIN_WPM, unit)), max: String(speedValue(PACE_MAX_WPM, unit)), step: String(speedValue(1, unit)),
      range: `${formatSpeed(PACE_MIN_WPM, { bare: true }, unit)}–${formatSpeed(PACE_MAX_WPM, {}, unit)}`,
      visible: presentation.custom, note,
    };

    if (replace) { next.value = value; next.shown = value; }

    publish(next);
  }

  function commit(value: string) {
    if (disposed || !ports) return;
    const unit = view.getSnapshot().unit;
    publish({ shown: value, value });
    ports.changed(clampPace(wpmFromSpeed(value, unit)));
  }

  return {
    view, sync,
    configure(next: PacePorts) { ports = next; },
    edit(value: string) { publish({ value }); },
    blur() { if (!disposed) ports?.refresh(); },
    attach(next: HTMLInputElement) {
      if (disposed) return () => {};

      detach?.();
      field = next;
      const changed = () => commit(next.value);
      next.addEventListener('change', changed);

      const cleanup = () => {
        next.removeEventListener('change', changed);

        if (field === next) field = null;
      };

      detach = cleanup;

      return cleanup;
    },
    dispose() { disposed = true; detach?.(); detach = null; field = null; },
  };
}

export function PaceNote({ controller }: { controller: ReturnType<typeof createPaceControls> }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <small id="pace-note" className="pace-note"><Copy parts={view.note} /></small>;
}

export function PaceCustom({ controller }: { controller: ReturnType<typeof createPaceControls> }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { if (ref.current) return controller.attach(ref.current); }, [controller]);

  return <label id="pace-custom" className="preference-row" htmlFor="pace-wpm" hidden={!view.visible}><span className="preference-copy"><strong>custom pace</strong><small id="pace-range" className="pace-note">{view.range}</small></span><input ref={ref} className="input pace-wpm num" id="pace-wpm" type="number" min={view.min} max={view.max} step={view.step} value={view.value} onChange={(event) => controller.edit(event.currentTarget.value)} onBlur={() => controller.blur()} inputMode="numeric" data-unit={view.unit} data-shown={view.shown ?? undefined} aria-describedby="pace-range" /></label>;
}
