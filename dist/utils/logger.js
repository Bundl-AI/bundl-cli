import chalk from "chalk";
const flags = {
    json: false,
    ci: false,
    silent: false,
};
export function setLoggerFlags(f) {
    if (f.json !== undefined)
        flags.json = f.json;
    if (f.ci !== undefined)
        flags.ci = f.ci;
    if (f.silent !== undefined)
        flags.silent = f.silent;
}
export class Logger {
    log(message) {
        if (flags.json || flags.silent)
            return;
        if (flags.ci) {
            console.log(message);
            return;
        }
        console.log(message);
    }
    success(message) {
        if (flags.json || flags.silent)
            return;
        if (flags.ci) {
            console.log(message);
            return;
        }
        console.log(chalk.green("✓"), message);
    }
    error(message) {
        if (flags.silent && !flags.json)
            return;
        if (flags.json)
            return;
        if (flags.ci) {
            console.error(message);
            return;
        }
        console.error(chalk.red("✗"), message);
    }
    warn(message) {
        if (flags.json || flags.silent)
            return;
        if (flags.ci) {
            console.log(message);
            return;
        }
        console.warn(chalk.yellow("⚠"), message);
    }
    info(message) {
        if (flags.json || flags.silent)
            return;
        if (flags.ci) {
            console.log(message);
            return;
        }
        console.log(chalk.dim(message));
    }
    step(message) {
        if (flags.json || flags.silent)
            return;
        if (flags.ci) {
            console.log(message);
            return;
        }
        console.log(chalk.hex("#e85d26")("→"), message);
    }
    /**
     * Output JSON. Only prints when --json is active; otherwise no-op.
     */
    json(data) {
        if (!flags.json)
            return;
        console.log(JSON.stringify(data, null, 2));
    }
}
export const logger = new Logger();
//# sourceMappingURL=logger.js.map