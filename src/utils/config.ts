import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";

const BundlConfigSchema = z.object({
  version: z.string(),
  ai_provider: z.enum(["claude-code", "anthropic-api", "openai-api"]),
  targets: z.array(z.string()),
  workspace_id: z.string().optional(),
  workspace_name: z.string().optional(),
  corpus_version: z.string().optional(),
});

export type BundlConfig = z.infer<typeof BundlConfigSchema>;

const CONFIG_FILENAME = "bundl.yaml";

function getConfigPath(cwd: string = process.cwd()): string {
  return resolve(cwd, CONFIG_FILENAME);
}

/**
 * Read and parse bundl.yaml from the current working directory.
 * Returns null if the file does not exist.
 */
export function readConfig(cwd: string = process.cwd()): BundlConfig | null {
  const path = getConfigPath(cwd);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  const parsed = yaml.load(raw) as unknown;
  return BundlConfigSchema.parse(parsed);
}

/**
 * Write config to bundl.yaml in the current working directory.
 */
export function writeConfig(config: BundlConfig, cwd: string = process.cwd()): void {
  const path = getConfigPath(cwd);
  const content = yaml.dump(config, { lineWidth: -1 });
  writeFileSync(path, content, "utf-8");
}

/**
 * Creates .bundl/corpus/ and .bundl/scenarios/ in the current working directory if not present.
 */
export function ensureCorpusDir(cwd: string = process.cwd()): void {
  const corpusDir = resolve(cwd, ".bundl", "corpus");
  const scenariosDir = resolve(cwd, ".bundl", "scenarios");
  mkdirSync(corpusDir, { recursive: true });
  mkdirSync(scenariosDir, { recursive: true });
}
