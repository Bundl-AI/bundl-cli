import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import yaml from "js-yaml";

export function compileCorpus(root = process.cwd()) {
  try {
    const compilePath = path.join(root, "compile.js");
    if (!fs.existsSync(compilePath)) return 0;
    execSync("node compile.js", { cwd: root, stdio: "pipe" });
    return 1;
  } catch (_) {
    return 0;
  }
}

export function loadSkillCatalog(root = process.cwd()) {
  const skillsDir = path.join(root, ".bundl", "skills");
  if (!fs.existsSync(skillsDir)) return [];
  const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const out = [];
  for (const d of dirs) {
    const skillPath = path.join(skillsDir, d.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const raw = fs.readFileSync(skillPath, "utf8");
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) continue;
    let meta;
    try {
      meta = yaml.load(match[1]) || {};
    } catch (_) {
      continue;
    }
    out.push({
      name: meta.name || d.name,
      description: meta.description || "",
      location: ".bundl/skills/" + d.name + "/SKILL.md",
    });
  }
  return out;
}

const KNOWLEDGE_CAPTURE_BODY = `---
name: knowledge-capture
description: Use when the user shares information about their company, product, customers, market, competitors, tone, or vision. Captures and structures company knowledge into the right file.
---

## Your job
When the user shares company knowledge, you:
1. Identify what TYPE of information it is
2. Write it to the correct file in workspace/company/
3. Confirm what you captured and where

## Information types and where they live
COMPANY IDENTITY → workspace/company/company.md
ICP → workspace/company/icp.md
POSITIONING → workspace/company/positioning.md
PRODUCT → workspace/company/product.md
COMPETITORS → workspace/company/competitors.md
VOICE → workspace/company/voice.md
ARTIFACTS (use these paths only; never workspace/prds.md or workspace/prds/):
  PRDs, vision docs, product specs → workspace/artifacts/prds/[name].md
  Sequences → workspace/artifacts/sequences/
  Call prep → workspace/artifacts/call-prep/
  Templates → workspace/artifacts/templates/

## How to write structured knowledge
Use ## headers, bullet points, short sentences. Make it grep-able.

## Stub rule (important)
Company files start with "# Title" and "_Not yet defined._". When you add the first real content:
- If the file still contains only that stub (or stub plus nothing else), use **>** to overwrite: write the title line, a blank line, then your new content. Do NOT leave "_Not yet defined._" in the file.
- If the file already has real content beyond the stub, use **>>** to append your new section.

## After writing
Always confirm: "Got it. Saved to workspace/company/[file]: [one line summary]"`;

export function ensureKnowledgeCaptureSkill(root = process.cwd()) {
  const dir = path.join(root, ".bundl", "skills", "knowledge-capture");
  const skillPath = path.join(dir, "SKILL.md");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(skillPath, KNOWLEDGE_CAPTURE_BODY, "utf8");
}

export function buildSkillCatalogXML(catalog) {
  if (!catalog.length) return "";
  const lines = catalog.map(
    (s) =>
      "  <skill><name>" +
      (s.name || "") +
      "</name><description>" +
      (s.description || "").replace(/</g, "&lt;").replace(/>/g, "&gt;") +
      "</description><location>" +
      (s.location || "") +
      "</location></skill>"
  );
  return (
    "\n\n## Available skills (Agent Skills open standard)\n<available_skills>\n" +
    lines.join("\n") +
    "\n</available_skills>\nProgressive disclosure: you only see name and description here. When a task matches a skill (by description/keywords), run_bash to cat the <location> SKILL.md, then follow that file's instructions. Load one skill at a time when relevant; do not load all skills upfront."
  );
}
