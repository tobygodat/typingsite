// Deletes the signed-in caller's Stilltype account (src/account.js deleteAccount calls it).
// Deploy with: supabase functions deploy delete-account
// Keep the default verify_jwt, so the platform rejects requests without a valid user token before
// this code runs; handler.ts checks the token again with the Auth server. The platform provides
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to every Edge Function; the key never leaves the server.
import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import { handleDeleteAccount } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const auth = url && serviceKey
  ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } }).auth
  : null;

Deno.serve((request) => handleDeleteAccount(request, auth));
