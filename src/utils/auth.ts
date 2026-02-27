import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { getSupabase } from "./supabase.js";

const CREDENTIALS_DIR = path.join(os.homedir(), ".bundl");
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, "credentials.json");

export interface Credentials {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_email: string;
  user_id: string;
  workspace_id: string | null;
  workspace_name: string | null;
}

export function getCredentials(): Credentials | null {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) return null;
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(data: Credentials): void {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(data, null, 2));
  try {
    fs.chmodSync(CREDENTIALS_PATH, 0o600);
  } catch {
    // chmod may fail on Windows — not critical
  }
}

export function clearCredentials(): void {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    fs.unlinkSync(CREDENTIALS_PATH);
  }
}

export function isAuthenticated(): boolean {
  const creds = getCredentials();
  if (!creds) return false;
  return creds.expires_at > Date.now() / 1000 + 60;
}

export async function getValidToken(): Promise<string | null> {
  const creds = getCredentials();
  if (!creds) return null;

  // Token still valid — return immediately
  // Use 5 minute buffer to avoid expiry mid-command
  const fiveMinutes = 5 * 60;
  if (creds.expires_at > Date.now() / 1000 + fiveMinutes) {
    return creds.access_token;
  }

  // Token expired or about to expire — attempt refresh
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: creds.refresh_token,
    });

    if (error || !data.session) {
      // Refresh token itself has expired — clear and signal re-login
      clearCredentials();
      return null;
    }

    // Save refreshed tokens
    const updated: Credentials = {
      ...creds,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at:
        data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    };
    saveCredentials(updated);
    return updated.access_token;
  } catch {
    // Network error during refresh — return existing token as best effort
    // rather than logging user out
    if (creds.expires_at > Date.now() / 1000) {
      return creds.access_token;
    }
    clearCredentials();
    return null;
  }
}

/**
 * Standard auth check for commands that require login.
 * Returns a valid token or exits the process with a clear message.
 */
export async function requireAuth(): Promise<string> {
  const token = await getValidToken();

  if (token) return token;

  const creds = getCredentials();
  if (!creds) {
    console.log();
    console.log("  Not logged in.");
    console.log("  Run " + chalk.bold("bundl login") + " to connect.");
    console.log();
    process.exit(1);
  }

  // Had credentials but refresh failed — session fully expired
  console.log();
  console.log("  Your session has expired.");
  console.log("  Run " + chalk.bold("bundl login") + " to reconnect.");
  console.log();
  process.exit(1);
}
