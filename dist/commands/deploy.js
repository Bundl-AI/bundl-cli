import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import inquirer from "inquirer";
import yaml from "js-yaml";
import { CorpusSchema } from "../schema/corpus.js";
import { logger } from "../utils/logger.js";
import { readConfig } from "../utils/config.js";
import { validateCorpusDir } from "../utils/validate.js";
import { compile as compileClaudeCode } from "../targets/claude-code.js";
import { compile as compileOpenclaw } from "../targets/openclaw.js";
import { compile as compileOpencode } from "../targets/opencode.js";
import { compile as compileCursor } from "../targets/cursor.js";
const CORPUS_DIR = ".bundl/corpus";
const TARGETS = ["claude-code", "openclaw", "opencode", "cursor"];
function loadCorpus(cwd) {
    const corpusPath = resolve(cwd, CORPUS_DIR);
    const files = readdirSync(corpusPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    const skills = [];
    for (const file of files) {
        const raw = readFileSync(resolve(corpusPath, file), "utf-8");
        const parsed = yaml.load(raw);
        const result = CorpusSchema.safeParse(parsed);
        if (result.success)
            skills.push(result.data);
    }
    return skills;
}
function getCompilerOptions(cwd) {
    const config = readConfig(cwd);
    let bundlVersion = "0.1.0";
    try {
        const pkgPath = join(cwd, "package.json");
        if (existsSync(pkgPath)) {
            const v = JSON.parse(readFileSync(pkgPath, "utf-8"));
            bundlVersion = v.version ?? bundlVersion;
        }
    }
    catch {
        // ignore
    }
    return {
        cwd,
        bundlVersion,
        corpusVersion: config?.corpus_version ?? "0.0.0",
        industry: undefined,
    };
}
export async function runDeploy(options = {}) {
    const cwd = process.cwd();
    const target = options.target ?? "all";
    let files;
    try {
        files = readdirSync(resolve(cwd, CORPUS_DIR)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    }
    catch {
        files = [];
    }
    if (files.length === 0) {
        logger.error("No corpus found. Run bundl init to create one.");
        return 2;
    }
    const validation = validateCorpusDir(cwd);
    const hasErrors = !validation.valid;
    if (hasErrors && !options.ci && !options.json) {
        for (const r of validation.results) {
            if (r.error)
                logger.error(`${r.file}: ${r.error}`);
        }
        const { confirm } = await inquirer.prompt([
            {
                type: "confirm",
                name: "confirm",
                message: "Validation had errors. Deploy anyway?",
                default: false,
            },
        ]);
        if (!confirm)
            return 1;
    }
    else if (hasErrors && (options.ci || options.json)) {
        if (options.json) {
            logger.json({
                success: false,
                error: "Validation had errors. Fix with bundl validate before deploying.",
                validation: validation.results,
            });
        }
        else {
            logger.error("Validation had errors. Fix with bundl validate before deploying.");
        }
        return 1;
    }
    const skills = loadCorpus(cwd);
    const compilerOpts = getCompilerOptions(cwd);
    const toRun = target === "all" ? [...TARGETS] : [target];
    const results = [];
    for (const t of toRun) {
        switch (t) {
            case "claude-code":
                results.push(compileClaudeCode(skills, compilerOpts));
                break;
            case "openclaw":
                results.push(compileOpenclaw(skills, compilerOpts));
                break;
            case "opencode":
                results.push(compileOpencode(skills, compilerOpts));
                break;
            case "cursor":
                results.push(compileCursor(skills, compilerOpts));
                break;
            default:
                break;
        }
    }
    const allWritten = results.flatMap((r) => r.filesWritten);
    const allWarnings = results.flatMap((r) => r.warnings);
    if (options.json) {
        logger.json({
            success: allWarnings.length === 0,
            target: target === "all" ? TARGETS : target,
            filesWritten: allWritten,
            warnings: allWarnings,
            results: results.map((r) => ({
                target: r.target,
                filesWritten: r.filesWritten,
                warnings: r.warnings,
            })),
        });
        return 0;
    }
    if (options.ci) {
        for (const p of allWritten)
            logger.log(p);
        for (const w of allWarnings)
            logger.warn(w);
        return 0;
    }
    for (const r of results) {
        logger.success(`${r.target}: ${r.filesWritten.length} file(s) written`);
        for (const p of r.filesWritten)
            logger.log(`  ${p}`);
        for (const w of r.warnings)
            logger.warn(w);
    }
    return 0;
}
//# sourceMappingURL=deploy.js.map