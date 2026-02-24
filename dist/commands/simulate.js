import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import inquirer from "inquirer";
import ora from "ora";
import yaml from "js-yaml";
import chalk from "chalk";
import { CorpusSchema } from "../schema/corpus.js";
import { showBanner } from "../utils/banner.js";
import { setupGracefulExit } from "../utils/keyboard.js";
import { logger } from "../utils/logger.js";
import { detectProvider, callProvider, showProviderHelp } from "../utils/provider.js";
const CORPUS_DIR = ".bundl/corpus";
const SCENARIOS_DIR = ".bundl/scenarios";
function loadSkills(cwd) {
    const corpusPath = resolve(cwd, CORPUS_DIR);
    let files;
    try {
        files = readdirSync(corpusPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    }
    catch {
        return [];
    }
    const skills = [];
    for (const file of files) {
        try {
            const raw = readFileSync(resolve(corpusPath, file), "utf-8");
            const parsed = yaml.load(raw);
            const result = CorpusSchema.safeParse(parsed);
            if (result.success)
                skills.push(result.data);
        }
        catch {
            // skip invalid files
        }
    }
    return skills;
}
function loadAllScenarios(cwd) {
    const base = resolve(cwd, SCENARIOS_DIR);
    const out = [];
    try {
        const skillDirs = readdirSync(base, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
        for (const skillId of skillDirs) {
            const dir = resolve(base, skillId);
            const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
            for (const file of files) {
                const raw = readFileSync(resolve(dir, file), "utf-8");
                const scenario = yaml.load(raw);
                if (scenario?.skill_id && scenario?.inputs) {
                    scenario.skill_id = skillId;
                    scenario.scenario_name = scenario.scenario_name ?? file.replace(/\.(yaml|yml)$/, "");
                    out.push({ skillId, scenario });
                }
            }
        }
    }
    catch {
        // no scenarios
    }
    return out;
}
function buildUserMessage(required, optionalProvided, optionalSkipped) {
    let msg = "Execute this workflow with the following inputs:\n\n";
    for (const [name, value] of Object.entries(required)) {
        msg += `${name}: ${value}\n`;
    }
    for (const [name, value] of Object.entries(optionalProvided)) {
        msg += `${name}: ${value}\n`;
    }
    for (const { name, fallback } of optionalSkipped) {
        msg += `${name}: [not provided — ${fallback}]\n`;
    }
    return msg.trim();
}
function runGrader(provider, expectedBehavior, actualOutput) {
    const systemPrompt = "You are a grader. Answer only YES or NO, then one sentence explanation. No other text.";
    const userMessage = `Did this output achieve: '${expectedBehavior}'?\n\nOutput to grade:\n${actualOutput}`;
    return callProvider(provider, systemPrompt, userMessage);
}
const DIV = chalk.hex("#e85d26")("  ─────────────────────────────────────────");
function printOutputBox(skillName, output) {
    console.log(DIV);
    console.log(chalk.white(`  OUTPUT — ${skillName}`));
    console.log(DIV);
    console.log(output.trim());
    console.log(DIV);
}
export async function runSimulate(options = {}) {
    const cwd = process.cwd();
    const jsonMode = options.json === true;
    const ciMode = options.ci === true;
    const allMode = options.all === true;
    const workflowId = options.workflow;
    const generateScenarios = options.generateScenarios === true;
    if (ciMode && !allMode) {
        if (!jsonMode)
            logger.error("--ci requires --all");
        return 1;
    }
    setupGracefulExit();
    if (!jsonMode && !ciMode)
        showBanner();
    const providerResult = await detectProvider();
    const provider = providerResult.provider;
    if (!provider) {
        showProviderHelp();
        return 1;
    }
    const skills = loadSkills(cwd);
    if (skills.length === 0) {
        logger.error("No corpus found. Run bundl init to create one.");
        return 2;
    }
    if (allMode) {
        const scenarios = loadAllScenarios(cwd);
        if (scenarios.length === 0) {
            logger.error("No scenarios found. Run a simulation and save a scenario first.");
            return 2;
        }
        const results = [];
        for (const { skillId, scenario } of scenarios) {
            const skill = skills.find((s) => s.id === skillId);
            if (!skill)
                continue;
            const systemPrompt = skill.system_prompt +
                "\n\nExample of excellent output:\n" +
                skill.example_output;
            const skipped = scenario.inputs.optional_skipped ?? [];
            const optionalFallbacksForRun = (skill.inputs.optional ?? [])
                .filter((i) => skipped.includes(i.name))
                .map((i) => ({ name: i.name, fallback: i.fallback ?? "Not provided" }));
            const userMessage = buildUserMessage(scenario.inputs.required ?? {}, scenario.inputs.optional_provided ?? {}, optionalFallbacksForRun);
            const output = await callProvider(provider, systemPrompt, userMessage);
            const graderResponse = await runGrader(provider, scenario.expected_behavior, output);
            const passing = graderResponse.trim().toUpperCase().startsWith("YES");
            results.push({
                scenario_name: scenario.scenario_name,
                skill_id: skillId,
                passing,
                explanation: graderResponse.trim(),
            });
        }
        const passingCount = results.filter((r) => r.passing).length;
        if (jsonMode) {
            logger.json({
                total: results.length,
                passing: passingCount,
                results,
            });
            return passingCount === results.length ? 0 : 1;
        }
        if (ciMode) {
            for (const r of results) {
                if (r.passing)
                    logger.log(`✓ ${r.scenario_name}`);
                else
                    logger.error(`${r.scenario_name} — ${r.explanation ?? "behavior changed"}`);
            }
            logger.log("");
            logger.log(`${passingCount}/${results.length} scenarios passing`);
            return passingCount === results.length ? 0 : 1;
        }
        for (const r of results) {
            if (r.passing)
                logger.success(`${r.scenario_name} — behavior matches`);
            else {
                logger.error(`${r.scenario_name} — behavior changed`);
                logger.log(`  Was: ${scenarios.find((s) => s.scenario.scenario_name === r.scenario_name)?.scenario.expected_behavior ?? ""}`);
                logger.log(`  Now: ${r.explanation ?? ""}`);
            }
        }
        logger.log("");
        logger.log(`${passingCount}/${results.length} scenarios passing`);
        return 0;
    }
    let skill;
    if (workflowId) {
        const found = skills.find((s) => s.id === workflowId);
        if (!found) {
            logger.error(`Skill '${workflowId}' not found.`);
            return 2;
        }
        skill = found;
    }
    else if (jsonMode || ciMode) {
        if (jsonMode && !allMode) {
            logger.error("For JSON output use: bundl simulate --all (run all saved scenarios).");
            return 1;
        }
        logger.error("Interactive simulate requires no --ci; use --workflow <id> for non-interactive.");
        return 1;
    }
    else {
        const choice = await inquirer.prompt([
            {
                type: "list",
                name: "skill",
                message: "Select a skill to simulate",
                choices: skills.map((s) => ({ name: `${s.name} — ${s.category}`, value: s.id })),
            },
        ]);
        skill = skills.find((s) => s.id === choice.skill);
    }
    if (generateScenarios && !jsonMode) {
        const sys = `You are generating diverse edge-case test inputs for a Bundl skill. Output exactly 5-10 scenarios. For each scenario give a short name (one line) and then the inputs as "name: value" lines. Separate scenarios with "---". No other text.`;
        const reqNames = (skill.inputs.required ?? []).map((i) => i.name).join(", ");
        const optNames = (skill.inputs.optional ?? []).map((i) => i.name).join(", ");
        const user = `Skill: ${skill.name}\nRequired inputs: ${reqNames}\nOptional: ${optNames}\n\nGenerate 5-10 diverse edge case scenarios (different industries, sizes, edge values).`;
        const spinnerGen = ora("Generating scenarios...").start();
        let generatedText;
        try {
            generatedText = await callProvider(provider, sys, user);
            spinnerGen.succeed();
        }
        catch (e) {
            spinnerGen.fail();
            logger.error(e instanceof Error ? e.message : String(e));
            return 1;
        }
        const blocks = generatedText.split("---").map((b) => b.trim()).filter(Boolean);
        if (blocks.length === 0) {
            logger.warn("No scenarios generated.");
            return 0;
        }
        const choices = blocks.slice(0, 10).map((b, i) => {
            const firstLine = b.split("\n")[0] ?? `Scenario ${i + 1}`;
            return { name: firstLine.slice(0, 60), value: b };
        });
        const { selected } = await inquirer.prompt([
            { type: "checkbox", name: "selected", message: "Select scenarios to run and optionally save", choices: choices },
        ]);
        const selectedBlocks = Array.isArray(selected) ? selected : [];
        for (const block of selectedBlocks) {
            const lines = block.split("\n").filter(Boolean);
            const scenarioName = lines[0] ?? "generated";
            const req = {};
            const opt = {};
            for (const line of lines.slice(1)) {
                const idx = line.indexOf(":");
                if (idx <= 0)
                    continue;
                const name = line.slice(0, idx).trim();
                const value = line.slice(idx + 1).trim();
                if ((skill.inputs.required ?? []).some((i) => i.name === name))
                    req[name] = value;
                else if ((skill.inputs.optional ?? []).some((i) => i.name === name))
                    opt[name] = value;
            }
            const skipped = (skill.inputs.optional ?? []).filter((o) => !(o.name in opt)).map((o) => o.name);
            const fallbacks = (skill.inputs.optional ?? []).filter((o) => skipped.includes(o.name)).map((o) => ({ name: o.name, fallback: o.fallback ?? "Not provided" }));
            const sysPrompt = skill.system_prompt + "\n\nExample of excellent output:\n" + skill.example_output;
            const usrMsg = buildUserMessage(req, opt, fallbacks);
            const out = await callProvider(provider, sysPrompt, usrMsg);
            printOutputBox(skill.name, out);
            const { saveThis } = await inquirer.prompt([
                { type: "confirm", name: "saveThis", message: `Save "${scenarioName}" as scenario?`, default: false },
            ]);
            if (saveThis) {
                const dir = resolve(cwd, SCENARIOS_DIR, skill.id);
                mkdirSync(dir, { recursive: true });
                const scenario = {
                    skill_id: skill.id,
                    scenario_name: scenarioName,
                    created: new Date().toISOString(),
                    provider_used: provider,
                    inputs: { required: req, optional_provided: opt, optional_skipped: skipped },
                    expected_behavior: "Generated scenario — verify and update.",
                    status: "passing",
                    last_run: new Date().toISOString(),
                    last_output: out,
                };
                const path = resolve(dir, `${scenarioName}.yaml`);
                writeFileSync(path, yaml.dump(scenario, { lineWidth: -1 }), "utf-8");
                logger.success(`Saved ${path}`);
            }
        }
        return 0;
    }
    const required = {};
    const optionalProvided = {};
    const optionalSkipped = [];
    for (const input of skill.inputs.required ?? []) {
        if (jsonMode)
            continue;
        const a = await inquirer.prompt([
            {
                type: "input",
                name: "value",
                message: `${input.name}: ${input.description}`,
            },
        ]);
        required[input.name] = a.value.trim();
    }
    for (const input of skill.inputs.optional ?? []) {
        if (jsonMode)
            continue;
        const a = await inquirer.prompt([
            {
                type: "input",
                name: "value",
                message: `${input.name} (${input.description}) — adds ${input.fallback ? "context; skip = " + input.fallback : "context"}\n(press enter to skip)`,
                default: "",
            },
        ]);
        if (a.value.trim())
            optionalProvided[input.name] = a.value.trim();
        else
            optionalSkipped.push(input.name);
    }
    const optionalFallbacks = (skill.inputs.optional ?? [])
        .filter((i) => optionalSkipped.includes(i.name))
        .map((i) => ({ name: i.name, fallback: i.fallback ?? "Not provided" }));
    if (!jsonMode) {
        logger.log("");
        logger.log("Running: " + skill.name);
        logger.log("Provider: " + provider);
        logger.log(`Required inputs: ✓ ${Object.keys(required).length} provided`);
        logger.log(`Optional inputs: ${Object.keys(optionalProvided).length} / ${(skill.inputs.optional ?? []).length}`);
        if (optionalFallbacks.length) {
            logger.log("Missing optional: " + optionalFallbacks.map((o) => `${o.name} (${o.fallback})`).join(", "));
        }
        const { confirm } = await inquirer.prompt([
            { type: "confirm", name: "confirm", message: "Run simulation? (y/n)", default: true },
        ]);
        if (!confirm)
            return 0;
    }
    const systemPrompt = skill.system_prompt +
        "\n\nExample of excellent output:\n" +
        skill.example_output;
    const userMessage = buildUserMessage(required, optionalProvided, optionalFallbacks);
    const spinner = ora(`Running against ${provider}...`).start();
    let output;
    try {
        output = await callProvider(provider, systemPrompt, userMessage);
        spinner.succeed();
    }
    catch (err) {
        spinner.fail();
        logger.error(err instanceof Error ? err.message : String(err));
        return 1;
    }
    if (jsonMode) {
        logger.json({ skill_id: skill.id, skill_name: skill.name, output });
        return 0;
    }
    printOutputBox(skill.name, output);
    const { save } = await inquirer.prompt([
        { type: "confirm", name: "save", message: "Save this as a test scenario? (y/n)", default: false },
    ]);
    if (save) {
        const defaultName = `scenario-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
        const { scenarioName } = await inquirer.prompt([
            { type: "input", name: "scenarioName", message: "Scenario name", default: defaultName },
        ]);
        const { correct } = await inquirer.prompt([
            { type: "confirm", name: "correct", message: "Is this output correct? (y/n)", default: true },
        ]);
        const { expectedBehavior } = await inquirer.prompt([
            {
                type: "input",
                name: "expectedBehavior",
                message: "Describe expected behavior in one sentence",
                default: correct ? "Output matches the skill's success criteria and example quality." : "See last_output for actual behavior.",
            },
        ]);
        const dir = resolve(cwd, SCENARIOS_DIR, skill.id);
        mkdirSync(dir, { recursive: true });
        const scenario = {
            skill_id: skill.id,
            scenario_name: scenarioName.trim() || defaultName,
            created: new Date().toISOString(),
            provider_used: provider,
            inputs: { required, optional_provided: optionalProvided, optional_skipped: optionalSkipped },
            expected_behavior: expectedBehavior.trim(),
            status: correct ? "passing" : "failing",
            last_run: new Date().toISOString(),
            last_output: output,
        };
        const path = resolve(dir, `${scenario.scenario_name}.yaml`);
        writeFileSync(path, yaml.dump(scenario, { lineWidth: -1 }), "utf-8");
        logger.success(`Saved to ${path}`);
    }
    return 0;
}
//# sourceMappingURL=simulate.js.map