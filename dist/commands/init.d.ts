export type InitOptions = {
    role?: string;
    target?: string;
    industry?: string;
    size?: string;
    tools?: string;
    noAi?: boolean;
    json?: boolean;
    nonInteractive?: boolean;
};
export declare function runInit(options?: InitOptions): Promise<void>;
//# sourceMappingURL=init.d.ts.map