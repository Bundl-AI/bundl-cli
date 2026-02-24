import chalk from "chalk";
import { getBootstrapInstructions, getBootstrapTargetLabel, } from "../utils/agent-bootstrap-instructions.js";
import { logger } from "../utils/logger.js";
const VALID_TARGETS = ["claude-code", "openclaw", "opencode", "cursor"];
export async function runBootstrap(options) {
    const target = (options.target ?? "claude-code").toLowerCase().replace(/\s+/g, "-");
    if (!VALID_TARGETS.includes(target)) {
        logger.error(`Invalid target. Use one of: ${VALID_TARGETS.join(", ")}`);
        return 1;
    }
    const text = getBootstrapInstructions(target);
    const label = getBootstrapTargetLabel(target);
    if (options.json) {
        logger.json({ target, configFile: label, instructions: text });
        return 0;
    }
    const div = chalk.dim("  ─────────────────────────────────────────");
    console.log();
    console.log(div);
    console.log(chalk.white(`  Add this to your ${label} to enable self-managed corpus:`));
    console.log(div);
    console.log();
    console.log(text.split("\n").map((l) => "  " + l).join("\n"));
    console.log();
    console.log(div);
    if (target === "claude-code") {
        console.log(chalk.dim("  Copy the above into your CLAUDE.md, then restart Claude Code."));
        console.log(chalk.dim("  Claude Code will initialize and maintain its own corpus from that point."));
    }
    else {
        console.log(chalk.dim(`  Copy the above into your ${label}.`));
    }
    console.log(div);
    console.log();
    return 0;
}
//# sourceMappingURL=bootstrap.js.map