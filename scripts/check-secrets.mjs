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
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** Git patch headers use C quoting (including octal UTF-8 bytes), unlike -z path lists. */
function patchPath(value) {
  if (!value.startsWith('"')) return value.endsWith("\t") ? value.slice(0, -1) : value;
  const bytes = [];
  const escapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  for (let i = 1; i < value.length; i++) {
    const char = value[i];
    if (char === '"') {
      if (value.slice(i + 1) !== "" && value.slice(i + 1) !== "\t") throw new Error("invalid patch path");
      return Buffer.from(bytes).toString("utf8");
    }
    if (char === "\\") {
      const octal = /^[0-7]{1,3}/.exec(value.slice(i + 1));
      if (octal !== null) {
        const byte = Number.parseInt(octal[0], 8);
        if (byte > 255) throw new Error("invalid patch path");
        bytes.push(byte);
        i += octal[0].length;
      } else {
        const escaped = value[++i];
        if (!Object.hasOwn(escapes, escaped)) throw new Error("invalid patch path");
        bytes.push(escapes[escaped]);
      }
    } else {
      const cp = value.codePointAt(i);
      bytes.push(...Buffer.from(String.fromCodePoint(cp), "utf8"));
      if (cp > 0xffff) i++;
    }
  }
  throw new Error("invalid patch path");
}

function diagnosticPath(file) {
  if (file === null) return "null";
  return file.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, (char) => {
    if (char === "\n") return "\\n";
    if (char === "\t") return "\\t";
    if (char === "\r") return "\\r";
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
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

class CombinedDiffError extends Error {}

function scanDiff(diffText) {
  const findings = [];
  let file = null;
  let line = 0;
  let inHunk = false;
  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("@@@")) throw new CombinedDiffError();
    if (raw.startsWith("diff --git ")) {
      file = null;
      inHunk = false;
    } else if (raw.startsWith("@@")) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      inHunk = m !== null;
      line = m ? Number(m[1]) - 1 : 0;
    } else if (!inHunk && raw.startsWith("+++ ")) {
      const named = patchPath(raw.slice(4));
      file = named.startsWith("b/") ? named.slice(2) : null;
    } else if (inHunk && raw.startsWith("+")) {
      line += 1;
      for (const rule of scanLine(raw.slice(1))) findings.push({ file, line, rule });
    } else if (inHunk && raw.startsWith(" ")) {
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

/** Keep the NUL path intact after the metadata tab, including tabs and newlines in the name. */
function indexEntries() {
  return git(["ls-files", "--stage", "-z"]).split("\0").filter(Boolean).map((entry) => {
    const parsed = /^([0-7]{6}) (?:[0-9a-f]{40}|[0-9a-f]{64}) ([0-3])\t([\s\S]+)$/.exec(entry);
    if (parsed === null) throw new Error("invalid index entry");
    return { mode: parsed[1], stage: parsed[2], file: parsed[3] };
  });
}

// Only resolved gitlinks are opaque references to another repository, never parent blobs.
const isGitlink = (entry) => entry.mode === "160000" && entry.stage === "0";

const [mode, arg] = process.argv.slice(2);
let findings = [];
try {
  if (mode === "--staged") {
    const gitlinks = new Set(indexEntries().filter(isGitlink).map((entry) => entry.file));
    findings = scanDiff(git(["diff", "--cached", "-U0", "--no-color", "--submodule=short", "--src-prefix=a/", "--dst-prefix=b/"]));
    findings.push(...checkPaths(git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]).split("\0").filter((file) => !gitlinks.has(file))));
  } else if (mode === "--range" && arg) {
    findings = scanDiff(git(["diff", "-U0", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", arg]));
    findings.push(...checkPaths(git(["diff", "--name-only", "-z", "--diff-filter=ACMR", arg]).split("\0")));
  } else if (mode === "--tracked") {
    const files = indexEntries().filter((entry) => !isGitlink(entry)).map((entry) => entry.file);
    findings.push(...checkPaths(files));
    for (const file of files) {
      let text;
      try {
        text = git(["show", `:${file}`]);
      } catch {
        findings.push({ file, line: 0, rule: "index-read-failed" });
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
  if (error instanceof CombinedDiffError) console.error("check-secrets: combined diff is not supported");
  else console.error(`check-secrets: git failed (${error.status ?? "unknown"})`);
  process.exit(2);
}

if (findings.length === 0) {
  console.log("check-secrets: no findings");
  process.exit(0);
}
for (const f of findings) console.error(`check-secrets: ${diagnosticPath(f.file)}:${f.line} ${f.rule}`);
console.error(`check-secrets: ${findings.length} finding(s). Matched values are not printed.`);
process.exit(1);
