export function createApplicationLifetime() {
  const abort = new AbortController();
  const timeouts = new Set<number>();
  const intervals = new Set<number>();
  const frames = new Set<number>();
  const observers = new Set<ResizeObserver | MutationObserver>();
  let disposed = false;

  return {
    signal: abort.signal,
    timeout(callback: () => void, delay = 0) {
      const timer = window.setTimeout(() => { timeouts.delete(timer);

 if (!disposed) callback(); }, delay);
      timeouts.add(timer);

      return timer;
    },
    clearTimeout(timer: number) { timeouts.delete(timer); window.clearTimeout(timer); },
    interval(callback: () => void, delay: number) {
      const timer = window.setInterval(() => { if (!disposed) callback(); }, delay);
      intervals.add(timer);

      return timer;
    },
    clearInterval(timer: number) { intervals.delete(timer); window.clearInterval(timer); },
    frame(callback: FrameRequestCallback) {
      const frame = requestAnimationFrame((stamp) => { frames.delete(frame);

 if (!disposed) callback(stamp); });
      frames.add(frame);

      return frame;
    },
    cancelFrame(frame: number) { frames.delete(frame); cancelAnimationFrame(frame); },
    observeResize(callback: ResizeObserverCallback, target: Element) {
      const observer = new ResizeObserver(callback);
      observers.add(observer);
      observer.observe(target);
    },
    observeMutation(callback: MutationCallback, target: Node, options: MutationObserverInit) {
      const observer = new MutationObserver(callback);
      observers.add(observer);
      observer.observe(target, options);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();

      for (const timer of timeouts) window.clearTimeout(timer);

      for (const timer of intervals) window.clearInterval(timer);

      for (const frame of frames) cancelAnimationFrame(frame);

      for (const observer of observers) observer.disconnect();
      timeouts.clear();
      intervals.clear();
      frames.clear();
      observers.clear();
    },
  };
}
