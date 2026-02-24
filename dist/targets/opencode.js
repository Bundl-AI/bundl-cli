import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
export const name = "opencode";
function isAlwaysOn(skill) {
    return skill.load === "always" || skill.type === "constraint";
}
function isOnDemand(skill) {
    return skill.load === "on-demand";
}
export function compile(skills, options) {
    const warnings = [];
    const filesWritten = [];
    const cwd = options.cwd;
    const industry = options.industry ?? "General";
    const role = skills[0]?.role ?? "Agent";
    try {
        const alwaysOn = skills.filter(isAlwaysOn);
        const onDemand = skills.filter(isOnDemand);
        const allConstraints = [...new Set(alwaysOn.flatMap((s) => s.constraints ?? []))];
        const opencodeDir = resolve(cwd, ".opencode");
        const skillsDir = resolve(cwd, ".opencode", "skills");
        mkdirSync(skillsDir, { recursive: true });
        const agentMdContent = `<!-- BUNDL GENERATED — edit corpus in .bundl/corpus/ not here -->

## Agent Operating Instructions

### Role
${role} — ${industry}

### Hard Constraints
${allConstraints.map((c) => `- ${c}`).join("\n")}

### Corpus Info
Skills: ${onDemand.length} on-demand skills in .opencode/skills/
Run \`bundl validate\` to check corpus health
`;
        const agentMdPath = resolve(opencodeDir, "AGENT.md");
        writeFileSync(agentMdPath, agentMdContent, "utf-8");
        filesWritten.push(".opencode/AGENT.md");
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
            filesWritten.push(`.opencode/skills/${skill.id}.md`);
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
//# sourceMappingURL=opencode.js.map