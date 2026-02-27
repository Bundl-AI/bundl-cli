import chalk from "chalk";
import { getCredentials, isAuthenticated } from "../utils/auth.js";
import { getMyWorkspace } from "../utils/api.js";
import { logger } from "../utils/logger.js";

function formatExpiry(expiresAt: number): string {
  const secondsLeft = expiresAt - Math.floor(Date.now() / 1000);

  if (secondsLeft < 0) return "expired";
  if (secondsLeft < 60) return "expires in less than a minute";
  if (secondsLeft < 3600) {
    const mins = Math.floor(secondsLeft / 60);
    return `expires in ${mins} minute${mins === 1 ? "" : "s"}`;
  }
  if (secondsLeft < 86400) {
    const hours = Math.floor(secondsLeft / 3600);
    return `expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.floor(secondsLeft / 86400);
  return `expires in ${days} day${days === 1 ? "" : "s"}`;
}

export type WhoamiOptions = {
  json?: boolean;
};

export async function runWhoami(options: WhoamiOptions = {}): Promise<number> {
  const creds = getCredentials();

  if (options.json) {
    const authenticated = creds !== null && isAuthenticated();
    let plan: string | null = null;
    try {
      const ws = await getMyWorkspace();
      plan = ws.plan ?? "free";
    } catch {
      plan = null;
    }
    logger.json({
      authenticated,
      email: creds?.user_email ?? null,
      workspace_id: creds?.workspace_id ?? null,
      workspace_name: creds?.workspace_name ?? null,
      plan,
      expires_at: creds?.expires_at ?? null,
      expired: creds != null && !isAuthenticated(),
    });
    return 0;
  }

  if (!creds) {
    logger.info("Not logged in. Run bundl login to connect.");
    return 0;
  }

  if (!isAuthenticated()) {
    console.log(chalk.white("  Account    " + creds.user_email + "  ") + chalk.dim("(session expired)"));
    console.log(chalk.dim("  Run bundl login to reconnect."));
    return 0;
  }

  let planLabel = "—";
  try {
    const ws = await getMyWorkspace();
    planLabel = ws.plan ?? "free";
  } catch {
    // ignore
  }

  const div = chalk.dim("  ─────────────────────────────────────────");
  const workspaceLabel = creds.workspace_name ?? "none";
  const secondsLeft = creds.expires_at - Math.floor(Date.now() / 1000);
  const expiresLabel = formatExpiry(creds.expires_at);

  console.log();
  console.log(div);
  console.log(chalk.white("  Account    " + creds.user_email));
  console.log(chalk.white("  Workspace  " + workspaceLabel));
  console.log(chalk.white("  Plan       " + planLabel));
  console.log(chalk.white("  Status     Connected"));
  console.log(chalk.white("  Expires    " + expiresLabel));
  if (secondsLeft >= 0 && secondsLeft < 600) {
    console.log(
      chalk.yellow("  ⚠  Session expiring soon — ") +
        chalk.dim("will auto-refresh on next command")
    );
  }
  console.log(div);
  console.log();
  return 0;
}
