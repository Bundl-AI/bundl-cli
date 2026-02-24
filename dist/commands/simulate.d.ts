export type SimulateOptions = {
    all?: boolean;
    json?: boolean;
    ci?: boolean;
    workflow?: string;
    generateScenarios?: boolean;
};
export type ScenarioInputs = {
    required: Record<string, string>;
    optional_provided: Record<string, string>;
    optional_skipped: string[];
};
export type ScenarioFile = {
    skill_id: string;
    scenario_name: string;
    created: string;
    provider_used: string;
    inputs: ScenarioInputs;
    expected_behavior: string;
    status: "passing" | "failing";
    last_run: string;
    last_output: string;
};
export declare function runSimulate(options?: SimulateOptions): Promise<number>;
//# sourceMappingURL=simulate.d.ts.map