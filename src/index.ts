#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { showBanner } from "./utils/banner.js";
import { setLoggerFlags } from "./utils/logger.js";

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
  .action(async (skillId) => {
    const { runShow } = await import("./commands/show.js");
    const globalOpts = program.opts();
    const code = await runShow({ skillId: skillId ?? "", json: globalOpts.json });
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
  .command("push")
  .description("Deploy corpus to configured targets")
  .action(async () => {
    const { push } = await import("./commands/push.js");
    await push();
  });

program.parse();
