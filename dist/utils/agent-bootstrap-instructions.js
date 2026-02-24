const CLAUDE_SNIPPET = `## Bundl Corpus Management
bundl CLI is available. Use it to manage your behavioral corpus.
Check status: bundl status --json
Initialize: bundl init --role <role> --target claude-code --non-interactive
Validate: bundl validate --json
Simulate: bundl simulate --all --json
Deploy: bundl deploy --target claude-code
Edit corpus files in .bundl/corpus/ — never edit compiled output directly.`;
const OPENCLAW_SNIPPET = `{
  "agent_tools": ["bundl"],
  "on_startup": "bundl status --json",
  "corpus_management": {
    "check": "bundl status --json",
    "init": "bundl init --role {role} --target openclaw --non-interactive --json",
    "validate": "bundl validate --json",
    "deploy": "bundl deploy --target openclaw"
  }
}`;
const OPENCODE_SNIPPET = `## Corpus Management
Use bundl CLI for behavioral corpus.
bundl status --json | bundl validate --json | bundl deploy --target opencode`;
const CURSOR_SNIPPET = `## Bundl Corpus Management
bundl CLI is available. Use it to manage your behavioral corpus.
Check status: bundl status --json
Initialize: bundl init --role <role> --target cursor --non-interactive
Validate: bundl validate --json
Deploy: bundl deploy --target cursor
Edit corpus files in .bundl/corpus/ — never edit compiled output directly.`;
export function getBootstrapInstructions(target) {
    switch (target) {
        case "claude-code":
            return CLAUDE_SNIPPET;
        case "openclaw":
            return OPENCLAW_SNIPPET;
        case "opencode":
            return OPENCODE_SNIPPET;
        case "cursor":
            return CURSOR_SNIPPET;
        default:
            return CLAUDE_SNIPPET;
    }
}
export function getBootstrapTargetLabel(target) {
    switch (target) {
        case "claude-code":
            return "CLAUDE.md";
        case "openclaw":
            return "OpenClaw config";
        case "opencode":
            return "AGENT.md";
        case "cursor":
            return "Cursor rules / project docs";
        default:
            return "config file";
    }
}
//# sourceMappingURL=agent-bootstrap-instructions.js.map