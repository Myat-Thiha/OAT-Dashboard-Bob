#!/usr/bin/env node
/**
 * generate-executive-report.js
 *
 * Reads project-data.json and writes a self-contained executive briefing HTML
 * to outage-analysis-executive.html.
 *
 * Usage:
 *   node generate-executive-report.js
 *   node generate-executive-report.js --input project-data.json --output exec.html
 */

import { readFileSync, writeFileSync } from "fs";

const args = process.argv.slice(2);
const inputPath  = args[args.indexOf("--input")  + 1] || "project-data.json";
const outputPath = args[args.indexOf("--output") + 1] || "outage-analysis-executive.html";

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

const openItems   = items.filter(i => i.issueState === "open");
const closedItems = items.filter(i => i.issueState === "closed");
const resiliencyItems = items.filter(i => i.resiliencyApar || (i.labels || []).includes("Resiliency Analysis"));

// Status breakdown
const byStatus = {};
for (const i of items) { const s = i.status || "Unset"; byStatus[s] = (byStatus[s] || 0) + 1; }
const statusEntries = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);

// Category breakdown (top 6, rest grouped)
const byCat = {};
for (const i of items) { const c = i.outageCategory || "(Uncategorized)"; byCat[c] = (byCat[c] || 0) + 1; }
const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
const TOP_N = 6;
const topCats = catEntries.slice(0, TOP_N);
const otherCount = catEntries.slice(TOP_N).reduce((s, [, n]) => s + n, 0);
if (otherCount > 0) topCats.push(["Other", otherCount]);

// Monthly OA activity (last 12 months with data)
const byMonth = {};
for (const i of items) {
  if (!i.oaDates) continue;
  const m = String(i.oaDates).slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(m)) byMonth[m] = (byMonth[m] || 0) + 1;
}
const monthlyEntries = Object.entries(byMonth).sort().slice(-12);

// Top assignees by workload
const byAssignee = {};
for (const i of items) {
  if (!i.assignees) continue;
  for (const a of i.assignees.split(",")) {
    const k = a.trim(); if (k) byAssignee[k] = (byAssignee[k] || 0) + 1;
  }
}
const topAssignees = Object.entries(byAssignee).sort((a, b) => b[1] - a[1]).slice(0, 6);

// Followup required
const followupItems = items.filter(i => i.status === "Followup Required");

// ---------------------------------------------------------------------------
// SVG chart helpers
// ---------------------------------------------------------------------------

const W = 680, BAR_H = 22, BAR_GAP = 8, PAD_LEFT = 160, PAD_RIGHT = 60;

function svgBarChart(entries, total, colorFn) {
  const rows = entries.length;
  const h = rows * (BAR_H + BAR_GAP) + 10;
  const maxVal = entries[0]?.[1] || 1;
  const availW = W - PAD_LEFT - PAD_RIGHT;

  const bars = entries.map(([label, val], idx) => {
    const y = idx * (BAR_H + BAR_GAP) + 4;
    const bw = Math.max(2, Math.round(val / maxVal * availW));
    const pct = Math.round(val / total * 100);
    const color = colorFn(label, idx);
    const displayLabel = label.length > 26 ? label.slice(0, 24) + "…" : label;
    return `
      <text x="${PAD_LEFT - 8}" y="${y + BAR_H * 0.68}" text-anchor="end" font-size="12" fill="#57606a">${displayLabel}</text>
      <rect x="${PAD_LEFT}" y="${y}" width="${bw}" height="${BAR_H}" fill="${color}" rx="3"/>
      <text x="${PAD_LEFT + bw + 6}" y="${y + BAR_H * 0.68}" font-size="12" fill="#1f2328">${val} <tspan fill="#57606a">(${pct}%)</tspan></text>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">${bars}</svg>`;
}

function svgLineChart(entries) {
  if (!entries.length) return `<p style="color:#57606a;font-size:13px">No OA date data available.</p>`;
  const CW = 680, CH = 140, PL = 36, PR = 16, PT = 12, PB = 32;
  const vals = entries.map(([, v]) => v);
  const maxV = Math.max(...vals, 1);
  const iW = CW - PL - PR;
  const iH = CH - PT - PB;
  const pts = entries.map(([, v], i) => {
    const x = PL + (i / Math.max(entries.length - 1, 1)) * iW;
    const y = PT + iH - (v / maxV) * iH;
    return [x, y, v];
  });

  const polyline = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${PL},${PT + iH} ` + pts.map(([x, y]) => `${x},${y}`).join(" ") + ` ${PL + iW},${PT + iH}`;

  const labels = entries.map(([m], i) => {
    const x = PL + (i / Math.max(entries.length - 1, 1)) * iW;
    // show every other label to avoid crowding
    if (i % 2 !== 0 && i !== entries.length - 1) return "";
    const short = m.slice(2); // "YY-MM"
    return `<text x="${x}" y="${CH - 6}" text-anchor="middle" font-size="10" fill="#57606a">${short}</text>`;
  }).join("");

  const dots = pts.map(([x, y, v]) =>
    `<circle cx="${x}" cy="${y}" r="3" fill="#3b82d4"/><title>${v}</title>`
  ).join("");

  // y-axis gridlines at 25 / 50 / 75 / 100%
  const grids = [0.25, 0.5, 0.75, 1].map(f => {
    const y = PT + iH - f * iH;
    const val = Math.round(f * maxV);
    return `<line x1="${PL}" y1="${y}" x2="${PL + iW}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>
            <text x="${PL - 4}" y="${y + 4}" text-anchor="end" font-size="10" fill="#adb5bd">${val}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${CW} ${CH}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">
    ${grids}
    <polygon points="${area}" fill="#3b82d4" fill-opacity="0.08"/>
    <polyline points="${polyline}" fill="none" stroke="#3b82d4" stroke-width="2"/>
    ${dots}
    ${labels}
  </svg>`;
}

// Colour palettes
const CAT_COLORS  = ["#3b82d4","#7c5cd8","#0969da","#bf8700","#1a7f37","#cf222e","#57606a"];
const STATUS_COLORS = { "Done": "#1a7f37", "In Progress": "#bf8700", "Assigned": "#0969da", "Followup Required": "#cf222e", "Backlog": "#57606a", "Unset": "#adb5bd" };

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------
const esc = s => s == null ? "" : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function kpi(num, label, sub, color = "#1f2328") {
  return `<div class="kpi">
    <div class="kpi-num" style="color:${color}">${num}</div>
    <div class="kpi-label">${label}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
  </div>`;
}

function statusDot(status) {
  const c = STATUS_COLORS[status] || "#adb5bd";
  return `<span class="dot" style="background:${c}"></span>${esc(status || "Unset")}`;
}

// ---------------------------------------------------------------------------
// Build sections
// ---------------------------------------------------------------------------

const doneCount      = byStatus["Done"]             || 0;
const assignedCount  = byStatus["Assigned"]          || 0;
const followupCount  = byStatus["Followup Required"] || 0;
const completionPct  = Math.round(doneCount / totalItems * 100);

// Followup table (capped at 10 for exec view)
const followupRows = followupItems.slice(0, 10).map(i => {
  const titleLinked = i.issueUrl
    ? `<a href="${esc(i.issueUrl)}" target="_blank" rel="noopener">${esc(i.title)}</a>`
    : esc(i.title);
  return `<tr>
    <td>${titleLinked}</td>
    <td>${esc(i.assignees || i.oaAssignees || "—")}</td>
    <td>${esc(i.oaDates || "—")}</td>
    <td>${esc(i.oaOutcome || "—")}</td>
  </tr>`;
}).join("");
const followupMore = followupItems.length > 10
  ? `<p class="muted" style="font-size:12px;margin-top:6px">+ ${followupItems.length - 10} more follow-up items not shown</p>`
  : "";

// Resiliency table
const resiliencyRows = resiliencyItems.map(i => {
  const titleLinked = i.issueUrl
    ? `<a href="${esc(i.issueUrl)}" target="_blank" rel="noopener">${esc(i.title)}</a>`
    : esc(i.title);
  return `<tr>
    <td>${titleLinked}</td>
    <td><span class="dot" style="background:${STATUS_COLORS[i.status]||'#adb5bd'}"></span>${esc(i.status || "Unset")}</td>
    <td>${esc(i.resiliencyApar || "—")}</td>
    <td>${esc(i.assignees || i.oaAssignees || "—")}</td>
  </tr>`;
}).join("");

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(projectTitle)} — Executive Briefing</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.6; background: #fff; color: #1f2328; }
  .page { max-width: 780px; margin: 0 auto; padding: 40px 28px 72px; }

  /* Header */
  .report-header { border-bottom: 2px solid #1f2328; padding-bottom: 14px; margin-bottom: 28px; }
  .report-header h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }
  .report-header .subtitle { font-size: 13px; color: #57606a; margin-top: 3px; }

  /* Section */
  .section { margin-bottom: 40px; }
  .section h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #57606a; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 16px; }

  /* KPI row */
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 0; }
  .kpi { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 18px; }
  .kpi-num { font-size: 32px; font-weight: 700; line-height: 1; }
  .kpi-label { font-size: 12px; color: #57606a; margin-top: 5px; font-weight: 500; }
  .kpi-sub { font-size: 11px; color: #adb5bd; margin-top: 2px; }

  /* Progress bar */
  .progress-wrap { background: #e5e7eb; border-radius: 6px; height: 10px; margin: 6px 0 10px; overflow: hidden; }
  .progress-bar { height: 10px; background: #1a7f37; border-radius: 6px; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; color: #57606a; border-bottom: 1px solid #e5e7eb; padding: 6px 10px; }
  td { padding: 8px 10px; border-bottom: 1px solid #f0f1f3; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  a { color: #3b82d4; text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Dot */
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }

  /* Chart containers */
  .chart-box { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; }
  .chart-title { font-size: 12px; font-weight: 600; color: #57606a; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.4px; }

  /* Two-col layout */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 600px) { .two-col { grid-template-columns: 1fr; } }

  .muted { color: #57606a; }
  .highlight-red { color: #cf222e; font-weight: 600; }

  footer { margin-top: 56px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #57606a; }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="report-header">
    <h1>${esc(projectTitle)}</h1>
    <div class="subtitle">Executive Briefing &nbsp;·&nbsp; Generated ${generatedAt}</div>
  </div>

  <!-- 1. At-a-Glance KPIs -->
  <div class="section">
    <h2>At a Glance</h2>
    <div class="kpi-row">
      ${kpi(totalItems, "Total Cases")}
      ${kpi(doneCount, "Completed", `${completionPct}% completion rate`, "#1a7f37")}
      ${kpi(assignedCount, "In Progress", "actively assigned")}
      ${kpi(followupCount, "Follow-up Required", "need action", "#cf222e")}
      ${kpi(openItems.length, "Open Issues", "not yet closed")}
      ${kpi(resiliencyItems.length, "Resiliency APARs", "tagged for APAR", "#7c5cd8")}
    </div>
    <div style="margin-top:14px">
      <div style="font-size:12px;color:#57606a;margin-bottom:4px">Overall completion &mdash; ${doneCount} of ${totalItems} cases done (${completionPct}%)</div>
      <div class="progress-wrap"><div class="progress-bar" style="width:${completionPct}%"></div></div>
    </div>
  </div>

  <!-- 2. Status + Category charts side by side -->
  <div class="section">
    <h2>Case Distribution</h2>
    <div class="two-col">
      <div class="chart-box">
        <div class="chart-title">By Status</div>
        ${svgBarChart(statusEntries, totalItems, (label) => STATUS_COLORS[label] || "#adb5bd")}
      </div>
      <div class="chart-box">
        <div class="chart-title">By Outage Category</div>
        ${svgBarChart(topCats, totalItems, (_, i) => CAT_COLORS[i % CAT_COLORS.length])}
      </div>
    </div>
  </div>

  <!-- 3. Monthly Activity Trend -->
  <div class="section">
    <h2>OA Activity Trend (last ${monthlyEntries.length} months with data)</h2>
    <div class="chart-box">
      <div class="chart-title">Cases by OA Date — monthly</div>
      ${svgLineChart(monthlyEntries)}
    </div>
  </div>

  <!-- 4. Team Workload -->
  <div class="section">
    <h2>Team Workload</h2>
    <div class="chart-box">
      <div class="chart-title">Cases per assignee (top ${topAssignees.length})</div>
      ${svgBarChart(topAssignees, totalItems, (_, i) => CAT_COLORS[i % CAT_COLORS.length])}
    </div>
  </div>

  <!-- 5. Follow-up Required -->
  <div class="section">
    <h2>Follow-up Required &nbsp;<span class="highlight-red">${followupItems.length}</span></h2>
    ${followupItems.length === 0
      ? `<p class="muted">No items currently require follow-up.</p>`
      : `<table>
          <thead><tr><th>Case</th><th>Assignee</th><th>OA Date</th><th>Outcome / Next Step</th></tr></thead>
          <tbody>${followupRows}</tbody>
        </table>${followupMore}`
    }
  </div>

  <!-- 6. Resiliency APARs -->
  <div class="section">
    <h2>Resiliency APAR Items &nbsp;<span style="color:#7c5cd8;font-weight:600">${resiliencyItems.length}</span></h2>
    ${resiliencyItems.length === 0
      ? `<p class="muted">No Resiliency Analysis items found.</p>`
      : `<table>
          <thead><tr><th>Case</th><th>Status</th><th>APAR</th><th>Assignee</th></tr></thead>
          <tbody>${resiliencyRows}</tbody>
        </table>`
    }
  </div>

</div>
<footer>Made with IBM Bob</footer>
</body>
</html>`;

writeFileSync(outputPath, html, "utf8");
console.log(`Executive report written to ${outputPath}`);
