# Bundl Corpus Schema

The corpus schema defines how AI agent instructions are structured for Bundl. Each corpus entry describes one workflow, document, or constraint that agents (Claude Code, OpenClaw, OpenCode, Cursor) can use.

## Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for this corpus entry |
| `name` | string | Human-readable name |
| `role` | string | Role (e.g. sales, customer-success, product) |
| `category` | string | Category within the role |
| `version` | string | Semver version |
| `type` | enum | `workflow` \| `document` \| `constraint` |
| `load` | enum | `always` \| `on-demand` |
| `trigger_description` | string | When this corpus is used |
| `inputs` | object | Required and optional inputs (see below) |
| `system_prompt` | string | System prompt for the agent |
| `example_output` | string | Example of expected output |
| `tools` | string[] | Tool names the agent may use |
| `constraints` | string[] | Constraints on behavior |
| `handoff` | object | Escalation/handoff rules (see below) |
| `success_criteria` | string[] | Criteria for success |
| `surfaces` | object | `human` and `agent` booleans |

## Inputs

- **required**: array of `InputField`. Each has:
  - `name`, `description`, `example`
  - `source`: `{ agent: string, human: string }` (how the agent vs human refers to it)
- **optional**: array of `InputField`; each may include **fallback** for when the input is missing.

## Handoff

- **conditions**: string[] — when to escalate
- **escalate_to**: string — target corpus or role
- **handoff_message**: string — message for the handoff

## Surfaces

- **human**: boolean — visible to humans
- **agent**: boolean — visible to the agent

## JSON Schema

A machine-readable JSON Schema is generated from the Zod definitions and stored at `src/schema/corpus.json`. Regenerate it with:

```bash
npm run schema:generate
```

## TypeScript types

Types are exported from `src/schema/corpus.ts`: `Corpus`, `InputField`, `Handoff`, `Surfaces`, etc.
