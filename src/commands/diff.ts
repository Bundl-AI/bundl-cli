import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import execa from "execa";
import chalk from "chalk";
import { logger } from "../utils/logger.js";

const CORPUS_DIR = ".bundl/corpus";

export type DiffOptions = {
  json?: boolean;
};

function getLastDeployTime(cwd: string): number | null {
  const markers = [
    resolve(cwd, "CLAUDE.md"),
    resolve(cwd, ".claude", "skills"),
    resolve(cwd, ".cursor", "rules"),
    resolve(cwd, ".bundl", "output"),
  ];
  let latest = 0;
  for (const p of markers) {
    try {
      if (existsSync(p)) {
        const s = statSync(p);
        const mtime = s.mtimeMs ?? s.mtime.getTime();
        if (s.isDirectory()) {
          const entries = readdirSync(p, { withFileTypes: true });
          for (const e of entries) {
            const ep = resolve(p, e.name);
            const es = statSync(ep);
            const em = es.mtimeMs ?? es.mtime.getTime();
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

function formatTimeAgo(ms: number): string {
  const diffMs = Date.now() - ms;
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  if (diffMins < 60) return `${diffMins} min ago`;
  return `${Math.floor(diffHours)} hour(s) ago`;
}

export async function runDiff(options: DiffOptions): Promise<number> {
  const cwd = process.cwd();
  const corpusPath = resolve(cwd, CORPUS_DIR);
  if (!existsSync(corpusPath)) {
    logger.error("No corpus found. Run bundl init to create one.");
    return 2;
  }

  const lastDeploy = getLastDeployTime(cwd);
  const summary: { changed: string[]; added: string[]; modified: string[]; since: string | null } = {
    changed: [],
    added: [],
    modified: [],
    since: lastDeploy ? formatTimeAgo(lastDeploy) : null,
  };

  try {
    const { stdout } = await execa("git", ["diff", "--name-status", "HEAD", "--", CORPUS_DIR], { cwd, reject: false });
    if (stdout && stdout.trim()) {
      for (const line of stdout.trim().split("\n")) {
        const parts = line.split(/\t/);
        const status = parts[0];
        const file = parts[1] ?? "";
        const base = file.replace(/^.*\//, "").replace(/\.(yaml|yml)$/, "");
        if (status === "A") summary.added.push(base);
        else if (status === "M" || status === "D") summary.modified.push(base);
        summary.changed.push(base);
      }
    }
  } catch {
    const files = readdirSync(corpusPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const f of files) {
      const fp = resolve(corpusPath, f);
      const mtime = statSync(fp).mtimeMs;
      if (lastDeploy && mtime > lastDeploy) {
        summary.modified.push(f.replace(/\.(yaml|yml)$/, ""));
        summary.changed.push(f.replace(/\.(yaml|yml)$/, ""));
      }
    }
  }

  const uniqueChanged = [...new Set(summary.changed)];
  const uniqueAdded = [...new Set(summary.added)];
  const uniqueModified = [...new Set(summary.modified)];

  if (options.json) {
    logger.json({
      since: summary.since,
      changed: uniqueChanged,
      added: uniqueAdded,
      modified: uniqueModified,
      count: uniqueChanged.length,
    });
    return 0;
  }

  const div = chalk.dim("  ─────────────────────────────────────────");
  console.log();
  console.log(chalk.white(`  Changes since last deploy ${summary.since ? `(${summary.since})` : "(unknown)"}`));
  console.log(div);
  for (const f of uniqueModified) {
    if (!uniqueAdded.includes(f)) {
      console.log(chalk.yellow("  ~ " + f + ".yaml"));
      console.log(chalk.dim("      (modified)"));
    }
  }
  for (const f of uniqueAdded) {
    console.log(chalk.green("  + " + f + ".yaml"));
    console.log(chalk.dim("      (new)"));
  }
  if (uniqueChanged.length === 0) {
    console.log(chalk.dim("  No changes since last deploy."));
  }
  console.log(div);
  console.log(chalk.dim(`  ${uniqueChanged.length} file(s) changed · Run bundl deploy to apply`));
  console.log();
  return 0;
}
