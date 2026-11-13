export interface Readable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T) {
  let snapshot = initial;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => { listeners.delete(listener); };
    },
    publish(next: T) {
      if (Object.is(snapshot, next)) return;
      snapshot = next;

      for (const listener of listeners) listener();
    },
  };
}
