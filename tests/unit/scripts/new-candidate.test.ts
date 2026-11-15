/**
 * K4 (U-4): scripts/new-candidate.mjs prepares a candidate worktree and the settings templates.
 * Every test uses a small Git repository in a temporary directory, never this repository.
 * The script runs as a real process; git runs with an empty global config and no system config.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseConfig } from "../../../src/cli/config.js";
import { findKeyInJson } from "../../../src/cli/security/index.js";
import { parseTask } from "../../../src/cli/task.js";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../scripts/new-candidate.mjs");
const IS_WINDOWS = process.platform === "win32";
const FOLD = IS_WINDOWS || process.platform === "darwin";

const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const skip = gitAvailable ? false : "git is not available";

/** Variables that would point git elsewhere, and anything that looks like a credential. */
const DROPPED_ENV =
  /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|CONFIG_GLOBAL|CONFIG_NOSYSTEM)$|API_KEY|TOKEN|SECRET|PASSWORD/i;

const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

interface Sandbox {
  readonly root: string;
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
  readonly base: string;
}

function same(a: string, b: string): boolean {
  const left = fs.realpathSync.native(a);
  const right = fs.realpathSync.native(b);
  return FOLD ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync("git", ["-C", cwd, ...args], { cwd, env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function commit(sb: Pick<Sandbox, "repo" | "env">, message: string): void {
  git(sb.repo, ["add", "."], sb.env);
  git(
    sb.repo,
    ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message],
    sb.env,
  );
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * A temporary root with a repository whose directory name holds shell metacharacters.
 * It has one commit; `local.env` is ignored and not committed.
 */
function sandbox(options: { readonly commit?: boolean } = {}): Sandbox {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-k4-")));
  roots.push(root);
  const globalConfig = path.join(root, "empty.gitconfig");
  fs.writeFileSync(globalConfig, "");
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!DROPPED_ENV.test(name)) env[name] = value;
  }
  env["GIT_CONFIG_GLOBAL"] = globalConfig;
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  env["GIT_TERMINAL_PROMPT"] = "0";

  const repo = path.join(root, "r&d (1) %x%");
  fs.mkdirSync(repo);
  git(repo, ["init", "-q", "-b", "main"], env);
  // Safety: every git command below must act on this temporary repository only.
  assert.ok(same(git(repo, ["rev-parse", "--show-toplevel"], env).trim(), repo), "the fixture repository is its own top level");
  if (options.commit === false) return { root, repo, env, base: "" };

  write(path.join(repo, "package.json"), '{ "name": "fixture", "private": true, "scripts": { "test": "node --test" } }\n');
  write(path.join(repo, "tsconfig.json"), "{}\n");
  write(path.join(repo, "package-lock.json"), "{}\n");
  write(path.join(repo, ".eslintrc.json"), "{}\n");
  write(path.join(repo, "tests", "a.test.js"), "// fixture\n");
  write(path.join(repo, "src", "index.js"), "export const x = 1;\n");
  write(path.join(repo, ".gitignore"), "local.env\n");
  write(path.join(repo, "local.env"), "FAKE_VALUE=1\n");
  commit({ repo, env }, "base");
  const base = git(repo, ["rev-parse", "HEAD"], env).trim();
  return { root, repo, env, base };
}

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(sb: Sandbox, args: readonly string[], script = SCRIPT): RunResult {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: sb.root,
    env: sb.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function candidateArgs(sb: Sandbox, name: string, out: string, state: string): string[] {
  return ["--repo", sb.repo, "--name", name, "--out", out, "--state", state];
}

/** Branches, their commits and the registered worktrees. */
function repositoryState(sb: Sandbox): string {
  return [
    git(sb.repo, ["for-each-ref", "--format=%(refname) %(objectname)"], sb.env),
    git(sb.repo, ["worktree", "list", "--porcelain"], sb.env),
  ].join("---\n");
}

/** The package this script belongs to: the CLI installation the script protects. */
const PACKAGE_ROOT = path.dirname(path.dirname(SCRIPT));

function assertSamePaths(actual: readonly string[], expected: readonly string[]): void {
  const fold = (value: string) => (FOLD ? path.resolve(value).toLowerCase() : path.resolve(value));
  assert.deepEqual(actual.map(fold), expected.map(fold), JSON.stringify(actual));
}

function assertStopped(result: RunResult, pattern: RegExp): void {
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, pattern);
  assert.match(result.stderr, /nothing was changed/);
}

test("the script file exists where the tests expect it", () => {
  assert.ok(fs.statSync(SCRIPT).isFile(), SCRIPT);
});

test("creates the candidate worktree on candidate/<name> and both templates outside it", { skip }, () => {
  const sb = sandbox();
  const out = path.join(sb.root, "cand one");
  const state = path.join(sb.root, "settings");
  const result = run(sb, candidateArgs(sb, "fix-sum", out, state));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /candidate created/);

  assert.equal(git(out, ["rev-parse", "HEAD"], sb.env).trim(), sb.base);
  assert.equal(git(out, ["symbolic-ref", "--short", "HEAD"], sb.env).trim(), "candidate/fix-sum");
  assert.ok(fs.existsSync(path.join(out, "tests", "a.test.js")));
  assert.equal(fs.existsSync(path.join(out, "local.env")), false, "ignored files are not in the candidate");
  assert.ok(git(sb.repo, ["worktree", "list", "--porcelain"], sb.env).includes("candidate/fix-sum"));

  const configText = fs.readFileSync(path.join(state, "fix-sum.config.json"), "utf8");
  const taskText = fs.readFileSync(path.join(state, "fix-sum.task.json"), "utf8");
  assert.notEqual(configText.charCodeAt(0), 0xfeff, "no BOM");
  assert.notEqual(taskText.charCodeAt(0), 0xfeff, "no BOM");
  const config = JSON.parse(configText) as Record<string, unknown> & {
    model: string;
    integrity: { paths: string[] };
    limits: Record<string, number>;
    policy: { commands: unknown[]; protectedPaths: string[] };
    verifiers: unknown[];
  };
  const task = JSON.parse(taskText) as Record<string, unknown> & { policy: unknown; verifiers: unknown[] };
  assert.deepEqual(findKeyInJson(config, null), { kind: "none" });
  assert.deepEqual(findKeyInJson(task, null), { kind: "none" });

  assert.equal(config.model, "<모델 ID>");
  // W-3: what the script knows lies outside the candidate and feeds verification or later Git use:
  // the shared Git directory's hooks and config, and the running CLI installation's dist.
  assertSamePaths(config.integrity.paths, [
    path.join(sb.repo, ".git", "hooks"),
    path.join(sb.repo, ".git", "config"),
    path.join(PACKAGE_ROOT, "dist"),
  ]);
  for (const entry of config.integrity.paths) {
    assert.ok(path.isAbsolute(entry) && fs.existsSync(entry), `integrity path exists: ${entry}`);
  }
  assert.match(result.stdout, /integrity\.paths: 3 path\(s\) filled in/);
  assert.doesNotMatch(result.stdout, /not found/);
  assert.equal(config.limits["maxRepairAttempts"], 2);
  assert.deepEqual(config.policy.commands, [], "no command is allowed until a person adds one");
  for (const entry of ["tests", "scripts", ".github", "package.json", "tsconfig.json", ".git", "node_modules"]) {
    assert.ok(config.policy.protectedPaths.includes(entry), entry);
  }
  for (const entry of [".eslintrc.json", "package-lock.json"]) {
    assert.ok(config.policy.protectedPaths.includes(entry), `verification setting found in the base commit: ${entry}`);
  }
  assert.deepEqual(task.policy, config.policy);
  assert.deepEqual(task.verifiers, config.verifiers);
  assert.equal(config.verifiers.length, 1, "the base commit has package.json, so npm test is suggested");

  // The CLI's own validation accepts both templates as written, `integrity` included.
  const parsedConfig = parseConfig(config);
  assert.ok(parsedConfig.ok, parsedConfig.ok ? "" : parsedConfig.message);
  assert.equal(parsedConfig.config.integrity?.paths.length, 3);
  const parsedTask = parseTask(task, state, { limits: parsedConfig.config.limits });
  assert.ok(parsedTask.ok, parsedTask.ok ? "" : parsedTask.message);
  assert.equal(parsedTask.task.workspaceRoot, out);
  assert.equal(parsedTask.task.id, "fix-sum");
  assert.equal(parsedTask.task.limits.maxRepairAttempts, 2);
  // The task takes its limits from the config file only: without it, the task does not run.
  const alone = parseTask(task, state);
  assert.ok(!alone.ok && alone.code === "invalid_task", JSON.stringify(alone));
});

test("a dry run checks everything, prints the plan and changes nothing", { skip }, () => {
  const sb = sandbox();
  const out = path.join(sb.root, "cand");
  const state = path.join(sb.root, "settings");
  const before = repositoryState(sb);
  const result = run(sb, [...candidateArgs(sb, "dry", out, state), "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry run, nothing was changed/);
  assert.match(result.stdout, /worktree add -b candidate\/dry -- /);
  assert.match(result.stdout, /integrity\.paths: 3 path\(s\) filled in/);
  assert.match(result.stdout, /"workspaceRoot"/);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(state), false);
  assert.equal(repositoryState(sb), before);
});

test("W-3: integrity paths that do not exist are left out and named in the output", { skip }, () => {
  const sb = sandbox();
  // A repository without a hooks directory, and a CLI installation that was never built.
  fs.rmSync(path.join(sb.repo, ".git", "hooks"), { recursive: true, force: true });
  const cli = path.join(sb.root, "cli");
  write(path.join(cli, "package.json"), '{ "name": "codaryn-copy", "private": true }\n');
  const copy = path.join(cli, "scripts", "new-candidate.mjs");
  fs.mkdirSync(path.dirname(copy));
  fs.copyFileSync(SCRIPT, copy);
  const state = path.join(sb.root, "settings");

  const result = run(sb, candidateArgs(sb, "gaps", path.join(sb.root, "cand"), state), copy);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(state, "gaps.config.json"), "utf8")) as { integrity: { paths: string[] } };
  assertSamePaths(config.integrity.paths, [path.join(sb.repo, ".git", "config")]);
  assert.match(result.stdout, /integrity\.paths: 1 path\(s\) filled in/);
  assert.match(result.stdout, /integrity\.paths: not found, not added: .*[\\/]\.git[\\/]hooks \(shared Git hooks\)/);
  assert.match(result.stdout, /integrity\.paths: not found, not added: .*[\\/]cli[\\/]dist \(CLI installation dist\)/);
  // The CLI accepts the template as written: every listed path exists.
  const parsed = parseConfig(config);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
});

// ---- P0: existing targets are kept as they are ----

test("an existing candidate directory stops the script and is left as it was", { skip }, () => {
  const sb = sandbox();
  const state = path.join(sb.root, "settings");
  const before = repositoryState(sb);

  const full = path.join(sb.root, "full");
  write(path.join(full, "keep.txt"), "mine\n");
  assertStopped(run(sb, candidateArgs(sb, "full", full, state)), /already exists/);
  assert.deepEqual(fs.readdirSync(full), ["keep.txt"]);
  assert.equal(fs.readFileSync(path.join(full, "keep.txt"), "utf8"), "mine\n");

  const empty = path.join(sb.root, "empty");
  fs.mkdirSync(empty);
  assertStopped(run(sb, candidateArgs(sb, "empty", empty, state)), /already exists/);
  assert.deepEqual(fs.readdirSync(empty), []);

  const file = path.join(sb.root, "file");
  fs.writeFileSync(file, "a file\n");
  assertStopped(run(sb, candidateArgs(sb, "file", file, state)), /already exists/);
  assert.equal(fs.readFileSync(file, "utf8"), "a file\n");

  assert.equal(fs.existsSync(state), false, "no template was written");
  assert.equal(repositoryState(sb), before, "no branch or worktree was added");
});

test("an existing branch stops the script; the branch keeps its commit", { skip }, () => {
  const sb = sandbox();
  git(sb.repo, ["branch", "candidate/taken"], sb.env);
  write(path.join(sb.repo, "src", "later.js"), "export const later = 2;\n");
  commit(sb, "later");
  const before = repositoryState(sb);
  const out = path.join(sb.root, "cand");
  const state = path.join(sb.root, "settings");

  assertStopped(run(sb, candidateArgs(sb, "taken", out, state)), /candidate\/taken cannot be created/);
  assert.equal(git(sb.repo, ["rev-parse", "candidate/taken"], sb.env).trim(), sb.base);
  assert.equal(repositoryState(sb), before);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(state), false);
});

test("a branch named candidate, which candidate/<name> would collide with, stops the script", { skip }, () => {
  const sb = sandbox();
  git(sb.repo, ["branch", "candidate"], sb.env);
  const before = repositoryState(sb);
  const out = path.join(sb.root, "cand");
  assertStopped(run(sb, candidateArgs(sb, "next", out, path.join(sb.root, "settings"))), /refs\/heads\/candidate exists/);
  assert.equal(repositoryState(sb), before);
  assert.equal(fs.existsSync(out), false);
});

test("an existing template file stops the script and keeps its content", { skip }, () => {
  const sb = sandbox();
  const state = path.join(sb.root, "settings");
  const taskFile = path.join(state, "busy.task.json");
  write(taskFile, '{ "mine": true }\n');
  const before = repositoryState(sb);
  const out = path.join(sb.root, "cand");

  assertStopped(run(sb, candidateArgs(sb, "busy", out, state)), /busy\.task\.json already exists/);
  assert.equal(fs.readFileSync(taskFile, "utf8"), '{ "mine": true }\n');
  assert.deepEqual(fs.readdirSync(state), ["busy.task.json"], "the config template was not written either");
  assert.equal(fs.existsSync(out), false);
  assert.equal(repositoryState(sb), before);
});

// ---- Where the candidate and the settings may be ----

test("a candidate inside the repository is refused, also when reached through a link", { skip }, () => {
  const sb = sandbox();
  const state = path.join(sb.root, "settings");
  const before = repositoryState(sb);

  assertStopped(run(sb, candidateArgs(sb, "inner", path.join(sb.repo, "nested", "cand"), state)), /outside the repository/);
  assert.equal(fs.existsSync(path.join(sb.repo, "nested")), false);

  const link = path.join(sb.root, "via-link");
  fs.symlinkSync(sb.repo, link, IS_WINDOWS ? "junction" : "dir");
  assertStopped(run(sb, candidateArgs(sb, "linked", path.join(link, "cand"), state)), /outside the repository/);
  assert.equal(fs.existsSync(path.join(sb.repo, "cand")), false);

  assert.equal(repositoryState(sb), before);
  assert.equal(fs.existsSync(state), false);
});

test("a candidate inside another worktree of the repository, or at a registered worktree path, is refused", { skip }, () => {
  const sb = sandbox();
  const other = path.join(sb.root, "other-wt");
  git(sb.repo, ["worktree", "add", "-q", "-b", "side", other], sb.env);
  const gone = path.join(sb.root, "gone-wt");
  git(sb.repo, ["worktree", "add", "-q", "-b", "gone", gone], sb.env);
  fs.rmSync(gone, { recursive: true, force: true });
  const before = repositoryState(sb);
  const state = path.join(sb.root, "settings");

  assertStopped(run(sb, candidateArgs(sb, "in-other", path.join(other, "cand"), state)), /outside the repository and its worktrees/);
  assertStopped(run(sb, candidateArgs(sb, "at-gone", gone, state)), /already registered as a worktree/);
  assert.equal(fs.existsSync(path.join(other, "cand")), false);
  assert.equal(fs.existsSync(gone), false);
  assert.equal(repositoryState(sb), before);
});

test("a candidate or settings directory inside the CLI installation is refused", { skip }, () => {
  const sb = sandbox();
  // A copy of the script in its own package: that package is the installation it protects.
  const cli = path.join(sb.root, "cli");
  write(path.join(cli, "package.json"), '{ "name": "codaryn-copy", "private": true }\n');
  const copy = path.join(cli, "scripts", "new-candidate.mjs");
  fs.mkdirSync(path.dirname(copy));
  fs.copyFileSync(SCRIPT, copy);
  const before = repositoryState(sb);

  const inside = path.join(cli, "candidates", "one");
  assertStopped(run(sb, candidateArgs(sb, "one", inside, path.join(sb.root, "settings")), copy), /outside the CLI installation/);
  assert.equal(fs.existsSync(path.join(cli, "candidates")), false);

  const settings = path.join(cli, "settings");
  assertStopped(run(sb, candidateArgs(sb, "two", path.join(sb.root, "cand"), settings), copy), /settings directory must be outside the CLI installation/);
  assert.equal(fs.existsSync(settings), false);
  assert.equal(repositoryState(sb), before);
});

test("a settings directory inside the candidate or the repository is refused", { skip }, () => {
  const sb = sandbox();
  const out = path.join(sb.root, "cand");
  const before = repositoryState(sb);
  assertStopped(run(sb, candidateArgs(sb, "s1", out, path.join(out, "settings"))), /settings directory must be outside the candidate/);
  assertStopped(run(sb, candidateArgs(sb, "s2", out, out)), /settings directory must be outside the candidate/);
  assertStopped(run(sb, candidateArgs(sb, "s3", out, path.join(sb.repo, "settings"))), /settings directory must be outside the repository/);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(path.join(sb.repo, "settings")), false);
  assert.equal(repositoryState(sb), before);
});

test("--repo must be the top of a work tree with a commit", { skip }, () => {
  const sb = sandbox();
  const out = path.join(sb.root, "cand");
  const state = path.join(sb.root, "settings");
  assertStopped(
    run(sb, ["--repo", path.join(sb.repo, "tests"), "--name", "sub", "--out", out, "--state", state]),
    /top of the work tree/,
  );
  assertStopped(run(sb, ["--repo", path.join(sb.root, "missing"), "--name", "m", "--out", out, "--state", state]), /not a directory/);

  const empty = sandbox({ commit: false });
  assertStopped(run(empty, candidateArgs(empty, "first", path.join(empty.root, "cand"), path.join(empty.root, "settings"))), /no commit/);
  assert.equal(fs.existsSync(out), false);
});

test("usage errors exit with 2 before anything is checked or created", { skip }, () => {
  const sb = sandbox();
  const out = path.join(sb.root, "cand");
  const state = path.join(sb.root, "settings");
  const usage = (args: readonly string[], pattern: RegExp) => {
    const result = run(sb, args);
    assert.equal(result.status, 2, `${args.join(" ")}\n${result.stderr}`);
    assert.match(result.stderr, pattern);
    assert.match(result.stderr, /usage: /);
  };
  usage([], /--repo is required/);
  usage(["--repo", sb.repo, "--name", "a", "--out", out], /--state is required/);
  usage([...candidateArgs(sb, "a", out, state), "--name", "b"], /--name is given twice/);
  usage([...candidateArgs(sb, "a", out, state), "--force"], /unknown argument: --force/);
  usage(["--repo", "--name", "a", "--out", out, "--state", state], /--repo needs a value/);
  for (const name of ["A&B", "a b", "../x", "x-", "Upper", "con", "lpt1", "a.lock", "x".repeat(41), ""]) {
    usage(candidateArgs(sb, name, out, state), /--name must be/);
  }
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(state), false);

  const help = run(sb, ["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage: node scripts\/new-candidate\.mjs --repo/);
});

test("when git worktree add fails, the templates, the new settings directories and the new branch are removed", { skip }, () => {
  const sb = sandbox();
  // A file where git keeps its worktree records: the worktree cannot be added.
  fs.writeFileSync(path.join(sb.repo, ".git", "worktrees"), "not a directory\n");
  const before = repositoryState(sb);
  const settingsRoot = path.join(sb.root, "new-settings");
  const out = path.join(sb.root, "cand");

  const result = run(sb, candidateArgs(sb, "broken", out, path.join(settingsRoot, "deep")));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /git worktree add failed; the templates were removed/);
  assert.equal(fs.existsSync(settingsRoot), false, "directories the script created are gone");
  assert.equal(fs.existsSync(out), false);
  assert.equal(repositoryState(sb), before, "no branch is left behind");
});
