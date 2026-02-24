declare const TARGETS: readonly ["claude-code", "openclaw", "opencode", "cursor"];
export type DeployTarget = (typeof TARGETS)[number] | "all";
export type DeployOptions = {
    target?: DeployTarget;
    json?: boolean;
    ci?: boolean;
};
export declare function runDeploy(options?: DeployOptions): Promise<number>;
export {};
//# sourceMappingURL=deploy.d.ts.map