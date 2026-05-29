import fs from "fs";
import path from "path";

const WORKSPACE_DIRS = [
  "workspace/company",
  "workspace/commands",
  "workspace/memory",
  "workspace/chats",
  "workspace/artifacts/sequences",
  "workspace/artifacts/prds",
  "workspace/artifacts/call-prep",
  "workspace/artifacts/templates",
];
const WORKSPACE_FILES = [
  "workspace/company/company.md",
  "workspace/company/icp.md",
  "workspace/company/positioning.md",
  "workspace/company/product.md",
  "workspace/company/competitors.md",
  "workspace/company/voice.md",
];

export function bootstrapWorkspace(root = process.cwd()) {
  for (const d of WORKSPACE_DIRS) {
    const full = path.join(root, d);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
  }
  const memDir = path.join(root, "workspace", "memory");
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  const sessionPath = path.join(memDir, "session.md");
  const longtermPath = path.join(memDir, "longterm.md");
  if (!fs.existsSync(sessionPath)) fs.writeFileSync(sessionPath, "", "utf8");
  if (!fs.existsSync(longtermPath)) fs.writeFileSync(longtermPath, "", "utf8");
  for (const f of WORKSPACE_FILES) {
    const full = path.join(root, f);
    if (fs.existsSync(full)) continue;
    const title = path.basename(f, ".md").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    fs.writeFileSync(full, "# " + title + "\n_Not yet defined._\n", "utf8");
  }
}
