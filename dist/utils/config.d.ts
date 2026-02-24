import { z } from "zod";
declare const BundlConfigSchema: z.ZodObject<{
    version: z.ZodString;
    ai_provider: z.ZodEnum<["claude-code", "anthropic-api", "openai-api"]>;
    targets: z.ZodArray<z.ZodString, "many">;
    workspace_id: z.ZodOptional<z.ZodString>;
    workspace_name: z.ZodOptional<z.ZodString>;
    corpus_version: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version: string;
    ai_provider: "claude-code" | "anthropic-api" | "openai-api";
    targets: string[];
    workspace_id?: string | undefined;
    workspace_name?: string | undefined;
    corpus_version?: string | undefined;
}, {
    version: string;
    ai_provider: "claude-code" | "anthropic-api" | "openai-api";
    targets: string[];
    workspace_id?: string | undefined;
    workspace_name?: string | undefined;
    corpus_version?: string | undefined;
}>;
export type BundlConfig = z.infer<typeof BundlConfigSchema>;
/**
 * Read and parse bundl.yaml from the current working directory.
 * Returns null if the file does not exist.
 */
export declare function readConfig(cwd?: string): BundlConfig | null;
/**
 * Write config to bundl.yaml in the current working directory.
 */
export declare function writeConfig(config: BundlConfig, cwd?: string): void;
/**
 * Creates .bundl/corpus/ and .bundl/scenarios/ in the current working directory if not present.
 */
export declare function ensureCorpusDir(cwd?: string): void;
export {};
//# sourceMappingURL=config.d.ts.map