import fs from "fs";
import path from "path";

export function isCommand(input) {
  return typeof input === "string" && input.trim().startsWith("/");
}

export function resolveCommand(input, root = process.cwd()) {
  const trimmed = (input || "").trim();
  if (!trimmed.startsWith("/")) return { found: false, available: listCommands(root) };
  const parts = trimmed.slice(1).trim().split(/\s+/);
  const name = (parts[0] || "").toLowerCase();
  const args = parts.slice(1).join(" ");
  const commandsDir = path.join(root, "workspace", "commands");
  const cmdPath = path.join(commandsDir, name + ".md");
  if (!fs.existsSync(cmdPath)) {
    return { found: false, name, available: listCommands(root) };
  }
  const body = fs.readFileSync(cmdPath, "utf8");
  const cmdMessage =
    "[SLASH COMMAND: /" +
    name +
    "]\nFollow these instructions exactly:\n" +
    body +
    "\n\n" +
    (args ? "User args: " + args : "Apply to the current conversation context.");
  return { found: true, name, cmdMessage, args };
}

export function listCommands(root = process.cwd()) {
  const commandsDir = path.join(root, "workspace", "commands");
  if (!fs.existsSync(commandsDir)) return [];
  return fs
    .readdirSync(commandsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => "/" + f.replace(".md", ""));
}

const PATH_RULES = `## Path rules — read first
- Company files: workspace/company/[name].md
  NEVER workspace/[name].md (wrong)
  ALWAYS workspace/company/[name].md (correct)
- Memory files: workspace/memory/[name].md
- Artifact files: workspace/artifacts/[type]/[name].md
- Commands files: workspace/commands/[name].md
- Use >> to append when the file already has real content.
  If the file still only has the stub "# Title" and "_Not yet defined._", use > to overwrite with the title, a blank line, and your content (do not leave the stub).
  Exception: /save always uses > for new artifact files.
- Maximum 2 tool calls for /note: call 1 cat target file, call 2 echo >> append (or echo > if file is still stub-only).
  Do not mkdir, do not check if file exists. Files are guaranteed to exist.
`;

const COMMAND_BODIES = {
  "note.md": `# /note
## What it does
Captures the user's last message and saves it to the correct workspace/company/ file. Complete in 2 tool calls maximum.
## Identify the type
company identity, mission, vision → company.md
ICP, who we sell to, target customer → icp.md
positioning, one-liners, differentiators → positioning.md
product, features, what we build → product.md
competitors, competitive landscape → competitors.md
tone, voice, words we use/avoid → voice.md
anything else → company.md under a ## header
## Exact steps — 2 calls only
1. cat workspace/company/[target].md
2. If the file content is only the stub (title + "_Not yet defined._"), use > to overwrite with the title, a blank line, and your content (no stub). Otherwise use >> to append "
## [topic heading]
[structured content]".
## Confirm
"Noted. Saved to [file]: [one line summary]"
Do not ask a follow-up question. Do not make any other tool calls.`,
  "recall.md": `# /recall [topic]
## What it does
Greps all workspace files for the topic. Returns a clean summary.
## Exact steps
1. grep -ri "[topic]" workspace/company/
2. grep -ri "[topic]" workspace/memory/longterm.md
3. grep -ri "[topic]" workspace/artifacts/
Compile results into clean summary.
## If nothing found
"Nothing on [topic] yet. Tell me about it and use /note to save it."`,
  "learn.md": `# /learn
## What it does
Extracts a reusable insight or pattern from the current conversation. Saves to both longterm.md AND the relevant company file. Complete in 3 tool calls maximum.
## Exact steps
1. Identify the insight or pattern from context
2. echo "[date] | insight | [pattern]" >> workspace/memory/longterm.md
3. echo "
## Insight
[pattern]" >> workspace/company/[relevant].md
## Confirm
"Learned: [one line]. Saved to longterm.md and [file]"`,
  "save.md": `# /save [optional name]
## What it does
Saves the agent's most recent output as a named artifact. 2-3 tool calls max.
## Identify artifact type
email or sequence → workspace/artifacts/sequences/
PRD or spec → workspace/artifacts/prds/
call prep → workspace/artifacts/call-prep/
template → workspace/artifacts/templates/
anything else → workspace/artifacts/
## Exact steps
If name provided in args: use it. If no name: ask once "What should I call this?"
1. Determine folder from type above
2. echo "[content]" > workspace/artifacts/[type]/[name].md
   (> is correct here — new file, not appending)
## Confirm
"Saved to artifacts/[type]/[name].md"`,
  "icp.md": `# /icp
## What it does
Updates workspace/company/icp.md directly. 2 calls: cat then echo >>.`,
  "voice.md": `# /voice
## What it does
Updates workspace/company/voice.md directly. 2 calls: cat then echo >>.`,
  "compete.md": `# /compete
## What it does
Updates workspace/company/competitors.md directly. 2 calls: cat then echo.
If the file still only has the stub "# Competitors" and "_Not yet defined._", use > to overwrite with "# Competitors", a blank line, and the competitor list. Otherwise use >> to append.`,
  "task.md": `# /task
## What it does
Queues a task for the agent. Execute it (load skills if needed, run_bash). Confirm when done.`,
};

export function ensureCommandFiles(root = process.cwd()) {
  const dir = path.join(root, "workspace", "commands");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(COMMAND_BODIES)) {
    fs.writeFileSync(path.join(dir, file), (PATH_RULES + "\n\n" + body).trim(), "utf8");
  }
}
