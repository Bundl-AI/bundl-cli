import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import inquirer from "inquirer";
import ora from "ora";
import yaml from "js-yaml";
import { showBanner, showSuccess, showError, showWarning, showInfo } from "../utils/banner.js";
import { setupGracefulExit } from "../utils/keyboard.js";
import { logger } from "../utils/logger.js";
import { detectProvider, callProvider, showProviderHelp } from "../utils/provider.js";
import { detectProjectContext } from "../utils/detect-context.js";
import { readConfig, writeConfig, ensureCorpusDir, } from "../utils/config.js";
import { validateCorpusDir } from "../utils/validate.js";
import { CorpusSchema } from "../schema/corpus.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..", "..");
const ROLE_CHOICES = [
    "Sales Development Rep",
    "Account Executive",
    "Customer Success Manager",
    "Product Manager",
    "Marketing Manager",
    "Engineering Manager",
    "Other (describe)",
];
const ROLE_TO_SLUG = {
    "Sales Development Rep": "sales",
    "Account Executive": "sales",
    "Customer Success Manager": "customer-success",
    "Product Manager": "product",
    "Marketing Manager": "marketing",
    "Engineering Manager": "engineering",
    "Other (describe)": "other",
};
const RUNTIME_CHOICES = ["Claude Code", "OpenClaw", "OpenCode", "Cursor", "All"];
const RUNTIME_TO_TARGET = {
    "Claude Code": "claude-code",
    OpenClaw: "openclaw",
    OpenCode: "opencode",
    Cursor: "cursor",
    All: "all",
};
const ROLE_FOLDER_SLUGS = ["sales", "customer-success", "product", "marketing", "engineering", "other"];
function roleToFolderSlug(role) {
    const normalized = role.toLowerCase().replace(/\s+/g, "-");
    if (ROLE_TO_SLUG[role])
        return ROLE_TO_SLUG[role];
    if (ROLE_FOLDER_SLUGS.includes(normalized))
        return normalized;
    const prefix = ROLE_FOLDER_SLUGS.find((s) => normalized.startsWith(s));
    return prefix ?? (normalized || "other");
}
const TOOL_CHOICES = [
    "Salesforce",
    "HubSpot",
    "Gmail",
    "Outlook",
    "Slack",
    "LinkedIn",
    "Jira",
    "Linear",
    "Notion",
    "GitHub",
    "Stripe",
    "Other",
];
function getPackageRoot() {
    return PACKAGE_ROOT;
}
function hasExistingCorpus(cwd) {
    const corpusDir = resolve(cwd, ".bundl", "corpus");
    if (!existsSync(corpusDir))
        return false;
    const files = readdirSync(corpusDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    return files.length > 0;
}
function loadRoleTemplates(roleSlug) {
    const rolesDir = join(getPackageRoot(), "src", "roles", roleSlug);
    if (!existsSync(rolesDir))
        return [];
    const files = readdirSync(rolesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    return files.map((f) => {
        const path = join(rolesDir, f);
        const content = readFileSync(path, "utf-8");
        const parsed = yaml.load(content);
        const id = parsed?.id ?? f.replace(/\.(yaml|yml)$/, "");
        return { content, id };
    });
}
function loadJsonSchema() {
    const schemaPath = join(getPackageRoot(), "src", "schema", "corpus.json");
    return readFileSync(schemaPath, "utf-8");
}
function extractYamlFromResponse(response) {
    let text = response.trim();
    const codeBlock = text.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/);
    if (codeBlock)
        text = codeBlock[1].trim();
    return text;
}
async function generateSkill(provider, systemPrompt, userMessage, skillName, baseTemplate, noAi) {
    if (noAi) {
        const parsed = CorpusSchema.safeParse(yaml.load(baseTemplate));
        return {
            yaml: baseTemplate,
            valid: parsed.success,
            usedFallback: false,
        };
    }
    const response = await callProvider(provider, systemPrompt, userMessage);
    const rawYaml = extractYamlFromResponse(response);
    let parsed;
    try {
        parsed = yaml.load(rawYaml);
    }
    catch {
        parsed = null;
    }
    let result = CorpusSchema.safeParse(parsed);
    if (!result.success) {
        const retryPrompt = `${systemPrompt}\n\nPrevious attempt had validation errors. Fix them and output ONLY valid YAML, no markdown:\n${result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("\n")}`;
        const retryResponse = await callProvider(provider, retryPrompt, userMessage);
        const retryYaml = extractYamlFromResponse(retryResponse);
        try {
            parsed = yaml.load(retryYaml);
        }
        catch {
            parsed = null;
        }
        result = CorpusSchema.safeParse(parsed);
    }
    if (result.success) {
        return { yaml: yaml.dump(result.data, { lineWidth: -1 }), valid: true, usedFallback: false };
    }
    if (!baseTemplate || baseTemplate.trim() === "") {
        return { yaml: rawYaml, valid: false, usedFallback: false };
    }
    const fallbackParsed = yaml.load(baseTemplate);
    const fallbackResult = CorpusSchema.safeParse(fallbackParsed);
    return {
        yaml: baseTemplate,
        valid: fallbackResult.success,
        usedFallback: true,
    };
}
export async function runInit(options = {}) {
    const cwd = process.cwd();
    const jsonMode = options.json === true;
    const noAiFlag = options.noAi === true;
    const nonInteractive = options.nonInteractive === true;
    setupGracefulExit();
    if (!jsonMode && !nonInteractive)
        showBanner();
    const providerResult = await detectProvider();
    const provider = providerResult.provider;
    if (nonInteractive) {
        let role;
        if (options.role) {
            role = options.role;
        }
        else {
            const ctx = detectProjectContext(cwd);
            if (ctx.role && ctx.confidence === "high") {
                if (!jsonMode)
                    logger.info(`Detected role: ${ctx.role} — using for corpus generation`);
                role = ctx.role;
            }
            else if (ctx.role && ctx.confidence === "low") {
                role = ctx.role;
            }
            else {
                role = "general";
            }
        }
        const roleSlug = roleToFolderSlug(role);
        const industry = options.industry ?? "B2B SaaS";
        const companySize = options.size ?? "50-200";
        const toolsRaw = options.tools ?? "";
        const tools = toolsRaw ? toolsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];
        const targetSlug = (options.target ?? "claude-code").toLowerCase().replace(/\s+/g, "-");
        const noAi = noAiFlag || !provider;
        ensureCorpusDir(cwd);
        const templates = loadRoleTemplates(roleSlug);
        if (templates.length === 0 && !noAi) {
            if (jsonMode) {
                logger.json({ success: false, error: "No templates for role", role: roleSlug });
                process.exit(1);
            }
            process.exit(1);
        }
        const schemaJson = loadJsonSchema();
        const systemPromptBase = `You are generating a Bundl corpus skill YAML file.
Output ONLY valid YAML matching this schema exactly. No markdown. No explanation. No code blocks.

Schema: ${schemaJson}

Customize this base template for:
Role: ${role}
Industry: ${industry}
Company size: ${companySize}
Tools: ${tools.join(", ") || "None specified"}

The system_prompt field must be specific to this role and industry.
The example_output field must be a realistic, detailed example — not a template with brackets.
Required inputs must be the minimum needed to execute this skill.
Optional inputs must each have a fallback field explaining what the skill does if that input is absent.
The trigger_description must be specific enough for an AI agent to know exactly when to load this skill.`;
        const userMessage = "Generate the customized skill YAML now.";
        const written = [];
        const corpusDir = resolve(cwd, ".bundl", "corpus");
        const skillsToGenerate = templates.length > 0 ? templates : (noAi ? [] : [{ content: "", id: "custom-skill" }]);
        if (skillsToGenerate.length === 0) {
            if (noAi) {
                const fallbackSlug = roleSlug === "general" ? "sales" : roleSlug;
                const fallbackTemplates = loadRoleTemplates(fallbackSlug);
                for (const { content, id } of fallbackTemplates) {
                    const outPath = resolve(corpusDir, `${id}.yaml`);
                    writeFileSync(outPath, content, "utf-8");
                    written.push(outPath);
                }
            }
            const validation = validateCorpusDir(cwd);
            let version = "0.1.0";
            try {
                const pkgPath = join(getPackageRoot(), "package.json");
                version = JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? version;
            }
            catch {
                // ignore
            }
            const config = {
                version,
                ai_provider: provider ?? "claude-code",
                targets: targetSlug === "all" ? ["claude-code", "openclaw", "opencode", "cursor"] : [targetSlug],
            };
            const existing = readConfig(cwd);
            if (existing) {
                config.workspace_id = existing.workspace_id;
                config.workspace_name = existing.workspace_name;
                config.corpus_version = existing.corpus_version;
            }
            writeConfig(config, cwd);
            if (jsonMode) {
                logger.json({
                    success: true,
                    skillsGenerated: written.length,
                    target: targetSlug,
                    corpusPath: corpusDir,
                    validation: validation.results,
                });
                process.exit(0);
            }
            if (noAi) {
                showSuccess(`✓ ${written.length} base templates copied to .bundl/corpus/\n\nThese are starting point templates — not customized to your company.\nTo customize with AI:\n  → Claude Code:        install at claude.ai/code\n  → Anthropic API key:  export ANTHROPIC_API_KEY=sk-ant-...\n  → OpenAI API key:     export OPENAI_API_KEY=sk-...\n\nThen run: bundl init (will detect your provider automatically)`);
            }
            process.exit(0);
        }
        for (const { content, id } of skillsToGenerate) {
            const systemPrompt = `${systemPromptBase}\n\nBase template to customize:\n${content}`;
            const result = await generateSkill(provider ?? "anthropic-api", systemPrompt, userMessage, id, content, noAi);
            const outPath = resolve(corpusDir, `${id}.yaml`);
            writeFileSync(outPath, result.yaml, "utf-8");
            written.push(outPath);
        }
        const validation = validateCorpusDir(cwd);
        let version = "0.1.0";
        try {
            version = JSON.parse(readFileSync(join(getPackageRoot(), "package.json"), "utf-8")).version ?? version;
        }
        catch {
            // ignore
        }
        const config = {
            version,
            ai_provider: provider ?? "claude-code",
            targets: targetSlug === "all" ? ["claude-code", "openclaw", "opencode", "cursor"] : [targetSlug],
        };
        const existing = readConfig(cwd);
        if (existing) {
            config.workspace_id = existing.workspace_id;
            config.workspace_name = existing.workspace_name;
            config.corpus_version = existing.corpus_version;
        }
        writeConfig(config, cwd);
        if (providerResult.hasAgentRuntime) {
            const { runDeploy } = await import("./deploy.js");
            const code = await runDeploy({ target: targetSlug, json: jsonMode, ci: true });
            if (code !== 0)
                process.exit(1);
        }
        if (jsonMode) {
            logger.json({
                success: true,
                skillsGenerated: written.length,
                target: targetSlug,
                corpusPath: corpusDir,
                validation: validation.results,
            });
            process.exit(0);
        }
        if (!providerResult.hasAgentRuntime && provider) {
            showSuccess(`✓ ${written.length} skills generated in .bundl/corpus/\n  ✓ Validated — all agent-ready\n\nNo agent runtime detected. Your corpus is ready to deploy when you set one up.\n\nTo deploy later:\n  → Claude Code:  bundl deploy --target claude-code\n  → OpenClaw:     bundl deploy --target openclaw\n  → OpenCode:     bundl deploy --target opencode\n  → Cursor:       bundl deploy --target cursor\n\nTo generate bootstrap instructions for your agent:\n  → bundl bootstrap --target <runtime>`);
        }
        else if (providerResult.hasAgentRuntime) {
            showSuccess(`✓ ${written.length} skills generated in .bundl/corpus/\n  ✓ Deployed to ${targetSlug}\n\nYour agent knows how your company works. Restart to apply.`);
        }
        else if (noAi) {
            showSuccess(`✓ ${written.length} base templates copied to .bundl/corpus/\n\nThese are starting point templates. Run bundl init with an API key or Claude Code to customize.`);
        }
        process.exit(0);
    }
    if (hasExistingCorpus(cwd)) {
        if (jsonMode) {
            logger.json({ error: "Corpus exists. Add a new role interactively (omit --json)." });
            return;
        }
        const { action } = await inquirer.prompt([
            {
                type: "list",
                name: "action",
                message: "A corpus already exists. What would you like to do?",
                choices: [
                    { name: "Enhance existing corpus with AI (customize base templates)", value: "enhance" },
                    { name: "Add a new role", value: "add" },
                    { name: "Start fresh (overwrites existing)", value: "fresh" },
                    { name: "Cancel", value: "cancel" },
                ],
            },
        ]);
        if (action === "cancel") {
            showInfo("Run bundl init anytime to continue.");
            return;
        }
        if (action === "fresh") {
            const corpusDirForFresh = resolve(cwd, ".bundl", "corpus");
            const files = readdirSync(corpusDirForFresh).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
            for (const f of files) {
                unlinkSync(resolve(corpusDirForFresh, f));
            }
        }
        // add / fresh: fall through to role/target prompts below
        if (action === "enhance") {
            showInfo("Enhance mode: existing customized skills are left untouched; base-template skills will be customized with AI. Run bundl init again and choose Enhance when ready.");
            const ctx = detectProjectContext(cwd);
            const roleSlug = ctx.role ? roleToFolderSlug(ctx.role) : "sales";
            const templates = loadRoleTemplates(roleSlug);
            if (templates.length === 0 || !provider) {
                showWarning("No templates or provider for enhance. Use Add a new role or set API key.");
                return;
            }
            ensureCorpusDir(cwd);
            const corpusDir = resolve(cwd, ".bundl", "corpus");
            const existingFiles = readdirSync(corpusDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
            let enhanced = 0;
            let skipped = 0;
            for (const file of existingFiles) {
                const path = resolve(corpusDir, file);
                const raw = readFileSync(path, "utf-8");
                const parsed = yaml.load(raw);
                const baseId = file.replace(/\.(yaml|yml)$/, "");
                const baseTemplate = templates.find((t) => t.id === baseId);
                if (!baseTemplate) {
                    skipped++;
                    continue;
                }
                const baseExampleLen = yaml.load(baseTemplate.content)?.example_output?.length ?? 0;
                const currentExampleLen = (parsed?.example_output ?? "").length;
                if (currentExampleLen > baseExampleLen + 100) {
                    skipped++;
                    continue;
                }
                const schemaJson = loadJsonSchema();
                const systemPrompt = `You are generating a Bundl corpus skill YAML file. Output ONLY valid YAML.\n\nSchema: ${schemaJson}\n\nCustomize this base template. Make example_output longer and more specific than the base.`;
                const result = await generateSkill(provider, systemPrompt, "Generate the customized skill YAML now.", baseId, baseTemplate.content, false);
                if (result.valid) {
                    writeFileSync(path, result.yaml, "utf-8");
                    enhanced++;
                }
                else {
                    skipped++;
                }
            }
            showSuccess(`Enhanced ${enhanced} skills · ${skipped} already customized or skipped.`);
            const validation = validateCorpusDir(cwd);
            for (const r of validation.results) {
                if (!r.valid)
                    showWarning(`${r.file}: ${r.error}`);
            }
            return;
        }
    }
    let role;
    let industry;
    let companySize;
    let tools;
    let runtime;
    if (options.role && options.target) {
        role = options.role;
        industry = options.industry ?? "B2B SaaS";
        companySize = options.size ?? "50–200";
        tools = options.tools ? options.tools.split(",").map((t) => t.trim()) : [];
        runtime = options.target;
    }
    else {
        const answers = await inquirer.prompt([
            {
                type: "list",
                name: "role",
                message: "What role are you building for?",
                choices: [...ROLE_CHOICES],
                when: () => !options.role,
            },
            {
                type: "input",
                name: "industry",
                message: "What industry?",
                default: "B2B SaaS",
                when: () => !jsonMode,
            },
            {
                type: "list",
                name: "companySize",
                message: "Company size?",
                choices: ["1–50", "50–200", "200–1000", "1000+"],
                when: () => !jsonMode,
            },
            {
                type: "checkbox",
                name: "tools",
                message: "What tools does this role use? (space to select)",
                choices: TOOL_CHOICES,
                when: () => !jsonMode,
            },
            {
                type: "list",
                name: "runtime",
                message: "What agent runtime are you using?",
                choices: [...RUNTIME_CHOICES],
                when: () => !options.target,
            },
        ]);
        role = options.role ?? answers.role ?? ROLE_CHOICES[0];
        industry = answers.industry ?? options.industry ?? "B2B SaaS";
        companySize = answers.companySize ?? options.size ?? "50–200";
        tools = Array.isArray(answers.tools) ? answers.tools : options.tools ? options.tools.split(",").map((t) => t.trim()) : [];
        runtime = options.target ?? answers.runtime ?? "Claude Code";
    }
    const roleSlug = roleToFolderSlug(role);
    const targetSlug = RUNTIME_TO_TARGET[runtime] ?? runtime.replace(/\s+/g, "-").toLowerCase();
    if (!jsonMode) {
        if (provider) {
            logger.info(`Using ${provider} for generation`);
        }
        else {
            showProviderHelp();
            if (!noAiFlag) {
                const { continueBase } = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "continueBase",
                        message: "Continue with base template only? (no AI customization)",
                        default: false,
                    },
                ]);
                if (!continueBase) {
                    process.exit(0);
                }
            }
        }
    }
    ensureCorpusDir(cwd);
    const templates = loadRoleTemplates(roleSlug);
    const noAi = noAiFlag || !provider;
    const schemaJson = loadJsonSchema();
    const systemPromptBase = `You are generating a Bundl corpus skill YAML file.
Output ONLY valid YAML matching this schema exactly. No markdown. No explanation. No code blocks.

Schema: ${schemaJson}

Customize this base template for:
Role: ${role}
Industry: ${industry}
Company size: ${companySize}
Tools: ${tools.join(", ") || "None specified"}

The system_prompt field must be specific to this role and industry.
The example_output field must be a realistic, detailed example — not a template with brackets.
Required inputs must be the minimum needed to execute this skill.
Optional inputs must each have a fallback field explaining what the skill does if that input is absent.
The trigger_description must be specific enough for an AI agent to know exactly when to load this skill.`;
    const userMessage = "Generate the customized skill YAML now.";
    const written = [];
    const corpusDir = resolve(cwd, ".bundl", "corpus");
    if (templates.length === 0 && !noAi) {
        if (!jsonMode)
            logger.warn("No seed templates for this role; generating from schema only is not yet supported. Use --no-ai to copy base templates from another role or add templates.");
    }
    const fromScratch = templates.length === 0 && !noAi;
    const skillsToGenerate = templates.length > 0
        ? templates
        : fromScratch
            ? [{ content: "", id: "custom-skill" }]
            : [];
    if (skillsToGenerate.length === 0) {
        if (!jsonMode)
            logger.info("No templates for this role and --no-ai set. Add templates to src/roles/" + roleSlug + " or choose another role.");
        if (jsonMode)
            logger.json({ success: false, error: "No templates for role", role: roleSlug });
        return;
    }
    const schemaOnlyPrompt = fromScratch
        ? `${systemPromptBase}\n\nGenerate a single Bundl corpus skill from scratch (no base template). Output ONLY valid YAML.`
        : null;
    for (const { content, id } of skillsToGenerate) {
        const skillName = id;
        const systemPrompt = schemaOnlyPrompt ?? `${systemPromptBase}\n\nBase template to customize:\n${content}`;
        const baseTemplate = content || (fromScratch ? "" : content);
        if (!jsonMode) {
            const spinner = ora(`Generating ${skillName}...`).start();
            try {
                const result = await generateSkill(provider ?? "anthropic-api", systemPrompt, userMessage, skillName, baseTemplate, noAi && !fromScratch);
                if (result.usedFallback) {
                    spinner.warn(`${skillName} — validation failed, used base template`);
                    showWarning(`${skillName}: used base template (AI output invalid)`);
                }
                else {
                    spinner.succeed(skillName);
                }
                const outPath = resolve(corpusDir, `${id}.yaml`);
                writeFileSync(outPath, result.yaml, "utf-8");
                written.push(outPath);
            }
            catch (err) {
                spinner.fail(skillName);
                showError(skillName + ": " + (err instanceof Error ? err.message : String(err)));
                if (content) {
                    writeFileSync(resolve(corpusDir, `${id}.yaml`), content, "utf-8");
                    written.push(resolve(corpusDir, `${id}.yaml`));
                }
            }
        }
        else {
            const result = await generateSkill(provider ?? "anthropic-api", systemPrompt, userMessage, skillName, baseTemplate, noAi && !fromScratch);
            const outPath = resolve(corpusDir, `${id}.yaml`);
            writeFileSync(outPath, result.yaml, "utf-8");
            written.push(outPath);
        }
    }
    const validation = validateCorpusDir(cwd);
    if (!jsonMode) {
        logger.step("Validating...");
        for (const r of validation.results) {
            if (r.valid)
                logger.success(`${r.file} valid`);
            else
                logger.warn(`${r.file}: ${r.error ?? "invalid"}`);
        }
        if (!validation.valid && validation.results.some((r) => !r.valid)) {
            showInfo("Fix the errors above and run bundl validate. You can also edit .bundl/corpus/*.yaml and re-run.");
        }
    }
    const targetsToDeploy = targetSlug === "all"
        ? ["claude-code", "openclaw", "opencode", "cursor"]
        : [targetSlug];
    let version = "0.1.0";
    try {
        const pkgPath = join(getPackageRoot(), "package.json");
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        version = pkg.version ?? version;
    }
    catch {
        // ignore
    }
    const config = {
        version,
        ai_provider: provider ?? "claude-code",
        targets: targetsToDeploy,
    };
    const existing = readConfig(cwd);
    if (existing) {
        config.workspace_id = existing.workspace_id;
        config.workspace_name = existing.workspace_name;
        config.corpus_version = existing.corpus_version;
    }
    writeConfig(config, cwd);
    if (providerResult.hasAgentRuntime) {
        const { runDeploy } = await import("./deploy.js");
        await runDeploy({
            target: targetSlug,
            json: false,
            ci: true,
        });
    }
    if (jsonMode) {
        logger.json({
            success: true,
            skillsGenerated: written.length,
            target: targetSlug,
            corpusPath: corpusDir,
            validation: validation.results,
        });
        return;
    }
    if (!providerResult.hasAgentRuntime && provider) {
        showSuccess(`✓ ${written.length} skills generated in .bundl/corpus/\n  ✓ Validated — all agent-ready\n\n  No agent runtime detected. Your corpus is ready to deploy when you set one up.\n\n  To deploy later:\n  → Claude Code:  bundl deploy --target claude-code\n  → OpenClaw:     bundl deploy --target openclaw\n  → OpenCode:     bundl deploy --target opencode\n  → Cursor:       bundl deploy --target cursor\n\n  To generate bootstrap instructions for your agent:\n  → bundl bootstrap --target <runtime>`);
        return;
    }
    if (noAiFlag && !provider) {
        showSuccess(`✓ ${written.length} base templates copied to .bundl/corpus/\n\n  These are starting point templates — not customized to your company.\n  To customize with AI:\n  → Claude Code:        install at claude.ai/code\n  → Anthropic API key:  export ANTHROPIC_API_KEY=sk-ant-...\n  → OpenAI API key:     export OPENAI_API_KEY=sk-...\n\n  Then run: bundl init (will detect your provider automatically)`);
        return;
    }
    const targetLabel = targetSlug === "all" ? "all runtimes" : targetSlug;
    showSuccess(`✓ ${written.length} skills generated in .bundl/corpus/\n  ✓ Deployed to ${targetLabel}\n\n  Your ${runtime} agent knows how your company works.\n  Restart ${runtime} to apply.\n\n  To share with your team: bundl push`);
}
//# sourceMappingURL=init.js.map