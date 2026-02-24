// API keys used locally only — direct to AI provider, never transmitted to bundl.ai
import execa from "execa";
import axios from "axios";
/**
 * Detect which AI provider is available and whether an agent runtime is installed.
 * hasAgentRuntime is true only when Claude Code (claude CLI) is available.
 * API keys alone = provider set, hasAgentRuntime false.
 */
export async function detectProvider() {
    try {
        const result = await execa("claude", ["--version"], { reject: false });
        if (result.exitCode === 0) {
            return { provider: "claude-code", hasAgentRuntime: true, runtimeName: "Claude Code" };
        }
    }
    catch {
        // ignore
    }
    if (process.env.ANTHROPIC_API_KEY) {
        return { provider: "anthropic-api", hasAgentRuntime: false, runtimeName: null };
    }
    if (process.env.OPENAI_API_KEY) {
        return { provider: "openai-api", hasAgentRuntime: false, runtimeName: null };
    }
    return { provider: null, hasAgentRuntime: false, runtimeName: null };
}
/**
 * Call the AI provider with system and user message. Returns the assistant text.
 * API keys are read from env only and used only for direct provider calls.
 */
export async function callProvider(provider, systemPrompt, userMessage) {
    if (provider === "claude-code") {
        const combined = `<system>\n${systemPrompt}\n</system>\n\n<user>\n${userMessage}\n</user>`;
        const { stdout } = await execa("claude", ["--print"], {
            input: combined,
        });
        return stdout ?? "";
    }
    if (provider === "anthropic-api") {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key)
            throw new Error("ANTHROPIC_API_KEY is not set");
        const { data } = await axios.post("https://api.anthropic.com/v1/messages", {
            model: "claude-sonnet-4-5",
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
        }, {
            headers: {
                "Content-Type": "application/json",
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
            },
        });
        const block = data.content?.find((c) => c.type === "text");
        return block?.text ?? "";
    }
    if (provider === "openai-api") {
        const key = process.env.OPENAI_API_KEY;
        if (!key)
            throw new Error("OPENAI_API_KEY is not set");
        const { data } = await axios.post("https://api.openai.com/v1/chat/completions", {
            model: "gpt-4o",
            max_tokens: 4096,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ],
        }, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${key}`,
            },
        });
        return data.choices?.[0]?.message?.content ?? "";
    }
    throw new Error(`Unknown provider: ${provider}`);
}
export function showProviderHelp() {
    console.log(`No AI provider detected. Bundl needs one of:
  → Claude Code (recommended): claude.ai/code
  → Anthropic API key: export ANTHROPIC_API_KEY=sk-ant-...
  → OpenAI API key: export OPENAI_API_KEY=sk-...

Or skip AI: bundl init --no-ai`);
}
//# sourceMappingURL=provider.js.map