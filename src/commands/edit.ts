import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import inquirer from "inquirer";
import execa from "execa";
import { runValidate } from "./validate.js";
import { runDeploy } from "./deploy.js";
import { readConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";

const CORPUS_DIR = ".bundl/corpus";

export type EditOptions = {
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

export async function runEdit(options: EditOptions): Promise<number> {
  const cwd = process.cwd();
  const path = findSkillPath(cwd, options.skillId);
  if (!path) {
    logger.error(`Skill not found: ${options.skillId}. Run bundl list to see available skills.`);
    return 2;
  }

  const editor = process.env.EDITOR || process.env.VISUAL || "nano";
  try {
    await execa(editor, [path], { stdio: "inherit" });
  } catch (err) {
    logger.error("Editor exited with error: " + (err instanceof Error ? err.message : String(err)));
    return 1;
  }

  const code = await runValidate({ file: options.skillId + ".yaml", json: options.json });
  if (options.json) return code;

  if (code !== 0) {
    logger.warn("Validation had errors. Fix the file and run bundl validate.");
    return code;
  }

  const config = readConfig(cwd);
  const lastTarget = config?.targets?.[0] ?? "claude-code";
  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: "Deploy now?",
      default: true,
    },
  ]);
  if (confirm) {
    await runDeploy({ target: lastTarget as "claude-code" | "openclaw" | "opencode" | "cursor" | "all", json: false, ci: true });
  }
  return 0;
}
