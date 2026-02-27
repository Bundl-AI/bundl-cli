import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

let _client: SupabaseClient | null = null;

/** Lazy-init client so whoami/logout work without valid Supabase URL (e.g. dev with placeholders). */
export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL.startsWith("http")) return null;
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return _client;
}

