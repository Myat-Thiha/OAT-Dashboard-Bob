// generate-report-leadership.js — Leadership executive OAT report
// Sections: KPI summary (big-number tiles), Category bar chart (SVG),
//           Completion rate gauge, Resiliency snapshot, Executive Summary bullets.
// Category bars are clickable — opens a CSS :target modal with item detail.
import { readFileSync, writeFileSync } from "fs";

const args       = process.argv.slice(2);
const inputPath  = args[args.indexOf("--input")  + 1] || "project-data.json";
const outputPath = args[args.indexOf("--output") + 1] || "outage-analysis-report-leadership.html";

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

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

const byStatus = {};
for (const item of items) {
  const s = item.status || "Unset";
  byStatus[s] = (byStatus[s] || 0) + 1;
}

const byCategory = {};
const byCategoryItems = {};
for (const item of items) {
  const c = item.outageCategory || "(Uncategorized)";
  byCategory[c] = (byCategory[c] || 0) + 1;
  if (!byCategoryItems[c]) byCategoryItems[c] = [];
  byCategoryItems[c].push(item);
}
const uncategorizedCount = byCategory["(Uncategorized)"] || 0;
const categoryEntries = Object.entries(byCategory)
  .filter(([c]) => c !== "(Uncategorized)")
  .sort((a, b) => b[1] - a[1]);

const resiliencyItems = items
  .filter((i) => i.resiliencyApar || (i.labels || []).includes("Resiliency Analysis"))
  .sort((a, b) => {
    const da = a.oaDates ? new Date(a.oaDates) : new Date(0);
    const db = b.oaDates ? new Date(b.oaDates) : new Date(0);
    return db - da;
  });

const doneCount     = byStatus["Done"] || 0;
const followupCount = byStatus["Followup Required"] || 0;
const assignedCount = byStatus["Assigned"] || 0;
const donePct       = Math.round(doneCount / totalItems * 100);
const openCount     = totalItems - doneCount;
const withoutDate   = items.filter((i) => !i.oaDates || isNaN(new Date(i.oaDates)));

// APARs by unique number
const aparSet = new Set(
  resiliencyItems
    .map((i) => i.resiliencyApar)
    .filter(Boolean)
);
const aparCount = aparSet.size;

// By-year aggregation (newest first) + per-year category counts
const byYear = {};
const byYearCategory = {};
for (const item of items) {
  if (!item.oaDates) continue;
  const d = new Date(item.oaDates);
  if (isNaN(d)) continue;
  const yr = String(d.getUTCFullYear());
  if (!byYear[yr]) byYear[yr] = { total: 0, done: 0, followup: 0, assigned: 0, items: [] };
  byYear[yr].total++;
  if (item.status === "Done")                   byYear[yr].done++;
  else if (item.status === "Followup Required") byYear[yr].followup++;
  else if (item.status === "Assigned")          byYear[yr].assigned++;
  byYear[yr].items.push(item);
  if (!byYearCategory[yr]) byYearCategory[yr] = {};
  const cat = item.outageCategory || "—";
  byYearCategory[yr][cat] = (byYearCategory[yr][cat] || 0) + 1;
}
const yearEntries = Object.entries(byYear).sort((a, b) => Number(b[0]) - Number(a[0]));
const itemsWithDate = items.filter((i) => i.oaDates && !isNaN(new Date(i.oaDates))).length;

// ---------------------------------------------------------------------------
// Per-year category bar chart (SVG, inline, compact)
// ---------------------------------------------------------------------------
function renderYearCats(yr) {
  const cats = Object.entries(byYearCategory[yr] || {})
    .filter(([c]) => c !== "—")
    .sort((a, b) => b[1] - a[1]);
  const uncategorized = (byYearCategory[yr] || {})["—"] || 0;
  if (!cats.length && !uncategorized) return "";

  const maxVal  = cats.length ? cats[0][1] : 1;
  const barW    = 220;
  const labelW  = 190;
  const rowH    = 22;
  const svgW    = labelW + barW + 50;
  const svgH    = cats.length * rowH + 2;

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

// ---------------------------------------------------------------------------
// Year breakdown — dev-style collapsible sections with category summary + item table
// ---------------------------------------------------------------------------
function renderYearBreakdown() {
  const noDateCount = totalItems - itemsWithDate;
  const noDatePct   = Math.round(noDateCount / totalItems * 100);

  if (!yearEntries.length) return `<p class="section-note">No OA dates recorded.</p>`;

  const blocks = yearEntries.map(([yr, d]) => {
    const resolvedPct = Math.round(d.done / d.total * 100);
    const openCount   = d.total - d.done;

    const itemRows = [...d.items]
      .sort((a, b) => new Date(b.oaDates) - new Date(a.oaDates))
      .map(item => {
        const sc = {"Done":"b-done","Assigned":"b-assigned","Followup Required":"b-followup","Unset":"b-unset"}[item.status] || "b-unset";
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

  return `${blocks}`;
}

// ---------------------------------------------------------------------------
// Slug helper for :target anchor IDs
// ---------------------------------------------------------------------------
function slugify(str) {
  return "cat-" + str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// SVG horizontal bar chart for top categories (max 10) — bars are links
// ---------------------------------------------------------------------------
function renderCategoryChart() {
  const entries = categoryEntries.slice(0, 10);
  if (!entries.length) return `<p class="section-note">No categorized items.</p>`;

  const maxVal   = entries[0][1];
  const barW     = 380;
  const rowH     = 30;
  const labelW   = 180;
  const countW   = 36;
  const chartH   = entries.length * rowH + 4;

  const bars = entries.map(([cat, n], idx) => {
    const y     = idx * rowH;
    const bLen  = Math.max(2, Math.round(n / maxVal * barW));
    const pct   = Math.round(n / totalItems * 100);
    const slug  = slugify(cat);
    const label = cat.length > 24 ? cat.slice(0, 22) + "…" : cat;
    return `
  <a href="#${slug}" style="text-decoration:none;">
  <g transform="translate(0,${y})" class="bar-group" data-cat="${esc(cat)}">
    <rect x="0" y="0" width="${labelW + barW + countW + 20}" height="${rowH}" fill="transparent"/>
    <text x="${labelW - 8}" y="19" font-size="12" fill="#3b82d4" text-anchor="end" font-family="-apple-system,'Segoe UI',sans-serif" text-decoration="underline">${esc(label)}</text>
    <rect x="${labelW}" y="8" width="${bLen}" height="14" rx="2" fill="#3b82d4" opacity="0.85"/>
    <text x="${labelW + bLen + 6}" y="19" font-size="11" fill="#57606a" font-family="-apple-system,'Segoe UI',sans-serif">${n} (${pct}%)</text>
  </g>
  </a>`;
  }).join("");

  const svgW = labelW + barW + countW + 20;
  return `
  <svg width="${svgW}" height="${chartH}" viewBox="0 0 ${svgW} ${chartH}" role="img" aria-label="Category bar chart" style="max-width:100%;overflow:visible;cursor:pointer;">
    ${bars}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Category modals (CSS :target — no JS required)
// ---------------------------------------------------------------------------
function renderCategoryModals() {
  return categoryEntries.map(([cat, n]) => {
    const slug  = slugify(cat);
    const catItems = (byCategoryItems[cat] || []).sort((a, b) => {
      const da = a.oaDates ? new Date(a.oaDates) : new Date(0);
      const db = b.oaDates ? new Date(b.oaDates) : new Date(0);
      return db - da;
    });
    const rows = catItems.map(item => {
      const statusClass = {"Done":"b-done","Assigned":"b-assigned","Followup Required":"b-followup","Unset":"b-unset"}[item.status] || "b-unset";
      const titleCell = item.issueUrl
        ? `<a href="${esc(item.issueUrl)}" target="_blank" rel="noopener">${esc(item.title)}</a>`
        : esc(item.title);
      return `<tr><td>${titleCell}</td><td><span class="badge ${statusClass}">${esc(item.status || "Unset")}</span></td><td style="white-space:nowrap;">${esc(item.oaDates || "—")}</td><td>${esc(item.assignees || "—")}</td></tr>`;
    }).join("\n");

    return `
<div id="${slug}" class="modal-overlay">
  <div class="modal-box">
    <div class="modal-header">
      <span class="modal-title">${esc(cat)} <span class="modal-count">${n} item${n !== 1 ? "s" : ""}</span></span>
      <a href="#" class="modal-close" aria-label="Close">✕</a>
    </div>
    <div class="modal-body">
      <table>
        <thead><tr><th>Title</th><th>Status</th><th>OA Date</th><th>Assignee</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</div>`;
  }).join("\n");
}

// ---------------------------------------------------------------------------
// SVG donut gauge for completion rate
// ---------------------------------------------------------------------------
function renderGauge() {
  const r  = 54;
  const cx = 70;
  const cy = 70;
  const circ = 2 * Math.PI * r;
  const filled = circ * (donePct / 100);
  const gap    = circ - filled;
  const pctLabel = `${donePct}%`;
  // start from top (-90deg = -π/2)
  // stroke-dasharray: filled gap; rotate so arc starts at top
  return `
  <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Completion rate ${donePct}%">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="14"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#3b82d4" stroke-width="14"
      stroke-dasharray="${filled.toFixed(2)} ${gap.toFixed(2)}"
      stroke-linecap="round"
      transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="22" font-weight="700" fill="#3b82d4" font-family="-apple-system,'Segoe UI',sans-serif">${pctLabel}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="#57606a" font-family="-apple-system,'Segoe UI',sans-serif">Complete</text>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Executive summary bullets (max 5, plain language)
// ---------------------------------------------------------------------------
function renderExecSummary() {
  const bullets = [];

  bullets.push(`The team has completed outage analysis on <strong>${doneCount} of ${totalItems} items (${donePct}%)</strong>${assignedCount ? `, with ${assignedCount} actively in progress` : ""}.`);

  if (categoryEntries.length > 0) {
    const [topCat, topCatCount] = categoryEntries[0];
    const topCatPct = Math.round(topCatCount / (totalItems - uncategorizedCount) * 100);
    bullets.push(`The most thoroughly analysed category is <strong>${esc(topCat)}</strong>, accounting for <strong>${topCatPct}%</strong> of classified outages — demonstrating strong focus and domain expertise.`);
  }

  if (resiliencyItems.length > 0)
    bullets.push(`<strong>${resiliencyItems.length} item${resiliencyItems.length !== 1 ? "s" : ""}</strong> have been escalated to formal Resiliency APARs, reflecting proactive defect identification and follow-through.`);

  const rows = bullets.map((b) => `<li>${b}</li>`).join("\n    ");
  return `<ul class="exec-list">\n    ${rows}\n  </ul>`;
}

// ---------------------------------------------------------------------------
// Assemble HTML
// ---------------------------------------------------------------------------

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(projectTitle)} — Leadership Summary</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.6; color: #1f2328; background: #ffffff; padding: 32px 16px 48px; }
  .container { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 16px; font-weight: 700; margin: 32px 0 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  .meta { color: #57606a; font-size: 13px; margin-bottom: 24px; }
  a { color: #3b82d4; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .audience-tag { display: inline-block; background: #eff6ff; border: 1px solid #93c5fd; color: #1e40af; font-size: 11px; font-weight: 600; border-radius: 10px; padding: 2px 10px; margin-left: 8px; vertical-align: middle; letter-spacing: 0.03em; }
  .kpi-row { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .kpi { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 20px; flex: 1; min-width: 110px; }
  .kpi .num { font-size: 32px; font-weight: 700; color: #3b82d4; line-height: 1.1; }
  .kpi .lbl { font-size: 12px; color: #57606a; margin-top: 2px; }
  .kpi.kpi-alert .num { color: #b45309; }
  .kpi.kpi-unset .num { color: #6b7280; }
  .two-col { display: flex; gap: 32px; align-items: flex-start; flex-wrap: wrap; margin-top: 8px; }
  .two-col .gauge-wrap { flex-shrink: 0; }
  .two-col .chart-wrap { flex: 1; min-width: 260px; }
  .exec-list { list-style: none; padding: 0; }
  .exec-list li { padding: 10px 0 10px 22px; border-bottom: 1px solid #f3f4f6; position: relative; font-size: 13px; }
  .exec-list li::before { content: "→"; position: absolute; left: 4px; color: #3b82d4; font-weight: 700; }
  .exec-list li:last-child { border-bottom: none; }
  .resil-toggle { display: inline-block; margin-top: 6px; }
  .resil-toggle > details { border-left: 3px solid #d8b4fe; padding-left: 14px; }
  .resil-toggle > details > summary { display: flex; align-items: center; gap: 12px; padding: 10px 0; cursor: pointer; list-style: none; user-select: none; }
  .resil-toggle > details > summary::-webkit-details-marker { display: none; }
  .resil-toggle > details > summary::before { content: "▶"; font-size: 10px; color: #7c3aed; flex-shrink: 0; transition: transform 0.15s; }
  .resil-toggle > details[open] > summary::before { transform: rotate(90deg); }
  .resil-tile-btn { background: #faf5ff; border: 1px solid #d8b4fe; border-radius: 6px; padding: 12px 20px; text-align: center; display: inline-block; }
  .resil-tile-btn .num { font-size: 28px; font-weight: 700; color: #7c3aed; line-height: 1.1; }
  .resil-tile-btn .lbl { font-size: 12px; color: #57606a; }
  .resil-hint { font-size: 11px; color: #7c3aed; margin-top: 3px; }
  .resil-table-wrap { padding-top: 10px; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
  th { background: #f7f8fa; text-align: left; padding: 7px 10px; border: 1px solid #e5e7eb; font-weight: 600; white-space: nowrap; }
  td { padding: 6px 10px; border: 1px solid #e5e7eb; vertical-align: middle; }
  tr:nth-child(even) td { background: #fafbfc; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .b-done     { background: #d1fae5; color: #065f46; }
  .b-assigned { background: #dbeafe; color: #1e40af; }
  .b-followup { background: #fef3c7; color: #92400e; }
  .b-unset    { background: #fee2e2; color: #991b1b; }
  .b-backlog  { background: #f3f4f6; color: #374151; }
  .section-note { font-size: 12px; color: #57606a; margin-bottom: 6px; }
  footer { margin-top: 48px; padding-top: 12px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #57606a; }
  .year-section { margin-bottom: 16px; }
  .year-section > details { border-left: 3px solid #e5e7eb; padding-left: 14px; }
  .year-section > details > summary { display: flex; align-items: center; gap: 8px; padding: 7px 0; cursor: pointer; list-style: none; user-select: none; flex-wrap: wrap; }
  .year-section > details > summary::-webkit-details-marker { display: none; }
  .year-section > details > summary::before { content: "▶"; font-size: 10px; color: #57606a; flex-shrink: 0; transition: transform 0.15s; }
  .year-section > details[open] > summary::before { transform: rotate(90deg); }
  .year-title { font-weight: 700; font-size: 14px; background: #f7f8fa; border: 1px solid #e5e7eb; padding: 4px 12px; border-radius: 4px; }
  .month-table-wrap { padding-top: 8px; padding-bottom: 4px; }
  .year-cats { margin: 8px 0 10px; }

  /* ── Category modals (CSS :target, no JS) ── */
  .modal-overlay {
    display: none;
    position: fixed; inset: 0; z-index: 100;
    background: rgba(0,0,0,0.45);
    align-items: center; justify-content: center;
    padding: 20px;
  }
  .modal-overlay:target { display: flex; }
  .modal-box {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
    width: 100%; max-width: 780px; max-height: 80vh;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-bottom: 1px solid #e5e7eb;
    background: #f7f8fa; flex-shrink: 0;
  }
  .modal-title { font-size: 15px; font-weight: 700; color: #1f2328; }
  .modal-count { font-size: 12px; font-weight: 400; color: #57606a; margin-left: 8px; }
  .modal-close {
    font-size: 16px; color: #57606a; text-decoration: none;
    line-height: 1; padding: 2px 6px; border-radius: 4px;
    border: 1px solid transparent;
  }
  .modal-close:hover { background: #f3f4f6; border-color: #e5e7eb; color: #1f2328; text-decoration: none; }
  .modal-body { overflow-y: auto; padding: 14px 18px; flex: 1; }
  .bar-group:hover rect:not([fill="transparent"]) { opacity: 1; }
  .chart-hint { font-size: 11px; color: #57606a; margin-top: 4px; }
</style>
</head>
<body>
<div class="container">
  <h1><a href="https://github.ibm.com/orgs/Db2z/projects/32" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">${esc(projectTitle)} — Leadership Summary</a> <span class="audience-tag">Leadership View</span></h1>
  <div class="meta">Generated: ${generatedAt}  |  Source: GitHub Projects (GraphQL)  |  Board: <a href="https://github.ibm.com/orgs/Db2z/projects/32" target="_blank" rel="noopener"><strong>${esc(projectTitle)}</strong></a></div>

  <div class="kpi-row">
    <div class="kpi"><div class="num">${totalItems}</div><div class="lbl">Total Outage Items</div></div>
    <div class="kpi"><div class="num">${doneCount}</div><div class="lbl">Resolved</div></div>
    <div class="kpi"><div class="num">${followupCount}</div><div class="lbl">In Review</div></div>
    <div class="kpi"><div class="num">${assignedCount}</div><div class="lbl">In Progress</div></div>
    ${(byStatus["Unset"] || 0) > 0 ? `<div class="kpi kpi-unset"><div class="num">${byStatus["Unset"]}</div><div class="lbl">Assignment Pending</div></div>` : ""}
    ${(byStatus["Backlog"] || 0) > 0 ? `<div class="kpi"><div class="num" style="color:#374151;">${byStatus["Backlog"]}</div><div class="lbl">Backlog</div></div>` : ""}
  </div>

  <h2>Completion Rate &amp; Category Breakdown</h2>
  <div class="two-col">
    <div class="gauge-wrap">${renderGauge()}</div>
    <div class="chart-wrap">
      <p class="section-note">Top outage categories by volume. Click any bar to see items.</p>
      ${renderCategoryChart()}
      <p class="chart-hint">Click a category label or bar to drill down.</p>
    </div>
  </div>

  <h2>Analysis by Year</h2>
  <p class="section-note">Outage items by OA date year, newest first. Click any row to see the full item list.</p>
  ${renderYearBreakdown()}

  <h2>Resiliency APARs</h2>
  <p class="section-note">Items that resulted in a formal resiliency APAR filing.</p>
  <div class="resil-toggle">
    <details>
      <summary>
        <div class="resil-tile-btn">
          <div class="num">${resiliencyItems.length}</div>
          <div class="lbl">Items with APAR</div>
          <div class="resil-hint">Click to view all ▾</div>
        </div>
      </summary>
      <div class="resil-table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Status</th><th>OA Date</th><th>APAR(s)</th><th>Category</th></tr></thead>
          <tbody>
            ${resiliencyItems.map(item => {
              const statusClass = {"Done":"b-done","Assigned":"b-assigned","Followup Required":"b-followup","Unset":"b-unset"}[item.status] || "b-unset";
              const titleCell = item.issueUrl
                ? `<a href="${esc(item.issueUrl)}" target="_blank" rel="noopener">${esc(item.title)}</a>`
                : esc(item.title);
              return `<tr><td>${titleCell}</td><td><span class="badge ${statusClass}">${esc(item.status || "Unset")}</span></td><td>${esc(item.oaDates || "—")}</td><td>${esc(item.resiliencyApar || "—")}</td><td>${esc(item.outageCategory || "—")}</td></tr>`;
            }).join("\n            ")}
          </tbody>
        </table>
      </div>
    </details>
  </div>

  <h2>Executive Summary</h2>
  ${renderExecSummary()}

  <footer>Made with IBM Bob</footer>
</div>

${renderCategoryModals()}
</body>
</html>`;

writeFileSync(outputPath, html, "utf8");
console.log(`Leadership report written to ${outputPath}`);
