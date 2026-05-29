#!/usr/bin/env node
import "dotenv/config";
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";
import { runAgentLoop, buildSystemPrompt, resetMessages, getMessages } from "./src/runtime/agent.js";
import { bootstrapWorkspace } from "./src/runtime/bootstrap.js";
import { compileCorpus, ensureKnowledgeCaptureSkill } from "./src/runtime/skills.js";
import { ensureCommandFiles, listCommands } from "./src/runtime/commands.js";
import { initSession } from "./src/runtime/memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();

if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY is not set. Add it to .env");
  process.exit(1);
}

bootstrapWorkspace(ROOT);
compileCorpus(ROOT);
ensureKnowledgeCaptureSkill(ROOT);
ensureCommandFiles(ROOT);
initSession(ROOT);

const systemPrompt = buildSystemPrompt(ROOT);
resetMessages(systemPrompt);
let messages = getMessages(); // same array reference; runAgentLoop mutates it

console.log("Agent is ready.");
console.log("Commands: " + listCommands(ROOT).join(" "));
console.log("At 'You:' type your message or /[command]. Type exit to end.\n");

async function handleInput(input) {
  const trimmed = (input || "").trim();
  if (trimmed.toLowerCase() === "exit") {
    rl.close();
    process.exit(0);
  }
  if (!trimmed) return;

  await runAgentLoop({
    message: trimmed,
    messages,
    systemPrompt,
    root: ROOT,
    onToken: (token) => process.stdout.write(token),
    onAction: ({ tool, input: args, output }) => {
      const cmd = args?.command ?? "";
      console.log("\n→ " + cmd + "\n" + (output || ""));
    },
    onDone: (fullResponse) => {
      console.log("\n\n" + (fullResponse || ""));
    },
    onError: (err) => console.error("\nError:", err?.message || err),
  });
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function prompt() {
  rl.question("You: ", (line) => {
    handleInput(line).then(() => prompt()).catch((e) => {
      console.error(e);
      prompt();
    });
  });
}

(async () => {
  if (process.argv[2]) {
    await handleInput(process.argv[2]);
  }
  prompt();
})();
