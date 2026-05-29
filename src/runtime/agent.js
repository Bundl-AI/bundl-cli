import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { executeTool, TOOL_DEFINITIONS } from "./tools.js";
import {
  trimMessages,
  estimateTokens,
  estimateMessagesTokens,
  getSessionPath,
} from "./memory.js";
import { loadSkillCatalog, buildSkillCatalogXML } from "./skills.js";
import { isCommand, resolveCommand } from "./commands.js";

let _messages = [];

export function getMessages() {
  return _messages;
}

export function resetMessages(systemPrompt) {
  _messages = systemPrompt ? [{ role: "system", content: systemPrompt }] : [];
}

export function buildSystemPrompt(root = process.cwd()) {
  const instructionsPath = path.join(root, "instructions.md");
  const instructions = fs.existsSync(instructionsPath)
    ? fs.readFileSync(instructionsPath, "utf8")
    : "You are a helpful assistant. Use run_bash to read/write .md files in workspace/ when needed.";

  const catalog = loadSkillCatalog(root);
  const catalogBlock = buildSkillCatalogXML(catalog);

  const sessionPath = path.join(root, "workspace", "memory", "session.md");
  const sessionContent = fs.existsSync(sessionPath)
    ? fs.readFileSync(sessionPath, "utf8").trim()
    : "No session memory yet.";

  const companyDir = path.join(root, "workspace", "company");
  const companyFiles = ["company.md", "icp.md", "positioning.md", "product.md", "competitors.md", "voice.md"];
  let companyBlock = "";
  const stubs = {
    company: "# Company\n_Not yet defined._",
    icp: "# Icp\n_Not yet defined._",
    positioning: "# Positioning\n_Not yet defined._",
    product: "# Product\n_Not yet defined._",
    competitors: "# Competitors\n_Not yet defined._",
    voice: "# Voice\n_Not yet defined._",
  };
  for (const f of companyFiles) {
    const p = path.join(companyDir, f);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, "utf8").trim();
    const key = f.replace(".md", "");
    const stub = stubs[key];
    if (!content || content === stub || content.length <= 60) continue;
    companyBlock += "\n### " + key + "\n" + content + "\n";
  }
  if (companyBlock) companyBlock = "\n\n## Company knowledge\n" + companyBlock;

  const memoryRules =
    "\n\n## Memory rules\n" +
    "- session.md is loaded above; longterm.md is NOT — grep it when needed.\n" +
    "- Before any task: grep longterm.md for relevant terms (person, company, doc type).\n" +
    "- After each task: append a one-line summary to longterm.md. Paths under workspace/ or .bundl/.";

  return (
    instructions +
    catalogBlock +
    "\n\n## Your session memory\n" +
    sessionContent +
    companyBlock +
    memoryRules
  );
}

export async function runAgentLoop({
  message,
  messages,
  systemPrompt,
  root = process.cwd(),
  onToken,
  onAction,
  onDone,
  onError,
}) {
  const list = messages ?? _messages;
  const sessionPath = getSessionPath(root);

  let resolvedMessage = message;
  if (isCommand(message)) {
    const r = resolveCommand(message, root);
    if (r.found) resolvedMessage = r.cmdMessage;
  }

  list.push({ role: "user", content: resolvedMessage });

  let commandUsed = "";
  if (isCommand(message)) {
    const r = resolveCommand(message, root);
    if (r.found) commandUsed = r.name || "";
  }
  const turnTools = [];

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let fullResponse = "";

  for (;;) {
    const toSend = trimMessages(list, systemPrompt, sessionPath);
    try {
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: toSend,
        tools: TOOL_DEFINITIONS,
        stream: true,
      });

      let currentContent = "";
      const toolCallsMap = {};

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          currentContent += delta.content;
          if (onToken && delta.content) onToken(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const i = tc.index;
            if (i === undefined) continue;
            if (!toolCallsMap[i]) toolCallsMap[i] = { id: "", name: "", arguments: "" };
            if (tc.id) toolCallsMap[i].id = tc.id;
            if (tc.function?.name) toolCallsMap[i].name = tc.function.name;
            if (tc.function?.arguments) toolCallsMap[i].arguments += tc.function.arguments;
          }
        }
      }

      fullResponse = currentContent.trim();
      const toolCallsArr = Object.keys(toolCallsMap)
        .sort((a, b) => Number(a) - Number(b))
        .map((i) => toolCallsMap[i])
        .filter((tc) => tc.id || tc.name);

      const assistantMessage = {
        role: "assistant",
        content: currentContent || null,
        tool_calls:
          toolCallsArr.length > 0
            ? toolCallsArr.map((tc, i) => ({
                id: tc.id || "call_" + i,
                type: "function",
                function: {
                  name: tc.name || "run_bash",
                  arguments: tc.arguments || "{}",
                },
              }))
            : undefined,
      };

      list.push(assistantMessage);

      if (!assistantMessage.tool_calls?.length) {
        if (sessionPath && fullResponse) {
          const taskPreview = resolvedMessage.slice(0, 80);
          const actionPreview = (fullResponse.split("\n")[0].slice(0, 80) || "Done").trim();
          let entry =
            "\n### " +
            new Date().toISOString() +
            "\nTask: " +
            taskPreview +
            "\nAction: " +
            actionPreview +
            "\nResult: Done\n";
          if (commandUsed) {
            entry = entry.replace("Result: Done\n", "Command: /" + commandUsed + "\nResult: Done\n");
          }
          if (turnTools.length > 0) {
            const toolLines = turnTools.map((a) => {
              if (a.tool !== "run_bash" || !a.input?.command) return a.tool + " (tool)";
              const cmd = String(a.input.command).trim();
              if (cmd.startsWith("cat ")) return "read " + cmd.replace(/^cat\s+/, "").trim();
              if (cmd.startsWith("echo ") && (cmd.includes(" >> ") || cmd.includes(" > "))) {
                const file = cmd.includes(" >> ") ? cmd.split(" >> ").pop() : cmd.split(" > ").pop();
                return "wrote " + (file || "").replace(/^["']|["']$/g, "").trim();
              }
              if (cmd.startsWith("grep ")) {
                const rest = cmd.replace(/^grep\s+(-\w+\s+)*/, "").trim();
                const file = rest.split(/\s+/).pop();
                return "searched " + (file || "—");
              }
              return cmd.slice(0, 50) + (cmd.length > 50 ? "…" : "");
            });
            entry = entry.replace("Result: Done\n", "Tools: " + toolLines.join("; ") + "\nResult: Done\n");
          }
          fs.appendFileSync(sessionPath, entry);
        }
        if (onDone) onDone(fullResponse);
        return;
      }

      for (const tc of assistantMessage.tool_calls) {
        const name = tc.function?.name || "run_bash";
        let args = {};
        try {
          args = JSON.parse(tc.function?.arguments || "{}");
        } catch (_) {}
        const { output, error } = executeTool(name, args, root);
        const result = error ?? output ?? "(no output)";
        const action = { tool: name, input: args, output: result };
        turnTools.push(action);
        if (onAction) onAction(action);
        list.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
    } catch (err) {
      if (onError) onError(err);
      throw err;
    }
  }
}
