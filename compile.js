import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(__dirname, ".bundl", "corpus");
const SKILLS_DIR = path.join(__dirname, ".bundl", "skills");

function compile() {
  if (!fs.existsSync(CORPUS_DIR)) return 0;
  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  let count = 0;
  for (const file of files) {
    const slug = file.replace(/\.(yaml|yml)$/, "");
    const raw = fs.readFileSync(path.join(CORPUS_DIR, file), "utf8");
    let skill;
    try {
      skill = yaml.load(raw);
    } catch (_) {
      continue;
    }
    if (!skill || typeof skill !== "object") continue;
    const name = skill.name || slug;
    const desc = skill.trigger_description || skill.description || skill.trigger || name;
    const systemPrompt = skill.system_prompt || "";
    const inputs = skill.inputs;
    let inputsList = "";
    if (inputs) {
      const required = inputs.required || (Array.isArray(inputs) ? inputs : []);
      const names = Array.isArray(required) ? required.map((i) => (typeof i === "string" ? i : (i && i.name) || "")) : [];
      if (names.length) inputsList = "\n## Inputs needed\n" + names.filter(Boolean).map((n) => "- " + n).join("\n");
    }
    const rules = skill.constraints || skill.guardrails || [];
    const rulesList = Array.isArray(rules) && rules.length ? "\n## Rules\n" + rules.map((r) => "- " + r).join("\n") : "";
    const success = skill.success_criteria || [];
    const successList = Array.isArray(success) && success.length ? "\n## Success looks like\n" + success.map((s) => "- " + s).join("\n") : "";
    const body = (systemPrompt.trim() + inputsList + rulesList + successList).trim();
    const frontmatter = "---\nname: " + name + "\ndescription: " + desc.replace(/\n/g, " ") + "\n---\n\n";
    const outDir = path.join(SKILLS_DIR, slug);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "SKILL.md"), frontmatter + body, "utf8");
    count++;
  }
  return count;
}

const n = compile();
console.log("Compiled " + n + " skills → .bundl/skills/");
