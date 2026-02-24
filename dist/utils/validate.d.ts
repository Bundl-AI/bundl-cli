export type ValidateResult = {
    file: string;
    valid: boolean;
    error?: string;
};
/**
 * Validate all .yaml files in .bundl/corpus/. Returns per-file results.
 */
export declare function validateCorpusDir(cwd?: string): {
    valid: boolean;
    results: ValidateResult[];
};
//# sourceMappingURL=validate.d.ts.map