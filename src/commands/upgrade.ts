import inquirer from "inquirer";
import ora from "ora";
import chalk from "chalk";
import open from "open";
import { requireAuth } from "../utils/auth.js";
import {
  getMyWorkspace,
  createCheckoutSession,
  createPortalSession,
  type Workspace,
  type WorkspacePlan,
} from "../utils/api.js";
import { logger } from "../utils/logger.js";

const UPGRADE_PAGE = "https://bundl.ai/company";

function formatStarterMonthlyTotal(seats: number): string {
  if (seats <= 3) return "$20/mo";
  const total = 20 + (seats - 3) * 20;
  return `$${total}/mo`;
}

function formatStarterYearlyTotal(seats: number): string {
  const base = 3 * 15 * 12;
  if (seats <= 3) return `$${base}/yr`;
  const total = seats * 15 * 12;
  return `$${total}/yr`;
}

function formatTeamTotal(interval: "monthly" | "yearly"): string {
  return interval === "monthly" ? "$1,000/mo" : "$11,000/yr";
}

export type UpgradeOptions = {
  manage?: boolean;
  json?: boolean;
};

export async function runUpgrade(options: UpgradeOptions = {}): Promise<number> {
  await requireAuth();

  if (options.manage) {
    const spinner = ora("Opening subscription management...").start();
    try {
      const { url } = await createPortalSession();
      spinner.succeed();
      console.log();
      console.log(chalk.green("  Opening subscription management in browser"));
      console.log();
      await open(url);
      return 0;
    } catch (err) {
      spinner.fail();
      logger.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  const fetchSpinner = ora("Fetching workspace...").start();
  let workspace: Workspace;
  try {
    workspace = await getMyWorkspace();
  } catch (err) {
    fetchSpinner.fail();
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  fetchSpinner.succeed();

  const plan = (workspace.plan ?? "free") as WorkspacePlan;
  if (plan === "team") {
    logger.success("You're already on the Team plan.");
    console.log(chalk.dim("  bundl upgrade --manage"));
    return 0;
  }

  const { planChoice } = await inquirer.prompt<{ planChoice: "starter" | "team" | "cancel" }>([
    {
      type: "list",
      name: "planChoice",
      message: "Select a plan:",
      choices: [
        {
          name: "Starter — $20/month (first 3 seats included)\n    Shared library, company workspace, org library",
          value: "starter",
        },
        {
          name: "Team — $1,000/month\n    Standardization, own AI prompt corpus, reuse what works",
          value: "team",
        },
        new inquirer.Separator(),
        { name: "Cancel", value: "cancel" },
      ],
    },
  ]);

  if (planChoice === "cancel") return 0;

  const { interval } = await inquirer.prompt<{ interval: "monthly" | "yearly" }>([
    {
      type: "list",
      name: "interval",
      message: "Billing interval:",
      choices: [
        { name: "Monthly", value: "monthly" },
        { name: "Yearly (save ~25%)", value: "yearly" },
      ],
    },
  ]);

  let seats = 1;
  if (planChoice === "starter") {
    const { seatsAnswer } = await inquirer.prompt<{ seatsAnswer: string }>([
      {
        type: "input",
        name: "seatsAnswer",
        message: "How many seats? (default: 3)",
        default: "3",
      },
    ]);
    const n = parseInt(seatsAnswer.trim() || "3", 10);
    seats = Math.min(100, Math.max(1, isNaN(n) ? 3 : n));
  }

  const totalLabel =
    planChoice === "starter"
      ? interval === "monthly"
        ? formatStarterMonthlyTotal(seats)
        : formatStarterYearlyTotal(seats)
      : formatTeamTotal(interval);

  const div = chalk.dim("  ─────────────────────────────────────────");
  console.log();
  console.log(div);
  console.log(chalk.white("  Plan      " + (planChoice === "starter" ? "Starter" : "Team")));
  console.log(chalk.white("  Seats     " + seats));
  console.log(chalk.white("  Interval  " + (interval === "monthly" ? "Monthly" : "Yearly")));
  console.log(chalk.white("  Total     " + totalLabel));
  console.log(div);
  console.log();

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    { type: "confirm", name: "confirm", message: "Proceed to checkout? (Y/n)", default: true },
  ]);
  if (!confirm) {
    logger.info("Cancelled.");
    return 0;
  }

  const checkoutSpinner = ora("Creating checkout session...").start();
  try {
    const { url } = await createCheckoutSession(
      workspace.id,
      planChoice,
      interval,
      planChoice === "starter" ? seats : undefined
    );
    checkoutSpinner.succeed();
    console.log();
    console.log(chalk.green("  ✓ Opening Stripe checkout in your browser"));
    console.log();
    console.log(chalk.dim("  Complete payment there to activate your plan."));
    console.log(chalk.dim("  CLI access updates immediately after successful payment."));
    console.log();
    console.log(chalk.dim("  If browser didn't open:"));
    console.log(chalk.dim("  " + url));
    console.log();
    await open(url);
    return 0;
  } catch (err) {
    checkoutSpinner.fail();
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

export async function showUpgradePrompt(
  plan: WorkspacePlan | undefined,
  workspaceId: string
): Promise<void> {
  const div = chalk.dim("  ─────────────────────────────────────────");
  console.log();
  console.log(div);
  console.log(chalk.yellow("  This action requires a paid plan."));
  console.log();
  console.log(chalk.dim("  Starter — $20/month (first 3 seats included)"));
  console.log(chalk.dim("  Team — $1,000/month"));
  console.log(div);
  console.log();

  const { action } = await inquirer.prompt<{
    action: "starter" | "team" | "browser" | "cancel";
  }>([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        {
          name: "Upgrade to Starter — $20/month (first 3 seats included)",
          value: "starter",
        },
        { name: "Upgrade to Team — $1,000/month", value: "team" },
        { name: "Open upgrade page in browser", value: "browser" },
        new inquirer.Separator(),
        { name: "Cancel", value: "cancel" },
      ],
    },
  ]);

  if (action === "cancel") {
    logger.info("Cancelled.");
    process.exit(0);
  }

  if (action === "browser") {
    await open(UPGRADE_PAGE);
    console.log(chalk.dim("  Opened " + UPGRADE_PAGE));
    process.exit(0);
  }

  const { interval } = await inquirer.prompt<{ interval: "monthly" | "yearly" }>([
    {
      type: "list",
      name: "interval",
      message: "Billing interval:",
      choices: [
        { name: "Monthly", value: "monthly" },
        { name: "Yearly (save ~25%)", value: "yearly" },
      ],
    },
  ]);

  let seats = 1;
  if (action === "starter") {
    const { seatsAnswer } = await inquirer.prompt<{ seatsAnswer: string }>([
      {
        type: "input",
        name: "seatsAnswer",
        message: "How many seats? (default: 3)",
        default: "3",
      },
    ]);
    const n = parseInt(seatsAnswer.trim() || "3", 10);
    seats = Math.min(100, Math.max(1, isNaN(n) ? 3 : n));
  }

  const spinner = ora("Creating checkout session...").start();
  try {
    const { url } = await createCheckoutSession(
      workspaceId,
      action,
      interval,
      action === "starter" ? seats : undefined
    );
    spinner.succeed();
    console.log();
    console.log(chalk.green("  ✓ Opening Stripe checkout in your browser"));
    console.log();
    await open(url);
    process.exit(0);
  } catch (err) {
    spinner.fail();
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export function isPaymentRequiredError(err: unknown): boolean {
  return (err as Error & { status?: number }).status === 402;
}
