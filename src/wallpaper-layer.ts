import { greyscale, ditherMask, smoothScale, colourGrid, luminance, contrast } from './wallpaper.js';
import type { WallpaperLook, WallpaperPixels } from './wallpaper.js';
import { encodeWallpaper, wallpaperCanvas } from './wallpaper-image.js';
import type { WallpaperImage } from './wallpaper-image.js';
import type { AsyncLifetime } from './async-runtime.js';

export interface WallpaperLayerHost { layer: HTMLElement; surfaces: readonly HTMLElement[]; reading: readonly HTMLElement[] }

type RGBA = [number, number, number, number];

type RGB = [number, number, number];

interface Source extends WallpaperPixels { cell?: number }

const INKS: Array<[string, string, number]> = [['--text', '', 4.5], ['--muted', '', 4.5], ['--danger', '--danger-soft', 4.5], ['--accent', '', 3]];
const SAMPLES = 8192;
const WASH_SCALE = 8;
const over = ([r, g, b, a]: RGBA, under: readonly number[]): RGB => [r * a + (under[0] ?? 0) * (1 - a), g * a + (under[1] ?? 0) * (1 - a), b * a + (under[2] ?? 0) * (1 - a)];

export function createWallpaperLayer({ layer, surfaces, reading }: WallpaperLayerHost, lifetime: AsyncLifetime) {
  let image: WallpaperImage | null = null;
  let luma: Uint8ClampedArray<ArrayBuffer> | null = null;
  let look: WallpaperLook = { style: 'dither', blur: 0, opacity: 100, reach: 0 };
  let drawn = '';
  let url = '';
  let timer = 0;
  let disposed = false;
  let rendering: AbortController | null = null;
  let source: Source | null = null;
  const probe = layer.appendChild(document.createElement('i'));
  const [, swatch] = wallpaperCanvas(1, 1);

  function publish(blob: Blob, key: string, size: string, pixels: Source) {
    if (drawn !== key) return;
    source = pixels;
    URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    layer.style.setProperty('--wallpaper-image', `url("${url}")`);

    if (size) layer.style.setProperty('--wallpaper-size', size);
    layer.dataset.style = look.style;
    layer.dataset.shown = '';
    halo();
  }

  function draw(): void {
    if (!image) return;
    layer.hidden = false;

    if (look.style === 'regular') {
      if (drawn === 'regular') return;
      drawn = 'regular';

      return publish(image.blob, drawn, '', image.pixels);
    }

    const dither = look.style === 'dither';
    const cell = parseFloat(getComputedStyle(layer).getPropertyValue(dither ? '--wallpaper-pitch' : '--wallpaper-cell'));
    const cols = Math.ceil(layer.clientWidth / cell);
    const lines = Math.ceil(innerHeight / cell);
    const size = `${cols * cell}px ${lines * cell}px`;
    const key = `${look.style} ${size}`;

    if (!cols || !lines || key === drawn) return;
    drawn = key;
    const { width, height } = image.pixels;

    if (dither) luma ??= greyscale(image.pixels.data);
    const scale = dither ? 1 : WASH_SCALE;
    const pixels = dither ? ditherMask({ width, height, luma: luma ?? greyscale(image.pixels.data) }, cols, lines) : smoothScale(colourGrid(image.pixels, cols, lines), cols, lines, scale);
    const [node, context] = wallpaperCanvas(cols * scale, lines * scale);
    context.putImageData(new ImageData(pixels, cols * scale, lines * scale), 0, 0);
    const shown = { width: cols * scale, height: lines * scale, data: pixels, cell: dither ? cell : 0 };
    rendering?.abort();
    rendering = new AbortController();
    void lifetime.run(encodeWallpaper(node), rendering.signal).then((blob) => { if (!disposed) publish(blob, key, size, shown); }, () => {});
  }

  function apply() {
    layer.style.setProperty('--wallpaper-blur', `${look.blur}px`);
    layer.style.setProperty('--wallpaper-opacity', String(look.opacity / 100));
    layer.style.setProperty('--wallpaper-reach', String(look.reach / 100));
    halo();
  }

  // A colour as the page paints it, in sRGB with alpha 0–1, whatever syntax the token uses.
  function colour(value: string): RGBA {
    probe.style.color = value;
    swatch.clearRect(0, 0, 1, 1);
    swatch.fillStyle = '#0000';
    swatch.fillStyle = getComputedStyle(probe).color;
    swatch.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = swatch.getImageData(0, 0, 1, 1).data;

    return [r, g, b, a / 255];
  }

  // Text the picture runs behind gets an outline in the ground colour (data-halo) where what the layer paints there
  // would take a letter, a mistyped letter on its tint or the caret below the contrast floor: the style, tint,
  // blur, opacity, height and mid-run dim all count, and the worst pixel under each region decides it. Checked
  // when one of those, the theme or the layout changes, never per keystroke.
  function halo() {
    const pixels = source;

    const strength = layer.hidden || layer.dataset.shown === undefined || !pixels ? 0
      : (look.opacity / 100) * (document.body.dataset.running === 'true' ? parseFloat(getComputedStyle(layer).getPropertyValue('--wallpaper-dim')) : 1);

    const height = layer.getBoundingClientRect().height;

    const stops = [...getComputedStyle(layer).maskImage.matchAll(/rgba?\(([^)]*)\)\s+([\d.]+)%/g)]
      .map(([, rgb = '', at]): [number, number] => [(Number(at) / 100) * height, Number(rgb.match(/[\d.]+/g)?.[3] ?? 1)]);

    const fade = (y: number) => {
      const next = stops.findIndex(([at]) => at > y);

      if (next === 0) return stops[0]?.[1] ?? 0;

      if (next === -1) return stops.at(-1)?.[1] ?? 0;
      const [y0, a0] = stops[next - 1] ?? [0, 0];
      const [y1, a1] = stops[next] ?? [0, 0];

      return a0 + ((y - y0) / (y1 - y0)) * (a1 - a0);
    };

    const ground = colour('var(--ground)');
    const inks = INKS.map(([ink, tint, floor]): [RGBA, RGBA | null, number] => [colour(`var(${ink})`), tint ? colour(`var(${tint})`) : null, floor]);
    const tint = colour('color-mix(in oklab, var(--accent) var(--wallpaper-tint), var(--ground))');
    const light = getComputedStyle(document.documentElement).colorScheme === 'light';
    const spread = pixels?.cell ? 0 : 3 * look.blur;

    const [scale = 1, left = 0, top = 0] = pixels?.cell ? [pixels.cell, 0, 0] : ((): [number, number, number] => {
      if (!pixels) return [1, 0, 0];
      const width = layer.clientWidth + 4 * look.blur;
      const tall = innerHeight + 4 * look.blur;
      const fit = Math.max(width / pixels.width, tall / pixels.height);

      return [fit, (width - pixels.width * fit) / 2 - 2 * look.blur, (tall - pixels.height * fit) / 2 - 2 * look.blur];
    })();

    for (const node of reading) {
      const rect = node.getBoundingClientRect();
      const alpha = rect.height ? strength * fade(rect.top) : 0;
      let readable = alpha <= 0;

      if (!readable && pixels) {
        const span = (from: number, to: number, size: number): [number, number] => [Math.max(0, Math.floor(from)), Math.min(size, Math.ceil(to))];
        const [x0, x1] = span((rect.left - spread - left) / scale, (rect.right + spread - left) / scale, pixels.width);
        const [y0, y1] = span((rect.top - spread - top) / scale, (rect.bottom + spread - top) / scale, pixels.height);
        const step = Math.max(1, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / SAMPLES)));
        readable = true;

        for (let y = y0; readable && y < y1; y += step) {
          for (let x = x0; readable && x < x1; x += step) {
            const at = (y * pixels.width + x) * 4;
            const dots = (pixels.data[at + 3] ?? 0) / 255;

            const behind = pixels.cell
              ? over([tint[0], tint[1], tint[2], alpha * (light ? 1 - dots : dots)], ground)
              : over([pixels.data[at] ?? 0, pixels.data[at + 1] ?? 0, pixels.data[at + 2] ?? 0, alpha], ground);

            readable = inks.every(([ink, under, floor]) => {
              const surface = under ? over(under, behind) : behind;

              return contrast(luminance(over(ink, surface)), luminance(surface)) >= floor;
            });
          }
        }
      }

      if (readable) delete node.dataset.halo;
      else node.dataset.halo = '';
    }
  }


  function measure(): void {
    const surface = surfaces.map((node) => node.getBoundingClientRect()).find((rect) => rect.height);

    if (surface) layer.style.setProperty('--wallpaper-top', `${surface.top}px`);
    halo();
  }

  const observer = new ResizeObserver(measure);

  for (const node of [...surfaces, ...reading]) observer.observe(node);

  const changed: MutationCallback = (records) => {
    if (records.some((record) => record.target instanceof Element && record.attributeName && record.target.getAttribute(record.attributeName) !== record.oldValue)) halo();
  };

  const bodyChanges = new MutationObserver(changed);
  const themeChanges = new MutationObserver(changed);
  bodyChanges.observe(document.body, { attributes: true, attributeOldValue: true, attributeFilter: ['data-running', 'data-view'] });
  themeChanges.observe(document.documentElement, { attributes: true, attributeOldValue: true, attributeFilter: ['data-theme', 'style', 'class'] });

  const resize = () => {
    measure();
    clearTimeout(timer);

    if (image) timer = window.setTimeout(draw, 150);
  };

  addEventListener('scroll', measure, { passive: true });
  addEventListener('resize', resize);

  return {
    show(next: WallpaperImage | null, nextLook: WallpaperLook) {
      image = next;
      look = nextLook;
      luma = null;
      drawn = '';
      rendering?.abort();
      apply();

      if (image) { draw();

 return; }

      source = null;
      halo();
      URL.revokeObjectURL(url);
      url = '';
      layer.hidden = true;
      delete layer.dataset.shown;
      delete layer.dataset.style;
      layer.style.removeProperty('--wallpaper-image');
    },
    look(next: WallpaperLook) {
      const redraw = look.style !== next.style;
      look = next;
      apply();

      if (image && redraw) draw();
    },
    dispose() {
      disposed = true;
      rendering?.abort();
      clearTimeout(timer);
      observer.disconnect();
      bodyChanges.disconnect();
      themeChanges.disconnect();
      removeEventListener('scroll', measure);
      removeEventListener('resize', resize);
      URL.revokeObjectURL(url);
      probe.remove();
      layer.hidden = true;
      delete layer.dataset.shown;
      delete layer.dataset.style;
      layer.style.removeProperty('--wallpaper-image');

      for (const node of reading) delete node.dataset.halo;
    },
  };
}
