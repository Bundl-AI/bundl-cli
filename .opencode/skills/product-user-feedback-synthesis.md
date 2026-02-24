---
name: User Feedback Synthesis
description: When a PM needs to synthesize feedback from multiple sources (support, interviews, surveys, NPS comments) into themes. Trigger when feedback_items (array of feedback strings with sources) is provided.
---

# User Feedback Synthesis

You are synthesizing user feedback from multiple sources into themes for a product manager. Your job is to identify 3–5 themes, support each with evidence from the feedback, assess frequency and severity, distinguish signal from noise, and recommend next investigation.

Themes: Group feedback by theme (e.g. "Dark mode / accessibility," "Export and reporting," "Performance"). Each theme should have a short name and 2–4 evidence bullets (direct quotes or close paraphrases from feedback_items). Do not invent feedback; cite what was provided.

Frequency assessment: For each theme, say how often it appeared (e.g. "5 of 12 sources," "Recurring in support and survey"). Use volume_per_source if provided; otherwise infer from the list.

Severity assessment: For each theme, indicate whether it seems high/medium/low impact (e.g. blocking adoption, quality of life, edge case). Consider segment and source (e.g. enterprise blocker vs. nice-to-have from one SMB).

Signal vs. noise: In 2–4 sentences, summarize what appears to be real signal (repeated, multiple segments, or tied to outcomes) vs. one-off or noisy (single mention, vague, or outlier segment). Be honest.

Recommended next investigation: 1–3 concrete next steps (e.g. "Run 2–3 discovery interviews focused on dark mode and accessibility," "Add survey question in Q2 to quantify demand," "Review support tickets for 'export' to confirm scope"). Make it actionable.

Output structure: Themes (3–5 with evidence), Frequency assessment, Severity assessment, Signal vs. noise, Recommended next investigation.


## Required Context
- feedback_items: Array of feedback strings; each can include source in the string or as context

## Optional Context
- time_period: Time period the feedback covers (if absent: Not specified)
- customer_segments_represented: Which segments the feedback comes from (if absent: Unknown)
- volume_per_source: Rough volume per source (e.g. 8 support, 5 interviews, 40 survey) (if absent: Not provided)

## Constraints
- Use only feedback from the provided feedback_items; do not invent quotes or sources.
- Themes must be supported by evidence from the list.
- Signal vs. noise and recommended investigation must be specific to the data.


## Done When
- 3–5 themes with evidence bullets
- Frequency and severity assessment per theme
- Signal vs. noise summary
- 1–3 recommended next investigation steps

## Example Output
THEMES (with evidence)

1. Dark mode / accessibility
- Support #4401: "Customer asked for dark mode; said it's hard on eyes in long sessions."
- Interview (Meridian): "We'd use the product more if we had dark mode and keyboard shortcuts."
- NPS: "Love the product but need dark mode for night shifts."
- Survey: 12 respondents selected "Theme/accessibility options" as top improvement.

2. Keyboard shortcuts / power users
- Interview (Meridian): Same quote as above — paired with dark mode.
- Support #4390: "Power users want shortcuts for report run and export."
- No survey data; 2 support mentions.

3. Export and reporting (secondary in this set)
- Support #4380: "Bulk export to PDF for board meetings." (Also in feature-request triage.)
- Fewer items in this batch; theme is consistent with prior triage.

FREQUENCY ASSESSMENT
- Dark mode: 4+ distinct sources (support, interview, NPS, survey); 12 survey responses. Highest frequency in this batch.
- Keyboard shortcuts: 2 sources; lower volume but often paired with dark mode.
- Export: 1 source in this batch; known from other triage.

SEVERITY ASSESSMENT
- Dark mode: Medium–high. Tied to "use the product more" and "night shifts" (accessibility/work context). Not a single-segment ask.
- Keyboard shortcuts: Medium. Power-user efficiency; likely niche but high value for that segment.
- Export: Already triaged; severity as per feature-request workflow.

SIGNAL VS. NOISE
Dark mode is clear signal: multiple channels, multiple segments, and survey volume. Keyboard shortcuts are partial signal — often mentioned with dark mode but less volume; worth validating. Export is known signal from prior work. No single one-off themes in this batch that look like noise; the smallest theme (shortcuts) still has 2 sources.

RECOMMENDED NEXT INVESTIGATION
1. Add dark mode to roadmap candidate list and run 2–3 discovery interviews to confirm use cases (long sessions, night shifts, accessibility) and scope (full UI vs. key screens).
2. In same interviews, probe keyboard shortcuts: who uses them today (if any), which actions matter most.
3. Add one survey question in Q2: "How important is dark mode / theme options?" (1–5) to quantify demand before committing.

