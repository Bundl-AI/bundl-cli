import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import inquirer from "inquirer";
import ora from "ora";
import chalk from "chalk";
import yaml from "js-yaml";
import { requireAuth } from "../utils/auth.js";
import {
  getMyWorkspace,
  getWorkspacePrompts,
  type CompanyPrompt,
  type Workspace,
} from "../utils/api.js";
import { showUpgradePrompt, isPaymentRequiredError } from "./upgrade.js";
import { ensureCorpusDir } from "../utils/config.js";
import { parseUserPromptToInputs } from "../utils/prompt-renderer.js";
import { logger } from "../utils/logger.js";
import type { Corpus } from "../schema/corpus.js";

const CORPUS_DIR = ".bundl/corpus";

export type PullOptions = {
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
};

function extractRole(category: string | undefined): string {
  if (!category || !category.startsWith("bundl:")) return "general";
  const parts = category.split(":");
  return parts[1] ?? "general";
}

function extractType(category: string | undefined): "workflow" | "document" | "constraint" {
  if (!category || !category.startsWith("bundl:")) return "workflow";
  const parts = category.split(":");
  const t = parts[2] ?? "workflow";
  return t === "document" || t === "constraint" ? t : "workflow";
}

function extractCategory(category: string | undefined): string {
  const role = extractRole(category);
  return role;
}

function apiPromptToYaml(prompt: CompanyPrompt): Corpus {
  const slug = prompt.slug ?? prompt.id;
  const inputs = parseUserPromptToInputs(prompt.user_prompt ?? "");
  return {
    id: slug,
    name: prompt.title ?? slug,
    role: extractRole(prompt.category),
    category: extractCategory(prompt.category),
    version: "1.0.0",
    type: extractType(prompt.category),
    load: "on-demand",
    trigger_description: prompt.description ?? "",
    inputs,
    system_prompt: prompt.system_prompt ?? "",
    example_output: prompt.example_output ?? "",
    tools: [],
    constraints: [],
    handoff: { conditions: [], escalate_to: "", handoff_message: "" },
    success_criteria: [],
    surfaces: { human: true, agent: true },
  };
}

function getLocalMtime(cwd: string, slug: string): number | null {
  const base = resolve(cwd, CORPUS_DIR);
  for (const ext of [".yaml", ".yml"]) {
    const p = resolve(base, slug + ext);
    if (existsSync(p)) return statSync(p).mtimeMs;
  }
  return null;
}

export async function runPull(options: PullOptions = {}): Promise<number> {
  const cwd = process.cwd();
  await requireAuth();

  if (options.json) {
    const workspace = await getMyWorkspace();
    const { companyPrompts } = await getWorkspacePrompts(workspace.id);
    const bundlPrompts = companyPrompts.filter((p) => p.category?.startsWith("bundl:"));
    logger.json({
      workspace: { id: workspace.id, name: workspace.name },
      skills: bundlPrompts.length,
      prompts: bundlPrompts.map((p) => ({ id: p.slug ?? p.id, title: p.title })),
    });
    return 0;
  }

  const connectSpinner = ora("Connecting to workspace...").start();
  let workspace: Workspace;
  try {
    workspace = await getMyWorkspace();
  } catch (err) {
    connectSpinner.fail();
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  connectSpinner.succeed(`✓ ${workspace.name}`);

  const fetchSpinner = ora(`Fetching corpus from ${workspace.name}...`).start();
  let companyPrompts: CompanyPrompt[];
  try {
    const data = await getWorkspacePrompts(workspace.id);
    companyPrompts = data.companyPrompts ?? [];
  } catch (err) {
    fetchSpinner.fail();
    if (isPaymentRequiredError(err)) {
      await showUpgradePrompt(workspace.plan ?? "free", workspace.id);
      return 0;
    }
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  fetchSpinner.succeed();

  const bundlPrompts = companyPrompts.filter((p) => p.category?.startsWith("bundl:"));
  if (bundlPrompts.length === 0) {
    logger.info("No Bundl skills found in your workspace.");
    logger.info("Run bundl push to sync your local corpus to your workspace.");
    return 0;
  }

  type Row = { slug: string; action: "new" | "update" | "skip" };
  const rows: Row[] = [];
  for (const p of bundlPrompts) {
    const slug = p.slug ?? p.id;
    const localMtime = getLocalMtime(cwd, slug);
    const remoteAt = p.updated_at ? new Date(p.updated_at).getTime() : 0;
    let action: Row["action"] = "new";
    if (localMtime != null) {
      if (options.force) action = "update";
      else if (remoteAt > localMtime) action = "update";
      else action = "skip";
    }
    rows.push({ slug, action });
  }

  const toWrite = rows.filter((r) => r.action !== "skip");
  const skipped = rows.filter((r) => r.action === "skip").length;

  const div = chalk.dim("  ─────────────────────────────────────────");
  console.log();
  console.log(chalk.white("  Pulling from " + workspace.name));
  console.log(div);
  for (const r of rows) {
    const line =
      r.action === "new"
        ? chalk.cyan("  ↓ " + r.slug.padEnd(32)) + chalk.dim("(new)")
        : r.action === "update"
          ? chalk.cyan("  ↓ " + r.slug.padEnd(32)) + chalk.dim("(remote newer — will update)")
          : chalk.yellow("  ~ " + r.slug.padEnd(32)) + chalk.dim("(local newer — skipping)");
    console.log(line);
  }
  console.log(div);
  console.log(
    chalk.white(`  ${toWrite.length} skills will be written. ${skipped} skipped.`)
  );

  if (!options.dryRun) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      { type: "confirm", name: "confirm", message: "Continue? (Y/n)", default: true },
    ]);
    if (!confirm) {
      logger.info("Pull cancelled.");
      return 0;
    }
  }

  if (options.dryRun) {
    logger.info("Dry run — no files written.");
    return 0;
  }

  ensureCorpusDir(cwd);
  const corpusPath = resolve(cwd, CORPUS_DIR);
  const written: string[] = [];

  for (const p of bundlPrompts) {
    const slug = p.slug ?? p.id;
    const row = rows.find((r) => r.slug === slug);
    if (row?.action === "skip") continue;

    const skill = apiPromptToYaml(p);
    const toWrite =
      p.agent_config != null
        ? { ...skill, agent_config: p.agent_config }
        : skill;
    const content = yaml.dump(toWrite, { lineWidth: -1 });
    const outPath = resolve(corpusPath, slug + ".yaml");
    writeFileSync(outPath, content, "utf-8");
    written.push(slug + ".yaml");
  }

  console.log();
  console.log(div);
  console.log(chalk.green(`  ✓ Pulled ${written.length} skills from ${workspace.name}`));
  console.log();
  for (const f of written) console.log(chalk.dim("  " + f));
  console.log();
  console.log(chalk.dim("  Run bundl validate to check corpus health."));
  console.log(chalk.dim("  Run bundl deploy --target <runtime> to apply."));
  console.log();
  return 0;
}
