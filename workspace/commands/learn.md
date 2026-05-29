## Path rules — read first
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


# /learn
## What it does
Extracts a reusable insight or pattern from the current conversation. Saves to both longterm.md AND the relevant company file. Complete in 3 tool calls maximum.
## Exact steps
1. Identify the insight or pattern from context
2. echo "[date] | insight | [pattern]" >> workspace/memory/longterm.md
3. echo "
## Insight
[pattern]" >> workspace/company/[relevant].md
## Confirm
"Learned: [one line]. Saved to longterm.md and [file]"