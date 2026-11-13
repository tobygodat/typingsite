import { Effect, Schema } from 'effect';
import type { Scope } from 'effect';
import { MAX_EDGE, readLook } from './wallpaper.js';
import type { WallpaperLook } from './wallpaper.js';

export interface WallpaperImage { pixels: ImageData; blob: Blob }

interface DeviceRecords { image: unknown; look: unknown }

const KEY = 'wallpaper';
const LOOK = 'wallpaper-look';
const Bytes = Schema.Struct({ bytes: Schema.instanceOf(ArrayBuffer), type: Schema.optional(Schema.String) });
const Grey = Schema.Struct({ width: Schema.Number, height: Schema.Number, luma: Schema.Union([Schema.instanceOf(Uint8ClampedArray), Schema.Array(Schema.Number)]) });

const failure = (cause: unknown): Error => cause instanceof Error ? cause : new Error('Can’t read that file.');

export function wallpaperCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const node = Object.assign(document.createElement('canvas'), { width, height });
  const context = node.getContext('2d', { willReadFrequently: true });

  if (!context) throw new Error('Background images need a canvas.');

  return [node, context];
}

export function encodeWallpaper(node: HTMLCanvasElement, type?: string): Effect.Effect<Blob, Error> {
  return Effect.callback((resume, signal) => {
    node.toBlob((blob) => {
      if (!signal.aborted) resume(blob ? Effect.succeed(blob) : Effect.fail(new Error('Can’t encode that file.')));
    }, type, 0.9);
  });
}

function bytes(blob: Blob): Effect.Effect<ArrayBuffer, Error> {
  return Effect.callback((resume) => {
    const reader = new FileReader();
    reader.onerror = () => resume(Effect.fail(failure(reader.error)));
    reader.onload = () => resume(reader.result instanceof ArrayBuffer ? Effect.succeed(reader.result) : Effect.fail(new Error('Can’t read that file.')));
    reader.readAsArrayBuffer(blob);

    return Effect.sync(() => {
      reader.onload = reader.onerror = null;

      if (reader.readyState === FileReader.LOADING) reader.abort();
    });
  });
}

function bitmap(file: Blob): Effect.Effect<ImageBitmap, Error, Scope.Scope> {
  return Effect.acquireRelease(Effect.callback<ImageBitmap, Error>((resume, signal) => {
    createImageBitmap(file).then((image) => {
      if (signal.aborted) image.close();
      else resume(Effect.succeed(image));
    }, (cause: unknown) => resume(Effect.fail(failure(cause))));
  }), (image) => Effect.sync(() => image.close()), { interruptible: true });
}

export function decodeWallpaper(file: Blob, original?: Blob): Effect.Effect<WallpaperImage, Error> {
  return Effect.scoped(Effect.gen(function*() {
    const image = yield* bitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const [node, context] = wallpaperCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, node.width, node.height);
    const pixels = context.getImageData(0, 0, node.width, node.height);
    const blob = original ?? (yield* encodeWallpaper(node, 'image/webp'));

    return { pixels, blob };
  }));
}

function database(): Effect.Effect<IDBDatabase, Error, Scope.Scope> {
  return Effect.acquireRelease(Effect.callback<IDBDatabase, Error>((resume, signal) => {
    const request = indexedDB.open('stilltype-device', 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files'); };

    request.onerror = () => resume(Effect.fail(failure(request.error)));
    request.onsuccess = () => {
      if (signal.aborted) request.result.close();
      else resume(Effect.succeed(request.result));
    };
  }), (db) => Effect.sync(() => db.close()), { interruptible: true });
}

function transaction<A>(mode: IDBTransactionMode, use: (files: IDBObjectStore) => () => A): Effect.Effect<A, Error> {
  return Effect.scoped(Effect.gen(function*() {
    const db = yield* database();

    return yield* Effect.callback<A, Error>((resume) => {
      const tx = db.transaction('files', mode);
      let result: () => A;

      try { result = use(tx.objectStore('files')); } catch (cause) {
        tx.abort();
        resume(Effect.fail(failure(cause)));

        return;
      }

      tx.oncomplete = () => resume(Effect.succeed(result()));
      tx.onerror = tx.onabort = () => resume(Effect.fail(failure(tx.error)));

      return Effect.sync(() => {
        tx.oncomplete = tx.onerror = tx.onabort = null;

        try { tx.abort(); } catch {}
      });
    });
  }));
}

function restoreImage(raw: unknown): Effect.Effect<WallpaperImage, Error> {
  if (Schema.is(Bytes)(raw)) {
    const blob = new Blob([raw.bytes], { type: raw.type });

    return decodeWallpaper(blob, blob);
  }

  if (!Schema.is(Grey)(raw) || !Number.isInteger(raw.width) || !Number.isInteger(raw.height) || raw.width < 1 || raw.height < 1 || raw.width > MAX_EDGE || raw.height > MAX_EDGE || raw.luma.length !== raw.width * raw.height) return Effect.fail(new Error('Can’t read that file.'));

  return Effect.gen(function*() {
    const [node, context] = wallpaperCanvas(raw.width, raw.height);
    const pixels = context.createImageData(raw.width, raw.height);
    raw.luma.forEach((value, index) => pixels.data.set([value, value, value, 255], index * 4));
    context.putImageData(pixels, 0, 0);
    const blob = yield* encodeWallpaper(node, 'image/webp');

    return { pixels, blob };
  });
}

export function restoreWallpaper(): Effect.Effect<{ image: WallpaperImage; look: WallpaperLook } | null, Error> {
  return Effect.gen(function*() {
    const saved = yield* transaction<DeviceRecords>('readonly', (files) => {
      const image = files.get(KEY);
      const look = files.get(LOOK);

      return () => ({ image: image.result, look: look.result });
    });

    if (!saved.image) return null;
    const image = yield* restoreImage(saved.image);

    return { image, look: readLook(saved.look) };
  });
}

export function saveWallpaper(image: WallpaperImage): Effect.Effect<void, Error> {
  return Effect.gen(function*() {
    const encoded = yield* bytes(image.blob);
    yield* transaction('readwrite', (files) => {
      files.put({ type: image.blob.type, bytes: encoded }, KEY);

      return () => {};
    });
  });
}

export function saveWallpaperLook(look: WallpaperLook): Effect.Effect<void, Error> {
  return transaction('readwrite', (files) => {
    files.put(look, LOOK);

    return () => {};
  });
}

export function deleteWallpaper(): Effect.Effect<void, Error> {
  return transaction('readwrite', (files) => {
    files.delete(KEY);

    return () => {};
  });
}
