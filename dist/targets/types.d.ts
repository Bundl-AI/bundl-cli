import type { Corpus } from "../schema/corpus.js";
export type CompilerOptions = {
    cwd: string;
    bundlVersion: string;
    corpusVersion: string;
    industry?: string;
};
export type CompilerResult = {
    target: string;
    filesWritten: string[];
    warnings: string[];
};
export type TargetCompiler = (skills: Corpus[], options: CompilerOptions) => CompilerResult;
//# sourceMappingURL=types.d.ts.map