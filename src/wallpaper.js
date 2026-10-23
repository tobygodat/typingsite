// The background image (settings → appearance). It stays on this device, in IndexedDB, as a copy at most
// MAX_EDGE pixels on its long side, with its look (style, blur, opacity) beside it; profiles never carry
// either. Three styles: regular shows the photo; dither shows an ordered-dither mask over a tint of the theme's
// accent, so a theme change costs no redraw; gradient shows a coarse grid of the photo's colours that the
// browser scales up smoothly. Blur and opacity are CSS on the layer, so a slider drag never redraws. The dither
// and gradient grids are drawn once per pick or style, and again only when the layer's size in cells changes.
import { onSetting, selectSetting } from './settings.js';

export const MAX_EDGE = 1024;
export const STYLES = ['regular', 'dither', 'gradient'];
const BLUR_MAX = 32;
const OPACITY_MIN = 10;
const LEVELS = 4;
const WASH_SCALE = 8;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const KEY = 'wallpaper';
const LOOK = 'wallpaper-look';

// Rec. 709 luma, stretched so the darkest and lightest 2% clip: a dim photo uses the whole range too.
export function greyscale(rgba) {
  const luma = new Uint8ClampedArray(rgba.length / 4);
  const counts = new Uint32Array(256);
  for (let i = 0; i < luma.length; i++) {
    luma[i] = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
    counts[luma[i]]++;
  }
  const clip = luma.length * 0.02;
  let low = 0;
  let high = 255;
  for (let seen = counts[0]; low < 255 && seen <= clip; seen += counts[++low]);
  for (let seen = counts[255]; high > 0 && seen <= clip; seen += counts[--high]);
  if (high <= low) return luma;
  for (let i = 0; i < luma.length; i++) luma[i] = ((luma[i] - low) * 255) / (high - low);
  return luma;
}

// Lays a cols × rows grid over the image as background-size: cover does (centred, cropped) and hands each cell
// the pixel spans under it.
function eachCell({ width, height }, cols, rows, visit) {
  const scale = Math.max(cols / width, rows / height);
  const left = (width - cols / scale) / 2;
  const top = (height - rows / scale) / 2;
  const span = (start, cell, limit) => {
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
export function ditherMask(image, cols, rows) {
  const mask = new Uint8ClampedArray(cols * rows * 4);
  eachCell(image, cols, rows, (x, y, x0, x1, y0, y1) => {
    let sum = 0;
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) sum += image.luma[sy * image.width + sx];
    const value = sum / ((y1 - y0) * (x1 - x0) * 255);
    const level = Math.min(LEVELS - 1, Math.floor(value * (LEVELS - 1) + (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16));
    mask[(y * cols + x) * 4 + 3] = (level * 255) / (LEVELS - 1);
  });
  return mask;
}

// One opaque RGBA pixel per cell: the average colour of the image under it.
export function colourGrid({ width, height, data }, cols, rows) {
  const grid = new Uint8ClampedArray(cols * rows * 4);
  eachCell({ width, height }, cols, rows, (x, y, x0, x1, y0, y1) => {
    const sum = [0, 0, 0];
    for (let sy = y0; sy < y1; sy++) {
      for (let sx = x0; sx < x1; sx++) for (let c = 0; c < 3; c++) sum[c] += data[(sy * width + sx) * 4 + c];
    }
    const at = (y * cols + x) * 4;
    grid.set([...sum.map((total) => total / ((y1 - y0) * (x1 - x0))), 255], at);
  });
  return grid;
}

// The grid scaled up `scale` times in place of the browser, whose raster path steps visibly when it stretches a
// few pixels across a screen: each pixel blends its four nearest cell centres with smoothstep weights, so the
// wash has no creases at the centres and stays flat at the edges.
export function smoothScale(grid, cols, rows, scale) {
  const width = cols * scale;
  const height = rows * scale;
  const out = new Uint8ClampedArray(width * height * 4);
  const axis = (at, count) => {
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
        const top = grid[(y0 * cols + x0) * 4 + c] * (1 - u) + grid[(y0 * cols + x1) * 4 + c] * u;
        const bottom = grid[(y1 * cols + x0) * 4 + c] * (1 - u) + grid[(y1 * cols + x1) * 4 + c] * u;
        out[(y * width + x) * 4 + c] = top * (1 - v) + bottom * v;
      }
    }
  }
  return out;
}

// A stored look, or the default (dither, sharp, full strength): anything unreadable falls back field by field.
export function readLook(saved) {
  const number = (value, min, max, fallback) => (Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback);
  return {
    style: STYLES.includes(saved?.style) ? saved.style : 'dither',
    blur: number(saved?.blur, 0, BLUR_MAX, 0),
    opacity: number(saved?.opacity, OPACITY_MIN, 100, 100),
  };
}

function stored(mode, use) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('stilltype-device', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('files', mode);
      const requests = [use(transaction.objectStore('files'))].flat();
      transaction.oncomplete = () => { db.close(); resolve(requests.map((request) => request.result)); };
      transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

function canvas(width, height) {
  const node = Object.assign(document.createElement('canvas'), { width, height });
  return [node, node.getContext('2d', { willReadFrequently: true })];
}

const encode = (node, type) => new Promise((resolve, reject) => node.toBlob((blob) => (blob ? resolve(blob) : reject()), type, 0.9));

// The colour copy kept on the device: its pixels, and the encoded file that is stored and shown as regular.
async function readImage(file, blob) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const [node, context] = canvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, node.width, node.height);
  bitmap.close();
  return { pixels: context.getImageData(0, 0, node.width, node.height), blob: blob ?? (await encode(node, 'image/webp')) };
}

// Stored as the encoded file's bytes, never a Blob: WebKit refuses Blobs in IndexedDB in private windows. An image
// picked before styles is a grey copy ({ width, height, luma }): it shows grey in every style.
async function readStored(saved) {
  if (saved.bytes) {
    const blob = new Blob([saved.bytes], { type: saved.type });
    return readImage(blob, blob);
  }
  const [node, context] = canvas(saved.width, saved.height);
  const pixels = context.createImageData(saved.width, saved.height);
  saved.luma.forEach((value, i) => pixels.data.set([value, value, value, 255], i * 4));
  context.putImageData(pixels, 0, 0);
  return { pixels, blob: await encode(node, 'image/webp') };
}

export function createWallpaper({ layer, input, remove, error, style, blur, opacity, stats, passage }) {
  const rows = [style, blur, opacity].map((control) => control.closest('.preference-row'));
  let image = null;
  let luma = null;
  let look = readLook();
  let drawn = '';
  let url = '';
  let timer = 0;

  function show(next) {
    image = next;
    luma = null;
    drawn = '';
    remove.hidden = !image;
    for (const row of rows) row.hidden = !image;
    if (image) return draw();
    URL.revokeObjectURL(url);
    url = '';
    layer.hidden = true;
    delete layer.dataset.shown;
    delete layer.dataset.style;
    layer.style.removeProperty('--wallpaper-image');
  }

  function publish(blob, key, size) {
    if (drawn !== key) return;
    URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    layer.style.setProperty('--wallpaper-image', `url("${url}")`);
    if (size) layer.style.setProperty('--wallpaper-size', size);
    layer.dataset.style = look.style;
    layer.dataset.shown = '';
  }

  function draw() {
    layer.hidden = false;
    if (look.style === 'regular') {
      if (drawn === 'regular') return;
      drawn = 'regular';
      return publish(image.blob, drawn);
    }
    const dither = look.style === 'dither';
    const cell = parseFloat(getComputedStyle(layer).getPropertyValue(dither ? '--wallpaper-pitch' : '--wallpaper-cell'));
    const cols = Math.ceil(layer.clientWidth / cell);
    const lines = Math.ceil(layer.clientHeight / cell);
    const size = `${cols * cell}px ${lines * cell}px`;
    const key = `${look.style} ${size}`;
    if (!cols || !lines || key === drawn) return;
    drawn = key;
    const { width, height } = image.pixels;
    if (dither) luma ??= greyscale(image.pixels.data);
    const scale = dither ? 1 : WASH_SCALE;
    const pixels = dither ? ditherMask({ width, height, luma }, cols, lines) : smoothScale(colourGrid(image.pixels, cols, lines), cols, lines, scale);
    const [node, context] = canvas(cols * scale, lines * scale);
    context.putImageData(new ImageData(pixels, cols * scale, lines * scale), 0, 0);
    encode(node).then((blob) => publish(blob, key, size), () => {});
  }

  function apply() {
    selectSetting('wallpaper-style', look.style);
    blur.disabled = look.style === 'dither';
    for (const [control, value, text] of [[blur, look.blur, `${look.blur} px`], [opacity, look.opacity, `${look.opacity}%`]]) {
      control.value = String(value);
      control.setAttribute('aria-valuetext', text);
      control.style.setProperty('--fill', `${((value - control.min) / (control.max - control.min)) * 100}%`);
    }
    layer.style.setProperty('--wallpaper-blur', `${look.blur}px`);
    layer.style.setProperty('--wallpaper-opacity', String(look.opacity / 100));
  }

  const save = () => stored('readwrite', (files) => files.put(look, LOOK)).catch(() => {});

  // Where the practice screen's countdown and passage start, for the layer to fade out above: the rail never
  // moves between modes, so this changes only with the window or the text size. A hidden screen keeps the last.
  function measure() {
    for (const [name, node] of [['--wallpaper-stats', stats], ['--wallpaper-passage', passage]]) {
      const { top, height } = node.getBoundingClientRect();
      if (height) layer.style.setProperty(name, `${top + scrollY}px`);
    }
  }
  new ResizeObserver(measure).observe(passage);
  addEventListener('resize', measure);

  new ResizeObserver(() => {
    clearTimeout(timer);
    if (image) timer = setTimeout(draw, 150);
  }).observe(layer);

  input.addEventListener('change', async () => {
    const [file] = input.files;
    input.value = '';
    if (!file) return;
    let next;
    try {
      next = await readImage(file);
    } catch {
      error.hidden = false;
      return;
    }
    error.hidden = true;
    show(next);
    const bytes = await next.blob.arrayBuffer();
    stored('readwrite', (files) => files.put({ type: next.blob.type, bytes }, KEY)).catch(() => {});
  });

  remove.addEventListener('click', () => {
    show(null);
    input.focus();
    stored('readwrite', (files) => files.delete(KEY)).catch(() => {});
  });

  onSetting('wallpaper-style', (value) => {
    look = { ...look, style: value };
    apply();
    save();
    if (image) draw();
  });

  for (const [control, field] of [[blur, 'blur'], [opacity, 'opacity']]) {
    control.addEventListener('input', () => {
      look = { ...look, [field]: Number(control.value) };
      apply();
    });
    control.addEventListener('change', save);
  }

  apply();
  stored('readonly', (files) => [files.get(KEY), files.get(LOOK)])
    .then(async ([saved, savedLook]) => {
      if (!saved || image) return;
      const next = await readStored(saved);
      if (image) return;
      look = readLook(savedLook);
      apply();
      show(next);
    })
    .catch(() => {});
}
