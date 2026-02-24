import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { CorpusSchema } from "../schema/corpus.js";

export type ValidateResult = {
  file: string;
  valid: boolean;
  error?: string;
};

/**
 * Validate all .yaml files in .bundl/corpus/. Returns per-file results.
 */
export function validateCorpusDir(cwd: string = process.cwd()): {
  valid: boolean;
  results: ValidateResult[];
} {
  const corpusDir = resolve(cwd, ".bundl", "corpus");
  const results: ValidateResult[] = [];
  let valid = true;

  try {
    const files = readdirSync(corpusDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of files) {
      const path = resolve(corpusDir, file);
      try {
        const raw = readFileSync(path, "utf-8");
        const parsed = yaml.load(raw) as unknown;
        const out = CorpusSchema.safeParse(parsed);
        if (out.success) {
          results.push({ file, valid: true });
        } else {
          valid = false;
          const msg = out.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
          results.push({ file, valid: false, error: msg });
        }
      } catch (err) {
        valid = false;
        results.push({
          file,
          valid: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch {
    // directory doesn't exist or not readable
  }

  return { valid, results };
}
