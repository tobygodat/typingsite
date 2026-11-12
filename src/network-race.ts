import { Schema } from 'effect';
import { decodeReply } from './network.js';
import type { Conditions } from './typing.js';

function open<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
}

export const TraceSchema = open({ v: Schema.Number, k: Schema.String, t: Schema.mutable(Schema.Array(Schema.Number)), e: Schema.Number });

export type CompactTrace = typeof TraceSchema.Type;

export const ChallengeScoreSchema = open({ wpm: Schema.Number, accuracy: Schema.Number, elapsedMs: Schema.Number, correct: Schema.Number });

export type ChallengeScore = typeof ChallengeScoreSchema.Type;

const optionalString = Schema.optional(Schema.NullOr(Schema.String));
const optionalNumber = Schema.optional(Schema.NullOr(Schema.Number));

export const ConditionsSchema = open({
  mode: Schema.optional(Schema.Literals(['time', 'words', 'quote', 'standard', 'code', 'book', 'custom', 'lesson'])),
  duration: optionalNumber, count: optionalNumber, punctuation: Schema.optional(Schema.Boolean), numbers: Schema.optional(Schema.Boolean),
  quoteLength: optionalString, difficulty: optionalString, wordList: optionalString,
  inputClass: Schema.optional(Schema.Literals(['physical-keyboard', 'touch'])),
  correctionPolicy: Schema.optional(Schema.Literals(['relaxed', 'mandatory', 'no-backspace', 'fail-word', 'fail-any'])),
  language: Schema.optional(Schema.String), corpus: Schema.optional(Schema.String), metricVersion: Schema.optional(Schema.String),
  recipe: Schema.optional(Schema.String), layout: Schema.optional(Schema.String), codeLanguage: Schema.optional(Schema.String), book: Schema.optional(Schema.String),
  strictSpace: Schema.optional(Schema.Boolean), quickEnd: Schema.optional(Schema.Boolean),
  textId: Schema.optional(Schema.String), sourceKind: Schema.optional(Schema.String),
});

export type RaceConditions = Conditions & { textId?: string; sourceKind?: string };

export const PlayerSchema = open({
  slot: Schema.Number, sequence: Schema.optional(Schema.Number), name: Schema.optional(Schema.String),
  ready: Schema.optional(Schema.Boolean), finished: Schema.optional(Schema.Boolean), connected: Schema.optional(Schema.Boolean),
  rematch: Schema.optional(Schema.Boolean), left: Schema.optional(Schema.Boolean), account: Schema.optional(Schema.Boolean), friend: Schema.optional(Schema.Boolean),
  typed: Schema.optional(Schema.String), progress: Schema.optional(Schema.Number), elapsed: optionalNumber, wpm: Schema.optional(Schema.Number),
  accuracy: Schema.optional(Schema.Number), keystrokes: Schema.optional(Schema.Number), errors: Schema.optional(Schema.Number),
  outcome: optionalString, checked: Schema.optional(Schema.Boolean),
});

export type RacePlayer = typeof PlayerSchema.Type;

const ratingFields = { rated: Schema.Boolean, reason: Schema.NullOr(Schema.String), outcome: Schema.NullOr(Schema.Literals(['won', 'lost', 'tied'])), before: Schema.Number, after: Schema.Number, delta: Schema.Number, races: Schema.Number };
const RatingSchema = open(ratingFields);

const RoomSchema = open({
  id: Schema.String, passage: Schema.Union([Schema.String, open({ id: Schema.String, text: Schema.String })]),
  conditions: Schema.optional(ConditionsSchema), players: Schema.optional(Schema.mutable(Schema.Array(PlayerSchema))), selfSlot: Schema.optional(Schema.Number),
  status: Schema.optional(Schema.Literals(['waiting', 'countdown', 'racing', 'finished', 'cancelled', 'expired'])), duration: optionalNumber,
  startAt: optionalString, serverNow: optionalString, expiresAt: optionalString, inviteKind: optionalString,
  rematchOf: optionalString, rematchId: optionalString, tally: Schema.optional(Schema.NullOr(Schema.mutable(Schema.Array(Schema.Number)))),
  quick: Schema.optional(Schema.Boolean), rating: Schema.optional(Schema.NullOr(RatingSchema)),
});

export type RaceRoom = typeof RoomSchema.Type & { passage: { id: string; text: string } };

export const EntrySchema = open({ roomId: Schema.String, room: RoomSchema, guestToken: optionalString, inviteToken: optionalString });

export type RaceEntry = typeof EntrySchema.Type & { room: RaceRoom };

export const FriendSchema = open({ id: Schema.String, name: Schema.optional(Schema.String), email: optionalString, account: Schema.optional(Schema.Boolean) });

export type Friend = typeof FriendSchema.Type;

export const InviteSchema = open({ id: Schema.String, hostName: Schema.optional(Schema.String), createdAt: Schema.optional(Schema.String), expiresAt: Schema.optional(Schema.String), rematch: Schema.optional(Schema.Boolean) });

export type RaceInvite = typeof InviteSchema.Type;

export const TraceReplySchema = open({ traces: Schema.optional(Schema.NullOr(Schema.mutable(Schema.Array(open({ slot: Schema.Number, trace: Schema.NullOr(TraceSchema) }))))) });
const LinkSchema = open({ id: Schema.String, friendId: Schema.String });
export const PeopleLinksSchema = open({ friends: Schema.mutable(Schema.Array(open({ id: Schema.String, tally: Schema.NullOr(Schema.mutable(Schema.Array(Schema.Number))) }))), invites: Schema.mutable(Schema.Array(LinkSchema)), challenges: Schema.mutable(Schema.Array(LinkSchema)) });

export type PeopleLinks = typeof PeopleLinksSchema.Type;

export function roomReply(value: unknown): RaceRoom {
  const room = decodeReply(RoomSchema, value);

  return { ...room, passage: typeof room.passage === 'string' ? { id: room.conditions?.textId || room.id, text: room.passage } : room.passage };
}

export function entryReply(value: unknown): RaceEntry {
  const reply = decodeReply(EntrySchema, value);

  return { ...reply, room: roomReply(reply.room) };
}

export const ChallengeSchema = open({
  id: Schema.String, role: Schema.Literals(['sent', 'received']), name: Schema.String, status: Schema.Literals(['open', 'done', 'expired']),
  conditions: ConditionsSchema, duration: Schema.NullOr(Schema.Number), sender: ChallengeScoreSchema, result: Schema.NullOr(ChallengeScoreSchema),
  createdAt: Schema.String, expiresAt: Schema.String, completedAt: Schema.NullOr(Schema.String),
  passage: Schema.optional(Schema.String), trace: Schema.optional(TraceSchema),
});

export type GhostChallenge = typeof ChallengeSchema.Type;

const LastRatingSchema = open({ roomId: Schema.String, ...ratingFields });

export type QuickMatchReply =
  | { state: 'idle' }
  | { state: 'waiting'; rating: number; races: number; waitedMs: number }
  | { state: 'paired'; roomId: string; room: RaceRoom }
  | { rating: number; races: number; last?: typeof LastRatingSchema.Type };

const QuickSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal('idle') }),
  Schema.Struct({ state: Schema.Literal('waiting'), rating: Schema.Number, races: Schema.Number, waitedMs: Schema.Number }),
  Schema.Struct({ state: Schema.Literal('paired'), roomId: Schema.String, room: RoomSchema }),
  Schema.Struct({ rating: Schema.Number, races: Schema.Number, last: Schema.optional(LastRatingSchema) }),
]);

export function quickReply(value: unknown): QuickMatchReply {
  const reply = decodeReply(QuickSchema, value);

  return 'state' in reply && reply.state === 'paired' ? { ...reply, room: roomReply(reply.room) } : reply;
}
