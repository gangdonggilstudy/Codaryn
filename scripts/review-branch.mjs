#!/usr/bin/env node
// PM merge gate: checks a work branch against main before it is merged.
// Usage: node scripts/review-branch.mjs <branch> <owned-path-prefix> [<owned-path-prefix> ...]
// Checks: commit author, no trailers or attribution lines, changed files inside the owned
// prefixes, whitespace errors, and the secret scan over the added lines.
// It does not run tests. Run typecheck and tests in the branch's worktree separately.
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const AUTHOR = "gangdonggil <gangdonggilstudy@gmail.com>";
const TRAILER = /^(co-authored-by|signed-off-by|reviewed-by|acked-by|claude-session|generated with|🤖)/im;
const BASE = "main";

const [branch, ...prefixes] = process.argv.slice(2);
if (!branch || prefixes.length === 0) {
  console.error("usage: review-branch.mjs <branch> <owned-path-prefix>...");
  process.exit(2);
}
const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const problems = [];

const log = git(["log", "--no-merges", "--format=%H%x1f%an <%ae>%x1f%cn <%ce>%x1f%B%x1e", `${BASE}..${branch}`]);
const commits = log.split("\x1e").map((s) => s.trim()).filter(Boolean).map((s) => s.split("\x1f"));
if (commits.length === 0) problems.push("no commits ahead of main");
for (const [hash, author, committer, body] of commits) {
  const short = hash.slice(0, 7);
  if (author !== AUTHOR) problems.push(`${short}: author is ${author}`);
  if (committer !== AUTHOR) problems.push(`${short}: committer is ${committer}`);
  if (TRAILER.test(body)) problems.push(`${short}: trailer or attribution line in message`);
}

const files = git(["diff", "--name-only", `${BASE}...${branch}`]).split("\n").filter(Boolean);
for (const file of files) {
  if (!prefixes.some((p) => file === p || file.startsWith(p.endsWith("/") ? p : `${p}/`))) {
    problems.push(`outside owned paths: ${file}`);
  }
}

const ws = spawnSync("git", ["diff", "--check", `${BASE}...${branch}`], { encoding: "utf8" });
if (ws.status !== 0) problems.push(`whitespace errors:\n${ws.stdout.trim()}`);

const scanner = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-secrets.mjs");
const scan = spawnSync(process.execPath, [scanner, "--range", `${BASE}...${branch}`], { encoding: "utf8" });
if (scan.status !== 0) problems.push(`secret scan failed:\n${(scan.stderr || scan.stdout).trim()}`);

console.log(`branch ${branch}: ${commits.length} commit(s), ${files.length} file(s) changed`);
for (const [hash, , , body] of commits) console.log(`  ${hash.slice(0, 7)} ${body.split("\n")[0]}`);
if (problems.length === 0) {
  console.log("review-branch: PASS (author, trailers, ownership, whitespace, secrets)");
  process.exit(0);
}
for (const p of problems) console.error(`review-branch: ${p}`);
console.error(`review-branch: FAIL (${problems.length} problem(s))`);
process.exit(1);
