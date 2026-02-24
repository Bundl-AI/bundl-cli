export type LoggerFlags = {
    json?: boolean;
    ci?: boolean;
    silent?: boolean;
};
export declare function setLoggerFlags(f: LoggerFlags): void;
export declare class Logger {
    log(message: string): void;
    success(message: string): void;
    error(message: string): void;
    warn(message: string): void;
    info(message: string): void;
    step(message: string): void;
    /**
     * Output JSON. Only prints when --json is active; otherwise no-op.
     */
    json(data: unknown): void;
}
export declare const logger: Logger;
//# sourceMappingURL=logger.d.ts.map