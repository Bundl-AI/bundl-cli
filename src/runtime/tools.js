import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const ALLOWED = [
  /^cat\s+[\w./-]+\.md$/,
  /^ls\s+[\w./-]*$/,
  /^mkdir\s+-p\s+[\w./-]+$/,
  /^touch\s+[\w./-]+\.md$/,
  /^echo\s+[\s\S]+\s+>>?\s+[\w./-]+\.md$/,
  /^cp\s+[\w./-]+\.md\s+[\w./-]+\.md$/,
  /^mv\s+[\w./-]+\.md\s+[\w./-]+\.md$/,
  /^rm\s+[\w./-]+\.md$/,
  /^grep\s+(-\w+\s+)*.+\s+[\w./-]+\.md$/,
  /^grep\s+(-\w+\s+)*.+\s+[\w./-]+$/,
];

export function executeTool(name, args, cwd = process.cwd()) {
  if (name !== "run_bash") {
    return { output: null, error: "Unknown tool: " + name };
  }
  const command = (args?.command ?? "").trim();
  let c = command;
  if (c.endsWith('.md"')) c = c.slice(0, -1);
  if (c.includes("..") || /(^|\s)\/[a-zA-Z0-9]/.test(c)) {
    return { output: null, error: "Blocked: only markdown file operations allowed" };
  }
  if (!c.includes("workspace/") && !c.includes(".bundl/")) {
    return { output: null, error: "Blocked: only markdown file operations allowed" };
  }
  if (!ALLOWED.some((r) => r.test(c))) {
    return { output: null, error: "Blocked: only markdown file operations allowed" };
  }
  try {
    const out = execSync(c, { encoding: "utf8", cwd });
    return { output: out || "(no output)", error: null };
  } catch (e) {
    if (c.startsWith("grep") && (e.status === 1 || e.statusCode === 1)) {
      return { output: "(no matches)", error: null };
    }
    const err = (e.stderr || e.message || String(e)).trim() || "(command failed)";
    return { output: null, error: err };
  }
}

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "run_bash",
      description:
        "Bash for .md files: workspace/ for memory and files, .bundl/skills/ for skill instructions. Use grep -i/-n on workspace/memory/longterm.md. Use cat on .bundl/skills/<name>/SKILL.md when a task matches an available skill.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
];

export function safePath(relativePath, root = process.cwd()) {
  const resolved = path.resolve(root, relativePath);
  const rootNorm = path.resolve(root);
  if (!resolved.startsWith(rootNorm)) return null;
  return resolved;
}

export function readWorkspaceFile(relativePath, root = process.cwd()) {
  const p = safePath(relativePath, root);
  if (!p || !fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

export function writeWorkspaceFile(relativePath, content, root = process.cwd()) {
  const p = safePath(relativePath, root);
  if (!p) return false;
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, content, "utf8");
  return true;
}
