import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSetting, setSetting } from './db';

/**
 * GoonBill Cloud — the app's shared backend. Every user syncs to this one
 * project; Supabase RLS policies keep each user's data separate.
 * The anon key is public by design (it ships in every client app).
 */
const DEFAULT_SUPABASE_URL = 'https://idsgqbommqyrvrnxedec.supabase.co';
const DEFAULT_ANON_KEY = 'sb_publishable_gSWfFXadwwc666owRgZwOA_WmAFcvC6';

let client: SupabaseClient | null = null;
let cacheKey = '';

/** The backend is baked into the app — always configured. */
export function supabaseConfigured(): boolean {
  return true;
}

/** Lazily-built client for the shared backend. */
export function getSupabase(): SupabaseClient | null {
  // A previously saved custom URL/key still wins, so nobody's setup breaks.
  const url = getSetting('supabase_url').trim() || DEFAULT_SUPABASE_URL;
  const key = getSetting('supabase_anon_key').trim() || DEFAULT_ANON_KEY;
  const ck = `${url}|${key}`;
  if (!client || cacheKey !== ck) {
    client = createClient(url, key);
    cacheKey = ck;
  }
  return client;
}

/** Call after the URL/key change so the next call rebuilds the client. */
export function resetSupabaseClient(): void {
  client = null;
  cacheKey = '';
}

export function setSupabaseCredentials(url: string, anonKey: string): void {
  setSetting('supabase_url', url.trim());
  setSetting('supabase_anon_key', anonKey.trim());
  resetSupabaseClient();
}
