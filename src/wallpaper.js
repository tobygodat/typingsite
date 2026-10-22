// The background image (settings → appearance). It stays on this device, in IndexedDB, as a grey copy at
// most MAX_EDGE pixels on its long side; profiles never carry it. The page shows it as an ordered-dither
// mask over a tint of the theme's accent (.wallpaper in styles.css), so a theme change costs no redraw.
// The mask is drawn once per pick, and again only when the layer's size in dots changes.
export const MAX_EDGE = 1024;
const LEVELS = 4;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const KEY = 'wallpaper';

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

// One RGBA pixel per dot, the level in alpha: the image covers cols × rows (centred, cropped), each dot
// averages the pixels under it, and a 4×4 Bayer threshold spreads it over LEVELS steps.
export function ditherMask({ width, height, luma }, cols, rows) {
  const scale = Math.max(cols / width, rows / height);
  const left = (width - cols / scale) / 2;
  const top = (height - rows / scale) / 2;
  const span = (start, cell, limit) => {
    const from = Math.min(limit - 1, Math.floor(start + cell / scale));
    return [from, Math.min(limit, Math.max(from + 1, Math.floor(start + (cell + 1) / scale)))];
  };
  const mask = new Uint8ClampedArray(cols * rows * 4);
  for (let y = 0; y < rows; y++) {
    const [y0, y1] = span(top, y, height);
    for (let x = 0; x < cols; x++) {
      const [x0, x1] = span(left, x, width);
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) sum += luma[sy * width + sx];
      const value = sum / ((y1 - y0) * (x1 - x0) * 255);
      const level = Math.min(LEVELS - 1, Math.floor(value * (LEVELS - 1) + (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16));
      mask[(y * cols + x) * 4 + 3] = (level * 255) / (LEVELS - 1);
    }
  }
  return mask;
}

function stored(mode, use) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('stilltype-device', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('files', mode);
      const request = use(transaction.objectStore('files'));
      transaction.oncomplete = () => { db.close(); resolve(request.result); };
      transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

async function readImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const context = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { width, height, luma: greyscale(context.getImageData(0, 0, width, height).data) };
}

export function createWallpaper({ layer, input, remove, error }) {
  let image = null;
  let drawn = '';
  let url = '';
  let timer = 0;

  function show(next) {
    image = next;
    drawn = '';
    remove.hidden = !image;
    if (image) return draw();
    URL.revokeObjectURL(url);
    url = '';
    layer.hidden = true;
    delete layer.dataset.shown;
    layer.style.removeProperty('--wallpaper-mask');
  }

  function draw() {
    const pitch = parseFloat(getComputedStyle(layer).getPropertyValue('--wallpaper-pitch'));
    layer.hidden = false;
    const cols = Math.ceil(layer.clientWidth / pitch);
    const rows = Math.ceil(layer.clientHeight / pitch);
    const size = `${cols * pitch}px ${rows * pitch}px`;
    if (!cols || !rows || size === drawn) return;
    drawn = size;
    const canvas = Object.assign(document.createElement('canvas'), { width: cols, height: rows });
    canvas.getContext('2d').putImageData(new ImageData(ditherMask(image, cols, rows), cols, rows), 0, 0);
    const from = image;
    canvas.toBlob((blob) => {
      if (image !== from || drawn !== size) return;
      URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      layer.style.setProperty('--wallpaper-mask', `url("${url}")`);
      layer.style.setProperty('--wallpaper-size', size);
      layer.dataset.shown = '';
    });
  }

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
    stored('readwrite', (files) => files.put(next, KEY)).catch(() => {});
  });

  remove.addEventListener('click', () => {
    show(null);
    input.focus();
    stored('readwrite', (files) => files.delete(KEY)).catch(() => {});
  });

  stored('readonly', (files) => files.get(KEY)).then((saved) => { if (saved && !image) show(saved); }, () => {});
}
