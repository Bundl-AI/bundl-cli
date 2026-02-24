import chalk from "chalk";

export type LoggerFlags = {
  json?: boolean;
  ci?: boolean;
  silent?: boolean;
};

const flags: LoggerFlags = {
  json: false,
  ci: false,
  silent: false,
};

export function setLoggerFlags(f: LoggerFlags): void {
  if (f.json !== undefined) flags.json = f.json;
  if (f.ci !== undefined) flags.ci = f.ci;
  if (f.silent !== undefined) flags.silent = f.silent;
}

export class Logger {
  log(message: string): void {
    if (flags.json || flags.silent) return;
    if (flags.ci) {
      console.log(message);
      return;
    }
    console.log(message);
  }

  success(message: string): void {
    if (flags.json || flags.silent) return;
    if (flags.ci) {
      console.log(message);
      return;
    }
    console.log(chalk.green("✓"), message);
  }

  error(message: string): void {
    if (flags.silent && !flags.json) return;
    if (flags.json) return;
    if (flags.ci) {
      console.error(message);
      return;
    }
    console.error(chalk.red("✗"), message);
  }

  warn(message: string): void {
    if (flags.json || flags.silent) return;
    if (flags.ci) {
      console.log(message);
      return;
    }
    console.warn(chalk.yellow("⚠"), message);
  }

  info(message: string): void {
    if (flags.json || flags.silent) return;
    if (flags.ci) {
      console.log(message);
      return;
    }
    console.log(chalk.dim(message));
  }

  step(message: string): void {
    if (flags.json || flags.silent) return;
    if (flags.ci) {
      console.log(message);
      return;
    }
    console.log(chalk.hex("#e85d26")("→"), message);
  }

  /**
   * Output JSON. Only prints when --json is active; otherwise no-op.
   */
  json(data: unknown): void {
    if (!flags.json) return;
    console.log(JSON.stringify(data, null, 2));
  }
}

export const logger = new Logger();
