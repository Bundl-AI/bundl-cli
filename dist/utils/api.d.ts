/**
 * Bundl API client. All requests to bundl.ai only.
 * Never include AI provider keys in any request to bundl.ai.
 * Corpus content (YAML text) is the only sensitive data sent to bundl.ai.
 */
/** Shared HTTP client (no baseURL). Do not send AI provider keys to bundl.ai. */
export declare const api: import("axios").AxiosInstance;
export type CorpusFile = {
    path: string;
    content: string;
};
export type SyncResult = {
    ok: boolean;
    version?: string;
    error?: string;
};
export type WorkspaceStatus = {
    workspace_id: string;
    workspace_name: string;
    version: string;
    skills_count: number;
};
export type AuthResult = {
    api_key: string;
    workspace_id: string;
    workspace_name: string;
};
export declare function syncCorpus(workspaceId: string, files: CorpusFile[]): Promise<SyncResult>;
export declare function getWorkspaceStatus(workspaceId: string): Promise<WorkspaceStatus>;
export declare function pollAuthStatus(state: string): Promise<AuthResult | null>;
//# sourceMappingURL=api.d.ts.map