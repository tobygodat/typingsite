import { Effect, Schema } from 'effect';
import { abortable, accountLifetime, pageLifetime, within, WorkCancelled } from './async-runtime.js';
import type { AsyncLifetime } from './async-runtime.js';

export const SUPABASE_URL = 'https://bicbyljexprkaedakofa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-JwGKezfGmITUHTITrhsNw_Izw71gdI';
export const REQUEST_TIMEOUT_MS = 15000;
export const UNREACHABLE = 'Can’t reach the account service. Check your connection.';

export class AuthError extends Error {
  status?: number;
  code?: string;
  unavailable?: boolean;
}

const ErrorReply = Schema.Struct({
  msg: Schema.optional(Schema.String), error_description: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String), error: Schema.optional(Schema.String),
  error_code: Schema.optional(Schema.String), code: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
});

export interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  lifetime?: AsyncLifetime;
}

export function requestEffect(path: string, { method = 'GET', body, token, headers = {}, signal: callerSignal }: RequestOptions = {}): Effect.Effect<unknown, AuthError> {
  const sentHeaders: Record<string, string> = { apikey: SUPABASE_KEY };
  if (token) sentHeaders.Authorization = `Bearer ${token}`;
  if (body) sentHeaders['Content-Type'] = 'application/json';
  return within(abortable(async (signal) => {
    const response = await fetch(`${SUPABASE_URL}${path}`, {
      method, signal: callerSignal ? AbortSignal.any([signal, callerSignal]) : signal, headers: Object.assign(sentHeaders, headers), body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      let reply: typeof ErrorReply.Type = {};
      try { reply = Schema.decodeUnknownSync(ErrorReply)(data); } catch {}
      const error = new AuthError(reply.msg || reply.error_description || reply.message || reply.error || `Request failed (${response.status}).`);
      error.status = response.status;
      const code = reply.error_code || reply.code;
      if (code) error.code = String(code);
      throw error;
    }
    return data;
  }, (cause) => cause instanceof AuthError ? cause : new AuthError(UNREACHABLE)), REQUEST_TIMEOUT_MS, () => new AuthError(UNREACHABLE));
}

export async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const lifetime = options.lifetime ?? (options.token ? accountLifetime() : pageLifetime());
  try {
    return await lifetime.run(requestEffect(path, options), options.signal);
  } catch (error) {
    if (error instanceof WorkCancelled) throw new AuthError(UNREACHABLE);
    throw error;
  }
}

export const errorDetails = (error: unknown): AuthError => error instanceof AuthError ? error : new AuthError(error instanceof Error ? error.message : String(error));

export function decodeReply<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S['Type'] {
  try { return Schema.decodeUnknownSync(schema)(value); }
  catch { throw new AuthError('The account service returned an unreadable reply. Try again.'); }
}

export const UserSchema = Schema.Struct({ id: Schema.String, email: Schema.optional(Schema.String) });
export const SessionSchema = Schema.Struct({
  access_token: Schema.String, refresh_token: Schema.optional(Schema.String), expires_at: Schema.Number,
  user: UserSchema, signInId: Schema.optional(Schema.String),
});
export type Session = { -readonly [K in keyof typeof SessionSchema.Type]: typeof SessionSchema.Type[K] };
export const AuthResponseSchema = Schema.Struct({
  access_token: Schema.String, refresh_token: Schema.String, user: UserSchema,
  expires_at: Schema.optional(Schema.Number), expires_in: Schema.optional(Schema.Number),
});
export type AuthResponse = typeof AuthResponseSchema.Type;
