/** IR-E4/E5: real scanner processes over isolated temporary Git indexes, never this repository. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../scripts/check-secrets.mjs");
const DROPPED_ENV = /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|CONFIG_GLOBAL|CONFIG_NOSYSTEM)$|API_KEY|TOKEN|SECRET|PASSWORD/i;
type Mode = "--staged" | "--range" | "--tracked";

function fixture(t: TestContext) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-ir-e-scan-")));
  t.after(() => {
    assert.equal(path.dirname(base).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(base).startsWith("codaryn-ir-e-scan-"));
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const empty = path.join(base, "empty.gitconfig");
  fs.writeFileSync(empty, "");
  const env: NodeJS.ProcessEnv = {};
  // Drop credential and Git routing names before retrieving any of their values.
  for (const name of Object.keys(process.env)) {
    if (!DROPPED_ENV.test(name) && !/^GIT_|^NODE_OPTIONS$/i.test(name)) env[name] = process.env[name];
  }
  Object.assign(env, { HOME: base, USERPROFILE: base, GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Temporary Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Temporary Test", GIT_COMMITTER_EMAIL: "test@example.invalid" });
  const repo = path.join(base, "repo");
  fs.mkdirSync(repo);
  const git = (args: readonly string[], input?: string): string => {
    const run = spawnSync("git", ["-C", repo, ...args], { cwd: repo, env, input, encoding: "utf8", windowsHide: true, timeout: 60_000 });
    assert.equal(run.status, 0, `fixture Git operation ${args[0]} must succeed`);
    return run.stdout;
  };
  git(["init", "-q", "-b", "main", "--template="]);
  git(["config", "core.autocrlf", "false"]);
  git(["config", "core.quotePath", "true"]);
  // Only index objects are created for unusual names; no Windows path is materialized.
  git(["config", "core.protectNTFS", "false"]);
  const stage = (file: string, content: string): string => {
    const blob = git(["hash-object", "-w", "--stdin"], content).trim();
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`]);
    return blob;
  };
  stage("README.md", "a harmless baseline\n");
  const baseTree = git(["write-tree"]).trim();
  git(["update-ref", "refs/heads/main", git(["commit-tree", baseTree], "test: base\n").trim()]);
  const scan = (mode: Mode) => {
    const args: string[] = [SCRIPT, mode];
    if (mode === "--range") {
      const tree = git(["write-tree"]).trim();
      const commit = git(["commit-tree", tree, "-p", "main"], "test: candidate\n").trim();
      git(["update-ref", "refs/heads/work", commit]);
      args.push("main...work");
    }
    const run = spawnSync(process.execPath, args, { cwd: repo, env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  };
  return { base, repo, git, stage, scan };
}

function sample() {
  const tail = ["Ab3", "dE5", "gH7", "jK9", "mN1", "pQ3", "sT5", "vX7"].join("");
  return { tail, value: ["sk", "proj", tail].join("-") };
}
function noValue(output: string, value: string, tail: string): void {
  assert.ok(!output.includes(value), "the synthetic value must not be printed");
  assert.ok(!output.includes(tail.slice(0, 12)), "the synthetic value's tail must not be printed");
}
function escaped(file: string): string {
  return file.replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
}

for (const mode of ["--staged", "--range"] as const) {
  test(`IR-E4 ${mode}: two leading plus signs are body, not a header`, (t) => {
    const r = fixture(t), { value, tail } = sample();
    r.stage("notes.md", `intro\n++${value}\n`);
    const run = r.scan(mode);
    noValue(run.output, value, tail);
    t.diagnostic(JSON.stringify({ issue: "E4", mode, status: run.status }));
    assert.equal(run.status, 1);
    assert.ok(run.output.includes("check-secrets: notes.md:2 openai-api-key"), "the actual file and added line must be reported");
  });
  test(`IR-E4 ${mode}: header-shaped body cannot change the diagnostic file or line`, (t) => {
    const r = fixture(t), { value, tail } = sample();
    r.stage("notes.md", `intro\n++ b/spoof.txt\n${value}\n`);
    const run = r.scan(mode);
    noValue(run.output, value, tail);
    assert.equal(run.status, 1);
    assert.ok(run.output.includes("check-secrets: notes.md:3 openai-api-key"), "a body line cannot spoof the file header");
    assert.ok(!run.output.includes("check-secrets: spoof.txt"));
  });
}
for (const mode of ["--staged", "--range", "--tracked"] as const) {
  test(`IR-E4 control ${mode}: ordinary added content keeps its detection and line`, (t) => {
    const r = fixture(t), { value, tail } = sample();
    r.stage("notes.md", `intro\n+${value}\n`);
    const run = r.scan(mode);
    noValue(run.output, value, tail);
    assert.equal(run.status, 1);
    assert.ok(run.output.includes("check-secrets: notes.md:2 openai-api-key"));
  });
  for (const file of ["한글/노트.txt", "space dir/note.txt", "line\nbreak.txt"]) {
    test(`IR-E5 ${mode}: content in ${JSON.stringify(file)} is read with its real index name`, (t) => {
      const r = fixture(t), { value, tail } = sample();
      // Index-only files cover names that Windows cannot create as working-tree files.
      r.stage(file, `intro\n${value}\n`);
      const run = r.scan(mode);
      noValue(run.output, value, tail);
      t.diagnostic(JSON.stringify({ issue: "E5", mode, file, status: run.status }));
      assert.equal(run.status, 1);
      assert.ok(run.output.includes(`check-secrets: ${escaped(file)}:2 openai-api-key`), "real name and escaped controls must be reported");
      assert.ok(!run.output.includes("line\nbreak"), "a filename cannot inject a diagnostic line");
    });
  }
  for (const file of ["한글/.env", "space dir/.env", "line\nbreak/.env"]) {
    test(`IR-E5 ${mode}: forbidden ${JSON.stringify(file)} is refused without any credential content`, (t) => {
      const r = fixture(t);
      r.stage(file, "harmless fixture content\n");
      const run = r.scan(mode);
      assert.equal(run.status, 1);
      assert.ok(run.output.includes(`check-secrets: ${escaped(file)}:0 forbidden-path`));
      assert.ok(!run.output.includes("line\nbreak"));
    });
  }
}
test("IR-E5: an unreadable index object is a finding, not a clean tracked scan", (t) => {
  const r = fixture(t);
  const blob = r.stage("lost.txt", "unique unavailable object\n");
  const object = path.resolve(r.repo, ".git", "objects", blob.slice(0, 2), blob.slice(2));
  assert.ok(object.startsWith(path.join(r.repo, ".git", "objects") + path.sep));
  fs.unlinkSync(object);
  const run = r.scan("--tracked");
  t.diagnostic(JSON.stringify({ issue: "E5", unreadableObjectStatus: run.status }));
  assert.equal(run.status, 1);
  assert.ok(run.output.includes("check-secrets: lost.txt:0 index-read-failed"));
  assert.ok(!run.output.includes("fatal:"), "Git's unescaped diagnostics must not bypass the scanner formatter");
});
