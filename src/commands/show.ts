import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import chalk from "chalk";
import { CorpusSchema } from "../schema/corpus.js";
import type { Corpus } from "../schema/corpus.js";
import { logger } from "../utils/logger.js";

const CORPUS_DIR = ".bundl/corpus";

export type ShowOptions = {
  skillId: string;
  json?: boolean;
};

function findSkillPath(cwd: string, skillId: string): string | null {
  const base = resolve(cwd, CORPUS_DIR);
  const withYaml = resolve(base, `${skillId}.yaml`);
  const withYml = resolve(base, `${skillId}.yml`);
  if (existsSync(withYaml)) return withYaml;
  if (existsSync(withYml)) return withYml;
  return null;
}

export async function runShow(options: ShowOptions): Promise<number> {
  const cwd = process.cwd();
  const path = findSkillPath(cwd, options.skillId);
  if (!path) {
    logger.error(`Skill not found: ${options.skillId}. Run bundl list to see available skills.`);
    return 2;
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = yaml.load(raw) as unknown;
  const result = CorpusSchema.safeParse(parsed);
  if (!result.success) {
    logger.error(`Invalid skill file: ${result.error.errors.map((e) => e.message).join("; ")}`);
    return 1;
  }
  const corpus = result.data;

  if (options.json) {
    logger.json(corpus);
    return 0;
  }

  const div = chalk.dim("  ─────────────────────────────────────────");
  const version = corpus.version ?? "—";
  const role = corpus.role ?? "—";
  const category = corpus.category ?? "—";
  console.log();
  console.log(div);
  console.log(chalk.bold(`  ${corpus.id} · ${version}`));
  console.log(chalk.white(`  ${role} · ${category}`));
  console.log(div);
  console.log();
  console.log(chalk.bold("  TRIGGER"));
  console.log(chalk.white("  " + (corpus.trigger_description ?? "—").replace(/\n/g, "\n  ")));
  console.log();
  console.log(chalk.bold("  REQUIRED INPUTS"));
  for (const i of corpus.inputs.required ?? []) {
    console.log(chalk.white(`  · ${i.name.padEnd(18)} ${i.description ?? ""}`));
  }
  if (!corpus.inputs.required?.length) console.log(chalk.dim("  (none)"));
  console.log();
  console.log(chalk.bold("  OPTIONAL INPUTS"));
  for (const i of corpus.inputs.optional ?? []) {
    const fallback = i.fallback ? ` — Fallback: ${i.fallback}` : "";
    console.log(chalk.white(`  · ${i.name.padEnd(18)} ${(i.description ?? "") + fallback}`));
  }
  if (!corpus.inputs.optional?.length) console.log(chalk.dim("  (none)"));
  console.log();
  console.log(chalk.bold("  CONSTRAINTS"));
  for (const c of corpus.constraints ?? []) {
    console.log(chalk.white("  · " + c));
  }
  if (!corpus.constraints?.length) console.log(chalk.dim("  (none)"));
  console.log();
  console.log(chalk.bold("  ESCALATE WHEN"));
  for (const h of corpus.handoff?.conditions ?? []) {
    console.log(chalk.white("  · " + h));
  }
  if (!corpus.handoff?.conditions?.length) console.log(chalk.dim("  (none)"));
  console.log();
  console.log(chalk.bold("  SURFACES"));
  console.log(chalk.white(`  ${corpus.surfaces?.human ? "human" : ""} ${corpus.surfaces?.agent ? "agent" : ""}`.trim() || "—"));
  console.log(chalk.bold("  LOAD"));
  console.log(chalk.white("  " + (corpus.load ?? "on-demand")));
  console.log();
  console.log(chalk.dim("  Run bundl simulate --workflow " + corpus.id + " to test this skill."));
  console.log(chalk.dim("  Run bundl edit " + corpus.id + " to modify."));
  console.log();
  return 0;
}
