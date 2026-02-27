import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import inquirer from "inquirer";
import ora from "ora";
import chalk from "chalk";
import yaml from "js-yaml";
import { requireAuth } from "../utils/auth.js";
import {
  getMyWorkspace,
  getWorkspacePrompts,
  createWorkspacePrompt,
  updateWorkspacePrompt,
  type CompanyPrompt,
  type Workspace,
  type PromptPayload,
} from "../utils/api.js";
import { showUpgradePrompt, isPaymentRequiredError } from "./upgrade.js";
import { readConfig, writeConfig } from "../utils/config.js";
import { renderUserPromptTemplate } from "../utils/prompt-renderer.js";
import { runValidate } from "./validate.js";
import { logger } from "../utils/logger.js";
import type { Corpus } from "../schema/corpus.js";

const CORPUS_DIR = ".bundl/corpus";

export type PushOptions = {
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
};

function yamlToApiPrompt(skill: Corpus): PromptPayload {
  return {
    title: skill.name,
    description: skill.trigger_description ?? "",
    category: `bundl:${skill.role}:${skill.type}`,
    tags: [skill.role, skill.type, "bundl-cli"],
    system_prompt: skill.system_prompt ?? "",
    user_prompt: renderUserPromptTemplate(skill.inputs),
    example_output: skill.example_output ?? "",
    library_status: "private",
    is_bundl_skill: true,
    agent_config: {},
  };
}

export async function push(options: PushOptions = {}): Promise<number> {
  const cwd = process.cwd();
  await requireAuth();

  const corpusPath = resolve(cwd, CORPUS_DIR);
  if (!existsSync(corpusPath)) {
    logger.error("No corpus found. Run bundl init first.");
    return 1;
  }
  const corpusFiles = readdirSync(corpusPath).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml")
  );
  if (corpusFiles.length === 0) {
    logger.error("No corpus found. Run bundl init first.");
    return 1;
  }

  const validateCode = await runValidate({ ci: true, json: true });
  if (validateCode !== 0 && !options.json) {
    logger.warn("Validation errors found.");
    const { pushAnyway } = await inquirer.prompt<{ pushAnyway: boolean }>([
      { type: "confirm", name: "pushAnyway", message: "Push anyway? (y/N)", default: false },
    ]);
    if (!pushAnyway) return 1;
  }

  if (options.json) {
    const workspace = await getMyWorkspace();
    const { companyPrompts } = await getWorkspacePrompts(workspace.id);
    const existingBundl = companyPrompts.filter((p) => p.category?.startsWith("bundl:"));
    const slugs = corpusFiles.map((f) => f.replace(/\.(yaml|yml)$/, ""));
    logger.json({
      workspace: { id: workspace.id, name: workspace.name },
      localSkills: slugs.length,
      remoteBundlSkills: existingBundl.length,
      wouldSync: slugs,
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

  let companyPrompts: CompanyPrompt[] = [];
  try {
    const data = await getWorkspacePrompts(workspace.id);
    companyPrompts = data.companyPrompts ?? [];
  } catch (err) {
    if (isPaymentRequiredError(err)) {
      await showUpgradePrompt(workspace.plan ?? "free", workspace.id);
      return 0;
    }
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const existingBundl = companyPrompts.filter((p) => p.category?.startsWith("bundl:"));
  const existingMap: Record<string, CompanyPrompt> = {};
  for (const p of existingBundl) {
    const slug = p.slug ?? p.id;
    existingMap[slug] = p;
  }

  const skills: { slug: string; corpus: Corpus; isNew: boolean }[] = [];
  for (const file of corpusFiles) {
    const path = resolve(corpusPath, file);
    const raw = readFileSync(path, "utf-8");
    const parsed = yaml.load(raw) as unknown;
    const slug = file.replace(/\.(yaml|yml)$/, "");
    const corpus = parsed as Corpus;
    skills.push({
      slug,
      corpus,
      isNew: !existingMap[slug],
    });
  }

  const div = chalk.dim("  ─────────────────────────────────────────");
  console.log();
  console.log(chalk.white("  Pushing to " + workspace.name));
  console.log(div);
  for (const { slug, isNew } of skills) {
    const label = isNew ? "(new)" : "(updating)";
    console.log(chalk.cyan("  ↑ " + slug.padEnd(32)) + chalk.dim(label));
  }
  console.log(div);
  console.log(chalk.white(`  ${skills.length} skills will be synced. Continue? (Y/n)`));

  if (!options.dryRun) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      { type: "confirm", name: "confirm", message: "Continue? (Y/n)", default: true },
    ]);
    if (!confirm) {
      logger.info("Push cancelled.");
      return 0;
    }
  }

  if (options.dryRun) {
    logger.info("Dry run — no changes pushed.");
    return 0;
  }

  for (const { slug, corpus, isNew } of skills) {
    const spinner = ora(`↑ ${corpus.name ?? slug}...`).start();
    const payload = yamlToApiPrompt(corpus);
    try {
      if (isNew) {
        await createWorkspacePrompt(workspace.id, payload);
      } else {
        const existing = existingMap[slug];
        if (existing?.id) {
          await updateWorkspacePrompt(workspace.id, existing.id, payload);
        } else {
          await createWorkspacePrompt(workspace.id, payload);
        }
      }
      spinner.succeed();
    } catch (err) {
      spinner.fail();
      if (isPaymentRequiredError(err)) {
        await showUpgradePrompt(workspace.plan ?? "free", workspace.id);
        return 0;
      }
      logger.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  const config = readConfig(cwd);
  const nextConfig = {
    version: config?.version ?? "0.1.0",
    ai_provider: config?.ai_provider ?? "claude-code",
    targets: config?.targets ?? [],
    workspace_id: workspace.id,
    workspace_name: workspace.name,
    corpus_version: config?.corpus_version,
    last_pushed: Math.floor(Date.now() / 1000),
  };
  writeConfig(nextConfig, cwd);

  console.log();
  console.log(div);
  console.log(chalk.green(`  ✓ Pushed ${skills.length} skills to ${workspace.name}`));
  console.log();
  console.log(chalk.white("  Your team can now access these skills"));
  console.log(chalk.white("  in the Bundl dashboard and browser extension."));
  console.log();
  console.log(chalk.dim("  bundl.ai/company/workspace"));
  console.log(div);
  console.log();
  return 0;
}
