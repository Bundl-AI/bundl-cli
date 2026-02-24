import chalk from "chalk";
/**
 * Catches SIGINT (Ctrl+C) and exits cleanly with a message.
 * Call at the top of every interactive command.
 */
export function setupGracefulExit() {
    process.on("SIGINT", () => {
        console.log();
        console.log(chalk.dim("Exiting Bundl. Run bundl init to start again."));
        process.exit(0);
    });
}
//# sourceMappingURL=keyboard.js.map