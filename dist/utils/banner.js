import figlet from "figlet";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
function getVersion() {
    try {
        const pkgPath = join(__dirname, "../../package.json");
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return pkg.version ?? "0.0.0";
    }
    catch {
        return "0.0.0";
    }
}
/**
 * Renders the Bundl banner for interactive commands (init, simulate).
 * Do not call from validate, status, push — those must be CI-safe.
 */
export function showBanner() {
    const bannerText = figlet.textSync("bundl", { font: "Slant" });
    console.log(chalk.white(bannerText));
    console.log(chalk.hex("#e85d26")("  The open corpus standard for AI employees."));
    console.log(chalk.dim(`  ${getVersion()}`));
    console.log(chalk.dim("  ─────────────────────────────────────────"));
    console.log();
}
export function showSuccess(message) {
    console.log(chalk.hex("#e85d26")("  ─────────────────────────────────────────"));
    console.log(chalk.white(`  ${message}`));
    console.log(chalk.hex("#e85d26")("  ─────────────────────────────────────────"));
}
export function showError(message) {
    console.error(chalk.red("✗"), chalk.red(message));
}
export function showWarning(message) {
    console.warn(chalk.yellow("⚠"), chalk.yellow(message));
}
export function showInfo(message) {
    console.log(chalk.dim(message));
}
//# sourceMappingURL=banner.js.map