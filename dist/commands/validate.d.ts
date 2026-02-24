import type { Corpus } from "../schema/corpus.js";
export type IssueSeverity = "error" | "warning";
export type Issue = {
    severity: IssueSeverity;
    message: string;
    suggestion: string;
    lineHint?: string;
};
export type FileResult = {
    path: string;
    status: "valid" | "warning" | "error";
    agentReady: boolean;
    issues: Issue[];
    parsed?: Corpus;
};
export declare function runSemanticChecks(parsed: Corpus): Issue[];
export type ValidateOptions = {
    json?: boolean;
    ci?: boolean;
    fix?: boolean;
    file?: string;
};
export declare function runValidate(options?: ValidateOptions): Promise<number>;
//# sourceMappingURL=validate.d.ts.map