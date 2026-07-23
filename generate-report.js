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
const resiliencyItems = items
  .filter((i) => i.resiliencyApar || (i.labels || []).includes("Resiliency Analysis"))
  .sort((a, b) => new Date(b.oaDates || 0) - new Date(a.oaDates || 0));

// KPI counts
const doneCount      = byStatus["Done"] || 0;
const followupCount  = byStatus["Followup Required"] || 0;
const assignedCount  = byStatus["Assigned"] || 0;
const itemsWithDate  = items.filter((i) => i.oaDates && !isNaN(new Date(i.oaDates))).length;

// Year / month breakdown + per-year category counts
const byYearMonth = {};
const byYearCategory = {};
for (const item of items) {
  if (!item.oaDates) continue;
  const d = new Date(item.oaDates);
  if (isNaN(d)) continue;
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (!byYearMonth[y]) byYearMonth[y] = {};
  if (!byYearMonth[y][m]) byYearMonth[y][m] = [];
  byYearMonth[y][m].push(item);
  if (!byYearCategory[y]) byYearCategory[y] = {};
  const cat = item.outageCategory || "—";
  byYearCategory[y][cat] = (byYearCategory[y][cat] || 0) + 1;
}
const years = Object.keys(byYearMonth)
  .sort();

// Top-3 non-uncategorised categories per year as an inline mini-table
function renderYearCats(y) {
  const cats = Object.entries(byYearCategory[y] || {})
    .filter(([c]) => c !== "—")
    .sort((a, b) => b[1] - a[1]);
  const uncategorized = (byYearCategory[y] || {})["—"] || 0;
  if (!cats.length && !uncategorized) return "";
  const rows = cats.map(([c, n]) =>
    `<tr><td>${esc(c)}</td><td style="text-align:right;min-width:28px;">${n}</td></tr>`
  ).join("");
  const uncNote = uncategorized > 0
    ? `<p class="section-note" style="margin:3px 0 0;">${uncategorized} item${uncategorized > 1 ? "s" : ""} uncategorized</p>`
    : "";
  return `<div class="year-cats"><table class="year-cats-table"><thead><tr><th>Categories</th><th style="text-align:right;">Count</th></tr></thead><tbody>${rows}</tbody></table>${uncNote}</div>`;
}

// Items split by OA date
const withDate    = items.filter((i) => i.oaDates && !isNaN(new Date(i.oaDates)))
                         .sort((a, b) => new Date(a.oaDates) - new Date(b.oaDates));
const withoutDate = items.filter((i) => !i.oaDates || isNaN(new Date(i.oaDates)));

// Notes grouping
const noteGroups = {};
for (const item of items) {
  if (!item.notes || !item.notes.trim()) continue;
  const key = item.notes.trim();
  if (!noteGroups[key]) noteGroups[key] = [];
  noteGroups[key].push(item);
}
const sortedNoteGroups = Object.entries(noteGroups).sort((a, b) => {
  if (b[1].length !== a[1].length) return b[1].length - a[1].length;
  return a[0].localeCompare(b[0]);
});
const notedItemsCount = sortedNoteGroups.reduce((s, [, arr]) => s + arr.length, 0);



// Uncategorized items (prioritise open/active statuses, then recent Done)
const uncategorizedItems = items
  .filter((i) => !i.outageCategory)
  .sort((a, b) => {
    const pri = ["Assigned", "Followup Required", "Backlog", "Done", "Unset"];
    return pri.indexOf(a.status || "Unset") - pri.indexOf(b.status || "Unset");
  });

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
    <button class="kpi" onclick="openKpiModal('all')"><div class="num">${totalItems}</div><div class="lbl">Total Outage Items</div></button>
    <button class="kpi" onclick="openKpiModal('done')"><div class="num">${doneCount}</div><div class="lbl">Resolved</div></button>
    <button class="kpi" onclick="openKpiModal('followup')"><div class="num">${followupCount}</div><div class="lbl">In Review</div></button>
    <button class="kpi" onclick="openKpiModal('assigned')"><div class="num">${assignedCount}</div><div class="lbl">In Progress</div></button>
    ${(byStatus["Unset"] || 0) > 0 ? `<button class="kpi kpi-unset" onclick="openKpiModal('status:Unset')"><div class="num">${byStatus["Unset"] || 0}</div><div class="lbl">Assignment Pending</div></button>` : ""}
    ${(byStatus["Backlog"] || 0) > 0 ? `<button class="kpi" onclick="openKpiModal('status:Backlog')"><div class="num" style="color:#374151;">${byStatus["Backlog"] || 0}</div><div class="lbl">Backlog</div></button>` : ""}
  </div>
  <div id="kpi-modal" class="kpi-modal-overlay" onclick="if(event.target===this)closeKpiModal()">
    <div class="kpi-modal-box">
      <div class="kpi-modal-header">
        <span id="kpi-modal-title" class="kpi-modal-title"></span>
        <button class="kpi-modal-close" onclick="closeKpiModal()">✕</button>
      </div>
      <div id="kpi-modal-body" class="kpi-modal-body"></div>
    </div>
  </div>`;
}

function renderStatusBreakdown() {
  const rows = statusEntries.map(([s, c]) => `
      <tr class="clickable-row" onclick="openKpiModal('status:${esc(s)}')" title="View ${esc(s)} items">
        <td>${statusBadge(s)}</td>
        <td>${c}</td>
        <td>${Math.round(c / totalItems * 100)}%</td>
      </tr>`).join("");

  const warn = unsetCount > 0
    ? `<div class="warn">⚠ ${unsetCount} item${unsetCount > 1 ? "s have" : " has"} no Status set — these rows are missing project-board metadata and may need triage.</div>`
    : "";

  return `
  <h2>Status Breakdown</h2>
  <p class="section-note">Click a row to view its items.</p>
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
  <h2>Analysis by Year</h2>
  <p class="section-note">No OA dates recorded.</p>`;
  }

  const blocks = years.map((y) => {
    const months = byYearMonth[y];
    const yearTotal = Object.values(months).reduce((a, b) => a + b.length, 0);
    const allYearItems = Object.values(months).flat()
      .sort((a, b) => new Date(a.oaDates) - new Date(b.oaDates));

    const itemRows = allYearItems.map((i) => `
        <tr>
          <td><a href="${esc(i.issueUrl || "")}" target="_blank" rel="noopener">${esc(i.title)}</a></td>
          <td>${statusBadge(i.status || "Unset")}</td>
          <td>${esc(i.oaDates || "—")}</td>
          <td>${esc(i.outageCategory || "—")}</td>
        </tr>`).join("");

    return `
    <div class="year-section">
      <details>
        <summary><span class="year-title" style="display:inline;">${y} — ${yearTotal} item${yearTotal !== 1 ? "s" : ""}</span></summary>
        ${renderYearCats(y)}
        <div class="month-table-wrap"><table>
          <thead><tr><th>Title</th><th>Status</th><th>OA Date</th><th>Category</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table></div>
      </details>
    </div>`;
  }).join("");

  return `
  <h2>Analysis by Year</h2>
  <p class="section-note">Based on OA Date field. ${noDateCount} of ${totalItems} items (${noDatePct}%) have no OA date and are excluded from this section.</p>
  ${blocks}
  <div class="note">${noDateCount} item${noDateCount !== 1 ? "s" : ""} have no OA date recorded and are excluded above. See the "All Items by OA Date" section for the full list.</div>`;
}

function renderTopCategories() {
  const noCategPct = Math.round(uncategorizedCount / totalItems * 100);
  const rows = categoryEntries
    .map(([c, n]) => `<tr class="clickable-row" onclick="openKpiModal('cat:${esc(c)}')" title="View ${esc(c)} items"><td>${esc(c)}</td><td>${n}</td></tr>`)
    .join("");

  const uncatRow = uncategorizedCount > 0
    ? `<tr class="clickable-row" onclick="openKpiModal('cat:(Uncategorized)')" title="View uncategorized items"><td><em>(Uncategorized)</em></td><td>${uncategorizedCount}</td></tr>`
    : "";

  const warn = uncategorizedCount > 0
    ? `<div class="warn">⚠ ${uncategorizedCount} item${uncategorizedCount > 1 ? "s" : ""} (${noCategPct}%) have no outage category set. See the "Uncategorized Items" section below for suggestions.</div>`
    : "";

  return `
  <h2>Top Outage Categories</h2>
  <p class="section-note">${uncategorizedCount} of ${totalItems} items (${noCategPct}%) have no outage category set. Click a row to view its items.</p>
  <table>
    <thead><tr><th>Category</th><th>Count</th></tr></thead>
    <tbody>${rows}${uncatRow}</tbody>
  </table>
  ${warn}`;
}

function renderResiliency() {
  if (!resiliencyItems.length) {
    return `
  <h2>Resiliency APAR Filed from OAT</h2>
  <p class="section-note">No items with Resiliency APAR set.</p>`;
  }

  const rows = resiliencyItems.map((i) => `
      <tr>
        <td class="truncate" title="${esc(i.title)}"><a href="${esc(i.issueUrl || "")}" target="_blank" rel="noopener">${esc(i.title)}</a></td>
        <td>${statusBadge(i.status || "Unset")}</td>
        <td>${esc(i.oaAssignees || i.assignees || "—")}</td>
        <td>${esc(i.oaDates || "—")}</td>
        <td>${esc(i.resiliencyApar || "—")}</td>
        <td>${esc(i.outageCategory || "—")}</td>
      </tr>`).join("");

  return `
  <h2>Resiliency APAR Filed from OAT</h2>
  <p class="section-note">Items where Resiliency APAR is set. ${resiliencyItems.length} total.</p>
  <table>
    <thead><tr><th>Title</th><th>Status</th><th>OA Assignees</th><th>OA Date</th><th>APAR(s)</th><th>Category</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderAnalysisNotes() {
  if (!sortedNoteGroups.length) {
    return `
  <h2>Analysis Issues with Notes</h2>
  <p class="section-note">No items have notes recorded.</p>`;
  }

  const blocks = sortedNoteGroups.map(([note, groupItems]) => {
    const count = groupItems.length;
    const rows = groupItems.map((i) => {
      const outcome = i.oaOutcome && i.oaOutcome.trim()
        ? `<div class="anote-outcome">${esc(i.oaOutcome.trim())}</div>` : "";
      return `
        <tr>
          <td><a href="${esc(i.issueUrl || "")}" target="_blank" rel="noopener">${esc(i.title)}</a>${outcome}</td>
          <td>${statusBadge(i.status || "Unset")}</td>
          <td>${esc(i.oaDates || "—")}</td>
          <td>${esc(i.outageCategory || "—")}</td>
        </tr>`;
    }).join("");
    return `
  <div class="anote-group"><details>
    <summary><span class="anote-label">${esc(note)}</span><span class="anote-count">${count} item${count !== 1 ? "s" : ""}</span></summary>
    <div class="anote-table-wrap"><table>
      <thead><tr><th>Title / Outcome</th><th>Status</th><th>OA Date</th><th>Category</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </details></div>`;
  }).join("");

  return `
  <h2>Analysis Issues with Notes</h2>
  <p class="section-note">${notedItemsCount} items with notes, grouped by note value. ${sortedNoteGroups.length} distinct notes.</p>
  ${blocks}`;
}

function renderUncategorized() {
  if (!uncategorizedItems.length) {
    return `
  <h2>Uncategorized Items</h2>
  <p class="section-note">All items have an outage category set. ✓</p>`;
  }

  return `
  <h2>Uncategorized Items</h2>
  <button class="uncat-card" onclick="openUncatModal()">
    <div class="uncat-card-inner">
      <div class="uncat-num">${uncategorizedItems.length}</div>
      <div class="uncat-lbl">items without an outage category</div>
      <div class="uncat-hint">Click to view all with suggested categories →</div>
    </div>
  </button>`;
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
const itemsJson = JSON.stringify(items.map((i) => ({
  title:    i.title   || "",
  url:      i.issueUrl || "",
  status:   i.status  || "Unset",
  category: i.outageCategory || "—",
  date:     i.oaDates || "",
})));

const uncatJson = JSON.stringify(uncategorizedItems.map((i) => ({
  title:     i.title   || "",
  url:       i.issueUrl || "",
  status:    i.status  || "Unset",
  date:      i.oaDates || "",
  suggested: suggestCategory(i.title),
})));

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
  .audience-tag { display: inline-block; background: #fdf4ff; border: 1px solid #e9d5ff; color: #6b21a8; font-size: 11px; font-weight: 600; border-radius: 10px; padding: 2px 10px; margin-left: 8px; vertical-align: middle; letter-spacing: 0.03em; }
  h2 { font-size: 16px; font-weight: 700; margin: 32px 0 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  h3 { font-size: 14px; font-weight: 600; margin: 18px 0 8px; color: #1f2328; }
  .meta { color: #57606a; font-size: 13px; margin-bottom: 24px; }
  .kpi-row { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .kpi { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 20px; flex: 1; min-width: 110px; cursor: pointer; text-align: left; font-family: inherit; transition: border-color 0.15s, box-shadow 0.15s; }
  .kpi:hover { border-color: #3b82d4; box-shadow: 0 0 0 2px rgba(59,130,212,0.15); }
  .kpi .num { font-size: 32px; font-weight: 700; color: #3b82d4; line-height: 1.1; }
  .kpi .lbl { font-size: 12px; color: #57606a; margin-top: 2px; }
  .kpi.kpi-alert .num { color: #b45309; }
  .kpi.kpi-unset .num { color: #6b7280; }
  .kpi-modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 1000; align-items: flex-start; justify-content: center; padding: 40px 16px; overflow-y: auto; }
  .kpi-modal-overlay.open { display: flex; }
  .kpi-modal-box { background: #fff; border-radius: 8px; width: 100%; max-width: 820px; box-shadow: 0 8px 32px rgba(0,0,0,0.18); display: flex; flex-direction: column; max-height: calc(100vh - 80px); }
  .kpi-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
  .kpi-modal-title { font-size: 15px; font-weight: 700; color: #1f2328; }
  .kpi-modal-close { background: none; border: none; font-size: 16px; cursor: pointer; color: #57606a; padding: 2px 6px; border-radius: 4px; line-height: 1; }
  .kpi-modal-close:hover { background: #f3f4f6; color: #1f2328; }
  .kpi-modal-body { overflow-y: auto; padding: 16px 18px; font-size: 13px; }
  .kpi-modal-body table { width: 100%; }
  .kpi-count { font-size: 12px; color: #57606a; margin-bottom: 10px; }
  .clickable-row { cursor: pointer; }
  .clickable-row:hover td { background: #eff6ff; color: #1e40af; }
  .uncat-card { display: inline-block; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 16px 24px; cursor: pointer; text-align: left; font-family: inherit; margin: 6px 0; transition: border-color 0.15s, box-shadow 0.15s; }
  .uncat-card:hover { border-color: #f59e0b; box-shadow: 0 0 0 2px rgba(245,158,11,0.18); }
  .uncat-card-inner { display: flex; flex-direction: column; gap: 2px; }
  .uncat-num { font-size: 32px; font-weight: 700; color: #b45309; line-height: 1.1; }
  .uncat-lbl { font-size: 13px; color: #92400e; font-weight: 600; }
  .uncat-hint { font-size: 12px; color: #b45309; margin-top: 4px; }
  .suggested-cat { display: inline-block; background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; border-radius: 10px; padding: 1px 8px; font-size: 11px; font-weight: 600; white-space: nowrap; }
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
  .ym-month-block { margin-bottom: 8px; }
  .ym-month-block > details { border-left: 3px solid #e5e7eb; padding-left: 12px; }
  .ym-month-block > details > summary { display: flex; align-items: center; gap: 10px; padding: 5px 0; cursor: pointer; list-style: none; user-select: none; }
  .ym-month-block > details > summary::-webkit-details-marker { display: none; }
  .ym-month-block > details > summary::before { content: "▶"; font-size: 10px; color: #57606a; transition: transform 0.15s; flex-shrink: 0; }
  .ym-month-block > details[open] > summary::before { transform: rotate(90deg); }
  .ym-month-block > details > summary:hover .ym-month-label { color: #3b82d4; }
  .ym-month-label { font-size: 13px; font-weight: 600; color: #1f2328; min-width: 36px; }
  .ym-count { font-size: 12px; color: #57606a; }
  .ym-month-block > details > .month-table-wrap { padding-top: 6px; padding-bottom: 8px; }
  .year-cats { margin: 6px 0 10px; }
  .year-cats-table { width: auto; min-width: 260px; font-size: 12px; margin-bottom: 0; }
  .year-cats-table th { font-size: 11px; padding: 4px 8px; background: #f0f4ff; }
  .year-cats-table td { padding: 3px 8px; font-size: 12px; }
  .anote-group { margin-bottom: 6px; }
  .anote-group > details { border-left: 3px solid #7c5cd8; padding-left: 12px; }
  .anote-group > details > summary { display: flex; align-items: center; gap: 10px; padding: 5px 0; cursor: pointer; list-style: none; user-select: none; }
  .anote-group > details > summary::-webkit-details-marker { display: none; }
  .anote-group > details > summary::before { content: "▶"; font-size: 10px; color: #57606a; flex-shrink: 0; }
  .anote-group > details[open] > summary::before { transform: rotate(90deg); }
  .anote-group > details > summary:hover .anote-label { color: #7c5cd8; }
  .anote-label { font-size: 13px; font-weight: 600; color: #1f2328; }
  .anote-count { font-size: 12px; color: #57606a; }
  .anote-table-wrap { padding-top: 6px; padding-bottom: 8px; }
  .anote-outcome { font-size: 11px; color: #57606a; margin-top: 2px; font-style: italic; }

  footer { margin-top: 48px; padding-top: 12px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #57606a; }
  .section-note { font-size: 12px; color: #57606a; margin-bottom: 6px; }
</style>
</head>
<body>
<div class="container">
  <h1><a href="https://github.ibm.com/orgs/Db2z/projects/32" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">${esc(projectTitle)} — Dashboard Summary</a> <span class="audience-tag">OAT-Team View</span></h1>
  <div class="meta">Generated: ${generatedAt}  |  Source: GitHub Projects (GraphQL)  |  Board: <a href="https://github.ibm.com/orgs/Db2z/projects/32" target="_blank" rel="noopener"><strong>${esc(projectTitle)}</strong></a></div>

  ${renderKPIs()}
  ${renderStatusBreakdown()}
  ${renderTopCategories()}
  ${renderYearMonth()}
  ${renderResiliency()}
  ${renderAnalysisNotes()}
  ${isWorkflow ? "" : renderUncategorized()}
  ${isWorkflow ? "" : renderKeyObservations()}

  <footer>Made with IBM Bob</footer>
</div>
<script>
(function () {
  var ALL_ITEMS = ${itemsJson};
  var UNCAT_ITEMS = ${uncatJson};

  function filterItems(key) {
    if (key.startsWith("status:")) {
      var s = key.slice(7);
      return ALL_ITEMS.filter(function(i){ return i.status === s; });
    }
    if (key.startsWith("cat:")) {
      var c = key.slice(4);
      if (c === "(Uncategorized)") return ALL_ITEMS.filter(function(i){ return !i.category || i.category === "—"; });
      return ALL_ITEMS.filter(function(i){ return i.category === c; });
    }
    switch (key) {
      case "done":     return ALL_ITEMS.filter(function(i){ return i.status === "Done"; });
      case "followup": return ALL_ITEMS.filter(function(i){ return i.status === "Followup Required"; });
      case "assigned": return ALL_ITEMS.filter(function(i){ return i.status === "Assigned"; });
      case "withdate": return ALL_ITEMS.filter(function(i){ return i.date && !isNaN(new Date(i.date)); });
      default:         return ALL_ITEMS;
    }
  }

  var LABELS = {
    all:      "All Items",
    done:     "Resolved",
    followup: "In Review",
    assigned: "In Progress",
    withdate: "Items with OA Dates"
  };

  var STATUS_CLS = { "Done": "b-done", "Assigned": "b-assigned", "Followup Required": "b-followup", "Backlog": "b-backlog" };

  function badge(s) {
    var cls = STATUS_CLS[s] || "b-unset";
    return '<span class="badge ' + cls + '">' + esc(s || "Unset") + '</span>';
  }

  function esc(s) {
    return s == null ? "" : String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  window.openKpiModal = function(key) {
    var items = filterItems(key);
    var label = LABELS[key] || (key.startsWith("status:") ? key.slice(7) : key.startsWith("cat:") ? key.slice(4) : key);
    document.getElementById("kpi-modal-title").textContent = label;
    var rows = items.map(function(i) {
      var link = i.url
        ? '<a href="' + esc(i.url) + '" target="_blank" rel="noopener">' + esc(i.title) + '</a>'
        : esc(i.title);
      return "<tr><td>" + link + "</td><td>" + badge(i.status) + "</td><td>" + esc(i.date || "—") + "</td><td>" + esc(i.category) + "</td></tr>";
    }).join("");
    document.getElementById("kpi-modal-body").innerHTML =
      '<p class="kpi-count">' + items.length + ' item' + (items.length !== 1 ? 's' : '') + '</p>' +
      '<table><thead><tr><th>Title</th><th>Status</th><th>OA Date</th><th>Category</th></tr></thead><tbody>' + rows + '</tbody></table>';
    document.getElementById("kpi-modal").classList.add("open");
    document.body.style.overflow = "hidden";
  };

  window.openUncatModal = function() {
    document.getElementById("kpi-modal-title").textContent = "Uncategorized Items — Suggested Categories";
    var rows = UNCAT_ITEMS.map(function(i) {
      var link = i.url
        ? '<a href="' + esc(i.url) + '" target="_blank" rel="noopener">' + esc(i.title) + '</a>'
        : esc(i.title);
      return "<tr><td>" + link + "</td><td>" + badge(i.status) + "</td><td>" + esc(i.date || "—") + "</td><td><span class='suggested-cat'>" + esc(i.suggested) + "</span></td></tr>";
    }).join("");
    document.getElementById("kpi-modal-body").innerHTML =
      '<p class="kpi-count">' + UNCAT_ITEMS.length + ' item' + (UNCAT_ITEMS.length !== 1 ? 's' : '') + ' — suggested categories based on title keywords. Prioritised by active status.</p>' +
      '<table><thead><tr><th>Title</th><th>Status</th><th>OA Date</th><th>Suggested Category</th></tr></thead><tbody>' + rows + '</tbody></table>';
    document.getElementById("kpi-modal").classList.add("open");
    document.body.style.overflow = "hidden";
  };

  window.closeKpiModal = function() {
    document.getElementById("kpi-modal").classList.remove("open");
    document.body.style.overflow = "";
  };

  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") window.closeKpiModal();
  });
})();
</script>
</body>
</html>`;

writeFileSync(outputPath, html, "utf8");
console.log(`Report written to ${outputPath}`);
