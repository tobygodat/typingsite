// The delete-account Edge Function without its Deno and supabase-js wiring (index.ts), so Node can
// test it. Deleting an account is one authoritative step: the caller's own token names the user and
// auth.admin.deleteUser removes them. The profile row, race rooms, race seats and friend rows go
// with the user through their ON DELETE CASCADE foreign keys (supabase/tests/account-deletion.sql).

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// The calls this function makes on supabase-js's auth client, created with the service key.
type UserReply = Promise<{ data: { user: { id: string } | null } | null; error: unknown }>;

export interface AccountAuth {
  getUser(jwt: string): UserReply;
  admin: {
    deleteUser(id: string, shouldSoftDelete?: boolean): Promise<{ error: unknown }>;
    getUserById(id: string): UserReply;
  };
}

export const MESSAGES = {
  method: 'Use POST to delete an account.',
  session: 'Your session has ended. Sign in again, then delete your account.',
  config: 'Account deletion isn’t configured on the server.',
  failed: 'Your account couldn’t be deleted just now. Nothing was removed. Try again in a moment.',
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

// deleteUser can commit and still fail on the way back (a dropped connection, a timeout), so a failed
// delete asks once more: only a user the Auth server reports as not found counts as gone.
async function userGone(auth: AccountAuth, userId: string): Promise<boolean> {
  try {
    const { data, error } = await auth.admin.getUserById(userId);
    // SAFETY: Auth errors carry an optional numeric status and string code; anything else fails both checks below.
    const { status, code } = (error ?? {}) as { status?: number; code?: string };

    return !data?.user && (code === 'user_not_found' || status === 404);
  } catch {
    return false;
  }
}

export async function handleDeleteAccount(request: Request, auth: AccountAuth | null): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (request.method !== 'POST') return reply(405, { error: MESSAGES.method });

  if (!auth) return reply(500, { error: MESSAGES.config });
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];

  if (!token) return reply(401, { error: MESSAGES.session });

  // The Auth server checks the token, so an expired, signed-out or forged one never names a user,
  // and nothing in the request body can choose whose account goes.
  let userId: string | undefined;

  try {
    const { data, error } = await auth.getUser(token);

    if (!error) userId = data?.user?.id;
  } catch {
    return reply(500, { error: MESSAGES.failed });
  }

  if (!userId) return reply(401, { error: MESSAGES.session });

  // A hard delete: a soft delete keeps the auth.users row, so none of the cascades would run.
  try {
    const { error } = await auth.admin.deleteUser(userId, false);

    if (!error) return reply(200, { deleted: true });
  } catch {
    // Settled below.
  }

  if (await userGone(auth, userId)) return reply(200, { deleted: true });

  return reply(500, { error: MESSAGES.failed });
}
