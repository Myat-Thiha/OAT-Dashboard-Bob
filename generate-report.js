#!/usr/bin/env node
/**
 * generate-report.js
 *
 * Reads project-data.json (produced by fetch-project.js) and writes a
 * self-contained HTML report to outage-analysis-report.html.
 *
 * Usage:
 *   node generate-report.js
 *   node generate-report.js --input project-data.json --output my-report.html
 */

import { readFileSync, writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const inputPath  = args[args.indexOf("--input")  + 1] || "project-data.json";
const outputPath = args[args.indexOf("--output") + 1] || "outage-analysis-report.html";

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------
let data;
try {
  data = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (e) {
  console.error(`Failed to read ${inputPath}: ${e.message}`);
  process.exit(1);
}

const { projectTitle, totalItems, items } = data;
const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

// Status breakdown
const byStatus = {};
for (const item of items) {
  const s = item.status || "Unset";
  byStatus[s] = (byStatus[s] || 0) + 1;
}
const statusEntries = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);

// Outage category breakdown
const byCategory = {};
for (const item of items) {
  const c = item.outageCategory || "(Uncategorized)";
  byCategory[c] = (byCategory[c] || 0) + 1;
}
const topCategories = Object.entries(byCategory)
  .filter(([c]) => c !== "(Uncategorized)")
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);
const uncategorizedCount = byCategory["(Uncategorized)"] || 0;

// Resiliency Analysis items
const resiliencyItems = items.filter(
  (i) => i.resiliencyApar || (i.labels || []).includes("Resiliency Analysis")
);

// Uncategorized items
const uncategorizedItems = items.filter((i) => !i.outageCategory);

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------
const esc = (s) =>
  s == null ? "" : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const link = (url, text) =>
  url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text || url)}</a>` : esc(text);

const badge = (text, color) =>
  `<span class="badge" style="background:${color}">${esc(text)}</span>`;

function titleCell(item) {
  const text = esc(item.title);
  const linked = item.issueUrl ? `<a href="${esc(item.issueUrl)}" target="_blank" rel="noopener">${text}</a>` : text;
  const closed = item.issueState === "closed"
    ? ` <span class="state-closed">closed</span>`
    : "";
  return linked + closed;
}

const STATUS_COLORS = {
  "Done":        "#1a7f37",
  "In Progress": "#bf8700",
  "Todo":        "#0969da",
  "Unset":       "#6e7781",
};

function statusBadge(status) {
  const color = STATUS_COLORS[status] || "#6e7781";
  return badge(status || "Unset", color);
}

// ---------------------------------------------------------------------------
// Build HTML sections
// ---------------------------------------------------------------------------

function renderStatusTable() {
  return `
    <table>
      <thead><tr><th>Status</th><th>Count</th><th>Share</th></tr></thead>
      <tbody>
        ${statusEntries.map(([s, c]) => `
          <tr>
            <td>${statusBadge(s)}</td>
            <td>${c}</td>
            <td>
              <div class="bar-wrap"><div class="bar" style="width:${Math.round(c/totalItems*100)}%"></div></div>
              ${Math.round(c/totalItems*100)}%
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function renderCategoryTable() {
  return `
    <table>
      <thead><tr><th>Category</th><th>Count</th></tr></thead>
      <tbody>
        ${topCategories.map(([c, n]) => `<tr><td>${esc(c)}</td><td>${n}</td></tr>`).join("")}
        <tr class="muted"><td><em>(Uncategorized)</em></td><td>${uncategorizedCount}</td></tr>
      </tbody>
    </table>`;
}

function renderResiliencyTable() {
  if (!resiliencyItems.length) return `<p class="muted">No Resiliency Analysis items found.</p>`;
  return `
    <table>
      <thead><tr><th>Title</th><th>Status</th><th>Assignees</th><th>OA Dates</th><th>Resiliency APAR</th></tr></thead>
      <tbody>
        ${resiliencyItems.map((i) => `
          <tr>
            <td>${titleCell(i)}</td>
            <td>${statusBadge(i.status || "Unset")}</td>
            <td>${esc(i.assignees || i.oaAssignees || "—")}</td>
            <td>${esc(i.oaDates || "—")}</td>
            <td>${esc(i.resiliencyApar || "—")}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function renderUncategorizedTable() {
  if (!uncategorizedItems.length) return `<p class="muted">All items are categorized.</p>`;
  return `
    <table>
      <thead><tr><th>Title</th><th>Status</th><th>Assignees</th></tr></thead>
      <tbody>
        ${uncategorizedItems.map((i) => `
          <tr>
            <td>${titleCell(i)}</td>
            <td>${statusBadge(i.status || "Unset")}</td>
            <td>${esc(i.assignees || i.oaAssignees || "—")}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

// ---------------------------------------------------------------------------
// Assemble final HTML
// ---------------------------------------------------------------------------
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(projectTitle)} — Outage Analysis Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.6; background: #fff; color: #1f2328; }
  .page { max-width: 760px; margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 16px; font-weight: 600; margin: 32px 0 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  .meta { font-size: 12px; color: #57606a; margin-bottom: 8px; }
  .kpi-row { display: flex; gap: 16px; margin: 20px 0; flex-wrap: wrap; }
  .kpi { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 20px; min-width: 140px; }
  .kpi .num { font-size: 28px; font-weight: 700; color: #1f2328; }
  .kpi .lbl { font-size: 12px; color: #57606a; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  th { text-align: left; font-size: 12px; font-weight: 600; color: #57606a; border-bottom: 1px solid #e5e7eb; padding: 6px 8px; }
  td { padding: 7px 8px; border-bottom: 1px solid #f0f1f3; font-size: 13px; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr.muted td { color: #57606a; font-style: italic; }
  a { color: #3b82d4; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .badge { display: inline-block; color: #fff; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px; }
  .bar-wrap { display: inline-block; width: 80px; height: 8px; background: #e5e7eb; border-radius: 4px; vertical-align: middle; margin-right: 6px; }
  .bar { height: 8px; background: #3b82d4; border-radius: 4px; }
  .muted { color: #57606a; }
  .state-closed { display: inline-block; font-size: 10px; font-weight: 600; color: #57606a; border: 1px solid #d0d7de; border-radius: 10px; padding: 1px 6px; vertical-align: middle; margin-left: 5px; }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #57606a; }
</style>
</head>
<body>
<div class="page">
  <h1>${esc(projectTitle)}</h1>
  <p class="meta">Generated ${generatedAt}</p>

  <div class="kpi-row">
    <div class="kpi"><div class="num">${totalItems}</div><div class="lbl">Total items</div></div>
    <div class="kpi"><div class="num">${resiliencyItems.length}</div><div class="lbl">Resiliency Analysis</div></div>
    <div class="kpi"><div class="num">${uncategorizedCount}</div><div class="lbl">Uncategorized</div></div>
    <div class="kpi"><div class="num">${byStatus["Done"] || 0}</div><div class="lbl">Done</div></div>
    <div class="kpi"><div class="num">${byStatus["In Progress"] || 0}</div><div class="lbl">In Progress</div></div>
  </div>

  <h2>Status Breakdown</h2>
  ${renderStatusTable()}

  <h2>Top Outage Categories</h2>
  ${renderCategoryTable()}

  <h2>Resiliency Analysis Items (${resiliencyItems.length})</h2>
  ${renderResiliencyTable()}

  <h2>Uncategorized Items (${uncategorizedCount})</h2>
  ${renderUncategorizedTable()}

  <footer>Made with IBM Bob</footer>
</div>
</body>
</html>`;

writeFileSync(outputPath, html, "utf8");
console.log(`Report written to ${outputPath}`);
