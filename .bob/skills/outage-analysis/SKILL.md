---
name: outage-analysis
description: Use when the user asks to summarize, analyze, or report on the Outage Analysis Team dashboard from GitHub Projects. Fetches all board items and produces a structured summary.
---

# Outage Analysis Dashboard Summary

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

After saving, read the file using `read_file` tool to load the JSON data. The file contains:
- `projectTitle` — the name of the GitHub Project board
- `totalItems` — total number of items fetched
- `items` — array of normalized board items, each with:
  `title`, `status`, `assignees`, `oaDates`, `outageCategory`, `resiliencyApar`,
  `oaOutcome`, `notes`, `labels`, `issueUrl`, `issueBody`

## Step 3 — Produce the summary

Parse the JSON output and produce a report with the following sections in markdown:

### Header
- Project name and date of this summary
- Total items on the board

### Status Breakdown
Count items by `status` field. Show a table: Status | Count, sorted by count descending.
Highlight any items with no status set ("Unset").

### Top Outage Categories
Count items by `outageCategory`. Show the top 5 as a table: Category | Count.
Also report total uncategorized items (null or empty `outageCategory`).

### Resiliency Analysis Items
List all items where `resiliencyApar` is non-empty OR `labels` includes `"Resiliency Analysis"`.
Show a table: Title | Status | Assignees | OA Dates | Resiliency APAR | Link.
If there are none, say so explicitly.

### Uncategorized Items
List all items with no `outageCategory`. Show a table: Title | Status | Assignees | Link.
For each, suggest a likely category based on keywords in the title (use your judgment — no script needed for this step).

### Key Observations
Write 3–5 bullet points of narrative observations — patterns, anomalies, or anything the team should pay attention to. Go beyond the counts; note things like assignee concentration, stale dates, or clusters of similar issues.
