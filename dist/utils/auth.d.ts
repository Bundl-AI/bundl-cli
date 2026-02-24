/**
 * Bundl workspace credentials only. AI provider keys are NEVER stored here.
 * Credentials are ONLY used for requests to bundl.ai endpoints.
 */
export type Credentials = {
    api_key: string;
    workspace_id: string;
    workspace_name: string;
    created: string;
};
export declare function getCredentials(): Credentials | null;
export declare function saveCredentials(data: Credentials): void;
export declare function clearCredentials(): void;
export declare function isAuthenticated(): boolean;
//# sourceMappingURL=auth.d.ts.map