/**
 * U-75 (design gap survey C-8, second-provider.md 4.3 and 8): scripts/check-secrets.mjs finds OpenAI
 * keys with a distinct prefix (`sk-proj-`, `sk-svcacct-`, `sk-admin-` and 20 or more of
 * `A-Z a-z 0-9 _ -`, the shape the CLI refuses) and the value of OPENAI_API_KEY, as it does for
 * Anthropic. Every test uses a small Git repository in a temporary directory, never this repository,
 * and runs the script as a real process. No key-shaped text is written in this file: each sample is
 * joined from pieces at run time, and the script must never print it.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../scripts/check-secrets.mjs");

const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const skip = gitAvailable ? false : "git is not available";

/** Variables that would point git elsewhere, and anything that looks like a credential. */
const DROPPED_ENV =
  /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|CONFIG_GLOBAL|CONFIG_NOSYSTEM)$|API_KEY|TOKEN|SECRET|PASSWORD/i;

const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A key-like tail of `length` letters and digits, mixed case, made at run time. */
function tail(length: number): string {
  const pieces = ["Ab3", "dE5", "gH7", "jK9", "mN1", "pQ3", "sT5", "vX7", "zA9", "cE1"];
  let out = "";
  for (let i = 0; out.length < length; i += 1) out += pieces[i % pieces.length];
  return out.slice(0, length);
}

/** `sk-<kind>-<tail>`, joined from pieces. */
function prefixed(kind: string, length: number): string {
  return ["sk", kind, tail(length)].join("-");
}

interface Repo {
  readonly repo: string;
  readonly env: NodeJS.ProcessEnv;
}

function git(repo: Repo, args: readonly string[]): string {
  const result = spawnSync("git", ["-C", repo.repo, ...args], { cwd: repo.repo, env: repo.env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/** A temporary repository with `files` added to the index (the script reads tracked or staged files). */
function repoWith(files: Readonly<Record<string, string>>): Repo {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u75-")));
  roots.push(root);
  const globalConfig = path.join(root, "empty.gitconfig");
  fs.writeFileSync(globalConfig, "");
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (!DROPPED_ENV.test(name)) env[name] = value;
  env["GIT_CONFIG_GLOBAL"] = globalConfig;
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  env["GIT_TERMINAL_PROMPT"] = "0";
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const r = { repo, env };
  git(r, ["init", "-q"]);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  git(r, ["add", "."]);
  return r;
}

function scan(repo: Repo, mode: "--tracked" | "--staged", extraEnv: NodeJS.ProcessEnv = {}): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [SCRIPT, mode], { cwd: repo.repo, env: { ...repo.env, ...extraEnv }, encoding: "utf8", windowsHide: true, timeout: 60_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("U-75: each OpenAI prefix with 20 or more characters after it is found by the openai-api-key rule, the value never printed", { skip }, () => {
  for (const kind of ["proj", "svcacct", "admin"]) {
    const value = prefixed(kind, 24);
    const repo = repoWith({ "notes.md": `line one\nthe key ${value} was pasted here\n` });
    const result = scan(repo, "--tracked");
    assert.equal(result.status, 1, kind);
    assert.match(result.output, /check-secrets: notes\.md:2 openai-api-key/, kind);
    assert.ok(!result.output.includes(value), `${kind}: the matched value is not printed`);
    assert.ok(!result.output.includes(tail(24)), `${kind}: no part of the value is printed`);
  }
});

test("U-75: before this unit the same text passed every rule (the generic sk- rule misses the hyphen after the prefix)", { skip }, () => {
  // The generic rule, as the script has it: `sk-` and 32 or more letters and digits, as one word.
  const generic = /\bsk-[A-Za-z0-9]{32,}\b/;
  for (const kind of ["proj", "svcacct", "admin"]) assert.equal(generic.test(prefixed(kind, 40)), false, kind);
});

test("U-75: shorter tails, other words after sk-, and a prefix inside a word are not found", { skip }, () => {
  const repo = repoWith({
    "a.md": [
      `${prefixed("proj", 19)}`, // 19 characters after the prefix
      `x${prefixed("proj", 24)}`, // not at a word start
      `${["sk", "project"].join("-")}-overview-and-setup-notes`, // another word after sk-
      `${["sk", "learn"].join("-")} and ${["sk", "proj"].join("-")}`, // ordinary names
      "",
    ].join("\n"),
  });
  const result = scan(repo, "--tracked");
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /check-secrets: no findings/);
});

test("U-75: underscores and hyphens in the tail count, as in the CLI's refusal shape", { skip }, () => {
  const value = ["sk", "svcacct", `${tail(10)}_${tail(6)}-${tail(6)}`].join("-");
  const repo = repoWith({ "b.txt": `${value}\n` });
  const result = scan(repo, "--tracked");
  assert.equal(result.status, 1);
  assert.match(result.output, /b\.txt:1 openai-api-key/);
});

test("U-75: the value of OPENAI_API_KEY is found whatever its shape, as ANTHROPIC_API_KEY's is", { skip }, () => {
  const value = ["u75", "made", "up", "value"].join("-");
  const repo = repoWith({ "c.txt": `before\nafter ${value} here\n` });
  const found = scan(repo, "--tracked", { OPENAI_API_KEY: value });
  assert.equal(found.status, 1);
  assert.match(found.output, /c\.txt:2 live-env-value:OPENAI_API_KEY/);
  assert.ok(!found.output.includes(value), "the value is not printed");
  // Without the variable the same file has no finding.
  const none = scan(repo, "--tracked");
  assert.equal(none.status, 0, none.output);
  // A value shorter than 8 characters is not looked for (as before, for both variables).
  const short = scan(repo, "--tracked", { OPENAI_API_KEY: "u75" });
  assert.equal(short.status, 0, short.output);
});

test("U-75: --staged finds an added OpenAI key with its line number", { skip }, () => {
  const value = prefixed("admin", 30);
  const repo = repoWith({ "d.md": `one\ntwo\n${value}\n` });
  const result = scan(repo, "--staged");
  assert.equal(result.status, 1);
  assert.match(result.output, /check-secrets: d\.md:3 openai-api-key/);
  assert.ok(!result.output.includes(value));
});

test("U-75: the earlier rules still find what they found", { skip }, () => {
  const anthropic = ["sk", "ant", tail(20)].join("-");
  const repo = repoWith({ "e.md": `${anthropic}\n` });
  const result = scan(repo, "--tracked");
  assert.equal(result.status, 1);
  assert.match(result.output, /e\.md:1 anthropic-api-key/);
  assert.ok(!result.output.includes("openai-api-key"));
});
