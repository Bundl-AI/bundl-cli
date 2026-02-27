# bundl - Bundl CLI

**The open corpus standard for AI employees.**

Give your autonomous agents your company's playbook. One corpus. Every agent. Every team member.

[![npm version](https://img.shields.io/npm/v/@bundl-corp/cli)](https://www.npmjs.com/package/@bundl-corp/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-supported-black)](https://claude.ai/code)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-supported-black)](#)
[![OpenCode](https://img.shields.io/badge/OpenCode-supported-black)](#)
[![Cursor](https://img.shields.io/badge/Cursor-supported-black)](#)

---

[Docs](#-how-it-works) · [Role Library](#-role-library) · [Agent Runtimes](#-agent-runtimes) · [Team Features](#-team-features) · [Contributing](#-contributing)

---

> **Starring this repo helps more engineers discover Bundl** ⭐

---

## ⚡ Quick Start

```bash
npm install -g @bundl-corp/cli
bundl init
```

That's it. In under 3 minutes your Claude Code or OpenClaw agent knows your ICP, your escalation rules, your communication style, and how your company works.

```
    __                  _ __
   / /_  __  ______  ____/ / /
  / __ \/ / / / __ \/ __  / /
 / /_/ / /_/ / / / / /_/ / /___
/_.___/\__,_/_/ /_/\__,_/_____/

  The open corpus standard for AI employees.
  v0.1.0
  ─────────────────────────────────────────

? What role are you building for?  Sales Development Rep
? What industry?  B2B SaaS
? What tools does this role use?  Salesforce, Gmail, LinkedIn

✔ Using your AI provider for generation

  ⠋ lead-qualification
  ✓ lead-qualification
  ✓ outreach-personalization
  ✓ objection-handling
  ✓ pre-call-research-brief
  ✓ deal-summary-next-steps

✔ 5 skills generated in .bundl/corpus/
✔ Deployed to .claude/skills/

  Your Claude Code agent knows how your company works.
  Restart Claude Code to apply.
```

---

## The Problem

Your AI agent does almost the right thing.

It follows generic instructions, not yours. Your best AI user spent months figuring out exactly how to prompt for great output at your company — the right ICP criteria, the right escalation logic, the right output format. When they left, that methodology left with them.

Every agent you deploy starts from zero. Every engineer on your team has different rules. There's no standard. There's no institutional memory.

**Bundl fixes this.** Define how your company works once. Every agent, every surface, every team member follows the same playbook — permanently.

---

## 🛠 How It Works

**1. Generate** — `bundl init` asks you a few questions and generates a structured corpus for your role using your own Claude or OpenAI instance. No API key sent anywhere except directly to the provider.

**2. Validate** — `bundl validate` checks every skill against the schema. Catches missing required fields, undefined variables, empty escalation rules. CI-safe with exit codes and `--json` flag.

**3. Simulate** — `bundl simulate` runs an actual skill against real test inputs using your AI. Not a mock engine — the real LLM executes the real skill. Save scenarios as regression tests.

**4. Deploy** — `bundl deploy` compiles your corpus to the format your agent runtime understands. `CLAUDE.md` + `.claude/skills/` for Claude Code. `openclaw-agent.json` for OpenClaw. Always-on context split from on-demand skills automatically.

---

## 📚 Role Library

15 production-ready skill templates across 3 roles. Customized to your company during `bundl init`.

| Role | Skill | Type |
|------|-------|------|
| **Sales** | Lead Qualification | Workflow |
| | Outreach Personalization | Workflow |
| | Objection Handling | Workflow |
| | **Pre-Call Research Brief** | Document |
| | Deal Summary & Next Steps | Document |
| **Customer Success** | Health Score Assessment | Workflow |
| | Onboarding Milestone Check | Workflow |
| | **Escalation Summary** | Document |
| | QBR Preparation | Document |
| | Churn Risk Response | Workflow |
| **Product** | Feature Request Triage | Workflow |
| | User Feedback Synthesis | Workflow |
| | **PRD First Draft** | Document |
| | Sprint Review Summary | Document |
| | Competitive Feature Analysis | Workflow |

**Document skills** produce polished, ready-to-use artifacts — briefs, summaries, and reports that a human would send as-is. [Contribute a role →](#-contributing)

---

## 🤖 Agent Runtimes

Bundl compiles your corpus to every agent runtime your team uses.

| Runtime | Command | Output |
|---------|---------|--------|
| **Claude Code** | `bundl deploy --target claude-code` | `CLAUDE.md` + `.claude/skills/` |
| **OpenClaw** | `bundl deploy --target openclaw` | `openclaw-agent.json` |
| **OpenCode** | `bundl deploy --target opencode` | `.opencode/skills/` |
| **Cursor** | `bundl deploy --target cursor` | `.cursor/rules/` |
| **All** | `bundl deploy --target all` | All of the above |

### Claude Code

Bundl splits your corpus intelligently:
- **Always-on** (`CLAUDE.md`) — hard constraints, agent identity, communication style
- **On-demand** (`.claude/skills/`) — workflows loaded only when relevant to the task

Context window efficiency built in. Skills not relevant to the current task never load.

```bash
bundl init --role sdr --target claude-code
# → CLAUDE.md updated with constraints
# → .claude/skills/lead-qualification.md
# → .claude/skills/outreach-personalization.md
# → .claude/skills/pre-call-research-brief.md
```

### OpenClaw

Built for autonomous, hands-off agent operation. The corpus is what makes running an agent unattended trustworthy. Bundl compiles your constraints as hard stops and your handoff conditions as explicit escalation rules.

```bash
bundl deploy --target openclaw
# → openclaw-agent.json with hard stops, escalation paths, success criteria
```

### Let the agent manage its own corpus

Add this to your `CLAUDE.md` and Claude Code will manage the Bundl corpus autonomously:

```markdown
You have access to the bundl CLI. Use it to:
- Check corpus health: bundl status --json
- Validate changes: bundl validate --json
- Test behavior: bundl simulate --all --json
- Deploy updates: bundl deploy --target claude-code

When asked to modify agent behavior, edit .bundl/corpus/ files.
Always run bundl simulate --all before deploying changes.
```

---

## 🔑 AI Providers

Bundl uses your existing AI credentials. Nothing goes through Bundl servers.

| Provider | How to use |
|----------|-----------|
| **Claude Code** | Install Claude Code — detected automatically |
| **Anthropic API** | `export ANTHROPIC_API_KEY=sk-ant-...` |
| **OpenAI API** | `export OPENAI_API_KEY=sk-...` |

Your API key is used only for local inference calls directly to the provider. It is never written to disk by Bundl and never sent to bundl.ai. [See Privacy →](#-privacy)

---

## 👥 Team Features

```
bundl push
```

> 🚧 **Coming soon.** Team workspace sync, browser extension, and dashboard are in active development.
>
> [Learn more at bundl.ai →](https://bundl.ai/company)

When available, `bundl push` will sync your corpus to a shared team workspace — keeping every agent, every extension, and every team member on the same playbook automatically.

---

## 📋 Commands

| Command | Description |
|---------|-------------|
| `bundl init` | Generate a corpus for your role using your AI |
| `bundl validate` | Check corpus against schema — local, offline, CI-safe |
| `bundl simulate` | Run a skill against real inputs using your AI |
| `bundl simulate --all` | Run all saved scenarios — use in CI as regression gate |
| `bundl deploy --target <runtime>` | Compile corpus to agent runtime format |
| `bundl status` | Show corpus health, deployed targets, workspace state |
| `bundl push` | *(Coming soon)* Sync to team workspace |

Global flags: `--json` · `--ci` · `--silent` · `--no-ai`

---

## 🔒 Privacy

- **Your API keys never leave your machine.** Used only for direct calls to Anthropic or OpenAI — Bundl is never in the middle.
- **Keys are never written to disk by Bundl.** Read from environment variables only.
- **`bundl validate` and `bundl deploy` work fully offline.** No network required.
- **Only your corpus YAML is synced to bundl.ai** (when `bundl push` is available), never your credentials.

---

## 🤝 Contributing

The easiest way to contribute is to add a role template.

**Quality bar for role templates:**
- `trigger_description` must be specific enough for an agent to know exactly when to load it
- `example_output` must be a real, detailed example — not a template with brackets
- Optional inputs must each have a `fallback` field
- Document type skills must produce output a human would use without rewriting

```bash
git clone https://github.com/bundl-ai/bundl-cli
cd bundl-cli
npm install
npm link
bundl --version
```

**Good first issues:**
- Add a new role template (Engineering Manager, Marketing Manager, Financial Analyst)
- Improve an existing skill's `example_output` quality
- Add a new deploy target
- Improve error messages in `bundl validate`

[View open issues →](https://github.com/bundl-ai/bundl-cli/issues) · [Read CONTRIBUTING.md →](CONTRIBUTING.md)

---

## Community

- 🐦 [Twitter / X](https://x.com/bundlprompts)
- 💬 [Discord](#) *(coming soon)*
- 🌐 [bundl.ai](https://bundl.ai)
- 📦 [npm](https://www.npmjs.com/package/@bundl-corp/cli)

---

## License

MIT © [Bundl AI](https://bundl.ai)

---

> **Built on the [Agent Skills](https://docs.anthropic.com/agent-skills) standard.** Bundl outputs valid Agent Skills format — compatible with any runtime that supports it.
