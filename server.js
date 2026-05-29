import "dotenv/config";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { runAgentLoop, buildSystemPrompt } from "./src/runtime/agent.js";
import { compileCorpus, loadSkillCatalog, ensureKnowledgeCaptureSkill } from "./src/runtime/skills.js";
import { listCommands, ensureCommandFiles } from "./src/runtime/commands.js";
import { loadSessionMemory, loadLongtermMemory } from "./src/runtime/memory.js";
import { readWorkspaceFile, writeWorkspaceFile } from "./src/runtime/tools.js";

import { bootstrapWorkspace } from "./src/runtime/bootstrap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const PORT = 8787;
const CHATS_DIR = path.join(ROOT, "workspace", "chats");
const CHATS_INDEX = path.join(CHATS_DIR, "index.json");

function createChatId() {
  return "chat-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function listChats() {
  if (!fs.existsSync(CHATS_DIR)) return [];
  try {
    const raw = fs.readFileSync(CHATS_INDEX, "utf8");
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")) : [];
  } catch (_) {
    return [];
  }
}

function loadChat(id) {
  if (!id || !/^chat-[a-z0-9-]+$/.test(id)) return null;
  const file = path.join(CHATS_DIR, id + ".json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function saveChat(id, data) {
  if (!fs.existsSync(CHATS_DIR)) fs.mkdirSync(CHATS_DIR, { recursive: true });
  const file = path.join(CHATS_DIR, id + ".json");
  const now = new Date().toISOString();
  const existing = loadChat(id);
  const payload = {
    id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    preview: data.preview != null ? data.preview : (existing?.preview || "New chat"),
    messages: Array.isArray(data.messages) ? data.messages : (existing?.messages || []),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  const index = listChats().filter((c) => c.id !== id);
  index.unshift({ id: payload.id, createdAt: payload.createdAt, updatedAt: payload.updatedAt, preview: payload.preview });
  fs.writeFileSync(CHATS_INDEX, JSON.stringify(index, null, 2), "utf8");
}

function initSequence() {
  bootstrapWorkspace(ROOT);
  compileCorpus(ROOT);
  ensureKnowledgeCaptureSkill(ROOT);
  ensureCommandFiles(ROOT);
  const catalog = loadSkillCatalog(ROOT);
  const sessionContent = loadSessionMemory(ROOT);
  const longtermContent = loadLongtermMemory(ROOT);
  const sessionLines = sessionContent ? sessionContent.split("\n").filter((l) => l.trim()).length : 0;
  const longtermLines = longtermContent ? longtermContent.split("\n").filter((l) => l.trim()).length : 0;
  const companyDir = path.join(ROOT, "workspace", "company");
  const stubs = {
    "company.md": "# Company\n_Not yet defined._",
    "icp.md": "# Icp\n_Not yet defined._",
    "positioning.md": "# Positioning\n_Not yet defined._",
    "product.md": "# Product\n_Not yet defined._",
    "competitors.md": "# Competitors\n_Not yet defined._",
    "voice.md": "# Voice\n_Not yet defined._",
  };
  const companyFiles = fs.existsSync(companyDir)
    ? fs.readdirSync(companyDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => {
          const content = fs.readFileSync(path.join(companyDir, f), "utf8").trim();
          const stub = stubs[f];
          const hasContent = !!(content && content !== stub && content.length > 60);
          return { name: f, path: "workspace/company/" + f, hasContent };
        })
    : [];
  const artifactDirs = {};
  for (const sub of ["sequences", "prds", "templates", "call-prep"]) {
    const full = path.join(ROOT, "workspace", "artifacts", sub);
    artifactDirs[sub] = fs.existsSync(full)
      ? fs.readdirSync(full, { withFileTypes: true }).map((d) => ({ name: d.name, isDirectory: d.isDirectory() }))
      : [];
  }
  const chats = listChats();
  return {
    skills: catalog,
    commands: listCommands(ROOT),
    companyFiles,
    sessionLines,
    longtermLines,
    artifactDirs,
    chats,
  };
}

let history = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const p = url.pathname;

  if (p.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    if (p === "/api/files" && req.method === "GET") {
      const filePath = url.searchParams.get("path") || "";
      const content = readWorkspaceFile(filePath, ROOT);
      if (content === null) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
      res.end(JSON.stringify({ path: filePath, content }));
      return;
    }
    if (p === "/api/files" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { path: filePath, content } = JSON.parse(body);
          const ok = writeWorkspaceFile(filePath, content, ROOT);
          if (!ok) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid path" }));
            return;
          }
          res.end(JSON.stringify({ path: filePath, saved: true }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: String(e.message) }));
        }
      });
      return;
    }
    if (p === "/api/ls" && req.method === "GET") {
      const dirPath = url.searchParams.get("path") || "workspace";
      const full = path.resolve(ROOT, dirPath);
      if (!full.startsWith(path.resolve(ROOT))) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Invalid path" }));
        return;
      }
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
      const files = fs.readdirSync(full, { withFileTypes: true }).map((d) => ({
        name: d.name,
        isDirectory: d.isDirectory(),
      }));
      res.end(JSON.stringify({ path: dirPath, files }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const distIndex = path.join(__dirname, "dist", "index.html");
  const distFile = p === "/" ? distIndex : path.join(__dirname, "dist", p);
  if (fs.existsSync(distFile) && fs.statSync(distFile).isFile()) {
    const ext = path.extname(distFile);
    const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".ico": "image/x-icon" };
    res.setHeader("Content-Type", types[ext] || "application/octet-stream");
    res.end(fs.readFileSync(distFile));
    return;
  }
  if (fs.existsSync(distIndex)) {
    res.setHeader("Content-Type", "text/html");
    res.end(fs.readFileSync(distIndex));
    return;
  }
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain");
  res.end("Not found. Run npm run build first.");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (_) {
      send(ws, { type: "agent:error", error: "Invalid JSON" });
      return;
    }

    if (msg.type === "init") {
      const initData = initSequence();
      send(ws, { type: "init:complete", ...initData });
      return;
    }

    if (msg.type === "chats:load") {
      const chat = loadChat(msg.chatId);
      if (!chat) {
        send(ws, { type: "chats:content", chatId: msg.chatId, error: "Not found", messages: [] });
      } else {
        send(ws, { type: "chats:content", chatId: chat.id, messages: chat.messages || [] });
      }
      return;
    }

    if (msg.type === "chats:save") {
      const { chatId, messages, preview } = msg;
      if (!chatId) return;
      const pre = preview != null ? String(preview).slice(0, 120) : undefined;
      saveChat(chatId, { messages, preview: pre });
      const list = listChats();
      send(ws, { type: "chats:updated", chats: list });
      return;
    }

    if (msg.type === "agent:message") {
      const { message, history: clientHistory, chatId: clientChatId } = msg;
      const messages = Array.isArray(clientHistory) && clientHistory.length > 0 ? clientHistory : history;
      if (messages.length === 0) {
        const systemPrompt = buildSystemPrompt(ROOT);
        history = [{ role: "system", content: systemPrompt }];
      } else {
        history = messages;
      }
      const systemPrompt = history[0]?.role === "system" ? history[0].content : buildSystemPrompt(ROOT);
      if (history[0]?.role !== "system") history.unshift({ role: "system", content: systemPrompt });

      const chatId = clientChatId || createChatId();

      runAgentLoop({
        message: message || "",
        messages: history,
        systemPrompt,
        root: ROOT,
        onToken: (token) => send(ws, { type: "agent:token", token }),
        onAction: (a) => send(ws, { type: "agent:action", tool: a.tool, input: a.input, preview: String(a.output).slice(0, 200) }),
        onDone: (fullResponse) => send(ws, { type: "agent:done", fullResponse, chatId }),
        onError: (err) => send(ws, { type: "agent:error", error: err?.message || String(err) }),
      }).catch((err) => send(ws, { type: "agent:error", error: err?.message || String(err) }));
      return;
    }

    if (msg.type === "file:read") {
      const content = readWorkspaceFile(msg.path, ROOT);
      send(ws, { type: "file:content", path: msg.path, content: content ?? "" });
      return;
    }

    if (msg.type === "file:write") {
      const ok = writeWorkspaceFile(msg.path, msg.content ?? "", ROOT);
      send(ws, ok ? { type: "file:saved", path: msg.path } : { type: "file:error", path: msg.path, error: "Invalid path" });
      return;
    }

    if (msg.type === "ls") {
      const dirPath = msg.path || "workspace";
      const full = path.resolve(ROOT, dirPath);
      if (!full.startsWith(path.resolve(ROOT)) || !fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
        send(ws, { type: "ls:result", path: dirPath, files: [] });
        return;
      }
      const files = fs.readdirSync(full, { withFileTypes: true }).map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
      send(ws, { type: "ls:result", path: dirPath, files });
      return;
    }
  });
});

server.listen(PORT, () => {
  console.log("Bundl Studio → http://localhost:" + PORT);
});
