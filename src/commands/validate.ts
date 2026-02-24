import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { CorpusSchema } from "../schema/corpus.js";
import type { Corpus } from "../schema/corpus.js";
import { logger } from "../utils/logger.js";

const CORPUS_DIR = ".bundl/corpus";

export type IssueSeverity = "error" | "warning";

export type Issue = {
  severity: IssueSeverity;
  message: string;
  suggestion: string;
  lineHint?: string;
};

export type FileResult = {
  path: string;
  status: "valid" | "warning" | "error";
  agentReady: boolean;
  issues: Issue[];
  parsed?: Corpus;
};

const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
const VARIABLE_REGEX = /\{\{(\w+)\}\}/g;

function extractVariables(text: string): string[] {
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  VARIABLE_REGEX.lastIndex = 0;
  while ((m = VARIABLE_REGEX.exec(text)) !== null) set.add(m[1]);
  return [...set];
}

function inputNames(corpus: Corpus): Set<string> {
  const names = new Set<string>();
  for (const i of corpus.inputs.required) names.add(i.name);
  for (const i of corpus.inputs.optional) names.add(i.name);
  return names;
}

export function runSemanticChecks(parsed: Corpus): Issue[] {
  const issues: Issue[] = [];
  const names = inputNames(parsed);

  const suggest = (msg: string, sug: string) => issues.push({ severity: "error", message: msg, suggestion: sug });
  const warn = (msg: string, sug: string, lineHint?: string) =>
    issues.push({ severity: "warning", message: msg, suggestion: sug, lineHint });

  const varsInPrompt = extractVariables(parsed.system_prompt);
  for (const v of varsInPrompt) {
    if (!names.has(v)) {
      suggest(
        `Variable {{${v}}} used in system_prompt but not declared in inputs.required or inputs.optional`,
        `Add a required or optional input with name: "${v}" (and description, example, source).`
      );
    }
  }

  if (parsed.surfaces.agent && (!parsed.success_criteria || parsed.success_criteria.length === 0)) {
    suggest(
      "success_criteria is empty — agent will not know when this workflow is complete",
      'Add at least one success criterion, e.g. "crm_record_updated" or "email_sent".'
    );
  }

  if (parsed.load === "on-demand") {
    const td = parsed.trigger_description?.trim() ?? "";
    if (td.length < 20) {
      suggest(
        "load is on-demand but trigger_description is missing or under 20 characters",
        "Write a specific trigger_description (20+ chars) so the agent knows when to load this skill."
      );
    }
  }

  if (parsed.type === "document") {
    const ex = parsed.example_output?.trim() ?? "";
    if (ex.length < 100) {
      suggest(
        "type is document but example_output is missing or under 100 characters",
        "Add a realistic example_output (100+ chars) so the document format is clear."
      );
    }
  }

  const tools = parsed.tools ?? [];
  if (
    (tools.includes("crm_write") || tools.includes("email_send")) &&
    (!parsed.handoff?.conditions || parsed.handoff.conditions.length === 0)
  ) {
    suggest(
      "Skills with crm_write or email_send must define handoff.conditions",
      "Add at least one condition under handoff.conditions and set escalate_to and handoff_message."
    );
  }

  for (const opt of parsed.inputs.optional ?? []) {
    if (opt.fallback === undefined || opt.fallback === "") {
      warn(
        `optional input '${opt.name}' missing fallback field`,
        `Add fallback: "Not provided — use default behavior" or a specific default.`,
        "inputs.optional"
      );
    }
  }

  if (parsed.surfaces.agent && (!parsed.constraints || parsed.constraints.length === 0)) {
    warn(
      "constraints array is empty on an agent-surface skill",
      "Add at least one constraint to guide agent behavior."
    );
  }

  const exampleLen = (parsed.example_output ?? "").trim().length;
  if (exampleLen > 0 && exampleLen < 200) {
    warn(
      "example_output under 200 chars (too short to be useful)",
      "Expand example_output to a realistic 200+ character example."
    );
  }

  const triggerLen = (parsed.trigger_description ?? "").trim().length;
  if (triggerLen > 200) {
    warn(
      "trigger_description over 200 chars (too long, agent may not use it)",
      "Shorten trigger_description to under 200 characters."
    );
  }

  const ver = (parsed.version ?? "").trim();
  if (ver && !SEMVER_REGEX.test(ver)) {
    warn(
      "version is not semver format",
      'Use semver, e.g. "1.0.0" or "1.2.3-beta.1".'
    );
  }

  return issues;
}

function applyFixes(parsed: Corpus): { changed: boolean; data: Corpus } {
  let changed = false;
  const data = JSON.parse(JSON.stringify(parsed)) as Corpus;

  for (const opt of data.inputs.optional ?? []) {
    if (opt.fallback === undefined || opt.fallback === "") {
      opt.fallback = "Not provided — use default behavior";
      changed = true;
    }
  }

  const v = (data.version ?? "").trim();
  if (v && !SEMVER_REGEX.test(v)) {
    data.version = "1.0.0";
    changed = true;
  }

  return { changed, data };
}

export type ValidateOptions = {
  json?: boolean;
  ci?: boolean;
  fix?: boolean;
  file?: string;
};

export async function runValidate(options: ValidateOptions = {}): Promise<number> {
  const cwd = process.cwd();
  const corpusPath = resolve(cwd, CORPUS_DIR);

  let files: string[];
  if (options.file) {
    const base = options.file.replace(/\.(yaml|yml)$/, "");
    const withYaml = base + ".yaml";
    const withYml = base + ".yml";
    const inCorpus = resolve(corpusPath, options.file);
    if (existsSync(resolve(corpusPath, withYaml))) files = [withYaml];
    else if (existsSync(resolve(corpusPath, withYml))) files = [withYml];
    else if (existsSync(inCorpus)) files = [options.file];
    else {
      logger.error(`File not found: ${options.file} in ${CORPUS_DIR}`);
      return 2;
    }
  } else {
    try {
      files = readdirSync(corpusPath).filter(
        (f) => f.endsWith(".yaml") || f.endsWith(".yml")
      );
    } catch {
      files = [];
    }
  }

  if (files.length === 0) {
    logger.error("No corpus found. Run bundl init to create one.");
    return 2;
  }

  const results: FileResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const file of files) {
    const filePath = resolve(corpusPath, file);
    const issues: Issue[] = [];
    let parsed: Corpus | undefined;

    try {
      const raw = readFileSync(filePath, "utf-8");
      const loaded = yaml.load(raw) as unknown;
      const zodResult = CorpusSchema.safeParse(loaded);
      if (!zodResult.success) {
        const msg = zodResult.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        issues.push({
          severity: "error",
          message: msg,
          suggestion: "Fix the schema errors above and re-run bundl validate.",
        });
      } else {
        parsed = zodResult.data;
        issues.push(...runSemanticChecks(parsed));
      }
    } catch (err) {
      issues.push({
        severity: "error",
        message: err instanceof Error ? err.message : String(err),
        suggestion: "Ensure the file is valid YAML.",
      });
    }

    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");

    let finalIssues = issues;
    let finalParsed = parsed;
    let finalErrors = errors.length;
    let finalWarnings = warnings.length;

    if (options.fix && parsed && errors.length === 0 && warnings.length > 0) {
      const { changed, data } = applyFixes(parsed);
      if (changed) {
        const out = yaml.dump(data, { lineWidth: -1 });
        writeFileSync(filePath, out, "utf-8");
        finalParsed = data;
        finalIssues = runSemanticChecks(data);
        finalErrors = finalIssues.filter((i) => i.severity === "error").length;
        finalWarnings = finalIssues.filter((i) => i.severity === "warning").length;
      }
    }

    const status =
      finalErrors > 0 ? "error" : finalWarnings > 0 ? "warning" : "valid";
    const agentReady = finalErrors === 0;

    totalErrors += finalErrors;
    totalWarnings += finalWarnings;

    results.push({
      path: file,
      status,
      agentReady,
      issues: finalIssues,
      parsed: finalParsed,
    });
  }

  const agentReadyCount = results.filter((r) => r.agentReady).length;

  if (options.json) {
    logger.json({
      valid: totalErrors === 0,
      summary: {
        total: results.length,
        agentReady: agentReadyCount,
        warnings: totalWarnings,
        errors: totalErrors,
      },
      files: results.map((r) => ({
        path: r.path,
        status: r.status,
        agentReady: r.agentReady,
        issues: r.issues.map((i) => ({
          severity: i.severity,
          message: i.message,
          suggestion: i.suggestion,
        })),
      })),
    });
    return totalErrors > 0 ? 1 : 0;
  }

  if (options.ci) {
    if (totalErrors > 0) {
      logger.error(`${totalErrors} error(s), ${totalWarnings} warning(s). Fix before deploying.`);
    }
    return totalErrors > 0 ? 1 : 0;
  }

  logger.log(`Validating corpus in ${CORPUS_DIR}...`);
  logger.log("");

  for (const r of results) {
    if (r.status === "valid") {
      logger.success(`${r.path} — agent-ready`);
    } else if (r.status === "warning") {
      logger.warn(`${r.path} — ${r.issues.filter((i) => i.severity === "warning").length} warning(s)`);
      for (const i of r.issues.filter((ii) => ii.severity === "warning")) {
        const line = i.lineHint ? `Line ~${i.lineHint}: ` : "";
        logger.log(`  ${line}${i.message}`);
        logger.log(`  Suggestion: ${i.suggestion}`);
      }
    } else {
      logger.error(`${r.path} — ${r.issues.filter((i) => i.severity === "error").length} error(s)`);
      for (const i of r.issues.filter((ii) => ii.severity === "error")) {
        logger.log(`  ${i.message}`);
        logger.log(`  Suggestion: ${i.suggestion}`);
      }
    }
  }

  logger.log("");
  logger.log(`${agentReadyCount}/${results.length} skills agent-ready`);
  const lastValidatePath = resolve(cwd, ".bundl", "last-validate.json");
  try {
    mkdirSync(resolve(cwd, ".bundl"), { recursive: true });
    writeFileSync(
      lastValidatePath,
      JSON.stringify({ at: new Date().toISOString(), agentReady: agentReadyCount, total: results.length }),
      "utf-8"
    );
  } catch {
    // ignore
  }
  if (totalErrors > 0) {
    logger.error(`${totalErrors} error(s) found — fix before deploying to agent runtimes`);
    return 1;
  }
  if (totalWarnings > 0) {
    logger.warn(`${totalWarnings} warning(s) — deployment can proceed`);
  }
  return 0;
}
