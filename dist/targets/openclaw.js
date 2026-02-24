import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
export const name = "openclaw";
function isAlwaysOn(skill) {
    return skill.load === "always" || skill.type === "constraint";
}
export function compile(skills, options) {
    const warnings = [];
    const filesWritten = [];
    const cwd = options.cwd;
    const industry = options.industry ?? "General";
    const role = skills[0]?.role ?? "Agent";
    try {
        const alwaysOn = skills.filter(isAlwaysOn);
        const onDemand = skills.filter((s) => s.load === "on-demand");
        const allConstraints = alwaysOn.flatMap((s) => s.constraints ?? []);
        const hardStops = allConstraints.filter((c) => c.toLowerCase().includes("escalate"));
        const skillsPayload = onDemand.map((skill) => ({
            id: skill.id,
            name: skill.name,
            trigger: skill.trigger_description,
            system_prompt: skill.system_prompt,
            required_inputs: (skill.inputs.required ?? []).map((i) => ({
                name: i.name,
                description: i.description,
                source: i.source,
            })),
            optional_inputs: (skill.inputs.optional ?? []).map((i) => ({
                name: i.name,
                description: i.description,
                fallback: i.fallback ?? "",
            })),
            tools_allowed: skill.tools ?? [],
            hard_stops: skill.constraints ?? [],
            escalate_when: skill.handoff?.conditions ?? [],
            escalate_to: skill.handoff?.escalate_to ?? "",
            done_when: skill.success_criteria ?? [],
        }));
        const out = {
            bundl_version: options.bundlVersion,
            corpus_version: options.corpusVersion,
            generated: new Date().toISOString(),
            agent: {
                role,
                industry,
            },
            always_on: {
                constraints: [...new Set(allConstraints)],
                identity: `${role} — ${industry}`,
                hard_stops: hardStops.length ? hardStops : allConstraints,
            },
            skills: skillsPayload,
        };
        const outPath = resolve(cwd, "openclaw-agent.json");
        writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
        filesWritten.push("openclaw-agent.json");
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
//# sourceMappingURL=openclaw.js.map