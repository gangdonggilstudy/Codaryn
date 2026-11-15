// Offline inventory aid (DR-75), never an adoption or release gate.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const LOCKS = ["package-lock.json", "gui/package-lock.json"];
const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"]);
export const NOTICE = "lock 밖 구성 요소(Electron 바이너리 안의 Chromium·Node·FFmpeg 등)는 이 목록에 없으며 별도로 확인한다";

/** Conservative metadata triage, not a full SPDX parser or compliance decision. */
export function classifyLicense(license) {
  if (license === undefined || license === null || (typeof license === "string" && license.trim() === "")) return "deny";
  if (typeof license !== "string") return "review";
  const value = license.trim();
  if (ALLOWED.has(value)) return "allow";
  if (/^(?:UNLICENSED|NONE|NO LICENSE)$/i.test(value)) return "deny";
  if (/^SEE LICENSE IN\b/i.test(value)) return "review";
  const tokens = value.match(/\(|\)|[^\s()]+/g) ?? [];
  if (tokens.some((token) => /^(?:OR|AND|WITH|\(|\))$/i.test(token))) {
    let balance = 0;
    for (const token of tokens) {
      if (token === "(") balance += 1;
      if (token === ")" && --balance < 0) return "review";
    }
    if (balance !== 0) return "review";
    // Only grouping and the policy's operators are recognized, not full SPDX syntax.
    const evaluate = (parts) => {
      while (parts[0] === "(") {
        let depth = 0;
        const close = parts.findIndex((token) => {
          if (token === "(") depth += 1;
          if (token === ")") depth -= 1;
          return depth === 0;
        });
        if (close !== parts.length - 1) break;
        parts = parts.slice(1, -1);
      }
      const split = (operator) => {
        let depth = 0, start = 0;
        const groups = [];
        parts.forEach((token, i) => {
          if (token === "(") depth += 1;
          else if (token === ")") depth -= 1;
          else if (depth === 0 && operator.test(token)) { groups.push(parts.slice(start, i)); start = i + 1; }
        });
        return groups.length === 0 ? null : [...groups, parts.slice(start)];
      };
      const alternatives = split(/^OR$/i), required = alternatives ?? split(/^(?:AND|WITH)$/i);
      if (required !== null) {
        if (required.some((part) => part.length === 0)) return "review";
        const results = required.map(evaluate);
        const deny = alternatives !== null ? results.every((result) => result === "deny") : results.some((result) => result === "deny");
        return deny ? "deny" : "review";
      }
      if (parts.length !== 1 || /^(?:OR|AND|WITH|\(|\))$/i.test(parts[0])) return "review";
      return classifyLicense(parts[0]);
    };
    // Even an expression with an allowed alternative remains a manual review item.
    return evaluate(tokens) === "deny" ? "deny" : "review";
  }
  // Match complete family prefixes, so LGPL and Boost's BSL-1.0 never become GPL/BUSL.
  const identifiers = value.split(/[\s()]+/);
  if (identifiers.some((id) => /^(?:GPL|AGPL|SSPL|BUSL)(?:[-\d]|$)/i.test(id))) return "deny";
  if (/(?:^|[-\s])(?:non[-\s]?commercial|paid[-\s]?only|commercial[-\s]?only)(?:$|[-\s])/i.test(value)
      || /\bCC-BY-NC(?:-|$)/i.test(value)) return "deny";
  // LGPL/MPL, BSL-1.0 and unknown IDs need review.
  return "review";
}

export function collectPackages(lock, lockFile) {
  const entries = lock?.packages;
  if (entries === null || typeof entries !== "object" || Array.isArray(entries)) return [];
  return Object.entries(entries).filter(([location]) => location !== "")
    .sort(([a], [b]) => a.localeCompare(b)).map(([location, metadata]) => {
      const entry = metadata !== null && typeof metadata === "object" ? metadata : {};
      return {
        lock: lockFile, path: location,
        name: typeof entry.name === "string" && entry.name !== "" ? entry.name : location.split("node_modules/").at(-1),
        version: entry.version ?? null, license: entry.license ?? null,
        dev: entry.dev === true, optional: entry.optional === true,
        classification: classifyLicense(entry.license),
      };
    });
}

function cell(value) {
  const text = value === null ? "(미기재)" : typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/[\u0000-\u001f\u007f]/g, " ");
}

/** read/out/err are I/O boundaries for synthetic tests; default inputs are script-relative. */
export function run({ jsonOutput = false, read = readFileSync, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  const packages = [], warnings = [];
  for (const lockFile of LOCKS) {
    let lock;
    try { lock = JSON.parse(read(path.join(ROOT, lockFile), "utf8")); }
    catch (error) {
      const code = error instanceof SyntaxError ? "invalid_json" : "read_error";
      err(`license check: ${lockFile}: ${code}\n`);
      return 2;
    }
    if (lock?.packages === null || typeof lock?.packages !== "object" || Array.isArray(lock.packages)) {
      warnings.push(`${lockFile}: packages 목록 형식을 확인한다`);
    }
    packages.push(...collectPackages(lock, lockFile));
  }
  const summary = { allow: 0, review: 0, deny: 0 };
  for (const row of packages) summary[row.classification] += 1;
  if (jsonOutput) out(JSON.stringify({ packages, summary, warnings, notice: NOTICE }, null, 2) + "\n");
  else {
    out("lock\tname\tversion\tlicense\tdev\toptional\tclassification\n");
    for (const row of packages) out([row.lock, row.name, row.version, row.license, row.dev, row.optional, row.classification].map(cell).join("\t") + "\n");
    out(`allow=${summary.allow} review=${summary.review} deny=${summary.deny} (비차단 보조 목록)\n`);
    for (const warning of warnings) out(warning + "\n");
    out(NOTICE + "\n");
  }
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run({ jsonOutput: process.argv.includes("--json") });
}
