export function at<T>(values: readonly T[], index: number): T {
  const value = values[index];

  if (value === undefined) throw new RangeError(`No value at index ${index}`);

  return value;
}

export function entry<T>(values: ReadonlyMap<string, T>, key: string): T {
  const value = values.get(key);

  if (value === undefined) throw new RangeError(`No entry for ${key}`);

  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function hasKey<T extends object>(value: T, key: PropertyKey): key is keyof T {
  return Object.hasOwn(value, key);
}

export function lookup<T extends object>(value: T, key: string): T[keyof T] | undefined {
  return hasKey(value, key) ? value[key] : undefined;
}
