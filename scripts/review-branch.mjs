#!/usr/bin/env node
// PM merge gate: checks a work branch against main before it is merged.
// Usage: node scripts/review-branch.mjs <branch> <owned-path-prefix> [<owned-path-prefix> ...]
// Checks: commit author and committer, no Git trailer of any key (Git's own trailer parsing) and no
// attribution line, for every commit of the branch, its merge commits included; changed files inside
// the owned prefixes, whitespace errors, and the secret scan over the added lines.
// It does not run tests. Run typecheck and tests in the branch's worktree separately.
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const AUTHOR = "gangdonggil <gangdonggilstudy@gmail.com>";
// Attribution lines anywhere in a message (a trailer block or not). Trailers themselves are found by
// Git (%(trailers:only)), so a key outside this list is refused too (IR-B6).
const ATTRIBUTION = /^(co-authored-by|signed-off-by|reviewed-by|acked-by|claude-session|generated with|🤖)/im;
const BASE = "main";

const [branch, ...prefixes] = process.argv.slice(2);
if (!branch || prefixes.length === 0) {
  console.error("usage: review-branch.mjs <branch> <owned-path-prefix>...");
  process.exit(2);
}
const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const problems = [];

// Every commit of the branch, merge commits included (IR-B6): a merge the candidate made carries an
// author, a committer and a message like any other commit. Read each validated hash separately:
// body field/record separators cannot invent or truncate another commit. Git commit messages have
// no NUL; validate the six NUL-delimited fields before using the complete body.
const commitId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const hashes = git(["rev-list", `${BASE}..${branch}`]).trim().split("\n").filter(Boolean);
const commits = [];
if (hashes.length === 0) problems.push("no commits ahead of main");
for (const hash of hashes) {
  if (!commitId.test(hash)) {
    problems.push("invalid commit id");
    continue;
  }
  const fields = git(["show", "-s", "--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%P%x00%(trailers:only,unfold)%x00%B", hash]).split("\0");
  if (fields.length !== 6 || fields[0] !== hash || (fields[3] !== "" && !fields[3].split(" ").every((parent) => commitId.test(parent)))) {
    problems.push(`${hash.slice(0, 7)}: invalid commit fields`);
    continue;
  }
  commits.push(fields);
}
for (const [hash, author, committer, parents, trailers, body] of commits) {
  const short = `${hash.slice(0, 7)}${parents.trim().split(/\s+/).length > 1 ? " (merge)" : ""}`;
  if (author !== AUTHOR) problems.push(`${short}: author is ${author}`);
  if (committer !== AUTHOR) problems.push(`${short}: committer is ${committer}`);
  if (trailers.trim() !== "") problems.push(`${short}: git trailer in message`);
  if (ATTRIBUTION.test(body)) problems.push(`${short}: attribution line in message`);
}

// Files touched by the branch's own (non-merge) commits. A three-dot diff is wrong when the
// branch merged main more than once: it picks an old merge base and lists files that came from main.
const files = [
  ...new Set(
    git(["log", "--no-merges", "--name-only", "--format=", `${BASE}..${branch}`]).split("\n").filter(Boolean),
  ),
];
// What merging the branch would actually change must also stay inside the owned paths.
const mergeTree = spawnSync("git", ["merge-tree", "--write-tree", "--name-only", BASE, branch], { encoding: "utf8" });
if (mergeTree.status === 0) {
  const tree = (mergeTree.stdout.split("\n")[0] ?? "").trim();
  for (const file of git(["diff", "--name-only", BASE, tree]).split("\n").filter(Boolean)) {
    if (!files.includes(file)) files.push(file);
  }
} else {
  problems.push("merge with main would conflict");
}
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

console.log(`branch ${branch}: ${hashes.length} commit(s), ${files.length} file(s) changed`);
for (const [hash, , , , , body] of commits) console.log(`  ${hash.slice(0, 7)} ${body.split("\n")[0]}`);
if (problems.length === 0) {
  console.log("review-branch: PASS (author, trailers, ownership, whitespace, secrets)");
  process.exit(0);
}
for (const p of problems) console.error(`review-branch: ${p}`);
console.error(`review-branch: FAIL (${problems.length} problem(s))`);
process.exit(1);
