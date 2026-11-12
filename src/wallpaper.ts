import { createStore } from './store.js';
import { AsyncLifetime, pageLifetime } from './async-runtime.js';
import { Effect, Semaphore } from 'effect';
import { isRecord } from './domain-values.js';
import { decodeWallpaper, restoreWallpaper, saveWallpaper, saveWallpaperLook, deleteWallpaper } from './wallpaper-image.js';
import type { WallpaperImage } from './wallpaper-image.js';
import { createWallpaperLayer } from './wallpaper-layer.js';
import type { WallpaperLayerHost } from './wallpaper-layer.js';
import { flushSync } from 'react-dom';

// The background image (settings → appearance). It stays on this device, in IndexedDB, as a copy at most
// MAX_EDGE pixels on its long side, with its look (style, blur, opacity, reach) beside it; profiles never carry
// either. Three styles: regular shows the photo; dither shows an ordered-dither mask over a tint of the theme's
// accent, so a theme change costs no redraw; gradient shows a coarse grid of the photo's colours that the
// browser scales up smoothly. Blur, opacity and reach are CSS on the layer, so a slider drag never redraws. The
// dither and gradient grids cover the whole screen and are drawn once per pick or style, and again only when the
// screen's size in cells changes.

export const MAX_EDGE = 1024;
export const STYLES = ['regular', 'dither', 'gradient'] satisfies WallpaperStyle[];

export type WallpaperStyle = 'regular' | 'dither' | 'gradient';

export interface WallpaperLook { style: WallpaperStyle; blur: number; opacity: number; reach: number }

export interface WallpaperPixels { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> }

interface LumaImage { width: number; height: number; luma: Uint8ClampedArray<ArrayBuffer> }

function byte(values: Uint8ClampedArray<ArrayBuffer> | Uint32Array<ArrayBuffer>, index: number): number {
  return values[index] ?? 0;
}

const BLUR_MAX = 32;
const OPACITY_MIN = 10;
const LEVELS = 4;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];


// The contrast floor: letters at least 4.5:1, the caret at least 3:1; mistyped letters sit on their tint.


// Samples per region at most, so a check costs about the same on any screen.



// Rec. 709 luma, stretched so the darkest and lightest 2% clip: a dim photo uses the whole range too.
export function greyscale(rgba: Uint8ClampedArray<ArrayBuffer>) {
  const luma = new Uint8ClampedArray(rgba.length / 4);
  const counts = new Uint32Array(256);

  for (let i = 0; i < luma.length; i++) {
    luma[i] = 0.2126 * byte(rgba, i * 4) + 0.7152 * byte(rgba, i * 4 + 1) + 0.0722 * byte(rgba, i * 4 + 2);
    const value = byte(luma, i);
    counts[value] = byte(counts, value) + 1;
  }

  const clip = luma.length * 0.02;
  let low = 0;
  let high = 255;

  for (let seen = byte(counts, 0); low < 255 && seen <= clip; seen += byte(counts, ++low));

  for (let seen = byte(counts, 255); high > 0 && seen <= clip; seen += byte(counts, --high));

  if (high <= low) return luma;

  for (let i = 0; i < luma.length; i++) luma[i] = ((byte(luma, i) - low) * 255) / (high - low);

  return luma;
}

// WCAG relative luminance of an sRGB colour, and the contrast between two luminances, as the e2e spec measures.
const channel = (value: number) => {
  const s = value / 255;

  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const luminance = ([r = 0, g = 0, b = 0]: readonly number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);



// Lays a cols × rows grid over the image as background-size: cover does (centred, cropped) and hands each cell
// the pixel spans under it.
function eachCell({ width, height }: { width: number; height: number }, cols: number, rows: number, visit: (x: number, y: number, x0: number, x1: number, y0: number, y1: number) => void) {
  const scale = Math.max(cols / width, rows / height);
  const left = (width - cols / scale) / 2;
  const top = (height - rows / scale) / 2;

  const span = (start: number, cell: number, limit: number): [number, number] => {
    const from = Math.min(limit - 1, Math.floor(start + cell / scale));

    return [from, Math.min(limit, Math.max(from + 1, Math.floor(start + (cell + 1) / scale)))];
  };

  for (let y = 0; y < rows; y++) {
    const [y0, y1] = span(top, y, height);

    for (let x = 0; x < cols; x++) visit(x, y, ...span(left, x, width), y0, y1);
  }
}

// One RGBA pixel per dot, the level in alpha: each dot averages the luma under it, and a 4×4 Bayer threshold
// spreads it over LEVELS steps.
export function ditherMask(image: LumaImage, cols: number, rows: number) {
  const mask = new Uint8ClampedArray(cols * rows * 4);
  eachCell(image, cols, rows, (x, y, x0, x1, y0, y1) => {
    let sum = 0;

    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) sum += byte(image.luma, sy * image.width + sx);
    const value = sum / ((y1 - y0) * (x1 - x0) * 255);
    const level = Math.min(LEVELS - 1, Math.floor(value * (LEVELS - 1) + ((BAYER[(y % 4) * 4 + (x % 4)] ?? 0) + 0.5) / 16));
    mask[(y * cols + x) * 4 + 3] = (level * 255) / (LEVELS - 1);
  });

  return mask;
}

// One opaque RGBA pixel per cell: the average colour of the image under it.
export function colourGrid({ width, height, data }: WallpaperPixels, cols: number, rows: number) {
  const grid = new Uint8ClampedArray(cols * rows * 4);
  eachCell({ width, height }, cols, rows, (x, y, x0, x1, y0, y1) => {
    const sum = [0, 0, 0];

    for (let sy = y0; sy < y1; sy++) {
      for (let sx = x0; sx < x1; sx++) for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + byte(data, (sy * width + sx) * 4 + c);
    }

    const at = (y * cols + x) * 4;
    grid.set([...sum.map((total) => total / ((y1 - y0) * (x1 - x0))), 255], at);
  });

  return grid;
}

// The grid scaled up `scale` times in place of the browser, whose raster path steps visibly when it stretches a
// few pixels across a screen: each pixel blends its four nearest cell centres with smoothstep weights, so the
// wash has no creases at the centres and stays flat at the edges.
export function smoothScale(grid: Uint8ClampedArray<ArrayBuffer>, cols: number, rows: number, scale: number) {
  const width = cols * scale;
  const height = rows * scale;
  const out = new Uint8ClampedArray(width * height * 4);

  const axis = (at: number, count: number): [number, number, number] => {
    const u = Math.min(count - 1, Math.max(0, (at + 0.5) / scale - 0.5));
    const from = Math.floor(u);
    const t = u - from;

    return [from, Math.min(count - 1, from + 1), t * t * (3 - 2 * t)];
  };

  for (let y = 0; y < height; y++) {
    const [y0, y1, v] = axis(y, rows);

    for (let x = 0; x < width; x++) {
      const [x0, x1, u] = axis(x, cols);

      for (let c = 0; c < 4; c++) {
        const top = byte(grid, (y0 * cols + x0) * 4 + c) * (1 - u) + byte(grid, (y0 * cols + x1) * 4 + c) * u;
        const bottom = byte(grid, (y1 * cols + x0) * 4 + c) * (1 - u) + byte(grid, (y1 * cols + x1) * 4 + c) * u;
        out[(y * width + x) * 4 + c] = top * (1 - v) + bottom * v;
      }
    }
  }

  return out;
}

// A stored look, or the default (dither, sharp, full strength, ending at the countdown): anything unreadable falls back field by field.
export function readLook(raw?: unknown): WallpaperLook {
  const saved = isRecord(raw) ? raw : {};
  const number = (value: unknown, min: number, max: number, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback);

  return {
    style: saved.style === 'regular' || saved.style === 'gradient' || saved.style === 'dither' ? saved.style : 'dither',
    blur: number(saved.blur, 0, BLUR_MAX, 0),
    opacity: number(saved.opacity, OPACITY_MIN, 100, 100),
    reach: number(saved.reach, 0, 100, 0),
  };
}


interface WallpaperView { look: WallpaperLook; hasImage: boolean; error: boolean }

export type WallpaperAdjustment = 'blur' | 'opacity' | 'reach';

export function createWallpaper() {
  const view = createStore<WallpaperView>({ look: readLook(), hasImage: false, error: false });
  const lifetime = new AsyncLifetime(pageLifetime());
  const writes = Semaphore.makeUnsafe(1);
  let image: WallpaperImage | null = null;
  let layer: ReturnType<typeof createWallpaperLayer> | null = null;
  let picking: AbortController | null = null;
  let restoring: AbortController | null = null;
  let restored = false;
  let revision = 0;
  const publish = (next: WallpaperView) => flushSync(() => view.publish(next));
  const persist = (program: Effect.Effect<void, Error>) => lifetime.run(writes.withPermit(program)).catch(() => {});

  function show(next: WallpaperImage | null): void {
    image = next;
    const current = view.getSnapshot();
    layer?.show(next, current.look);
    publish({ ...current, hasImage: Boolean(next) });
  }

  function saveLook(): Promise<void> {
    return persist(saveWallpaperLook(view.getSnapshot().look));
  }

  return {
    view, saveLook,
    attach(host: WallpaperLayerHost) {
      layer?.dispose();
      const attached = createWallpaperLayer(host, lifetime);
      layer = attached;
      attached.show(image, view.getSnapshot().look);

      if (!restored) {
        restored = true;
        const version = revision;
        const request = new AbortController();
        restoring = request;
        void lifetime.run(restoreWallpaper(), request.signal).then((saved) => {
          if (!saved || revision !== version || request.signal.aborted) return;
          publish({ ...view.getSnapshot(), look: saved.look });
          show(saved.image);
        }, () => {});
      }

      return () => {
        attached.dispose();

        if (layer === attached) layer = null;
      };
    },
    async pick(file: File): Promise<void> {
      revision++;
      restoring?.abort();
      picking?.abort();
      const request = new AbortController();
      picking = request;

      try {
        const next = await lifetime.run(decodeWallpaper(file), request.signal);

        if (request.signal.aborted || picking !== request) return;
        publish({ ...view.getSnapshot(), error: false });
        show(next);
        await lifetime.run(writes.withPermit(saveWallpaper(next)), request.signal).catch(() => {});
      } catch {
        if (!request.signal.aborted && picking === request && lifetime.active) publish({ ...view.getSnapshot(), error: true });
      } finally {
        if (picking === request) picking = null;
      }
    },
    remove() {
      revision++;
      restoring?.abort();
      picking?.abort();
      picking = null;
      show(null);
      void persist(deleteWallpaper());
    },
    style(value: string) {
      if (value !== 'regular' && value !== 'dither' && value !== 'gradient') return;
      const current = view.getSnapshot();
      const look = { ...current.look, style: value } satisfies WallpaperLook;
      layer?.look(look);
      publish({ ...current, look });
      void saveLook();
    },
    adjust(field: WallpaperAdjustment, value: number) {
      const current = view.getSnapshot();
      const look = readLook({ ...current.look, [field]: value });
      layer?.look(look);
      publish({ ...current, look });
    },
    async dispose() {
      picking?.abort();
      restoring?.abort();
      layer?.dispose();
      layer = null;
      await lifetime.close();
    },
  };
}

export type WallpaperController = ReturnType<typeof createWallpaper>;
