import figlet from "figlet";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Returns the banner as a single string (with ANSI codes). Use for terminal mirror in Studio.
 */
export function getBannerText(): string {
  const bannerText = figlet.textSync("bundl", { font: "Slant" });
  return (
    chalk.white(bannerText) +
    "\n" +
    chalk.hex("#e85d26")("  The open corpus standard for AI employees.") +
    "\n" +
    chalk.dim(`  ${getVersion()}`) +
    "\n" +
    chalk.dim("  ─────────────────────────────────────────") +
    "\n\n"
  );
}

/**
 * Renders the Bundl banner for interactive commands (init, simulate, studio).
 * Do not call from validate, status, push — those must be CI-safe.
 */
export function showBanner(): void {
  console.log(getBannerText());
}

export function showSuccess(message: string): void {
  console.log(chalk.hex("#e85d26")("  ─────────────────────────────────────────"));
  console.log(chalk.white(`  ${message}`));
  console.log(chalk.hex("#e85d26")("  ─────────────────────────────────────────"));
}

export function showError(message: string): void {
  console.error(chalk.red("✗"), chalk.red(message));
}

export function showWarning(message: string): void {
  console.warn(chalk.yellow("⚠"), chalk.yellow(message));
}

export function showInfo(message: string): void {
  console.log(chalk.dim(message));
}
