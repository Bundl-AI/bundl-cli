import inquirer from "inquirer";
import chalk from "chalk";

type MenuChoice =
  | "anthropic-key"
  | "openai-key"
  | "claude-code"
  | "exit";

/**
 * Show an interactive menu when no AI provider is detected.
 * Returns true if the user added credentials (caller should re-detect and continue).
 * Returns false if the user chose to exit or open Claude Code.
 */
export async function promptNoProvider(): Promise<boolean> {
  const { choice } = await inquirer.prompt<{ choice: MenuChoice }>([
    {
      type: "list",
      name: "choice",
      message: "No AI provider detected. What would you like to do?",
      choices: [
        {
          name: "Enter Anthropic API key (use for this run)",
          value: "anthropic-key",
        },
        {
          name: "Enter OpenAI API key (use for this run)",
          value: "openai-key",
        },
        {
          name: "I'll use Claude Code — open claude.ai/code, then run bundl simulate again",
          value: "claude-code",
        },
        new inquirer.Separator(),
        {
          name: "Exit",
          value: "exit",
        },
      ],
    },
  ]);

  if (choice === "exit") {
    return false;
  }

  if (choice === "claude-code") {
    console.log();
    console.log(chalk.dim("  Open Claude Code in your browser:"));
    console.log(chalk.bold("  https://claude.ai/code"));
    console.log();
    console.log(chalk.dim("  Then in your terminal run: bundl simulate"));
    console.log();
    return false;
  }

  if (choice === "anthropic-key") {
    const { key } = await inquirer.prompt<{ key: string }>([
      {
        type: "password",
        name: "key",
        message: "Paste your Anthropic API key (sk-ant-...):",
        validate: (v: string) => {
          if (!v || !v.trim()) return "Key is required.";
          if (!v.trim().startsWith("sk-ant-")) return "Anthropic keys usually start with sk-ant-";
          return true;
        },
      },
    ]);
    if (key?.trim()) {
      process.env.ANTHROPIC_API_KEY = key.trim();
      console.log(chalk.dim("  Key set for this session. Continuing..."));
      return true;
    }
    return false;
  }

  if (choice === "openai-key") {
    const { key } = await inquirer.prompt<{ key: string }>([
      {
        type: "password",
        name: "key",
        message: "Paste your OpenAI API key (sk-...):",
        validate: (v: string) => {
          if (!v || !v.trim()) return "Key is required.";
          if (!v.trim().startsWith("sk-")) return "OpenAI keys usually start with sk-";
          return true;
        },
      },
    ]);
    if (key?.trim()) {
      process.env.OPENAI_API_KEY = key.trim();
      console.log(chalk.dim("  Key set for this session. Continuing..."));
      return true;
    }
    return false;
  }

  return false;
}
