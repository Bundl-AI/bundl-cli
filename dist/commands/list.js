import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import chalk from "chalk";
import { CorpusSchema } from "../schema/corpus.js";
import { runSemanticChecks } from "./validate.js";
import { readConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";
const CORPUS_DIR = ".bundl/corpus";
function loadSkillsWithStatus(cwd) {
    const corpusPath = resolve(cwd, CORPUS_DIR);
    if (!existsSync(corpusPath)) {
        return { skills: [], agentReady: 0, warnings: 0, byFile: [] };
    }
    const files = readdirSync(corpusPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    const byFile = [];
    let agentReady = 0;
    let warnings = 0;
    const skills = [];
    for (const file of files) {
        const path = resolve(corpusPath, file);
        const raw = readFileSync(path, "utf-8");
        const parsed = yaml.load(raw);
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
        if (ready)
            agentReady++;
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
export async function runList(options = {}) {
    const cwd = process.cwd();
    const config = readConfig(cwd);
    const { skills, agentReady, warnings, byFile } = loadSkillsWithStatus(cwd);
    if (skills.length === 0) {
        logger.error("No corpus found. Run bundl init to create one.");
        return 2;
    }
    const role = skills[0]?.role ?? "—";
    const industry = config ? "—" : "—";
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
    console.log(chalk.dim("  Run bundl show <skill-id> to inspect a skill."));
    console.log(chalk.dim("  Run bundl edit <skill-id> to open in your editor."));
    console.log();
    return 0;
}
//# sourceMappingURL=list.js.map