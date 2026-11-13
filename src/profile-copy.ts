import { isRecord } from './domain-values.js';
import type { Profile, HydratedProfile, ProfileCopy, StoredProfileCopy } from './profile-types.js';

// cyrb53: a fast 53-bit string hash. Not cryptographic; it only tells copies of the cache apart.
function cyrb53(text: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// Names one copy of the device cache in a few characters, so a sign-out marker can say which it sent.
export const textStamp = (text: string) => `${text.length.toString(36)}:${cyrb53(text).toString(36)}`;

// Each run and loop names the conditions it was typed at, and most share a few sets, so a stored copy keeps
// each set once in conditionSets, under a stamp of its JSON, and a record names its set by that stamp
// (conditionSet, where conditions was). Loading puts every record's conditions back exactly as they were
// (withoutConditionSets, in normalizeProfile), so nothing that reads or merges a copy sees the table.
// Builds from before it read only inline conditions and throw on a record without them, so a copy is
// written this way only from CONDITION_SETS_FROM, once tabs still running one have had six weeks to reload.
export const CONDITION_SETS_FROM = '2026-12-01T00:00:00Z';
const CONDITIONED = ['runs', 'loops'];
const renamed = (record: Record<string, unknown>, from: string, to: string, value: unknown) => Object.fromEntries(Object.entries(record).map(([key, held]) => (key === from ? [to, value] : [key, held])));

export function withoutConditionSets(copy: unknown): unknown {
  if (!isRecord(copy)) return copy;
  const { conditionSets, ...rest } = copy;
  const sets = conditionSets && typeof conditionSets === 'object' ? conditionSets : {};
  const named = (record: unknown): record is Record<string, unknown> => isRecord(record) && 'conditionSet' in record;

  for (const name of CONDITIONED) {
    if (!Array.isArray(rest[name]) || !rest[name].some(named)) continue;
    rest[name] = rest[name].flatMap((record) => {
      if (!named(record)) return [record];

      if (record.conditions) {
        const { conditionSet, ...inline } = record;

        return [inline];
      }

      // A set this copy lacks (a tab on a build from before kept another copy's table): the record is left
      // out here, and comes back from any copy that holds it whole.
      const key = String(record.conditionSet);
      const conditions: unknown = Object.getOwnPropertyDescriptor(sets, key)?.value;

      return Object.hasOwn(sets, key) ? [renamed(record, 'conditionSet', 'conditions', Object.assign({}, conditions))] : [];
    });
  }

  return rest;
}

export function withConditionSets(profile: unknown, now = Date.now()): unknown {
  if (now < Date.parse(CONDITION_SETS_FROM) || !isRecord(profile)) return profile;
  const decoded = withoutConditionSets(profile);

  if (!isRecord(decoded)) return decoded;
  const copy = { ...decoded };
  const sets: Record<string, unknown> = {};
  const texts: Record<string, string> = {};

  for (const name of CONDITIONED) {
    if (!Array.isArray(copy[name])) continue;
    copy[name] = copy[name].map((record) => {
      if (!isRecord(record) || !record.conditions || typeof record.conditions !== 'object') return record;
      const text = JSON.stringify(record.conditions);
      const stamp = textStamp(text);

      // Two sets with one stamp: the second stays inline.
      if (texts[stamp] !== undefined && texts[stamp] !== text) return record;
      texts[stamp] = text;
      sets[stamp] = record.conditions;

      return renamed(record, 'conditions', 'conditionSet', stamp);
    });
  }

  return Object.keys(sets).length ? { ...copy, conditionSets: sets } : copy;
}

// The copy written to the device cache. A trace's summary is the replay of its own events (completeAttempt)
// and over half its size, so it is left out and rebuilt on load (normalizeProfile).
const withoutSummary = ({ summary, ...trace }: Record<string, unknown>) => trace;

export function storedCopy(profile: object, now?: number): StoredProfileCopy;
export function storedCopy(profile: unknown, now = Date.now()): unknown {
  return withConditionSets(isRecord(profile) && Array.isArray(profile.attempts)
    ? { ...profile, attempts: profile.attempts.map((trace) => (isRecord(trace) && trace.summary ? withoutSummary(trace) : trace)) } : profile, now);
}

// The file "Export my data" saves: this device's stored copy as it is, keystroke recordings included, with
// the moment it was made. It stays a stored copy at its top level, so anything that reads one reads it
// (normalizeProfile, scripts/evaluate-learner.mjs --profile). The sign-in is kept elsewhere and is never in it.
export function exportCopy(profile: Profile | HydratedProfile | ProfileCopy, now = Date.now()) {
  const at = new Date(now).toISOString();

  return { name: `stilltype-export-${at.slice(0, 10)}.json`, text: JSON.stringify({ ...storedCopy(profile, now), exportedAt: at }, null, 1) };
}

export function rowCopy<T extends object>(profile: T): Omit<T, 'attempts'> {
  const { attempts, ...rest } = { attempts: undefined, ...profile };

  return rest;
}

interface SyncMetadata {
  historyClearedAt?: string;
  appliedClears?: string[];
  heardClears?: string[];
  historyClearedIds?: (string | [marker: string, id: string])[];
  undoneClears?: string[];
  legacyClearedAt?: string;
  mergeStamp?: string;
}

export type SyncedProfile<P extends object = Profile> = P & SyncMetadata;
