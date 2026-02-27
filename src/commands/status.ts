import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import chalk from "chalk";
import { readConfig } from "../utils/config.js";
import { getCredentials } from "../utils/auth.js";
import { validateCorpusDir } from "../utils/validate.js";
import { logger } from "../utils/logger.js";

const CORPUS_DIR = ".bundl/corpus";
const SCENARIOS_DIR = ".bundl/scenarios";
const LAST_VALIDATE_FILE = ".bundl/last-validate.json";

function getLastEditedCorpusFile(cwd: string): { file: string; ago: string } | null {
  const corpusPath = resolve(cwd, CORPUS_DIR);
  if (!existsSync(corpusPath)) return null;
  const files = readdirSync(corpusPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  let latest: { file: string; mtime: number } | null = null;
  for (const f of files) {
    const mtime = statSync(resolve(corpusPath, f)).mtimeMs;
    if (!latest || mtime > latest.mtime) latest = { file: f, mtime };
  }
  if (!latest) return null;
  const diffMs = Date.now() - latest.mtime;
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const ago = diffMins < 1 ? "just now" : diffMins < 60 ? `${diffMins} min ago` : `${Math.floor(diffHours)} hour(s) ago`;
  return { file: latest.file, ago };
}

function getLastDeployTime(cwd: string): number | null {
  const markers = [resolve(cwd, "CLAUDE.md"), resolve(cwd, ".claude", "skills"), resolve(cwd, ".cursor", "rules")];
  let latest = 0;
  for (const p of markers) {
    try {
      if (existsSync(p)) {
        const s = statSync(p);
        const mtime = s.mtimeMs ?? s.mtime.getTime();
        if (s.isDirectory()) {
          const entries = readdirSync(p, { withFileTypes: true });
          for (const e of entries) {
            const em = statSync(resolve(p, e.name)).mtimeMs;
            if (em > latest) latest = em;
          }
        } else if (mtime > latest) latest = mtime;
      }
    } catch {
      // ignore
    }
  }
  return latest > 0 ? latest : null;
}

function getPendingChangeCount(cwd: string): number {
  const corpusPath = resolve(cwd, CORPUS_DIR);
  if (!existsSync(corpusPath)) return 0;
  const lastDeploy = getLastDeployTime(cwd);
  if (!lastDeploy) return 0;
  const files = readdirSync(corpusPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  let count = 0;
  for (const f of files) {
    if (statSync(resolve(corpusPath, f)).mtimeMs > lastDeploy) count++;
  }
  return count;
}

type LastValidateState = { at: string; agentReady: number; total: number };

function loadSkillsAndValidate(cwd: string): { total: number; agentReady: number; paths: string[] } {
  const corpusPath = resolve(cwd, CORPUS_DIR);
  let paths: string[] = [];
  try {
    paths = readdirSync(corpusPath)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map((f) => `${CORPUS_DIR}/${f}`);
  } catch {
    return { total: 0, agentReady: 0, paths: [] };
  }
  const validation = validateCorpusDir(cwd);
  const agentReady = validation.results.filter((r) => r.valid).length;
  return { total: paths.length, agentReady, paths };
}

function loadScenariosStats(cwd: string): { total: number; passing: number; failing: number } {
  const base = resolve(cwd, SCENARIOS_DIR);
  let total = 0;
  let passing = 0;
  let failing = 0;
  try {
    const skillDirs = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const skillId of skillDirs) {
      const dir = resolve(base, skillId);
      const files = readdirSync(dir).filter(
        (f) => f.endsWith(".yaml") || f.endsWith(".yml")
      );
      for (const file of files) {
        total++;
        const raw = readFileSync(resolve(dir, file), "utf-8");
        const doc = yaml.load(raw) as { status?: string };
        if (doc?.status === "passing") passing++;
        else failing++;
      }
    }
  } catch {
    // no scenarios
  }
  return { total, passing, failing };
}

function loadLastValidated(cwd: string): LastValidateState | null {
  try {
    const path = resolve(cwd, LAST_VALIDATE_FILE);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as LastValidateState;
    if (data?.at && typeof data.agentReady === "number" && typeof data.total === "number")
      return data;
  } catch {
    // ignore
  }
  return null;
}

function formatTimeAgo(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour(s) ago`;
    return `${diffDays} day(s) ago`;
  } catch {
    return "—";
  }
}

export type StatusOptions = {
  json?: boolean;
  ci?: boolean;
};

export async function runStatus(options: StatusOptions = {}): Promise<number> {
  const cwd = process.cwd();
  const config = readConfig(cwd);
  const creds = getCredentials();
  const skills = loadSkillsAndValidate(cwd);
  const scenarios = loadScenariosStats(cwd);
  const lastValidated = loadLastValidated(cwd);
  const lastEdited = getLastEditedCorpusFile(cwd);
  const pendingCount = getPendingChangeCount(cwd);
  const targetsDeployed = config?.targets ?? [];
  const lastDeployTime = getLastDeployTime(cwd);

  const workspaceId = config?.workspace_id ?? creds?.workspace_id ?? null;
  const workspaceName = config?.workspace_name ?? creds?.workspace_name ?? null;
  const connected = Boolean(workspaceId);

  if (options.json) {
    logger.json({
      workspace: workspaceId,
      workspace_name: workspaceName,
      connected,
      local_version: config?.corpus_version ?? config?.version ?? null,
      skills: {
        total: skills.total,
        agent_ready: skills.agentReady,
        paths: skills.paths,
      },
      scenarios: {
        total: scenarios.total,
        passing: scenarios.passing,
        failing: scenarios.failing,
      },
      targets_deployed: targetsDeployed,
      last_validated: lastValidated ? lastValidated.at : null,
      last_edited: lastEdited ? { file: lastEdited.file, ago: lastEdited.ago } : null,
      changes_pending: pendingCount,
    });
    return 0;
  }

  const div = chalk.dim("  ─────────────────────────────────────────");
  if (options.ci) {
    console.log(connected ? "connected" : "not connected");
    console.log(`skills: ${skills.total} (${skills.agentReady} agent-ready)`);
    console.log(`scenarios: ${scenarios.passing}/${scenarios.total} passing`);
    return 0;
  }

  const warningsCount = skills.total - skills.agentReady;
  console.log();
  console.log(chalk.bold("  Bundl Status"));
  console.log(div);
  if (connected) {
    console.log(chalk.white(`  Workspace    ${workspaceName ?? workspaceId} (connected)`));
  } else {
    console.log(chalk.dim("  Workspace    not connected (run bundl push to share with team)"));
  }
  console.log(chalk.white(`  Corpus       ${skills.total} skills · ${skills.agentReady} agent-ready · ${warningsCount} warning(s)`));
  if (lastEdited) {
    console.log(chalk.white(`  Last edited  ${lastEdited.file} (${lastEdited.ago})`));
  }
  const deployLabel = targetsDeployed.length
    ? lastDeployTime
      ? `${targetsDeployed.join(", ")} (${formatTimeAgo(new Date(lastDeployTime).toISOString())})${pendingCount > 0 ? ` — ${pendingCount} change(s) pending` : ""}`
      : targetsDeployed.join(", ")
    : "—";
  console.log(chalk.white(`  Deployed     ${deployLabel}`));
  if (scenarios.total > 0) {
    console.log(chalk.white(`  Scenarios   ${scenarios.total} saved (${scenarios.passing} passing, ${scenarios.failing} failing)`));
  } else {
    console.log(chalk.white("  Scenarios   none saved"));
  }
  if (lastValidated) {
    console.log(chalk.white(`  Validated    ${formatTimeAgo(lastValidated.at)} — ${lastValidated.agentReady}/${lastValidated.total} agent-ready`));
  } else {
    console.log(chalk.white("  Validated    — (run bundl validate)"));
  }
  console.log(div);
  if (pendingCount > 0) {
    console.log(chalk.dim("  Run bundl diff to see pending changes."));
    console.log(chalk.dim("  Run bundl deploy to apply them."));
  }
  console.log();
  return 0;
}
