# Outage Analysis — Bob Skill

A Bob skill that fetches and summarises the Db2 for z/OS team's **Outage Analysis GitHub Project** dashboard directly inside your Bob chat — and as a **GitHub Actions workflow** you can trigger with one click.

---

## What it does

Ask Bob anything like:

> *"Summarise the outage analysis dashboard"*
> *"Give me a report on the OA board"*

Bob will:

1. Fetch all items from the GitHub Project v2 board via GraphQL
2. Break down items by **status** and **outage category**
3. List all **Resiliency Analysis** items
4. Surface **uncategorised** items with suggested categories
5. Write **key observations** — patterns, anomalies, and things to pay attention to

You can also run the same analysis as a **GitHub Actions workflow** from the Actions tab — no Bob required.

---

## Prerequisites

- [Bob](https://github.ibm.com) installed and running in this workspace (for the Bob skill)
- Node.js 18+ on your `PATH`
- A GitHub Personal Access Token with `read:project` scope

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a `.env` file (for local use)

```bash
cp .env.example .env
```

Edit `.env`:

```
PROJECT_TOKEN=ghp_yourTokenHere
PROJECT_ID=PVT_yourProjectIdHere
GITHUB_API_URL=https://github.ibm.com/api/graphql
```

| Variable | Description |
|---|---|
| `PROJECT_TOKEN` | A GitHub PAT with `read:project` scope — create one at https://github.ibm.com/settings/tokens |
| `PROJECT_ID` | The GraphQL node ID of the project board |
| `GITHUB_API_URL` | GitHub Enterprise GraphQL endpoint — defaults to `https://api.github.com/graphql` if omitted |

#### Finding your `PROJECT_ID`

```bash
curl -s \
  -H "Authorization: Bearer YOUR_PAT" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ organization(login: \"YOUR_ORG\") { projectsV2(first: 50) { nodes { id title } } } }"}' \
  https://github.ibm.com/api/graphql
```

---

## GitHub Actions — one-click dashboard

The workflow in [`.github/workflows/outage-analysis.yml`](.github/workflows/outage-analysis.yml) lets anyone on the team generate a fresh report without installing anything locally.

### 3. Add repository secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value |
|---|---|
| `PROJECT_TOKEN` | Your GitHub PAT with `read:project` scope |
| `PROJECT_ID` | The GraphQL node ID of the project board |
| `GITHUB_API_URL` | *(optional)* Your GHE endpoint, e.g. `https://github.ibm.com/api/graphql` |

### 4. Run the workflow

1. Go to your repo → **Actions** tab
2. Select **"Outage Analysis Dashboard"** in the left sidebar
3. Click **"Run workflow"** → choose whether to post a GitHub Issue → click the green **"Run workflow"** button

The workflow will:
- Fetch all board items via GraphQL
- Generate a self-contained HTML report
- Upload it as a **downloadable artifact** (kept for 30 days)
- *(optionally)* Open a new **GitHub Issue** with a markdown summary table

### 5. Download the report

After the run completes, open the workflow run → scroll to **Artifacts** → download **`outage-analysis-report`**.

---

## Local usage (npm scripts)

```bash
# Fetch board data only
npm run fetch

# Generate HTML report from existing project-data.json
npm run report

# Fetch + generate in one step
npm run dashboard
```

The HTML report is written to `outage-analysis-report.html`.

---

## Project structure

```
.github/
  workflows/
    outage-analysis.yml     # GitHub Actions workflow — "Run workflow" button
.bob/
  skills/
    outage-analysis/
      SKILL.md              # Skill definition and instructions for Bob
      fetch-project.js      # Fetches all board items via GitHub GraphQL API
generate-report.js          # Converts project-data.json → self-contained HTML
.env.example                # Template for required environment variables
project-data.json           # Last fetched board data (git-ignored)
outage-analysis-report.html # Last generated HTML report (git-ignored)
```

---

## How it works

### Bob skill
When the skill is activated Bob runs [`fetch-project.js`](.bob/skills/outage-analysis/fetch-project.js) to fetch the board, then reads the JSON and produces a structured markdown report per [`SKILL.md`](.bob/skills/outage-analysis/SKILL.md).

### GitHub Actions
The same [`fetch-project.js`](.bob/skills/outage-analysis/fetch-project.js) runs in the Actions runner using the repo secrets instead of a local `.env`. [`generate-report.js`](generate-report.js) then converts the JSON into a portable HTML file that anyone can open in a browser.
