// Generates a custom theme from a short vibe for the signed-in caller (src/account.js generateTheme).
// Deploy with: supabase functions deploy generate-theme
// Keep the default verify_jwt, so the platform rejects requests without a valid user token before this
// code runs; handler.ts checks the token again with the Auth server. The platform provides SUPABASE_URL
// and SUPABASE_SERVICE_ROLE_KEY; ANTHROPIC_API_KEY is a function secret. No key leaves the server.
// The daily limit is public.claim_theme_generation (supabase/migrations/20261022120000_theme_generations.sql).
import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import { DAILY_LIMIT, handleGenerateTheme } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
const client = url && serviceKey
  ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const deps = client && apiKey ? {
  auth: client.auth,
  async claim(userId: string) {
    const { data, error } = await client.rpc('claim_theme_generation', { p_user: userId, p_limit: DAILY_LIMIT });
    if (error) throw error;
    return data === true;
  },
  apiKey,
  fetch,
} : null;

Deno.serve((request) => handleGenerateTheme(request, deps));
