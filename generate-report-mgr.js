// generate-report-mgr.js — Manager-focused OAT report
// Sections: KPI summary, Status Breakdown, Top Outage Categories,
//           Resiliency APAR summary, Key Observations.
// Omits: per-item tables, Analysis Notes, Uncategorized Items, Analysis by Year.
import { readFileSync, writeFileSync } from "fs";

const args       = process.argv.slice(2);
const inputPath  = args[args.indexOf("--input")  + 1] || "project-data.json";
const outputPath = args[args.indexOf("--output") + 1] || "outage-analysis-report-mgr.html";

let data;
try {
  data = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (e) {
  console.error("Error reading input file:", e.message);
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

const STATUS_BADGE = {
  "Done":              "b-done",
  "Assigned":          "b-assigned",
  "Followup Required": "b-followup",
  "Backlog":           "b-backlog",
};

function statusBadge(status) {
  const cls = STATUS_BADGE[status] || "b-unset";
  return `<span class="badge ${cls}">${esc(status || "Unset")}</span>`;
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

const byStatus = {};
for (const item of items) {
  const s = item.status || "Unset";
  byStatus[s] = (byStatus[s] || 0) + 1;
}
const statusEntries = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
const unsetCount = byStatus["Unset"] || 0;

const byCategory = {};
for (const item of items) {
  const c = item.outageCategory || "(Uncategorized)";
  byCategory[c] = (byCategory[c] || 0) + 1;
}
const uncategorizedCount = byCategory["(Uncategorized)"] || 0;
const categoryEntries = Object.entries(byCategory)
  .filter(([c]) => c !== "(Uncategorized)")
  .sort((a, b) => b[1] - a[1]);

const resiliencyItems = items
  .filter((i) => i.resiliencyApar || (i.labels || []).includes("Resiliency Analysis"))
  .sort((a, b) => new Date(b.oaDates || 0) - new Date(a.oaDates || 0));

const doneCount     = byStatus["Done"] || 0;
const followupCount = byStatus["Followup Required"] || 0;
const assignedCount = byStatus["Assigned"] || 0;
const itemsWithDate = items.filter((i) => i.oaDates && !isNaN(new Date(i.oaDates))).length;
const withoutDate   = items.filter((i) => !i.oaDates || isNaN(new Date(i.oaDates)));

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderKPIs() {
  return `
  <div class="kpi-row">
    <div class="kpi"><div class="num">${totalItems}</div><div class="lbl">Total Items</div></div>
    <div class="kpi"><div class="num">${doneCount}</div><div class="lbl">Done</div></div>
    <div class="kpi"><div class="num">${followupCount}</div><div class="lbl">Followup Required</div></div>
    <div class="kpi"><div class="num">${assignedCount}</div><div class="lbl">Assigned</div></div>
    <div class="kpi"><div class="num">${resiliencyItems.length}</div><div class="lbl">Resiliency APARs</div></div>
  </div>`;
}

function renderStatusBreakdown() {
  const rows = statusEntries.map(([s, c]) => `
      <tr>
        <td>${statusBadge(s)}</td>
        <td>${c}</td>
        <td>
          <div class="bar-wrap"><div class="bar" style="width:${Math.round(c / totalItems * 100)}%"></div></div>
        </td>
        <td style="text-align:right;">${Math.round(c / totalItems * 100)}%</td>
      </tr>`).join("");

  const warn = unsetCount > 0
    ? `<div class="warn">⚠ ${unsetCount} item${unsetCount > 1 ? "s" : ""} with no status set — needs triage.</div>`
    : "";

  return `
  <h2>Status Breakdown</h2>
  <table>
    <thead><tr><th>Status</th><th>Count</th><th style="min-width:120px;">Distribution</th><th>Share</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${warn}`;
}

function renderTopCategories() {
  const noCategPct = Math.round(uncategorizedCount / totalItems * 100);
  const maxCount   = categoryEntries.length ? categoryEntries[0][1] : 1;

  const rows = categoryEntries
    .map(([c, n]) => `
      <tr>
        <td>${esc(c)}</td>
        <td>${n}</td>
        <td>
          <div class="bar-wrap"><div class="bar" style="width:${Math.round(n / maxCount * 100)}%"></div></div>
        </td>
        <td style="text-align:right;">${Math.round(n / totalItems * 100)}%</td>
      </tr>`)
    .join("");

  const uncatRow = uncategorizedCount > 0
    ? `<tr><td><em>(Uncategorized)</em></td><td>${uncategorizedCount}</td><td><div class="bar-wrap"><div class="bar bar-warn" style="width:${Math.round(uncategorizedCount / maxCount * 100)}%"></div></div></td><td style="text-align:right;">${noCategPct}%</td></tr>`
    : "";

  const warn = uncategorizedCount > 0
    ? `<div class="warn">⚠ ${uncategorizedCount} item${uncategorizedCount > 1 ? "s" : ""} (${noCategPct}%) have no outage category.</div>`
    : "";

  return `
  <h2>Top Outage Categories</h2>
  <table>
    <thead><tr><th>Category</th><th>Count</th><th style="min-width:120px;">Distribution</th><th>Share</th></tr></thead>
    <tbody>${rows}${uncatRow}</tbody>
  </table>
  ${warn}`;
}

function renderResiliency() {
  if (!resiliencyItems.length) {
    return `
  <h2>Resiliency APARs</h2>
  <p class="section-note">No items with Resiliency APAR set.</p>`;
  }

  // Group by APAR number
  const byApar = {};
  for (const i of resiliencyItems) {
    const apar = i.resiliencyApar || "(Label only)";
    if (!byApar[apar]) byApar[apar] = [];
    byApar[apar].push(i);
  }

  const rows = Object.entries(byApar)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([apar, grpItems]) => {
      const statuses = [...new Set(grpItems.map((i) => i.status || "Unset"))];
      const cats     = [...new Set(grpItems.map((i) => i.outageCategory).filter(Boolean))];
      return `
      <tr>
        <td><strong>${esc(apar)}</strong></td>
        <td>${grpItems.length}</td>
        <td>${statuses.map(statusBadge).join(" ")}</td>
        <td>${esc(cats.join(", ") || "—")}</td>
      </tr>`;
    }).join("");

  return `
  <h2>Resiliency APARs</h2>
  <p class="section-note">${resiliencyItems.length} item${resiliencyItems.length !== 1 ? "s" : ""} — ${Object.keys(byApar).length} distinct APAR${Object.keys(byApar).length !== 1 ? "s" : ""}.</p>
  <table>
    <thead><tr><th>APAR</th><th>Items</th><th>Statuses</th><th>Categories</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderKeyObservations() {
  const obs = [];

  const noDatePct = Math.round((withoutDate.length / totalItems) * 100);
  if (withoutDate.length > 0)
    obs.push(`<strong>${withoutDate.length} items (${noDatePct}%)</strong> are missing an OA date — recording these improves trend analysis.`);

  if (unsetCount > 0)
    obs.push(`<strong>${unsetCount} item${unsetCount > 1 ? "s" : ""}</strong> have no status set and need triage.`);

  if (uncategorizedCount > 0)
    obs.push(`<strong>${uncategorizedCount} item${uncategorizedCount > 1 ? "s" : ""}</strong> lack an outage category.`);

  if (categoryEntries.length > 0) {
    const [topCat, topCatCount] = categoryEntries[0];
    const topCatPct = Math.round(topCatCount / (totalItems - uncategorizedCount) * 100);
    obs.push(`Leading outage category: <strong>${esc(topCat)}</strong> at <strong>${topCatPct}%</strong> of categorized items — may warrant targeted resiliency investment.`);
  }

  if (resiliencyItems.length > 0)
    obs.push(`<strong>${resiliencyItems.length} item${resiliencyItems.length !== 1 ? "s" : ""}</strong> carry a Resiliency APAR — confirm these are open and tracked.`);

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
// Assemble HTML
// ---------------------------------------------------------------------------

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(projectTitle)} — Manager Summary</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.6; color: #1f2328; background: #ffffff; padding: 32px 16px 48px; }
  .container { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 16px; font-weight: 700; margin: 32px 0 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  .meta { color: #57606a; font-size: 13px; margin-bottom: 24px; }
  .audience-tag { display: inline-block; background: #f0fdf4; border: 1px solid #86efac; color: #166534; font-size: 11px; font-weight: 600; border-radius: 10px; padding: 2px 10px; margin-left: 8px; vertical-align: middle; letter-spacing: 0.03em; }
  .kpi-row { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .kpi { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 18px; flex: 1; min-width: 110px; text-align: left; }
  .kpi .num { font-size: 26px; font-weight: 700; color: #3b82d4; }
  .kpi .lbl { font-size: 12px; color: #57606a; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
  th { background: #f7f8fa; text-align: left; padding: 7px 10px; border: 1px solid #e5e7eb; font-weight: 600; white-space: nowrap; }
  td { padding: 6px 10px; border: 1px solid #e5e7eb; vertical-align: middle; }
  tr:nth-child(even) td { background: #fafbfc; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .b-done     { background: #d1fae5; color: #065f46; }
  .b-assigned { background: #dbeafe; color: #1e40af; }
  .b-followup { background: #fef3c7; color: #92400e; }
  .b-backlog  { background: #f3f4f6; color: #374151; }
  .b-unset    { background: #fee2e2; color: #991b1b; }
  .bar-wrap { background: #e5e7eb; border-radius: 3px; height: 8px; width: 100%; }
  .bar      { background: #3b82d4; height: 8px; border-radius: 3px; min-width: 2px; }
  .bar-warn { background: #f59e0b; }
  .warn { background: #fff7ed; border-left: 3px solid #f59e0b; padding: 10px 14px; font-size: 13px; color: #92400e; margin: 10px 0; border-radius: 0 4px 4px 0; }
  .obs-list { list-style: none; padding: 0; }
  .obs-list li { padding: 8px 0 8px 20px; border-bottom: 1px solid #f3f4f6; position: relative; font-size: 13px; }
  .obs-list li::before { content: "•"; position: absolute; left: 6px; color: #3b82d4; font-weight: 700; }
  .obs-list li:last-child { border-bottom: none; }
  .section-note { font-size: 12px; color: #57606a; margin-bottom: 6px; }
  footer { margin-top: 48px; padding-top: 12px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #57606a; }
</style>
</head>
<body>
<div class="container">
  <h1><a href="https://github.ibm.com/orgs/Db2z/projects/32" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">${esc(projectTitle)} — Manager Summary</a> <span class="audience-tag">Manager View</span></h1>
  <div class="meta">Generated: ${generatedAt}  |  Source: GitHub Projects (GraphQL)  |  Board: <a href="https://github.ibm.com/orgs/Db2z/projects/32" target="_blank" rel="noopener"><strong>${esc(projectTitle)}</strong></a></div>

  ${renderKPIs()}
  ${renderStatusBreakdown()}
  ${renderTopCategories()}
  ${renderResiliency()}
  ${renderKeyObservations()}

  <footer>Made with IBM Bob</footer>
</div>
</body>
</html>`;

writeFileSync(outputPath, html, "utf8");
console.log(`Manager report written to ${outputPath}`);
