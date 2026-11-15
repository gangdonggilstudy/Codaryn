#!/usr/bin/env node
// Secret scan for commits. Never prints a matched value, only file, line number and rule name.
// Usage:
//   node scripts/check-secrets.mjs --staged          scan staged changes (pre-commit hook)
//   node scripts/check-secrets.mjs --range A...B     scan lines added in a revision range
//   node scripts/check-secrets.mjs --tracked         scan every tracked file
// Exit code 0: nothing found. 1: findings. 2: usage or git error.
import { execFileSync } from "node:child_process";

const RULES = [
  { name: "anthropic-api-key", re: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  // U-75: OpenAI keys with a distinct prefix, the shape the CLI refuses (OPENAI_PREFIXED_KEY_PATTERN_SOURCE
  // in src/contracts/config.ts). generic-sk-key below misses them: a hyphen follows the prefix.
  { name: "openai-api-key", re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/ },
  { name: "generic-sk-key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "api-key-assignment", re: /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*[=:]\s*["']?[A-Za-z0-9_-]{12,}/ },
];
const FORBIDDEN_PATHS = [/(^|\/)\.env$/, /(^|\/)\.env\.(?!example$)[^/]+$/, /\.pem$/, /(^|\/)id_(rsa|ed25519)$/];
// Values of these environment variables must never appear in a commit, whatever their format.
const LIVE_ENV = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function scanLine(text) {
  const hits = [];
  for (const rule of RULES) if (rule.re.test(text)) hits.push(rule.name);
  for (const name of LIVE_ENV) {
    const value = process.env[name];
    if (value && value.length >= 8 && text.includes(value)) hits.push(`live-env-value:${name}`);
  }
  return hits;
}

function scanDiff(diffText) {
  const findings = [];
  let file = null;
  let line = 0;
  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw.startsWith("+++ b/") ? raw.slice(6) : null;
    } else if (raw.startsWith("@@")) {
      const m = /\+(\d+)/.exec(raw);
      line = m ? Number(m[1]) - 1 : 0;
    } else if (raw.startsWith("+") && !raw.startsWith("+++")) {
      line += 1;
      for (const rule of scanLine(raw.slice(1))) findings.push({ file, line, rule });
    } else if (!raw.startsWith("-")) {
      line += 1;
    }
  }
  return findings;
}

function checkPaths(paths) {
  const findings = [];
  for (const p of paths) {
    if (p && FORBIDDEN_PATHS.some((re) => re.test(p))) findings.push({ file: p, line: 0, rule: "forbidden-path" });
  }
  return findings;
}

const [mode, arg] = process.argv.slice(2);
let findings = [];
try {
  if (mode === "--staged") {
    findings = scanDiff(git(["diff", "--cached", "-U0", "--no-color"]));
    findings.push(...checkPaths(git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).split("\n")));
  } else if (mode === "--range" && arg) {
    findings = scanDiff(git(["diff", "-U0", "--no-color", arg]));
    findings.push(...checkPaths(git(["diff", "--name-only", "--diff-filter=ACMR", arg]).split("\n")));
  } else if (mode === "--tracked") {
    const files = git(["ls-files"]).split("\n").filter(Boolean);
    findings.push(...checkPaths(files));
    for (const file of files) {
      let text;
      try {
        text = git(["show", `:${file}`]);
      } catch {
        continue;
      }
      text.split("\n").forEach((content, index) => {
        for (const rule of scanLine(content)) findings.push({ file, line: index + 1, rule });
      });
    }
  } else {
    console.error("usage: check-secrets.mjs --staged | --range <A...B> | --tracked");
    process.exit(2);
  }
} catch (error) {
  console.error(`check-secrets: git failed (${error.status ?? "unknown"})`);
  process.exit(2);
}

if (findings.length === 0) {
  console.log("check-secrets: no findings");
  process.exit(0);
}
for (const f of findings) console.error(`check-secrets: ${f.file}:${f.line} ${f.rule}`);
console.error(`check-secrets: ${findings.length} finding(s). Matched values are not printed.`);
process.exit(1);
