import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { STYLES } from './wallpaper.js';
import type { WallpaperAdjustment, WallpaperController } from './wallpaper.js';
import type { SettingsController } from './settings.js';

const RANGES = [
  { field: 'blur', label: 'blur', min: 0, max: 32, step: 2 },
  { field: 'opacity', label: 'opacity', min: 10, max: 100, step: 5 },
  { field: 'reach', label: 'height', min: 0, max: 100, step: 5 },
] satisfies Array<{ field: WallpaperAdjustment; label: string; min: number; max: number; step: number }>;

export function WallpaperSettings({ controller, settings }: { controller: WallpaperController; settings: SettingsController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const input = useRef<HTMLInputElement>(null);

  return <>
    <div className="preference-row">
      <div className="preference-copy"><strong id="wallpaper-label">background</strong><small id="wallpaper-error" className="preference-note" hidden={!view.error}>can’t read that file</small></div>
      <div className="setting-options" role="group" aria-labelledby="wallpaper-label" aria-describedby="wallpaper-error">
        <label className="setting-option"><input ref={input} id="wallpaper-file" type="file" accept="image/*" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';

          if (file) void controller.pick(file);
        }} /><span>choose…</span></label>
        <button id="wallpaper-remove" className="setting-option" type="button" hidden={!view.hasImage} onClick={() => { controller.remove(); input.current?.focus(); }}><span>remove</span></button>
      </div>
    </div>
    <div className="preference-row" hidden={!view.hasImage}>
      <div className="preference-copy"><strong id="wallpaper-style-label">style</strong></div>
      <fieldset className="setting-options" id="wallpaper-style" aria-labelledby="wallpaper-label wallpaper-style-label">
        {STYLES.map((style) => <label className="setting-option" key={style}><input type="radio" name="wallpaper-style" value={style} checked={view.look.style === style} onChange={() => settings.choose('wallpaper-style', style)} /><span>{style}</span></label>)}
      </fieldset>
    </div>
    {RANGES.map((range) => <WallpaperRange key={range.field} controller={controller} range={range} />)}
  </>;
}

function WallpaperRange({ controller, range: { field, label, min, max, step } }: { controller: WallpaperController; range: typeof RANGES[number] }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const control = input.current;
    const save = () => { void controller.saveLook(); };

    control?.addEventListener('change', save);

    return () => control?.removeEventListener('change', save);
  }, [controller]);
  const value = view.look[field];
  const fill: CSSProperties & { '--fill': string } = { '--fill': `${((value - min) / (max - min)) * 100}%` };

  return <label className="preference-row" htmlFor={`wallpaper-${field}`} hidden={!view.hasImage}>
    <span className="preference-copy"><strong>{label}</strong></span>
    <span className="preference-range"><input ref={input} className="range" id={`wallpaper-${field}`} type="range" min={min} max={max} step={step} value={value} disabled={field === 'blur' && view.look.style === 'dither'} aria-valuetext={field === 'blur' ? `${value} px` : `${value}%`} style={fill} onInput={(event) => controller.adjust(field, Number(event.currentTarget.value))} onChange={() => {}} /></span>
  </label>;
}
