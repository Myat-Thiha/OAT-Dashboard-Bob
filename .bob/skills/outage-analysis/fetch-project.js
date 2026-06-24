#!/usr/bin/env node
/**
 * fetch-project.js
 *
 * Fetches every item from a GitHub Project v2 board via the GraphQL API and
 * writes a single JSON object to stdout. Bob reads this output to produce the
 * Outage Analysis summary report.
 *
 * The script handles pagination automatically — boards with more than 100 items
 * are fetched in successive pages until all items are collected.
 *
 * Required environment variables (set in the project root .env file):
 *   PROJECT_TOKEN  — GitHub Personal Access Token with `read:project` scope
 *   PROJECT_ID     — GraphQL node ID of the project board (starts with PVT_)
 *
 * Optional environment variables:
 *   GITHUB_API_URL — GraphQL endpoint; defaults to https://api.github.com/graphql
 *                    Set this for GitHub Enterprise (e.g. https://github.ibm.com/api/graphql)
 *
 * Output shape (written to stdout as pretty-printed JSON):
 *   {
 *     projectTitle: string,       // Name of the GitHub Project board
 *     totalItems:   number,       // Total number of items fetched
 *     items:        NormalizedItem[]
 *   }
 *
 * Run directly for local testing:
 *   node .bob/skills/outage-analysis/fetch-project.js > project-data.json
 */

import { existsSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// 1. Environment setup
// ---------------------------------------------------------------------------

// Resolve the project root so we can load .env and dotenv regardless of the
// working directory Bob uses when invoking this script.
const PROJECT_ROOT = "/Users/myatthiha/Documents/OAT_Bob_Analysis";
const envPath = resolve(PROJECT_ROOT, ".env");

// Dynamically load dotenv only when a .env file is present. Using a dynamic
// import with an absolute path avoids relying on Node module resolution from
// the script's own directory.
if (existsSync(envPath)) {
  const { config } = await import(resolve(PROJECT_ROOT, "node_modules/dotenv/lib/main.js"));
  config({ path: envPath });
}

const token   = process.env.PROJECT_TOKEN;
const projectId = process.env.PROJECT_ID;
const apiUrl  = process.env.GHE_API_URL || process.env.GITHUB_API_URL || "https://api.github.com/graphql";

// Fail fast with a helpful message if the required variables are missing.
if (!token || !projectId) {
  console.error(
    "Error: PROJECT_TOKEN and PROJECT_ID environment variables must be set.\n" +
    "  PROJECT_TOKEN — a GitHub PAT with read:project scope\n" +
    "  PROJECT_ID    — the GraphQL node ID of the project\n\n" +
    "Fill in these values in:\n  " + envPath
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. GraphQL query
// ---------------------------------------------------------------------------

// Fetches one page of up to 100 project items. The `$cursor` argument enables
// cursor-based pagination — pass `null` for the first page, then the value of
// `endCursor` from each response for subsequent pages.
//
// `content` is a union type covering Issue, DraftIssue, and PullRequest.
// `fieldValues` returns all custom project fields (text, single-select, user,
// and date types) for each item.
const QUERY = `
query($projectId: ID!, $cursor: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      title
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          content {
          __typename
            ... on Issue {
              title
              url
              body
              state
              assignees(first: 10) { nodes { login } }
              labels(first: 10) { nodes { name } }
            }
            ... on DraftIssue {
              title
              body
            }
            ... on PullRequest {
              title
              url
              body
              state
              assignees(first: 10) { nodes { login } }
              labels(first: 10) { nodes { name } }
            }
          }
          fieldValues(first: 30) {
            nodes {
              ... on ProjectV2ItemFieldTextValue {
                text
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldUserValue {
                users(first: 5) { nodes { login } }
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldLabelValue {
                labels(first: 20) { nodes { name } }
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
        }
      }
    }
  }
}`;

// ---------------------------------------------------------------------------
// 3. API helper
// ---------------------------------------------------------------------------

/**
 * Executes the GraphQL query against the GitHub API with the given variables.
 *
 * @param {{ projectId: string, cursor: string | null }} variables
 * @returns {Promise<object>} The `data` portion of the GraphQL response.
 * @throws {Error} On HTTP errors or if the response contains GraphQL errors.
 */
async function graphql(variables) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "outage-analysis-bob-skill",
    },
    body: JSON.stringify({ query: QUERY, variables }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API returned HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors, null, 2)}`);
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// 4. Item normalisation
// ---------------------------------------------------------------------------

/**
 * Converts a raw GraphQL project item node into a flat, predictable object.
 *
 * Custom project field values arrive as a heterogeneous array of typed nodes.
 * This function first flattens them into a plain `{ fieldName: value }` map,
 * then picks out the OA-specific fields by their known column names.
 *
 * Item types:
 *   "issue"        — a linked GitHub Issue (has a URL)
 *   "pull_request" — a linked GitHub Pull Request (has a URL)
 *   "draft"        — a Draft Issue or field-only row (no URL)
 *
 * @param {object} node - A raw item node from the GraphQL response.
 * @returns {{
 *   type:            "issue" | "pull_request" | "draft",
 *   title:           string,
 *   status:          string | null,
 *   assignees:       string | null,
 *   oaAssignees:     string | null,
 *   oaDates:         string | null,
 *   outageCategory:  string | null,
 *   resiliencyApar:  string | null,
 *   oaOutcome:       string | null,
 *   notes:           string | null,
 *   labels:          string[],
 *   issueUrl:        string | null,
 *   issueBody:       string | null,
 * }}
 */
function normalizeItem(node) {
  // Flatten all field values into a plain object keyed by field name.
  const fields = {};
  for (const fv of node.fieldValues?.nodes ?? []) {
    const fieldName = fv.field?.name;
    if (!fieldName) continue; // skip system fields with no name

    if      (fv.text  !== undefined) fields[fieldName] = fv.text;
    else if (fv.name  !== undefined) fields[fieldName] = fv.name;
    else if (fv.date  !== undefined) fields[fieldName] = fv.date;
    else if (fv.users  !== undefined)
      // Collapse multiple assignees into a comma-separated string.
      fields[fieldName] = fv.users.nodes.map((u) => u.login).join(", ");
    else if (fv.labels !== undefined)
      // Collapse project-board label values into a comma-separated string
      // stored under the field name so it can be picked up below.
      fields[fieldName] = fv.labels.nodes.map((l) => l.name);
  }

  // `content` is null for pure field-only rows; default to an empty object so
  // all property accesses below are safe without extra null checks.
  const content = node.content ?? {};

  return {
    // Derive the item type from whether a URL is present (drafts never have one).
    type:           content.url
                      ? (content.__typename === "PullRequest" ? "pull_request" : "issue")
                      : "draft",
    issueState:     content.state?.toLowerCase() ?? null,
    // Prefer the content title; fall back to the "Title" project field for drafts.
    title:          content.title ?? fields["Title"] ?? "(no title)",
    status:         fields["Status"]          ?? null,
    // GitHub issue/PR assignees from the content union; falls back to the
    // board's synced "Assignees" user field (which mirrors the same data).
    assignees:      content.assignees?.nodes?.map((u) => u.login).join(", ")
                      ?? fields["Assignees"]  ?? null,
    // Separate "OA Assignees" custom text column on the project board.
    oaAssignees:    fields["OA Assignees"]    ?? null,
    oaDates:        fields["OA Date"]         ?? null,
    outageCategory: fields["Outage Category"] ?? null,
    resiliencyApar: fields["Resiliency APAR"] ?? null,
    oaOutcome:      fields["OA Outcome"]      ?? null,
    notes:          fields["Notes"]           ?? null,
    labels:         fields["Labels"] ?? content.labels?.nodes?.map((l) => l.name) ?? [],
    issueUrl:       content.url               ?? null,
    issueBody:      content.body              ?? null,
  };
}

// ---------------------------------------------------------------------------
// 5. Main — paginate and emit
// ---------------------------------------------------------------------------

/**
 * Entry point. Pages through all project items, normalises each one, and
 * writes the full result as a JSON object to stdout.
 */
async function main() {
  const items = [];
  let cursor = null;       // null on the first request; set to endCursor for each subsequent page
  let projectTitle = null; // captured from the first page response

  // Paginate until `hasNextPage` is false (cursor becomes null).
  do {
    const data = await graphql({ projectId, cursor });
    const project = data.node;

    // Capture the board title once from the first page.
    if (!projectTitle) projectTitle = project.title;

    const page = project.items;
    for (const node of page.nodes) {
      items.push(normalizeItem(node));
    }

    // Advance the cursor, or set it to null to stop the loop.
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  // Write the complete result to stdout for Bob to read.
  console.log(JSON.stringify({ projectTitle, totalItems: items.length, items }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
