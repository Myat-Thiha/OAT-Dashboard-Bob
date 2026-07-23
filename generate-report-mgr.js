// generate-report-mgr.js — Manager-focused OAT report
// Sections: KPI summary, Status Breakdown, Top Outage Categories,
//           Resiliency APAR summary, Analysis by Year, Key Observations.
// Omits: per-item tables, Analysis Notes, Uncategorized Items.
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

// By-year aggregation (newest first) + per-year category counts
const byYear = {};
const byYearCategory = {};
for (const item of items) {
  if (!item.oaDates) continue;
  const d = new Date(item.oaDates);
  if (isNaN(d)) continue;
  const yr = String(d.getUTCFullYear());
  if (!byYear[yr]) byYear[yr] = { total: 0, done: 0, items: [] };
  byYear[yr].total++;
  if (item.status === "Done") byYear[yr].done++;
  byYear[yr].items.push(item);
  if (!byYearCategory[yr]) byYearCategory[yr] = {};
  const cat = item.outageCategory || "—";
  byYearCategory[yr][cat] = (byYearCategory[yr][cat] || 0) + 1;
}
const yearEntries = Object.entries(byYear).sort((a, b) => Number(b[0]) - Number(a[0]));

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderKPIs() {
  const unsetCount   = byStatus["Unset"] || 0;
  const backlogCount = byStatus["Backlog"] || 0;
  return `
  <div class="kpi-row">
    <div class="kpi"><div class="num">${totalItems}</div><div class="lbl">Total Outage Items</div></div>
    <div class="kpi"><div class="num">${doneCount}</div><div class="lbl">Resolved</div></div>
    <div class="kpi"><div class="num">${followupCount}</div><div class="lbl">In Review</div></div>
    <div class="kpi"><div class="num">${assignedCount}</div><div class="lbl">In Progress</div></div>
    ${unsetCount > 0 ? `<div class="kpi kpi-unset"><div class="num">${unsetCount}</div><div class="lbl">Assignment Pending</div></div>` : ""}
    ${backlogCount > 0 ? `<div class="kpi"><div class="num" style="color:#374151;">${backlogCount}</div><div class="lbl">Backlog</div></div>` : ""}
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

function renderYearCats(yr) {
  const cats = Object.entries(byYearCategory[yr] || {})
    .filter(([c]) => c !== "—")
    .sort((a, b) => b[1] - a[1]);
  const uncategorized = (byYearCategory[yr] || {})["—"] || 0;
  if (!cats.length && !uncategorized) return "";

  const maxVal = cats.length ? cats[0][1] : 1;
  const barW   = 220;
  const labelW = 190;
  const rowH   = 22;
  const svgW   = labelW + barW + 50;
  const svgH   = cats.length * rowH + 2;

  const bars = cats.map(([c, n], idx) => {
    const y    = idx * rowH;
    const bLen = Math.max(2, Math.round(n / maxVal * barW));
    const label = c.length > 28 ? c.slice(0, 26) + "…" : c;
    return `<g transform="translate(0,${y})">
      <text x="${labelW - 6}" y="15" font-size="11" fill="#1f2328" text-anchor="end" font-family="-apple-system,'Segoe UI',sans-serif">${esc(label)}</text>
      <rect x="${labelW}" y="4" width="${bLen}" height="12" rx="2" fill="#3b82d4" opacity="0.75"/>
      <text x="${labelW + bLen + 5}" y="15" font-size="11" fill="#57606a" font-family="-apple-system,'Segoe UI',sans-serif">${n}</text>
    </g>`;
  }).join("");

  return `<div class="year-cats">
    <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="max-width:100%;overflow:visible;display:block;">${bars}</svg>
  </div>`;
}

function renderYearBreakdown() {
  const noDateCount = totalItems - itemsWithDate;
  const noDatePct   = Math.round(noDateCount / totalItems * 100);

  if (!yearEntries.length) return `<p class="section-note">No OA dates recorded.</p>`;

  const blocks = yearEntries.map(([yr, d]) => {
    const resolvedPct = Math.round(d.done / d.total * 100);

    const itemRows = [...d.items]
      .sort((a, b) => new Date(b.oaDates) - new Date(a.oaDates))
      .map(item => {
        const sc = STATUS_BADGE[item.status] || "b-unset";
        const titleCell = item.issueUrl
          ? `<a href="${esc(item.issueUrl)}" target="_blank" rel="noopener">${esc(item.title)}</a>`
          : esc(item.title);
        return `<tr><td>${titleCell}</td><td><span class="badge ${sc}">${esc(item.status || "Unset")}</span></td><td style="white-space:nowrap;">${esc(item.oaDates || "—")}</td><td>${esc(item.outageCategory || "—")}</td></tr>`;
      }).join("\n");

    const statsLine = `<span class="badge b-done" style="margin-left:10px;">${d.done} resolved</span> <span style="font-size:11px;color:#57606a;margin-left:6px;">${resolvedPct}% resolve rate</span>`;

    return `
    <div class="year-section">
      <details>
        <summary><span class="year-title">${yr} — ${d.total} item${d.total !== 1 ? "s" : ""}</span>${statsLine}</summary>
        ${renderYearCats(yr)}
        <div class="month-table-wrap"><table>
          <thead><tr><th>Title</th><th>Status</th><th>OA Date</th><th>Category</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table></div>
      </details>
    </div>`;
  }).join("");

  return `
  <h2>Analysis by Year</h2>
  <p class="section-note">Outage items by OA date year, newest first. Click any row to see the full item list.</p>
  ${blocks}`;
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
  .kpi { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 20px; flex: 1; min-width: 110px; }
  .kpi .num { font-size: 32px; font-weight: 700; color: #3b82d4; line-height: 1.1; }
  .kpi .lbl { font-size: 12px; color: #57606a; margin-top: 2px; }
  .kpi.kpi-alert .num { color: #b45309; }
  .kpi.kpi-unset .num { color: #6b7280; }
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
  .year-section { margin-bottom: 16px; }
  .year-section > details { border-left: 3px solid #e5e7eb; padding-left: 14px; }
  .year-section > details > summary { display: flex; align-items: center; gap: 8px; padding: 7px 0; cursor: pointer; list-style: none; user-select: none; flex-wrap: wrap; }
  .year-section > details > summary::-webkit-details-marker { display: none; }
  .year-section > details > summary::before { content: "▶"; font-size: 10px; color: #57606a; flex-shrink: 0; transition: transform 0.15s; }
  .year-section > details[open] > summary::before { transform: rotate(90deg); }
  .year-title { font-weight: 700; font-size: 14px; background: #f7f8fa; border: 1px solid #e5e7eb; padding: 4px 12px; border-radius: 4px; }
  .month-table-wrap { padding-top: 8px; padding-bottom: 4px; }
  .year-cats { margin: 8px 0 10px; }
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
  ${renderYearBreakdown()}
  ${renderKeyObservations()}

  <footer>Made with IBM Bob</footer>
</div>
</body>
</html>`;

writeFileSync(outputPath, html, "utf8");
console.log(`Manager report written to ${outputPath}`);
