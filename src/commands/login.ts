import inquirer from "inquirer";
import ora from "ora";
import chalk from "chalk";
import { getSupabase } from "../utils/supabase.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../utils/config.js";
import {
  getCredentials,
  saveCredentials,
  isAuthenticated,
  type Credentials,
} from "../utils/auth.js";
import { logger } from "../utils/logger.js";

function isValidEmail(s: string): boolean {
  const t = s.trim();
  return t.includes("@") && t.includes(".") && t.length > 5;
}

function isValidCode(s: string): boolean {
  const t = s.replace(/\s/g, "");
  return /^\d{8}$/.test(t);
}

export async function runLogin(): Promise<number> {
  const creds = getCredentials();
  if (creds && isAuthenticated()) {
    logger.success(`Already connected as ${creds.user_email}`);
    logger.info("Run bundl logout to disconnect.");
    return 0;
  }

  let email: string;
  while (true) {
    const ans = await inquirer.prompt<{ email: string }>([
      {
        type: "input",
        name: "email",
        message: "Enter your Bundl account email:",
      },
    ]);
    email = (ans.email ?? "").trim();
    if (isValidEmail(email)) break;
    logger.error("Please enter a valid email (e.g. you@company.com).");
  }

  const supabase = getSupabase();
  if (!supabase) {
    logger.error("Bundl login is not configured (missing or invalid Supabase URL).");
    return 1;
  }
  const sendSpinner = ora("Sending code to " + email + "...").start();
  const { error: otpError } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });

  if (otpError) {
    sendSpinner.fail();
    console.error(chalk.red("✗ Could not send a code to " + email));
    console.error(chalk.dim("  Make sure this email has a Bundl account at bundl.ai"));
    return 1;
  }

  sendSpinner.succeed();
  console.log(chalk.green("✓ Code sent — check your email"));
  console.log(chalk.dim("  The code expires in 10 minutes."));
  console.log();

  let code: string;
  while (true) {
    const ans = await inquirer.prompt<{ code: string }>([
      {
        type: "input",
        name: "code",
        message: "Enter the 8-digit code:",
      },
    ]);
    code = (ans.code ?? "").replace(/\s/g, "");
    if (isValidCode(code)) break;
    logger.error("Code must be 8 digits.");
  }

  const verifySpinner = ora("Verifying...").start();
  const { data, error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });

  if (verifyError || !data.session) {
    verifySpinner.fail();
    const msg = (verifyError?.message ?? "").toLowerCase();
    if (msg.includes("expired")) {
      console.error(chalk.red("✗ Code expired. Run bundl login again to get a new code."));
    } else if (msg.includes("invalid")) {
      console.error(chalk.red("✗ Invalid code. Check your email and try again."));
    } else {
      console.error(chalk.red("✗ Verification failed. Run bundl login to try again."));
    }
    return 1;
  }

  const session = data.session;
  const user = data.user;

  const credentials: Credentials = {
    access_token: session.access_token,
    refresh_token: session.refresh_token ?? "",
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user_email: user?.email ?? email,
    user_id: user?.id ?? "",
    workspace_id: null,
    workspace_name: null,
  };
  if (!credentials.refresh_token?.trim()) {
    console.error("[bundl] Warning: no refresh_token in session");
  }
  saveCredentials(credentials);

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/workspaces?select=id,name&limit=1`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (res.ok) {
      const json = (await res.json()) as { id?: string; name?: string }[];
      const ws = Array.isArray(json) && json[0] ? json[0] : null;
      if (ws?.id != null || ws?.name != null) {
        credentials.workspace_id = ws.id ?? null;
        credentials.workspace_name = ws.name ?? null;
        saveCredentials(credentials);
      }
    }
  } catch {
    // ignore — workspace optional
  }

  verifySpinner.succeed();

  const div = chalk.dim("  ─────────────────────────────────────────");
  const workspaceLabel = credentials.workspace_name ?? "No workspace found";
  console.log();
  console.log(div);
  console.log(chalk.green("  ✓ Connected to Bundl"));
  console.log();
  console.log(chalk.white("  Account   " + credentials.user_email));
  console.log(chalk.white("  Workspace " + workspaceLabel));
  console.log(div);
  console.log();
  console.log(chalk.dim("  Run bundl push to sync your corpus."));
  console.log(chalk.dim("  Run bundl whoami to check your connection anytime."));
  console.log();
  return 0;
}
