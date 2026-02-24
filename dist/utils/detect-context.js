import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const ROLE_HINTS = {
    sales: ["sales", "sdr", "ae", "account executive", "revenue", "crm", "salesforce", "hubspot", "lead", "outbound"],
    "customer-success": ["customer success", "cs", "onboarding", "churn", "qbr", "health score", "escalation"],
    product: ["product", "prd", "feature", "backlog", "sprint", "roadmap", "user feedback", "triage"],
    marketing: ["marketing", "campaign", "content", "seo", "demand gen"],
    engineering: ["engineering", "software", "dev", "sre", "infrastructure", "code review"],
};
function inferFromPackageJson(cwd) {
    const path = resolve(cwd, "package.json");
    if (!existsSync(path))
        return {};
    try {
        const raw = readFileSync(path, "utf-8");
        const pkg = JSON.parse(raw);
        const desc = (pkg.description ?? "").toLowerCase();
        const scripts = Object.values(pkg.scripts ?? {}).join(" ").toLowerCase();
        const deps = Object.keys(pkg.dependencies ?? {}).join(" ").toLowerCase();
        const combined = `${desc} ${scripts} ${deps}`;
        for (const [roleSlug, hints] of Object.entries(ROLE_HINTS)) {
            const matchCount = hints.filter((h) => combined.includes(h)).length;
            if (matchCount >= 2)
                return { role: roleSlug, industry: "B2B SaaS", confidence: "high" };
            if (matchCount === 1)
                return { role: roleSlug, industry: null, confidence: "low" };
        }
    }
    catch {
        // ignore
    }
    return {};
}
function inferFromClaudeMd(cwd) {
    const path = resolve(cwd, "CLAUDE.md");
    if (!existsSync(path))
        return {};
    try {
        const raw = readFileSync(path, "utf-8").toLowerCase();
        for (const [roleSlug, hints] of Object.entries(ROLE_HINTS)) {
            const matchCount = hints.filter((h) => raw.includes(h)).length;
            if (matchCount >= 2)
                return { role: roleSlug, industry: null, confidence: "high" };
            if (matchCount === 1)
                return { role: roleSlug, industry: null, confidence: "low" };
        }
    }
    catch {
        // ignore
    }
    return {};
}
function inferFromCrmFiles(cwd) {
    const indicators = ["salesforce", "hubspot", "pipedrive", "crm"];
    try {
        const entries = readdirSync(cwd, { withFileTypes: true });
        const names = entries.map((e) => e.name.toLowerCase());
        if (indicators.some((i) => names.some((n) => n.includes(i)))) {
            return { role: "sales", industry: "B2B SaaS", confidence: "low" };
        }
    }
    catch {
        // ignore
    }
    return {};
}
/**
 * Auto-detect project context (role, industry) from package.json, CLAUDE.md, and file hints.
 */
export function detectProjectContext(cwd = process.cwd()) {
    const fromPkg = inferFromPackageJson(cwd);
    const fromClaude = inferFromClaudeMd(cwd);
    const fromCrm = inferFromCrmFiles(cwd);
    if (fromPkg.role && fromPkg.confidence === "high") {
        return { role: fromPkg.role, industry: fromPkg.industry ?? null, confidence: "high" };
    }
    if (fromClaude.role && fromClaude.confidence === "high") {
        return { role: fromClaude.role, industry: fromClaude.industry ?? null, confidence: "high" };
    }
    if (fromPkg.role) {
        return { role: fromPkg.role, industry: fromPkg.industry ?? null, confidence: "low" };
    }
    if (fromClaude.role) {
        return { role: fromClaude.role, industry: null, confidence: "low" };
    }
    if (fromCrm.role) {
        return { role: fromCrm.role, industry: fromCrm.industry ?? null, confidence: "low" };
    }
    return { role: null, industry: null, confidence: "low" };
}
//# sourceMappingURL=detect-context.js.map