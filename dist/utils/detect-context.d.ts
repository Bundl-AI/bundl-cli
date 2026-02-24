export type ProjectContext = {
    role: string | null;
    industry: string | null;
    confidence: "high" | "low";
};
/**
 * Auto-detect project context (role, industry) from package.json, CLAUDE.md, and file hints.
 */
export declare function detectProjectContext(cwd?: string): ProjectContext;
//# sourceMappingURL=detect-context.d.ts.map