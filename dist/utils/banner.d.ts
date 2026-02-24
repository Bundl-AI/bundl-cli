/**
 * Renders the Bundl banner for interactive commands (init, simulate).
 * Do not call from validate, status, push — those must be CI-safe.
 */
export declare function showBanner(): void;
export declare function showSuccess(message: string): void;
export declare function showError(message: string): void;
export declare function showWarning(message: string): void;
export declare function showInfo(message: string): void;
//# sourceMappingURL=banner.d.ts.map