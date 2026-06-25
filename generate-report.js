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
 *
 * Flags:
 *   --workflow   Omit "Uncategorized Items" and "Key Observations" sections
 *                (use when generating from a workflow rather than directly by Bob)
 */

import { readFileSync, writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const inputPath   = args[args.indexOf("--input")  + 1] || "project-data.json";
const outputPath  = args[args.indexOf("--output") + 1] || "outage-analysis-report.html";
const isWorkflow  = args.includes("--workflow");

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
const now = new Date();
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const generatedAt = `${MONTH_NAMES[now.getUTCMonth()]} ${now.getUTCFullYear()}`;

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------
const esc = (s) =>
  s == null ? "" : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function issueNumber(url) {
  if (!url) return null;
  const m = url.match(/\/(\d+)$/);
  return m ? m[1] : null;
}

function linkCell(url) {
  const n = issueNumber(url);
  return n ? `<a href="${esc(url)}" target="_blank" rel="noopener">#${n}</a>` : "—";
}

function titleLink(item) {
  const text = esc(item.title);
  if (!item.issueUrl) return text;
  return `<a href="${esc(item.issueUrl)}" target="_blank" rel="noopener">${text}</a>`;
}

const STATUS_BADGE = {
  "Done":             "b-done",
  "Assigned":         "b-assigned",
  "Followup Required":"b-followup",
  "Backlog":          "b-backlog",
};

function statusBadge(status) {
  const cls = STATUS_BADGE[status] || "b-unset";
  return `<span class="badge ${cls}">${esc(status || "Unset")}</span>`;
}

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
const unsetCount = byStatus["Unset"] || 0;

// Category breakdown
const byCategory = {};
for (const item of items) {
  const c = item.outageCategory || "(Uncategorized)";
  byCategory[c] = (byCategory[c] || 0) + 1;
}
const uncategorizedCount = byCategory["(Uncategorized)"] || 0;
const categoryEntries = Object.entries(byCategory)
  .filter(([c]) => c !== "(Uncategorized)")
  .sort((a, b) => b[1] - a[1]);

// Resiliency items
const resiliencyItems = items.filter(
  (i) => i.resiliencyApar || (i.labels || []).includes("Resiliency Analysis")
);

// KPI counts
const doneCount      = byStatus["Done"] || 0;
const followupCount  = byStatus["Followup Required"] || 0;
const assignedCount  = byStatus["Assigned"] || 0;
const itemsWithDate  = items.filter((i) => i.oaDates && !isNaN(new Date(i.oaDates))).length;

// Year / month breakdown
const byYearMonth = {};
for (const item of items) {
  if (!item.oaDates) continue;
  const d = new Date(item.oaDates);
  if (isNaN(d)) continue;
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (!byYearMonth[y]) byYearMonth[y] = {};
  if (!byYearMonth[y][m]) byYearMonth[y][m] = [];
  byYearMonth[y][m].push(item);
}
const years = Object.keys(byYearMonth).sort();

// Items split by OA date
const withDate    = items.filter((i) => i.oaDates && !isNaN(new Date(i.oaDates)))
                         .sort((a, b) => new Date(a.oaDates) - new Date(b.oaDates));
const withoutDate = items.filter((i) => !i.oaDates || isNaN(new Date(i.oaDates)));

// Uncategorized items (prioritise open/active statuses, then recent Done)
const uncategorizedItems = items
  .filter((i) => !i.outageCategory)
  .sort((a, b) => {
    const pri = ["Assigned", "Followup Required", "Backlog", "Done", "Unset"];
    return pri.indexOf(a.status || "Unset") - pri.indexOf(b.status || "Unset");
  })
  .slice(0, 20);

// Simple keyword → category suggester
function suggestCategory(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("hang") || t.includes("deadlock") || t.includes("stuck"))
    return "Hang / Deadlock";
  if (t.includes("crash") || t.includes("abend") || t.includes("dump"))
    return "Crash / Abend";
  if (t.includes("perf") || t.includes("slow") || t.includes("latency") || t.includes("cpu") || t.includes("memory"))
    return "Performance";
  if (t.includes("connect") || t.includes("network") || t.includes("timeout"))
    return "Connectivity / Network";
  if (t.includes("replication") || t.includes("replica") || t.includes("sync"))
    return "Replication";
  if (t.includes("backup") || t.includes("restore") || t.includes("recovery"))
    return "Backup / Recovery";
  if (t.includes("security") || t.includes("auth") || t.includes("certif") || t.includes("ssl") || t.includes("tls"))
    return "Security / Auth";
  if (t.includes("storage") || t.includes("disk") || t.includes("space") || t.includes("tablespace"))
    return "Storage / Disk";
  if (t.includes("config") || t.includes("parameter") || t.includes("setting"))
    return "Configuration";
  if (t.includes("upgrade") || t.includes("migration") || t.includes("install"))
    return "Upgrade / Migration";
  return "Operational / Other";
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderKPIs() {
  return `
  <div class="kpi-row">
    <div class="kpi"><div class="num">${totalItems}</div><div class="lbl">Total items</div></div>
    <div class="kpi"><div class="num">${doneCount}</div><div class="lbl">Done</div></div>
    <div class="kpi"><div class="num">${followupCount}</div><div class="lbl">Followup Required</div></div>
    <div class="kpi"><div class="num">${assignedCount}</div><div class="lbl">Assigned</div></div>
    <div class="kpi"><div class="num">${itemsWithDate}</div><div class="lbl">Items with OA dates</div></div>
  </div>`;
}

function renderStatusBreakdown() {
  const rows = statusEntries.map(([s, c]) => `
      <tr>
        <td>${statusBadge(s)}</td>
        <td>${c}</td>
        <td>${Math.round(c / totalItems * 100)}%</td>
      </tr>`).join("");

  const warn = unsetCount > 0
    ? `<div class="warn">⚠ ${unsetCount} item${unsetCount > 1 ? "s have" : " has"} no Status set — these rows are missing project-board metadata and may need triage.</div>`
    : "";

  return `
  <h2>Status Breakdown</h2>
  <table>
    <thead><tr><th>Status</th><th>Count</th><th>Share</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${warn}`;
}

function renderYearMonth() {
  const noDateCount = totalItems - itemsWithDate;
  const noDatePct   = Math.round(noDateCount / totalItems * 100);

  if (!years.length) {
    return `
  <h2>Activity by Year &amp; Month</h2>
  <p class="section-note">No OA dates recorded.</p>`;
  }

  const blocks = years.map((y) => {
    const months = byYearMonth[y];
    const yearTotal = Object.values(months).reduce((a, b) => a + b.length, 0);

    const monthBlocks = Object.keys(months).sort().map((m) => {
      const monthItems = months[m];
      const monthLabel = MONTH_NAMES[parseInt(m, 10) - 1];
      const itemRows = monthItems.map((i) => `
          <tr>
            <td><a href="${esc(i.issueUrl || "")}" target="_blank" rel="noopener">${esc(i.title)}</a></td>
            <td>${statusBadge(i.status || "Unset")}</td>
            <td>${esc(i.oaDates || "—")}</td>
          </tr>`).join("");
      return `
        <div class="ym-month-block">
          <div class="ym-month-heading">
            <span class="ym-month-label">${monthLabel}</span>
            <span class="ym-count">${monthItems.length} item${monthItems.length !== 1 ? "s" : ""}</span>
          </div>
          <table>
            <thead><tr><th>Title</th><th>Status</th><th>OA Date</th></tr></thead>
            <tbody>${itemRows}</tbody>
          </table>
        </div>`;
    }).join("");

    return `
    <div class="year-section">
      <div class="year-title">${y} — ${yearTotal} item${yearTotal !== 1 ? "s" : ""}</div>
      ${monthBlocks}
    </div>`;
  }).join("");

  return `
  <h2>Activity by Year &amp; Month</h2>
  <p class="section-note">Based on OA Date field. ${noDateCount} of ${totalItems} items (${noDatePct}%) have no OA date and are excluded from this section.</p>
  ${blocks}
  <div class="note">${noDateCount} item${noDateCount !== 1 ? "s" : ""} have no OA date recorded and are excluded above. See the "All Items by OA Date" section for the full list.</div>`;
}

function renderTopCategories() {
  const noCategPct = Math.round(uncategorizedCount / totalItems * 100);
  const rows = categoryEntries
    .map(([c, n]) => `<tr><td>${esc(c)}</td><td>${n}</td></tr>`)
    .join("");

  const warn = uncategorizedCount > 0
    ? `<div class="warn">⚠ ${uncategorizedCount} item${uncategorizedCount > 1 ? "s" : ""} (${noCategPct}%) have no outage category set. See the "Uncategorized Items" section below for suggestions.</div>`
    : "";

  return `
  <h2>Top Outage Categories</h2>
  <p class="section-note">${uncategorizedCount} of ${totalItems} items (${noCategPct}%) have no outage category set.</p>
  <table>
    <thead><tr><th>Category</th><th>Count</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${warn}`;
}

function renderResiliency() {
  if (!resiliencyItems.length) {
    return `
  <h2>Resiliency Analysis Items</h2>
  <p class="section-note">No items with Resiliency APAR set.</p>`;
  }

  const rows = resiliencyItems.map((i) => `
      <tr>
        <td class="truncate" title="${esc(i.title)}"><a href="${esc(i.issueUrl || "")}" target="_blank" rel="noopener">${esc(i.title)}</a></td>
        <td>${statusBadge(i.status || "Unset")}</td>
        <td>${esc(i.oaAssignees || i.assignees || "—")}</td>
        <td>${esc(i.oaDates || "—")}</td>
        <td>${esc(i.resiliencyApar || "—")}</td>
      </tr>`).join("");

  return `
  <h2>Resiliency Analysis Items</h2>
  <p class="section-note">Items where Resiliency APAR is set. ${resiliencyItems.length} total.</p>
  <table>
    <thead><tr><th>Title</th><th>Status</th><th>OA Assignees</th><th>OA Date</th><th>APAR(s)</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderAllItemsByDate() {
  const withRows = withDate.map((i) => `
      <tr>
        <td>${esc(i.oaDates)}</td>
        <td class="truncate" title="${esc(i.title)}">${esc(i.title)}</td>
        <td>${statusBadge(i.status || "Unset")}</td>
        <td>${esc(i.assignees || i.oaAssignees || "—")}</td>
        <td>${esc(i.outageCategory || "—")}</td>
        <td>${linkCell(i.issueUrl)}</td>
      </tr>`).join("");

  const withoutRows = withoutDate.map((i) => `
      <tr>
        <td class="truncate" title="${esc(i.title)}"><a href="${esc(i.issueUrl || "")}" target="_blank" rel="noopener">${esc(i.title)}</a></td>
        <td>${statusBadge(i.status || "Unset")}</td>
        <td>${esc(i.assignees || i.oaAssignees || "—")}</td>
        <td>${linkCell(i.issueUrl)}</td>
      </tr>`).join("");

  return `
  <h2>All Items by OA Date</h2>
  <p class="section-note">${withDate.length} items with OA dates, sorted ascending. ${withoutDate.length} items with no OA date are listed last.</p>
  <h3>Items with OA Dates (${withDate.length})</h3>
  <table>
    <thead><tr><th>OA Date</th><th>Title</th><th>Status</th><th>Assignees</th><th>Category</th><th>Link</th></tr></thead>
    <tbody>${withRows}</tbody>
  </table>
  <h3>Items without OA Dates (${withoutDate.length})</h3>
  <table>
    <thead><tr><th>Title</th><th>Status</th><th>Assignees</th><th>Link</th></tr></thead>
    <tbody>${withoutRows}</tbody>
  </table>
  <div class="note">${withoutDate.length} item${withoutDate.length !== 1 ? "s have" : " has"} no OA date. These may need a date to be recorded on the project board.</div>`;
}

function renderUncategorized() {
  if (!uncategorizedItems.length) {
    return `
  <h2>Uncategorized Items — Samples with Suggested Categories</h2>
  <p class="section-note">All items have an outage category set.</p>`;
  }

  const rows = uncategorizedItems.map((i) => `
      <tr>
        <td class="truncate" title="${esc(i.title)}">${titleLink(i)}</td>
        <td>${statusBadge(i.status || "Unset")}</td>
        <td>${esc(i.oaDates || "—")}</td>
        <td>${esc(suggestCategory(i.title))}</td>
        <td>${linkCell(i.issueUrl)}</td>
      </tr>`).join("");

  return `
  <h2>Uncategorized Items — Samples with Suggested Categories</h2>
  <p class="section-note">Showing up to 20 uncategorized items (prioritised by active status). Suggested categories are based on keywords in the title.</p>
  <table>
    <thead><tr><th>Title</th><th>Status</th><th>OA Date</th><th>Suggested Category</th><th>Link</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderKeyObservations() {
  const obs = [];

  // Metadata gaps
  const noDatePct = Math.round((withoutDate.length / totalItems) * 100);
  if (withoutDate.length > 0)
    obs.push(`<strong>${withoutDate.length} items (${noDatePct}%)</strong> are missing an OA date — recording these would improve trend analysis.`);

  if (unsetCount > 0)
    obs.push(`<strong>${unsetCount} item${unsetCount > 1 ? "s" : ""}</strong> have no status set; these should be triaged and assigned a status.`);

  if (uncategorizedCount > 0)
    obs.push(`<strong>${uncategorizedCount} item${uncategorizedCount > 1 ? "s" : ""}</strong> lack an outage category — the "Uncategorized Items" section above contains AI-suggested categories to speed up labelling.`);

  // Top category concentration
  if (categoryEntries.length > 0) {
    const [topCat, topCatCount] = categoryEntries[0];
    const topCatPct = Math.round(topCatCount / (totalItems - uncategorizedCount) * 100);
    obs.push(`The leading outage category is <strong>${esc(topCat)}</strong>, accounting for <strong>${topCatPct}%</strong> of categorized items — this may warrant targeted resiliency investment.`);
  }

  // Resiliency coverage
  if (resiliencyItems.length > 0)
    obs.push(`<strong>${resiliencyItems.length} item${resiliencyItems.length !== 1 ? "s" : ""}</strong> carry a Resiliency APAR — review these to confirm APARs are open and being tracked.`);

  // Done rate
  const donePct = Math.round(doneCount / totalItems * 100);
  obs.push(`<strong>${doneCount} of ${totalItems} items (${donePct}%)</strong> are marked Done. ${followupCount > 0 ? `${followupCount} item${followupCount > 1 ? "s" : ""} still require followup.` : "No items are currently awaiting followup."}`);

  const bullets = obs.map((o) => `<li>${o}</li>`).join("\n    ");
  return `
  <h2>Key Observations</h2>
  <ul class="obs-list">
    ${bullets}
  </ul>`;
}

// ---------------------------------------------------------------------------
// Assemble final HTML
// ---------------------------------------------------------------------------
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(projectTitle)} — Dashboard Summary</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.6; color: #1f2328; background: #ffffff; padding: 32px 16px 48px; }
  .container { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 16px; font-weight: 700; margin: 32px 0 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  h3 { font-size: 14px; font-weight: 600; margin: 18px 0 8px; color: #1f2328; }
  .meta { color: #57606a; font-size: 13px; margin-bottom: 24px; }
  .kpi-row { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .kpi { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 18px; flex: 1; min-width: 120px; }
  .kpi .num { font-size: 26px; font-weight: 700; color: #3b82d4; }
  .kpi .lbl { font-size: 12px; color: #57606a; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
  th { background: #f7f8fa; text-align: left; padding: 7px 10px; border: 1px solid #e5e7eb; font-weight: 600; white-space: nowrap; }
  td { padding: 6px 10px; border: 1px solid #e5e7eb; vertical-align: top; }
  tr:nth-child(even) td { background: #fafbfc; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .b-done { background: #d1fae5; color: #065f46; }
  .b-assigned { background: #dbeafe; color: #1e40af; }
  .b-followup { background: #fef3c7; color: #92400e; }
  .b-backlog { background: #f3f4f6; color: #374151; }
  .b-unset { background: #fee2e2; color: #991b1b; }
  .note { background: #f7f8fa; border-left: 3px solid #3b82d4; padding: 10px 14px; font-size: 13px; color: #57606a; margin: 10px 0; border-radius: 0 4px 4px 0; }
  .warn { background: #fff7ed; border-left: 3px solid #f59e0b; padding: 10px 14px; font-size: 13px; color: #92400e; margin: 10px 0; border-radius: 0 4px 4px 0; }
  .obs-list { list-style: none; padding: 0; }
  .obs-list li { padding: 8px 0 8px 20px; border-bottom: 1px solid #f3f4f6; position: relative; font-size: 13px; }
  .obs-list li::before { content: "•"; position: absolute; left: 6px; color: #3b82d4; font-weight: 700; }
  .obs-list li:last-child { border-bottom: none; }
  a { color: #3b82d4; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .truncate { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .year-section { margin-bottom: 28px; }
  .year-title { font-weight: 700; font-size: 14px; background: #f7f8fa; border: 1px solid #e5e7eb; padding: 6px 12px; border-radius: 4px; margin-bottom: 10px; }
  .ym-month-block { margin-bottom: 16px; padding-left: 12px; border-left: 3px solid #e5e7eb; }
  .ym-month-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .ym-month-label { font-size: 13px; font-weight: 600; color: #1f2328; min-width: 36px; }
  .ym-count { font-size: 12px; color: #57606a; }
  footer { margin-top: 48px; padding-top: 12px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #57606a; }
  .section-note { font-size: 12px; color: #57606a; margin-bottom: 6px; }
</style>
</head>
<body>
<div class="container">
  <h1>${esc(projectTitle)} — Dashboard Summary</h1>
  <div class="meta">Generated: ${generatedAt}  |  Source: GitHub Projects (GraphQL)  |  Board: <strong>${esc(projectTitle)}</strong></div>

  ${renderKPIs()}
  ${renderStatusBreakdown()}
  ${renderYearMonth()}
  ${renderTopCategories()}
  ${renderResiliency()}
  ${renderAllItemsByDate()}
  ${isWorkflow ? "" : renderUncategorized()}
  ${isWorkflow ? "" : renderKeyObservations()}

  <footer>Made with IBM Bob</footer>
</div>
</body>
</html>`;

writeFileSync(outputPath, html, "utf8");
console.log(`Report written to ${outputPath}`);
