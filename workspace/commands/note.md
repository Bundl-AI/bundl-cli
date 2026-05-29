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


# /note
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
Do not ask a follow-up question. Do not make any other tool calls.