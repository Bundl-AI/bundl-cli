export type ProviderType = "claude-code" | "anthropic-api" | "openai-api";
export type DetectProviderResult = {
    provider: ProviderType | null;
    hasAgentRuntime: boolean;
    runtimeName: string | null;
};
/**
 * Detect which AI provider is available and whether an agent runtime is installed.
 * hasAgentRuntime is true only when Claude Code (claude CLI) is available.
 * API keys alone = provider set, hasAgentRuntime false.
 */
export declare function detectProvider(): Promise<DetectProviderResult>;
/**
 * Call the AI provider with system and user message. Returns the assistant text.
 * API keys are read from env only and used only for direct provider calls.
 */
export declare function callProvider(provider: ProviderType, systemPrompt: string, userMessage: string): Promise<string>;
export declare function showProviderHelp(): void;
//# sourceMappingURL=provider.d.ts.map