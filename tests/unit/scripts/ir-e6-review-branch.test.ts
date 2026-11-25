/** IR-E6: commit bodies remain whole scalars even when they contain the old field/record separators. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../scripts/review-branch.mjs");
const DROPPED_ENV = /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|CONFIG_GLOBAL|CONFIG_NOSYSTEM)$|API_KEY|TOKEN|SECRET|PASSWORD/i;
function fixture(t: TestContext) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-ir-e6-")));
  t.after(() => {
    assert.equal(path.dirname(base).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(base).startsWith("codaryn-ir-e6-"));
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const repo = path.join(base, "repo"), tool = path.join(base, "tool");
  fs.mkdirSync(repo); fs.mkdirSync(tool);
  fs.copyFileSync(SCRIPT, path.join(tool, "review-branch.mjs"));
  // The gate's secret scan is outside E6: only this temporary sibling stub is run.
  fs.writeFileSync(path.join(tool, "check-secrets.mjs"), "process.exit(0);\n");
  const empty = path.join(base, "empty.gitconfig");
  fs.writeFileSync(empty, "");
  const env: NodeJS.ProcessEnv = {};
  for (const name of Object.keys(process.env)) {
    if (!DROPPED_ENV.test(name) && !/^GIT_|^NODE_OPTIONS$/i.test(name)) env[name] = process.env[name];
  }
  Object.assign(env, { HOME: base, USERPROFILE: base, GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "gangdonggil", GIT_AUTHOR_EMAIL: "gangdonggilstudy@gmail.com", GIT_COMMITTER_NAME: "gangdonggil", GIT_COMMITTER_EMAIL: "gangdonggilstudy@gmail.com" });
  const git = (args: readonly string[], input?: string): string => {
    const run = spawnSync("git", ["-C", repo, ...args], { cwd: repo, env, input, encoding: "utf8", windowsHide: true, timeout: 60_000 });
    assert.equal(run.status, 0, `fixture Git operation ${args[0]} must succeed`);
    return run.stdout.trim();
  };
  git(["init", "-q", "-b", "main", "--template="]);
  git(["config", "core.autocrlf", "false"]);
  const commit = (file: string, text: string, message: string) => {
    const at = path.join(repo, file);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, text);
    git(["add", "--", file]);
    // Raw stdin preserves the separators; no project commit or user hook is involved.
    git(["commit", "-q", "--cleanup=verbatim", "-F", "-"], message);
  };
  commit("README.md", "baseline\n", "test: base\n");
  git(["switch", "-q", "-c", "work"]);
  const review = () => {
    const run = spawnSync(process.execPath, [path.join(tool, "review-branch.mjs"), "work", "docs"], { cwd: repo, env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  };
  return { git, commit, review };
}
for (const cp of [0x1f, 0x1e]) {
  test(`IR-E6: attribution after U+${cp.toString(16)} is inspected as the same commit body`, (t) => {
    const r = fixture(t);
    r.commit("docs/a.md", "ordinary content\n", `docs: add a note\n\n${String.fromCharCode(cp)}\nGenerated with an assistant tool, then checked.\n\nAn ordinary final paragraph.\n`);
    assert.equal(r.git(["show", "-s", "--format=%(trailers:only,unfold)", "HEAD"]), "", "this reproduction is outside a Git trailer block");
    const run = r.review();
    t.diagnostic(JSON.stringify({ issue: "E6", separator: cp, status: run.status }));
    assert.equal(run.status, 1);
    assert.ok(run.output.includes("attribution line in message"), "the forbidden line must be examined, not a parsing exception");
    assert.ok(!run.output.includes("TypeError"));
  });
  test(`IR-E6 control: ordinary U+${cp.toString(16)} body is not a spurious commit`, (t) => {
    const r = fixture(t);
    r.commit("docs/a.md", "ordinary content\n", `docs: add a note\n\nBefore ${String.fromCharCode(cp)} after.\n\nAn ordinary final paragraph.\n`);
    const run = r.review();
    assert.equal(run.status, 0);
    assert.ok(run.output.includes("review-branch: PASS"));
    assert.ok(run.output.includes("1 commit(s)"));
  });
}
