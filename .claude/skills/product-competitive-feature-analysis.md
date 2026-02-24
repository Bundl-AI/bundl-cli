---
name: Competitive Feature Analysis
description: When a competitor has announced or shipped a feature and the PM needs to analyze impact and response. Trigger when competitor_name and feature_description are provided.
---

# Competitive Feature Analysis

You are analyzing a competitor feature announcement for a product manager. Your job is to summarize what they shipped, compare to our capability, identify which customers might care, suggest customer talking points, and recommend a response: IGNORE, MONITOR, ACCELERATE, or COUNTER-MESSAGE — with reasoning.

Output structure:
1. WHAT THEY SHIPPED — 2–4 sentences summarizing the feature(s) from feature_description. Be accurate; do not overstate or understate. If source_url is provided, note it.

2. GAP ANALYSIS VS. OUR CAPABILITY — Where we stand relative to what they did. Use our_current_capability. Bullet list: what we have, what we lack, and what is parity or better. Be honest (e.g. "We have bulk PDF; they added Excel and scheduling — we have scheduling for single report but not bulk.").

3. WHICH CUSTOMERS MIGHT CARE — Segments or use cases most likely to be influenced (e.g. "Enterprise deal with board reporting needs," "Customers evaluating us vs. them in RFP"). Use affected_customer_segments if provided.

4. CUSTOMER TALKING POINTS — 2–4 short points our sales or CS can use when the competitor is mentioned (e.g. "We shipped bulk PDF in Q2; we're focused on depth of reporting quality, not checklist breadth," "Our implementation works with your existing permissions and audit requirements"). Do not bad-mouth the competitor; focus on our strengths and fit.

5. RECOMMENDED RESPONSE — One of: IGNORE (not material), MONITOR (watch; no immediate action), ACCELERATE (prioritize roadmap or messaging), COUNTER-MESSAGE (active messaging or enablement). Then 2–3 sentences of reasoning (e.g. "ACCELERATE — We have bulk PDF but lack Excel bulk and bulk scheduling; 2 deals cited this. Recommend: add Excel bulk to roadmap for next quarter and arm sales with one-pager.").

Be specific and actionable. No generic competitive fluff.


## Required Context
- competitor_name: Name of the competitor (company or product)
- feature_description: What they announced or shipped (as known from announcement, release notes, or sales)

## Optional Context
- our_current_capability: Our current capability in this area (if absent: Assess from product knowledge; state assumptions)
- affected_customer_segments: Which customer segments or deals might care (if absent: All segments potentially; clarify in competitive win/loss)
- source_url: Link to announcement or source (if absent: Not provided)

## Constraints
- Use only provided inputs; do not invent competitor features or our capability.
- Recommended response must be one of IGNORE, MONITOR, ACCELERATE, COUNTER-MESSAGE with clear reasoning.
- Customer talking points must be usable by sales/CS; no competitor bashing.


## Done When
- What they shipped, gap analysis, which customers might care, talking points, and recommended response all present
- Recommended response is one of the four options with reasoning
- Customer talking points are 2–4 and actionable

## Example Output
WHAT THEY SHIPPED
DataFlow Pro announced a "Reporting Suite" update that includes native bulk export of reports to both PDF and Excel, with optional scheduling (e.g. send a bulk export on a schedule). The feature is available on their Enterprise plan. Source: blog post (source_url if provided).

GAP ANALYSIS VS. OUR CAPABILITY
- We have: Single-report PDF export, scheduled reports (single report per schedule), and we just shipped bulk export to PDF (up to 25 reports) last sprint.
- We lack: Bulk export to Excel. Scheduled bulk export (they can schedule "send me these 10 reports as PDF/Excel every Monday").
- Parity/better: Our bulk PDF is live; we don't know their limits or performance. Our permissions model is consistent across export; worth highlighting in deals.

WHICH CUSTOMERS MIGHT CARE
Enterprise and mid-market customers, especially ops/finance and regulated industries, who compile report packs and want automation (scheduled bulk). Any deal where DataFlow is in the RFP or where "export" or "reporting" is a key evaluation criterion. Affected segments: enterprise and mid-market; ops/finance and compliance use cases.

CUSTOMER TALKING POINTS
- "We ship bulk export to PDF and have for [timeframe]. We focused on getting the core workflow right and on permissions and auditability — which matters in regulated environments."
- "Bulk Excel is on our roadmap; we're happy to share timing in a roadmap discussion. For PDF report packs, we're there today."
- "Our scheduling works today for single reports; we're looking at scheduled bulk based on customer demand. If that's critical for you, we can discuss timeline."
- Do not say "they're behind" or "we're better"; focus on our fit and roadmap.

RECOMMENDED RESPONSE: ACCELERATE
We have bulk PDF but lack bulk Excel and scheduled bulk. Two recent deals cited "bulk and scheduling" as a comparison point. Recommend: (1) Add bulk Excel to roadmap for next quarter if not already; (2) Create a one-pager for sales on "Reporting & Export — us vs. DataFlow" with the talking points above; (3) If we see 2–3 more deals or renewals where this is a factor, consider accelerating scheduled bulk export. Do not counter-message aggressively until we have parity or a clear differentiator; "we're focused on depth and compliance" is enough for now.

