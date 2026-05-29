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


# /recall [topic]
## What it does
Greps all workspace files for the topic. Returns a clean summary.
## Exact steps
1. grep -ri "[topic]" workspace/company/
2. grep -ri "[topic]" workspace/memory/longterm.md
3. grep -ri "[topic]" workspace/artifacts/
Compile results into clean summary.
## If nothing found
"Nothing on [topic] yet. Tell me about it and use /note to save it."