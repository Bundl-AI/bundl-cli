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
  /** "skill" = schema view (default), "prompt" = what gets sent to the AI */
  view?: "skill" | "prompt";
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

  const view = options.view ?? "skill";
  const skipFooter = false;
  if (view === "prompt") {
    printPromptView(corpus, { skipFooter });
  } else {
    printSkillView(corpus, { skipFooter });
  }
  return 0;
}

export type PrintViewOptions = {
  skipFooter?: boolean;
};

/**
 * Skill view: structured schema (what it is). Used by `bundl show --skill` and list "View skill details".
 */
export function printSkillView(corpus: Corpus, options: PrintViewOptions = {}): void {
  const skipFooter = options.skipFooter === true;
  const div = chalk.dim("  ─────────────────────────────────────────");
  const version = corpus.version ?? "—";
  const role = corpus.role ?? "—";
  const category = corpus.category ?? "—";
  const type = corpus.type ?? "workflow";
  console.log();
  console.log(div);
  console.log(chalk.bold(`  ${corpus.id} · ${version}`));
  console.log(chalk.white(`  ${role} · ${category} · ${type}`));
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
  const escalateTo = corpus.handoff?.escalate_to?.trim() ? corpus.handoff.escalate_to : null;
  for (const h of corpus.handoff?.conditions ?? []) {
    const line = escalateTo ? `  · ${h} → ${escalateTo}` : `  · ${h}`;
    console.log(chalk.white(line));
  }
  if (!corpus.handoff?.conditions?.length) console.log(chalk.dim("  (none)"));
  console.log();
  console.log(chalk.bold("  DONE WHEN"));
  for (const s of corpus.success_criteria ?? []) {
    console.log(chalk.white("  · " + s));
  }
  if (!corpus.success_criteria?.length) console.log(chalk.dim("  (none)"));
  console.log();
  const surfacesParts: string[] = [];
  if (corpus.surfaces?.human) surfacesParts.push("human");
  if (corpus.surfaces?.agent) surfacesParts.push("agent");
  const surfacesStr = surfacesParts.length ? surfacesParts.join(" · ") : "—";
  console.log(chalk.bold("  SURFACES") + chalk.white("  " + surfacesStr));
  console.log(chalk.bold("  LOAD") + chalk.white("  " + (corpus.load ?? "on-demand")));
  console.log();
  if (!skipFooter) {
    console.log(chalk.dim("  Run bundl simulate --workflow " + corpus.id + " to test this skill."));
    console.log(chalk.dim("  Run bundl edit " + corpus.id + " to modify."));
  }
  console.log();
}

/**
 * Prompt view: what gets sent to the AI (system prompt + example user message + example output).
 * Used by `bundl show --prompt` and list "View as prompt".
 */
export function printPromptView(corpus: Corpus, options: PrintViewOptions = {}): void {
  const div = chalk.dim("  ─────────────────────────────────────────");
  console.log();
  console.log(div);
  console.log(chalk.bold(`  SYSTEM PROMPT — ${corpus.id}`));
  console.log(div);
  console.log();
  const systemPromptText = (corpus.system_prompt ?? "").trim() || "(none)";
  for (const line of systemPromptText.split("\n")) {
    console.log(chalk.white("  " + line));
  }
  console.log();
  console.log(div);
  console.log(chalk.bold("  EXAMPLE USER MESSAGE"));
  console.log(div);
  console.log();
  const allInputs = [
    ...(corpus.inputs.required ?? []),
    ...(corpus.inputs.optional ?? []),
  ];
  if (allInputs.length === 0) {
    console.log(chalk.dim("  (no inputs)"));
  } else {
    for (const i of allInputs) {
      const label = i.source?.human ?? i.name;
      const example = (i.example ?? "").trim();
      if (!example) {
        console.log(chalk.white(`  ${label}: [provide: ${i.name}]`));
      } else {
        const lines = example.split("\n");
        console.log(chalk.white(`  ${label}: ${lines[0]}`));
        for (let j = 1; j < lines.length; j++) {
          console.log(chalk.white("    " + lines[j]));
        }
      }
    }
  }
  console.log();
  console.log(div);
  console.log(chalk.bold("  EXAMPLE OUTPUT"));
  console.log(div);
  console.log();
  const exampleOutputText = (corpus.example_output ?? "").trim() || "(none)";
  for (const line of exampleOutputText.split("\n")) {
    console.log(chalk.white("  " + line));
  }
  console.log();
  console.log(div);
  console.log();
}
