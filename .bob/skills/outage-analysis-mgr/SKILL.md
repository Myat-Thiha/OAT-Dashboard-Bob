---
name: outage-analysis-mgr
description: Use when the user asks to generate a manager-focused outage analysis report or manager summary from the GitHub Projects board. Produces a concise report with KPIs, status breakdown, category distribution, APAR grouping, and key observations — no item-level tables.
---

# Outage Analysis Dashboard — Manager Report

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
- `items` — array of normalized board items

**Keep this data in mind for the rest of the conversation.** Once loaded, you do not need to re-fetch unless the user explicitly asks for fresh data.

## Step 3 — Generate the HTML report

Run the manager report generator script using `execute_command`:

```
node /Users/myatthiha/Documents/OAT_Bob_Analysis/generate-report-mgr.js \
  --input /Users/myatthiha/Documents/OAT_Bob_Analysis/project-data.json \
  --output /Users/myatthiha/Documents/OAT_Bob_Analysis/db2z-outage-analysis-mgr-report.html
```

The script produces a fully self-contained HTML file at the path above. It includes:
- KPI summary tiles (Total, Done, Followup Required, Assigned, Resiliency APARs)
- Status Breakdown with distribution bars
- Top Outage Categories with distribution bars
- Resiliency APARs grouped by APAR number
- Key Observations

No item-level tables or drilldown links are included — this is a summary view for team management.

If the script exits with an error, show the message to the user and stop.

After the script succeeds, tell the user the report has been written to `db2z-outage-analysis-mgr-report.html` and they can open it directly. Do **not** read the HTML file back into context.

---

## Follow-up Q&A mode

After delivering the report, stay available for follow-up questions. Answer using the `project-data.json` already in context. Do **not** re-run the fetch script unless the user asks for fresh data.

### When to re-fetch vs reuse

| User says… | Action |
|---|---|
| "refresh", "re-fetch", "get latest", "update the data" | Re-run Steps 1–3 fully |
| Any analysis or question | Answer from the data already in context |

---

## Follow-up question patterns

### Workload and assignee overview

When the user asks about team workload, assignee distribution, or who owns what:

1. Tally open items per assignee from the `items` array
2. Flag anyone with a disproportionate share or items with no assignee
3. Present a compact summary: **Assignee | Open | Done | Resiliency APAR**

---

### APAR and resiliency status

When the user asks for a status update on resiliency APARs:

1. Filter items where `resiliencyApar` is non-empty or `labels` includes "Resiliency Analysis"
2. Group by APAR number
3. Summarise: **APAR | Item count | Statuses | Categories**

---

### Category or status deep-dive

When the user asks "how many items are in category X" or "show me all Followup Required":

1. Filter from the `items` array in context
2. Return a compact summary table (title, status, date, assignee)
3. If >15 rows, summarise first and offer the full list

---

### Regenerating the report

Re-run Step 3 only. No need to re-fetch unless the user requests fresh data.

```
node /Users/myatthiha/Documents/OAT_Bob_Analysis/generate-report-mgr.js \
  --input /Users/myatthiha/Documents/OAT_Bob_Analysis/project-data.json \
  --output /Users/myatthiha/Documents/OAT_Bob_Analysis/db2z-outage-analysis-mgr-report.html
```

---

## Supporting files
- Uses fetch-project.js from `.bob/skills/outage-analysis/`
- Report generator: `generate-report-mgr.js`
