#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { showBanner } from "./utils/banner.js";
import { setLoggerFlags } from "./utils/logger.js";
import { getCredentials, getValidToken } from "./utils/auth.js";

// Ctrl+C during inquirer prompts rejects with ExitPromptError; exit cleanly (no stack trace)
process.on("unhandledRejection", (reason: unknown) => {
  const err = reason instanceof Error ? reason : null;
  if (err?.name === "ExitPromptError") {
    process.exit(130);
  }
});

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("bundl")
  .version(getVersion())
  .description("The open corpus standard for AI employees")
  .option("--json", "Output only JSON (no styled output)")
  .option("--ci", "CI mode: no decorative output, essentials only")
  .option("--silent", "Suppress all output except errors")
  .hook("preAction", () => {
    const opts = program.opts();
    setLoggerFlags({
      json: opts.json === true,
      ci: opts.ci === true,
      silent: opts.silent === true,
    });
  });

// Show banner before help when user passes --help
const argv = process.argv;
if (argv.includes("--help") || argv.includes("-h")) {
  showBanner();
}

// Proactive refresh: if token expires within 30 minutes, refresh in background
async function silentRefreshIfNeeded(): Promise<void> {
  const creds = getCredentials();
  if (!creds) return;

  const thirtyMinutes = 30 * 60;
  if (creds.expires_at < Date.now() / 1000 + thirtyMinutes) {
    try {
      await getValidToken();
    } catch {
      // Silent failure — command will handle auth if needed
    }
  }
}
silentRefreshIfNeeded().catch(() => {});

program
  .command("init")
  .description("Initialize a new corpus workspace")
  .option("--role <role>", "Skip role prompt, use this role")
  .option("--target <target>", "Skip runtime prompt, use this target")
  .option("--industry <industry>", "Industry (default: B2B SaaS; used with --non-interactive)")
  .option("--size <size>", "Company size (default: 50-200; used with --non-interactive)")
  .option("--tools <tools>", "Comma-separated tools (used with --non-interactive)")
  .option("--no-ai", "Skip AI generation, use base templates only")
  .option("--non-interactive", "No prompts; use flags or detected context (for agents)")
  .action(async (cmd) => {
    const { runInit } = await import("./commands/init.js");
    const opts = typeof cmd?.opts === "function" ? cmd.opts() : {};
    const globalOpts = program.opts();
    await runInit({
      role: opts.role,
      target: opts.target,
      industry: opts.industry,
      size: opts.size,
      tools: opts.tools,
      noAi: opts.ai === false,
      json: globalOpts.json,
      nonInteractive: opts.nonInteractive === true,
    });
  });

program
  .command("validate")
  .description("Validate corpus files against the schema")
  .option("--file <file>", "Validate only this file (e.g. lead-qualification.yaml)")
  .option("--fix", "Attempt to auto-fix warnings (not errors)")
  .action(async (cmd) => {
    const { runValidate } = await import("./commands/validate.js");
    const opts = typeof cmd?.opts === "function" ? cmd.opts() : {};
    const globalOpts = program.opts();
    const code = await runValidate({
      json: globalOpts.json,
      ci: globalOpts.ci,
      fix: opts.fix === true,
      file: opts.file,
    });
    process.exit(code);
  });

program
  .command("simulate")
  .description("Simulate agent behavior")
  .option("--all", "Run all saved scenarios and grade against expected behavior")
  .option("--workflow <id>", "Skip skill selection, use this skill id (e.g. lead-qualification)")
  .option("--generate-scenarios", "Use AI to generate edge-case scenarios for the selected skill")
  .action(async (cmd) => {
    const { runSimulate } = await import("./commands/simulate.js");
    const opts = typeof cmd?.opts === "function" ? cmd.opts() : {};
    const globalOpts = program.opts();
    const code = await runSimulate({
      all: opts.all === true,
      workflow: opts.workflow,
      generateScenarios: opts.generateScenarios === true,
      json: globalOpts.json,
      ci: globalOpts.ci,
    });
    process.exit(code);
  });

program
  .command("list")
  .description("List all skills in the corpus")
  .action(async () => {
    const { runList } = await import("./commands/list.js");
    const globalOpts = program.opts();
    const code = await runList({ json: globalOpts.json });
    process.exit(code);
  });

program
  .command("show <skill-id>")
  .description("Inspect a single skill")
  .option("--skill", "Skill view: structured schema (default)")
  .option("--prompt", "Prompt view: system prompt + example user message + example output")
  .action(async (skillId, cmd) => {
    const { runShow } = await import("./commands/show.js");
    const globalOpts = program.opts();
    const opts = typeof cmd?.opts === "function" ? cmd.opts() : {};
    const view = opts.prompt === true ? "prompt" : "skill";
    const code = await runShow({
      skillId: skillId ?? "",
      json: globalOpts.json,
      view,
    });
    process.exit(code);
  });

program
  .command("edit <skill-id>")
  .description("Open skill in editor, validate, offer deploy")
  .action(async (skillId) => {
    const { runEdit } = await import("./commands/edit.js");
    const globalOpts = program.opts();
    const code = await runEdit({ skillId: skillId ?? "", json: globalOpts.json });
    process.exit(code);
  });

program
  .command("diff")
  .description("Show changes since last deploy")
  .action(async () => {
    const { runDiff } = await import("./commands/diff.js");
    const globalOpts = program.opts();
    const code = await runDiff({ json: globalOpts.json });
    process.exit(code);
  });

program
  .command("status")
  .description("Show workspace and deployment status")
  .action(async () => {
    const { runStatus } = await import("./commands/status.js");
    const globalOpts = program.opts();
    const code = await runStatus({ json: globalOpts.json, ci: globalOpts.ci });
    process.exit(code);
  });

program
  .command("bootstrap")
  .description("Print agent self-management instructions")
  .option("--target <target>", "claude-code | openclaw | opencode | cursor", "claude-code")
  .action(async (cmd) => {
    const { runBootstrap } = await import("./commands/bootstrap.js");
    const opts = typeof cmd?.opts === "function" ? cmd.opts() : {};
    const globalOpts = program.opts();
    const code = await runBootstrap({
      target: opts.target ?? "claude-code",
      json: globalOpts.json,
    });
    process.exit(code);
  });

program
  .command("deploy")
  .description("Compile corpus to target runtime(s)")
  .option(
    "--target <target>",
    "Target runtime: claude-code | openclaw | opencode | cursor | all"
  )
  .action(async (cmd) => {
    const { runDeploy } = await import("./commands/deploy.js");
    const opts = typeof cmd?.opts === "function" ? cmd.opts() : {};
    const globalOpts = program.opts();
    const code = await runDeploy({
      target: opts.target ?? "all",
      json: globalOpts.json,
      ci: globalOpts.ci,
    });
    process.exit(code);
  });

program
  .command("login")
  .description("Log in to your Bundl account (email OTP)")
  .action(async () => {
    const { runLogin } = await import("./commands/login.js");
    const code = await runLogin();
    process.exit(code);
  });

program
  .command("logout")
  .description("Log out and clear local credentials")
  .action(async () => {
    const { runLogout } = await import("./commands/logout.js");
    const code = await runLogout();
    process.exit(code);
  });

program
  .command("upgrade")
  .description("Upgrade workspace plan or open subscription management")
  .option("--manage", "Open Stripe customer portal to manage subscription")
  .action(async (cmd) => {
    const { runUpgrade } = await import("./commands/upgrade.js");
    const opts = typeof cmd?.opts === "function" ? cmd.opts() : {};
    const globalOpts = program.opts();
    const code = await runUpgrade({
      manage: opts.manage === true,
      json: globalOpts.json,
    });
    process.exit(code);
  });

program
  .command("whoami")
  .description("Show current Bundl account and connection status")
  .action(async () => {
    const { runWhoami } = await import("./commands/whoami.js");
    const globalOpts = program.opts();
    const code = await runWhoami({ json: globalOpts.json });
    process.exit(code);
  });

program
  .command("pull")
  .description("Pull corpus from your Bundl workspace")
  .option("--force", "Overwrite local files even if local is newer")
  .option("--dry-run", "Show what would be pulled without writing files")
  .action(async (cmd) => {
    const { runPull } = await import("./commands/pull.js");
    const opts = typeof cmd?.opts === "function" ? cmd.opts() : {};
    const globalOpts = program.opts();
    const code = await runPull({
      force: opts.force === true,
      dryRun: opts.dryRun === true,
      json: globalOpts.json,
    });
    process.exit(code);
  });

program
  .command("push")
  .description("Sync corpus to your Bundl workspace")
  .option("--force", "Skip conflict check, overwrite remote")
  .option("--dry-run", "Show what would be pushed without writing")
  .action(async (cmd) => {
    const { push } = await import("./commands/push.js");
    const opts = typeof cmd?.opts === "function" ? cmd.opts() : {};
    const globalOpts = program.opts();
    const code = await push({
      force: opts.force === true,
      dryRun: opts.dryRun === true,
      json: globalOpts.json,
    });
    process.exit(typeof code === "number" ? code : 0);
  });

program.parse();
