import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import chalk from "chalk";
import inquirer from "inquirer";
import { CorpusSchema } from "../schema/corpus.js";
import type { Corpus } from "../schema/corpus.js";
import { runSemanticChecks } from "./validate.js";
import { readConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { printSkillView, printPromptView } from "./show.js";
import { runEdit } from "./edit.js";
import { runSimulate } from "./simulate.js";

const CORPUS_DIR = ".bundl/corpus";

const ACTION_VIEW_SKILL = "view_skill";
const ACTION_VIEW_PROMPT = "view_prompt";
const ACTION_EDIT = "edit";
const ACTION_SIMULATE = "simulate";
const ACTION_BACK = "back";
const CHOICE_EXIT = "__exit__";

export type ListOptions = {
  json?: boolean;
};

function loadSkillsWithStatus(cwd: string): { skills: Corpus[]; agentReady: number; warnings: number; byFile: { id: string; type: string; load: string; agentReady: boolean; warningCount: number }[] } {
  const corpusPath = resolve(cwd, CORPUS_DIR);
  if (!existsSync(corpusPath)) {
    return { skills: [], agentReady: 0, warnings: 0, byFile: [] };
  }
  const files = readdirSync(corpusPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const byFile: { id: string; type: string; load: string; agentReady: boolean; warningCount: number }[] = [];
  let agentReady = 0;
  let warnings = 0;
  const skills: Corpus[] = [];

  for (const file of files) {
    const path = resolve(corpusPath, file);
    const raw = readFileSync(path, "utf-8");
    const parsed = yaml.load(raw) as unknown;
    const result = CorpusSchema.safeParse(parsed);
    const id = file.replace(/\.(yaml|yml)$/, "");
    if (!result.success) {
      byFile.push({ id, type: "?", load: "?", agentReady: false, warningCount: 0 });
      continue;
    }
    const corpus = result.data;
    skills.push(corpus);
    const issues = runSemanticChecks(corpus);
    const errCount = issues.filter((i) => i.severity === "error").length;
    const warnCount = issues.filter((i) => i.severity === "warning").length;
    const ready = errCount === 0;
    if (ready) agentReady++;
    warnings += warnCount;
    byFile.push({
      id: corpus.id ?? id,
      type: corpus.type ?? "workflow",
      load: corpus.load ?? "on-demand",
      agentReady: ready,
      warningCount: warnCount,
    });
  }
  return { skills, agentReady, warnings, byFile };
}

function renderCorpusTable(
  byFile: { id: string; type: string; load: string; agentReady: boolean; warningCount: number }[],
  skills: Corpus[],
  config: ReturnType<typeof readConfig> | null
): void {
  const role = skills[0]?.role ?? "—";
  const industry = config ? "—" : "—";
  const version = config?.corpus_version ?? config?.version ?? "v1.0.0";
  const agentReady = byFile.filter((s) => s.agentReady).length;
  const warnings = byFile.reduce((sum, s) => sum + s.warningCount, 0);
  const div = chalk.dim("  ─────────────────────────────────────────");
  console.log();
  console.log(chalk.bold("  Corpus — " + CORPUS_DIR));
  console.log(div);
  console.log(chalk.white(`  ${role} · ${industry} · ${version}`));
  console.log();
  console.log(chalk.white(`  ${skills.length} skills · ${agentReady} agent-ready · ${warnings} warning(s)`));
  console.log();
  for (const s of byFile) {
    const status = s.agentReady ? chalk.green("✓") : chalk.yellow("⚠");
    const warnLabel = s.warningCount > 0 ? ` ${s.warningCount} warning(s)` : " agent-ready";
    console.log(chalk.white(`  ${status}  ${s.id.padEnd(28)} ${s.type.padEnd(10)} ${s.load.padEnd(10)}${warnLabel}`));
  }
  console.log();
}

export async function runList(options: ListOptions = {}): Promise<number> {
  const cwd = process.cwd();
  const config = readConfig(cwd);
  let { skills, agentReady, warnings, byFile } = loadSkillsWithStatus(cwd);

  if (skills.length === 0) {
    logger.error("No corpus found. Run bundl init to create one.");
    return 2;
  }

  const role = skills[0]?.role ?? "—";
  const version = config?.corpus_version ?? config?.version ?? "v1.0.0";

  if (options.json) {
    logger.json({
      path: CORPUS_DIR,
      role,
      version,
      total: skills.length,
      agentReady,
      warnings,
      skills: byFile.map((s) => ({
        id: s.id,
        type: s.type,
        load: s.load,
        agentReady: s.agentReady,
        warningCount: s.warningCount,
      })),
    });
    return 0;
  }

  // Interactive mode: table + skill selector + action menu
  while (true) {
    const data = loadSkillsWithStatus(cwd);
    skills = data.skills;
    byFile = data.byFile;
    agentReady = data.agentReady;
    warnings = data.warnings;

    renderCorpusTable(byFile, skills, readConfig(cwd));

    const skillChoices = [
      ...byFile.map((s) => ({
        name: `  ${s.id.padEnd(32)} ${s.type} · ${s.load}`,
        value: s.id,
      })),
      new inquirer.Separator("─────────────────"),
      { name: "Exit", value: CHOICE_EXIT },
    ];

    const { skillChoice } = await inquirer.prompt<{ skillChoice: string }>([
      {
        type: "list",
        name: "skillChoice",
        message: "Select a skill:",
        choices: skillChoices,
        pageSize: 20,
      },
    ]);

    if (skillChoice === CHOICE_EXIT) {
      return 0;
    }

    const selectedId = skillChoice;

    // Action menu for the selected skill
    while (true) {
      const { action } = await inquirer.prompt<{ action: string }>([
        {
          type: "list",
          name: "action",
          message: `${selectedId} — what would you like to do?`,
          choices: [
            { name: "View skill details", value: ACTION_VIEW_SKILL },
            { name: "View as prompt", value: ACTION_VIEW_PROMPT },
            { name: "Edit in editor", value: ACTION_EDIT },
            { name: "Simulate", value: ACTION_SIMULATE },
            new inquirer.Separator(),
            { name: "Back to list", value: ACTION_BACK },
          ],
        },
      ]);

      if (action === ACTION_BACK) {
        break;
      }

      if (action === ACTION_VIEW_SKILL) {
        const corpus = skills.find((s) => s.id === selectedId);
        if (corpus) {
          printSkillView(corpus, { skipFooter: true });
          await inquirer.prompt<{ x: string }>([
            { type: "input", name: "x", message: "Press Enter to return to menu" },
          ]);
        } else {
          logger.error(`Skill not found: ${selectedId}`);
        }
        continue;
      }

      if (action === ACTION_VIEW_PROMPT) {
        const corpus = skills.find((s) => s.id === selectedId);
        if (corpus) {
          printPromptView(corpus, { skipFooter: true });
          await inquirer.prompt<{ x: string }>([
            { type: "input", name: "x", message: "Press Enter to return to menu" },
          ]);
        } else {
          logger.error(`Skill not found: ${selectedId}`);
        }
        continue;
      }

      if (action === ACTION_EDIT) {
        const code = await runEdit({ skillId: selectedId, json: false });
        if (code !== 0) {
          logger.warn("Edit or validation failed. Fix the file and run bundl validate.");
        }
        break; // back to list (re-render table and selector)
      }

      if (action === ACTION_SIMULATE) {
        await runSimulate({ workflow: selectedId, json: false, ci: false });
        await inquirer.prompt<{ x: string }>([
          { type: "input", name: "x", message: "Press Enter to return to menu" },
        ]);
        continue;
      }
    }
  }
}
