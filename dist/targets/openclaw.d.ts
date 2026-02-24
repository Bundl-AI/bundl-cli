import type { Corpus } from "../schema/corpus.js";
import type { CompilerOptions, CompilerResult } from "./types.js";
export declare const name = "openclaw";
export declare function compile(skills: Corpus[], options: CompilerOptions): CompilerResult;
/** Legacy: single-skill JSON for init’s .bundl/output/ (use compile() for deploy). */
export declare function emit(corpus: unknown): string;
//# sourceMappingURL=openclaw.d.ts.map