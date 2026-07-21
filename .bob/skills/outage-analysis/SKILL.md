---
name: outage-analysis
description: Use when the user asks to summarize, analyze, or report on the Outage Analysis Team dashboard from GitHub Projects. Produces an executive leadership summary: big-number KPIs, completion rate gauge, category bar chart, APAR snapshot, and plain-language executive summary bullets — no item-level detail.
---

# Outage Analysis Dashboard — Leadership Summary

Follow these steps exactly each time this skill is activated.

## Step 1 — Check prerequisites

Before fetching, source the `.env` file from the workspace root (if it exists) and verify the required environment variables are set. Run:

```
[ -f /Users/myatthiha/Documents/OAT_Bob_Analysis/.env ] && export $(grep -v '^#' /Users/myatthiha/Documents/OAT_Bob_Analysis/.env | grep -v '^$' | xargs) ; echo "PROJECT_TOKEN is ${PROJECT_TOKEN:+set} ${PROJECT_TOKEN:-NOT SET}" && echo "PROJECT_ID is ${PROJECT_ID:+set} ${PROJECT_ID:-NOT SET}"
```

Use `execute_command` to run this. If either variable is NOT SET, stop and tell the user:

> To use this skill, create a `.env` file in the workspace root with:
>
> ```
> PROJECT_TOKEN=ghp_yourTokenHere
> PROJECT_ID=PVT_yourProjectIdHere
> ```
>
> - `PROJECT_TOKEN` — a GitHub Personal Access Token with `read:project` scope (create at github.com/settings/tokens)
> - `PROJECT_ID` — the GraphQL node ID of your project board, found by running:
>   `gh project list --owner <your-org>`
>
> Save the file and re-run the skill — no terminal exports needed.

## Step 2 — Fetch and save the project data

Run the fetch script and save the output to a local file using `execute_command`:

```
node /Users/myatthiha/Documents/OAT_Bob_Analysis/.bob/skills/outage-analysis/fetch-project.js > /Users/myatthiha/Documents/OAT_Bob_Analysis/project-data.json
```

This saves the fetched data to `project-data.json` in the project root directory.

If the script exits with an error, show the error message to the user and stop.

After saving, read the file using `read_file` tool to load the JSON data into context. The file contains:
- `projectTitle` — the name of the GitHub Project board
- `totalItems` — total number of items fetched
- `items` — array of normalized board items, each with:
  `title`, `status`, `assignees`, `oaDates`, `outageCategory`, `resiliencyApar`,
  `oaOutcome`, `notes`, `labels`, `issueUrl`, `issueBody`

**Keep this data in mind for the rest of the conversation.** Once loaded, you do not need to re-fetch unless the user explicitly asks for fresh data.

## Step 3 — Generate the HTML report

Run the leadership report generator script using `execute_command`:

```
node /Users/myatthiha/Documents/OAT_Bob_Analysis/generate-report-leadership.js \
  --input /Users/myatthiha/Documents/OAT_Bob_Analysis/project-data.json \
  --output /Users/myatthiha/Documents/OAT_Bob_Analysis/db2z-outage-analysis-leadership-report.html
```

The script produces a fully self-contained HTML file. It includes:
- KPI tiles: Total items, Resolved, Followup Required, In Progress
- Completion rate gauge (SVG donut)
- Top category horizontal bar chart (SVG, no external assets)
- Resiliency APAR snapshot: items count + distinct APAR count
- Executive Summary: up to 5 plain-language insight bullets

No item-level tables, drilldowns, or engineering detail — this is a leadership-level one-pager.

If the script exits with an error, show the message to the user and stop.

After the script succeeds, tell the user the report has been written to `db2z-outage-analysis-leadership-report.html` and they can open it directly. Do **not** read the HTML file back into context.

---

## Follow-up Q&A mode

After delivering the report, stay available for follow-up questions. Answer using the `project-data.json` already in context — do **not** re-run the fetch script unless the user says "refresh", "re-fetch", or "get latest data".

### When to re-fetch vs reuse

| User says… | Action |
|---|---|
| "refresh", "re-fetch", "get latest", "update the data" | Re-run Steps 1–3 fully |
| Any analysis or question | Answer from the data already in context |

---

## Follow-up question patterns

### High-level metric questions

When the user asks "what's our completion rate?", "how many are still open?", "what's the top failure type?":
- Answer directly from aggregated counts (byStatus, byCategory) already in context
- Keep answers to 1–3 sentences — this is a leadership audience

### Resiliency APAR questions

When the user asks about APARs or resiliency filings:
1. Count items where `resiliencyApar` is non-empty or `labels` includes "Resiliency Analysis"
2. Summarise distinct APAR numbers and their associated statuses
3. Keep to a brief paragraph — no item tables

### Trend questions

When the user asks "are things getting better?", "how does this year compare to last?":
1. Group items by `oaDates` year
2. Report year-over-year item counts and resolved percentages
3. Note any notable spikes or improvements in plain language

### Regenerating the report

Re-run Step 3 only. No need to re-fetch unless the user asks for fresh data.

```
node /Users/myatthiha/Documents/OAT_Bob_Analysis/generate-report-leadership.js \
  --input /Users/myatthiha/Documents/OAT_Bob_Analysis/project-data.json \
  --output /Users/myatthiha/Documents/OAT_Bob_Analysis/db2z-outage-analysis-leadership-report.html
```

---

## Supporting files in this skill directory:
- fetch-project.js — fetches all project items from GitHub Projects GraphQL API
- Report generator: `generate-report-leadership.js`
