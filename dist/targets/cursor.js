import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
export const name = "cursor";
export function compile(skills, options) {
    const warnings = [];
    const filesWritten = [];
    const cwd = options.cwd;
    try {
        const rulesDir = resolve(cwd, ".cursor", "rules");
        mkdirSync(rulesDir, { recursive: true });
        for (const skill of skills) {
            const requiredList = (skill.inputs.required ?? []).map((i) => i.name).join(", ");
            const optionalList = (skill.inputs.optional ?? [])
                .map((i) => (i.fallback ? `${i.name} (${i.fallback})` : i.name))
                .join(", ");
            const contextNeeded = "Required: " + (requiredList || "none") + "\nOptional: " + (optionalList || "none");
            const rules = (skill.constraints ?? []).length > 0
                ? skill.constraints.map((c) => `- ${c}`).join("\n")
                : "";
            const escalate = (skill.handoff?.conditions?.length ?? 0) > 0
                ? (skill.handoff.conditions ?? []).map((c) => `- ${c}`).join("\n")
                : "";
            const mdc = `---
description: ${skill.trigger_description}
alwaysApply: ${skill.load === "always"}
---

# ${skill.name}

${skill.system_prompt}

## Context Needed
${contextNeeded}

## Rules
${rules || "(none)"}
${escalate ? "\n## When to Escalate\n" + escalate : ""}

## Good Output Looks Like
${skill.example_output}
`;
            const outPath = resolve(rulesDir, `${skill.id}.mdc`);
            writeFileSync(outPath, mdc, "utf-8");
            filesWritten.push(`.cursor/rules/${skill.id}.mdc`);
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
//# sourceMappingURL=cursor.js.map