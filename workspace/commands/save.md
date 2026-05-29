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


# /save [optional name]
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
"Saved to artifacts/[type]/[name].md"