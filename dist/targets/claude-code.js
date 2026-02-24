import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
export const name = "claude-code";
function isAlwaysOn(skill) {
    return skill.load === "always" || skill.type === "constraint";
}
function isOnDemand(skill) {
    return skill.load === "on-demand";
}
function communicationStyleSkill(skills) {
    return (skills.find((s) => s.category === "communication-style" ||
        s.id.toLowerCase().includes("communication-style")) ?? null);
}
export function compile(skills, options) {
    const warnings = [];
    const filesWritten = [];
    const cwd = options.cwd;
    const industry = options.industry ?? "General";
    const role = skills[0]?.role ?? "Agent";
    const timestamp = new Date().toISOString();
    try {
        const alwaysOn = skills.filter(isAlwaysOn);
        const onDemand = skills.filter(isOnDemand);
        const allConstraints = [...new Set(alwaysOn.flatMap((s) => s.constraints ?? []))];
        const commSkill = communicationStyleSkill(skills);
        const claudeDir = resolve(cwd, ".claude");
        const skillsDir = resolve(cwd, ".claude", "skills");
        mkdirSync(skillsDir, { recursive: true });
        const bundlSection = `<!-- BUNDL GENERATED — edit corpus in .bundl/corpus/ not here -->
<!-- bundl v${options.bundlVersion} | corpus v${options.corpusVersion} | ${timestamp} -->

## Agent Operating Instructions

### Role
${role} — ${industry}

### Hard Constraints
${allConstraints.map((c) => `- ${c}`).join("\n")}

${commSkill ? `### Communication Style\n${commSkill.system_prompt}\n` : ""}### Corpus Info
Skills: ${onDemand.length} on-demand skills loaded when relevant
Run \`bundl validate\` to check corpus health
Run \`bundl simulate\` to test workflow behavior
`;
        const claudeMdPath = resolve(cwd, "CLAUDE.md");
        if (existsSync(claudeMdPath)) {
            const existing = readFileSync(claudeMdPath, "utf-8");
            const bundlStart = existing.indexOf("<!-- BUNDL GENERATED");
            const hasUserContent = existing.includes("# Project") ||
                (bundlStart >= 0 && existing.slice(0, bundlStart).trim().length > 0) ||
                (bundlStart < 0 && existing.trim().length > 0);
            if (hasUserContent) {
                const withoutOldBundl = bundlStart >= 0
                    ? existing.slice(0, bundlStart).trimEnd()
                    : existing.trimEnd();
                writeFileSync(claudeMdPath, withoutOldBundl + "\n\n" + bundlSection + "\n", "utf-8");
            }
            else {
                writeFileSync(claudeMdPath, bundlSection + "\n", "utf-8");
            }
            filesWritten.push("CLAUDE.md");
        }
        else {
            writeFileSync(claudeMdPath, bundlSection + "\n", "utf-8");
            filesWritten.push("CLAUDE.md");
        }
        for (const skill of onDemand) {
            const required = (skill.inputs.required ?? [])
                .map((i) => `- ${i.name}: ${i.description}`)
                .join("\n");
            const optional = (skill.inputs.optional ?? [])
                .map((i) => `- ${i.name}: ${i.description}${i.fallback ? ` (if absent: ${i.fallback})` : ""}`)
                .join("\n");
            const constraints = (skill.constraints ?? []).length
                ? "## Constraints\n" + skill.constraints.map((c) => `- ${c}`).join("\n")
                : "";
            const handoff = skill.handoff?.conditions?.length && skill.handoff.escalate_to
                ? "## Escalate When\n" +
                    skill.handoff.conditions.map((c) => `- ${c}`).join("\n") +
                    `\nEscalate to: ${skill.handoff.escalate_to}`
                : "";
            const doneWhen = (skill.success_criteria ?? []).length > 0
                ? "## Done When\n" + skill.success_criteria.map((c) => `- ${c}`).join("\n")
                : "";
            const md = `---
name: ${skill.name}
description: ${skill.trigger_description}
---

# ${skill.name}

${skill.system_prompt}

## Required Context
${required || "(none)"}

## Optional Context
${optional || "(none)"}
${constraints ? "\n" + constraints : ""}
${handoff ? "\n" + handoff : ""}
${doneWhen ? "\n" + doneWhen : ""}

## Example Output
${skill.example_output}
`;
            const outPath = resolve(skillsDir, `${skill.id}.md`);
            writeFileSync(outPath, md, "utf-8");
            filesWritten.push(`.claude/skills/${skill.id}.md`);
        }
    }
    catch (err) {
        warnings.push(err instanceof Error ? err.message : String(err));
    }
    return { target: name, filesWritten, warnings };
}
/** Legacy: single-skill JSON for init’s .bundl/output/ (use compile() for deploy). */
export function emit(corpus) {
    return JSON.stringify(corpus, null, 2);
}
//# sourceMappingURL=claude-code.js.map