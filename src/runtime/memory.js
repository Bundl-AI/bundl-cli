import fs from "fs";
import path from "path";

const BUDGET = 4000;
const KEEP_RECENT = 6;

export function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

export function estimateMessagesTokens(messages) {
  return messages.reduce((total, msg) => {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content ?? msg.tool_calls ?? msg);
    return total + estimateTokens(content);
  }, 0);
}

export function trimMessages(messages, systemPrompt, sessionPath) {
  const systemTokens = estimateTokens(systemPrompt);
  const conv = messages.slice(1);
  const convTokens = estimateMessagesTokens(conv);
  if (systemTokens + convTokens <= BUDGET) return messages;
  const recent = conv.slice(-KEEP_RECENT);
  const older = conv.slice(0, -KEEP_RECENT);
  if (older.length === 0) return messages;
  const summaryText = older
    .map((m) => {
      const role = m.role === "user" ? "User" : "Agent";
      const content =
        typeof m.content === "string"
          ? m.content
          : JSON.stringify(m.content ?? m.tool_calls ?? m);
      return role + ": " + content.slice(0, 200);
    })
    .join("\n");
  const summaryMessages = [
    {
      role: "user",
      content: "[CONVERSATION SUMMARY — " + older.length + " earlier messages]\n" + summaryText,
    },
    { role: "assistant", content: "Understood. I have context from earlier in our conversation." },
  ];
  if (sessionPath && typeof fs.appendFileSync === "function") {
    const entry = "\n### " + new Date().toISOString() + " [trimmed]\n" + summaryText + "\n";
    fs.appendFileSync(sessionPath, entry);
  }
  return [messages[0], ...summaryMessages, ...recent];
}

export function getSessionPath(root = process.cwd()) {
  return path.join(root, "workspace", "memory", "session.md");
}

export function getLongtermPath(root = process.cwd()) {
  return path.join(root, "workspace", "memory", "longterm.md");
}

export function loadSessionMemory(root = process.cwd()) {
  const p = getSessionPath(root);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8").trim();
}

export function loadLongtermMemory(root = process.cwd()) {
  const p = getLongtermPath(root);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8").trim();
}

export function appendSession(entry, root = process.cwd()) {
  const p = getSessionPath(root);
  fs.appendFileSync(p, entry, "utf8");
}

export function appendLongterm(entry, root = process.cwd()) {
  const p = getLongtermPath(root);
  fs.appendFileSync(p, entry, "utf8");
}

export function initSession(root = process.cwd()) {
  const p = getSessionPath(root);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sessionId =
    new Date().toISOString().split("T")[0] + "-" + Math.random().toString(36).slice(2, 6);
  fs.writeFileSync(p, "## Session " + sessionId + " " + new Date().toISOString() + "\n\n", "utf8");
}
