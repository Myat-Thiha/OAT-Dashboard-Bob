---
name: outage-analysis-dev
description: Use when the user asks to generate a developer-focused outage analysis report from the GitHub Projects board. Produces the full-detail report: all items, notes, uncategorized items, year/month breakdown, and drilldown modals.
---

# Outage Analysis Dashboard — Developer Report

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

Run the developer report generator script using `execute_command`:

```
node /Users/myatthiha/Documents/OAT_Bob_Analysis/generate-report-dev.js \
  --input /Users/myatthiha/Documents/OAT_Bob_Analysis/project-data.json \
  --output /Users/myatthiha/Documents/OAT_Bob_Analysis/db2z-outage-analysis-dev-report.html
```

The script produces a fully self-contained HTML file. It includes all sections:
- KPI summary, Status Breakdown, Activity by Year & Month, Top Outage Categories,
  Resiliency Analysis Items, All Items by OA Date, Uncategorized Items with Suggested Categories,
  and Key Observations.

If the script exits with an error, show the message to the user and stop.

After the script succeeds, tell the user the report has been written to `db2z-outage-analysis-dev-report.html` and they can open it directly. Do **not** read the HTML file back into context or pass it to `create_html_artifact`.

---

## Follow-up Q&A mode

After delivering the report, **stay in analyst mode**. The user may ask follow-up questions at any time. Answer them using the `project-data.json` already loaded in context — do **not** re-run the fetch script unless the user says something like "refresh", "re-fetch", or "get latest data".

### When to re-fetch vs reuse

| User says… | Action |
|---|---|
| "refresh", "re-fetch", "get latest", "update the data" | Re-run Steps 1–3 fully |
| Any analysis or question | Answer from the data already in context |

### Data already in context

After Step 2, you have the full `items` array in context. Each item has:
`title`, `status`, `assignees`, `oaDates`, `outageCategory`, `resiliencyApar`, `oaOutcome`, `notes`, `labels`, `issueUrl`, `issueBody`

If the data was loaded in a previous turn and is no longer in context, re-read `project-data.json` using `read_file` before answering — do not guess or hallucinate.

---

## Follow-up question patterns

### Category recommendations for uncategorized items

When the user asks for category suggestions (e.g. "what category should this be?", "suggest categories for uncategorized outages"):

1. Read `project-data.json` if not already in context
2. Filter items where `outageCategory` is null or empty
3. For each item, infer a category from keywords in `title`, `notes`, and `issueBody`
4. Present a table: **Title | Suggested Category | Reasoning | Link**
5. If the user wants to apply the suggestions, remind them to update the GitHub Project board directly — Bob cannot write back to GitHub Projects

**Category taxonomy to use** (match the existing values in the board; suggest new ones only if nothing fits):
- Hang / Deadlock
- Crash / Abend
- Performance / Slow
- Connectivity / Network
- Replication
- Backup / Recovery
- Security / Auth
- Storage / Disk
- Configuration
- Upgrade / Migration
- Operational / Other

---

### Assignee analysis

When the user asks about assignees, workload, or who owns what:

1. Tally items per assignee (use `assignees` field; fall back to `oaAssignees`)
2. Highlight anyone carrying a disproportionate share
3. Identify items with **no assignee** — these are a workload risk
4. Present: **Assignee | Open items | Done items | Has Resiliency APAR**

---

### Stale / overdue items

When the user asks about stale, old, or stuck items:

1. Filter items where `status` is NOT "Done"
2. Sort by `oaDates` ascending (oldest first); items without a date come last
3. Flag items older than 6 months as stale
4. Present: **Title | Status | OA Date | Assignees | Days open (approx.) | Link**

---

### Resiliency APAR tracking

When the user asks about APARs, resiliency items, or open defects:

1. Filter items where `resiliencyApar` is non-empty OR `labels` includes `"Resiliency Analysis"`
2. Group by APAR number if multiple items share the same APAR
3. Present: **APAR | Title(s) | Status | Assignees | OA Date | Link**
4. Note any APARs that appear on multiple items — these may indicate recurring issues

---

### Trend analysis

When the user asks about trends, patterns over time, or year/month breakdowns:

1. Group items by `oaDates` (year + month)
2. Count items per period and note spikes
3. Cross-reference with `outageCategory` to see if a category drove a spike
4. Describe the pattern in prose + a compact table: **Period | Count | Top category that month**

---

### Custom filters / ad-hoc queries

When the user asks something like "show me all items assigned to X", "find items with no OA date", "list Done items in category Y":

1. Apply the filter directly against the `items` array in context
2. Return the matching items as a table appropriate to the question
3. If the result is large (>20 rows), summarise first and offer to show the full list

---

### Regenerating the report

If the user asks to regenerate or update the report after follow-up changes:

Re-run Step 3 only. No need to re-fetch from GitHub unless the user asks for fresh data.

```
node /Users/myatthiha/Documents/OAT_Bob_Analysis/generate-report-dev.js \
  --input /Users/myatthiha/Documents/OAT_Bob_Analysis/project-data.json \
  --output /Users/myatthiha/Documents/OAT_Bob_Analysis/db2z-outage-analysis-dev-report.html
```

---

## Supporting files in this skill directory:
- Uses fetch-project.js from `.bob/skills/outage-analysis/`
