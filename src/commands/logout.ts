import { getSupabase } from "../utils/supabase.js";
import { getCredentials, clearCredentials } from "../utils/auth.js";
import { logger } from "../utils/logger.js";

export async function runLogout(): Promise<number> {
  const creds = getCredentials();

  if (!creds) {
    logger.info("Not currently logged in.");
    return 0;
  }

  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.auth.setSession({
        access_token: creds.access_token,
        refresh_token: creds.refresh_token,
      });
      await supabase.auth.signOut();
    } catch {
      // best effort — still clear local credentials
    }
  }

  clearCredentials();
  logger.success(`Logged out of ${creds.user_email}`);
  return 0;
}
