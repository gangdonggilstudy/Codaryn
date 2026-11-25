// IR-B6 (improvement review B): review-branch refuses any Git trailer (git's own trailer parsing), still
// refuses attribution lines on their own, and checks the candidate's merge commits too
// (docs/development-workflow.md 7절 trailer 금지·작성자, 8절 병합 전 검토). A lawful candidate still passes.
//
// Every case runs in a fresh repository the test makes in the system's temporary folder, with Git's
// global and system settings cut off (GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM), so no personal setting is
// read. It runs a copy of review-branch.mjs whose check-secrets.mjs is a stub that passes: the secret
// scan is not what these cases check, and the real scanner is not run.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "review-branch.mjs");
const OWNER = { name: "gangdonggil", email: "gangdonggilstudy@gmail.com" };
const OTHER = { name: "Someone Else", email: "someone@example.invalid" };

/** A repository with `main` (one commit) and the tool copy; removed after the case. */
function setUp(t) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "codaryn-review-branch-")));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const tool = path.join(base, "tool"), repo = path.join(base, "repo");
  mkdirSync(tool); mkdirSync(repo);
  copyFileSync(SCRIPT, path.join(tool, "review-branch.mjs"));
  writeFileSync(path.join(tool, "check-secrets.mjs"), "process.exit(0);\n");
  const empty = path.join(base, "empty.gitconfig");
  writeFileSync(empty, "");
  const env = (who = OWNER) => ({
    PATH: process.env.PATH ?? "",
    ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : {}),
    HOME: base, USERPROFILE: base, TEMP: base, TMP: base,
    GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email,
  });
  const git = (args, who) => execFileSync("git", args, { cwd: repo, env: env(who), encoding: "utf8" });
  git(["init", "-q", "-b", "main"]);
  git(["config", "core.autocrlf", "false"]);
  const commit = (file, text, message, who) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), text);
    git(["add", "--", file], who);
    git(["commit", "-q", "-m", message], who);
  };
  commit("README.md", "# Repo\n", "chore: start");
  const review = () => {
    const run = spawnSync(process.execPath, [path.join(tool, "review-branch.mjs"), "work", "docs"], { cwd: repo, env: env(), encoding: "utf8" });
    return { code: run.status, out: run.stdout, err: run.stderr };
  };
  return { git, commit, review };
}

test("IR-B6: a lawful candidate passes, a merge of main by the owner included", (t) => {
  const { git, commit, review } = setUp(t);
  git(["switch", "-q", "-c", "work"]);
  commit("docs/a.md", "a\n", "docs: add a note\n\nThe note says what the change is for, in prose.");
  git(["switch", "-q", "main"]);
  commit("README.md", "# Repo\n\nMore.\n", "chore: main moves on");
  git(["switch", "-q", "work"]);
  git(["merge", "-q", "--no-ff", "-m", "merge: take main into the work branch", "main"]);
  const run = review();
  assert.equal(run.code, 0, run.err);
  assert.match(run.out, /review-branch: PASS/);
});

test("IR-B6: any Git trailer is refused, not only the listed keys", (t) => {
  const { git, commit, review } = setUp(t);
  git(["switch", "-q", "-c", "work"]);
  commit("docs/a.md", "a\n", "docs: add a note\n\nThe note says what the change is for.\n\nTests: 3 passed");
  const run = review();
  assert.equal(run.code, 1, run.out);
  assert.match(run.err, /git trailer in message/);
});

test("IR-B6: an attribution line is refused on its own, outside a trailer block", (t) => {
  const { git, commit, review } = setUp(t);
  git(["switch", "-q", "-c", "work"]);
  commit("docs/a.md", "a\n", "docs: add a note\n\nGenerated with an assistant tool, then checked.\n\nThe note says what the change is for.");
  const run = review();
  assert.equal(run.code, 1, run.out);
  assert.match(run.err, /attribution line in message/);
  assert.doesNotMatch(run.err, /git trailer in message/, "the line is not a trailer: the attribution check found it");
});

test("IR-B6: a candidate's merge commit is checked: its author, committer and trailers", (t) => {
  const { git, commit, review } = setUp(t);
  git(["switch", "-q", "-c", "work"]);
  commit("docs/a.md", "a\n", "docs: add a note\n\nThe note says what the change is for.");
  git(["switch", "-q", "main"]);
  commit("README.md", "# Repo\n\nMore.\n", "chore: main moves on");
  git(["switch", "-q", "work"]);
  git(["merge", "-q", "--no-ff", "-m", "merge: take main\n\nBrought main in.\n\nChange-Id: I0123456789", "main"], OTHER);
  const run = review();
  assert.equal(run.code, 1, run.out);
  assert.match(run.err, /\(merge\): author is Someone Else <someone@example\.invalid>/);
  assert.match(run.err, /\(merge\): committer is Someone Else <someone@example\.invalid>/);
  assert.match(run.err, /\(merge\): git trailer in message/);
});
