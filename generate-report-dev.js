// generate-report-dev.js — Developer-focused OAT report
// Identical to generate-report.js (full detail view for devs).
// Delegates to generate-report.js with the same args.
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const base = join(__dirname, "generate-report.js");
const args = process.argv.slice(2);

execFileSync(process.execPath, [base, ...args], { stdio: "inherit" });
