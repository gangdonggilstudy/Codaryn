/**
 * U-199 (U-172, DR-72, adapter-contract 5.15): the app layer's text editing, readWorkspaceText and
 * writeWorkspaceText, through the app as the GUI engine host makes it (createNodeAppEnvironment), with
 * a real config file, the key and the registered value in the environment, and real CLI runs beside
 * it. The unit tests (tests/unit/app/u172-*) build their own environment; here the pieces meet.
 * - a file with a registered value, the key's value or a key shape opens read only (masked) and a
 *   save with its own digest is not_editable; the values never come back in the text;
 * - protected paths of the config file and of a task file: read only, not written;
 * - BOM and CRLF are kept byte for byte, LF stays LF; mixed line endings are read only;
 * - while a real CLI run holds the workspace lock: read only (workspace_locked) and a save is
 *   refused; once the run has ended the save goes through and no run record changes;
 * - a real CLI run that changes the file after it was opened: the save is a conflict, the run's
 *   change stays;
 * - a new text with a key shape, the registered value or a CR is refused (text_refused);
 * - the size limit (MAX_READ_BYTES) counted with the line ending and BOM put back.
 * Scripted model, fake values, no key sent anywhere, every CLI behind the network guard.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createCodarynApp, createNodeAppEnvironment } from "../../src/app/index.js";
import type { CodarynApp, TaskForm } from "../../src/app/index.js";
import { MAX_READ_BYTES } from "../../src/contracts/index.js";
import { writeConfigFile } from "../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { sha256Of, textStep, toolStep, writeGeneralTask } from "../fixtures/general-tasks.js";
import { FAKE_API_KEY, FAKE_SECRET_A, FAKE_SECRET_ENV_A } from "../fixtures/secrets.js";
import { cliEnv, readLiveRecords, startCli, waitFor } from "../support/cli.js";
import { runGuarded } from "../support/fake-anthropic.js";

/** A key-shaped text, built here so no source holds one (G-10). */
const KEY_SHAPED = ["sk", "ant", "api03", "FAKE".repeat(20)].join("-");
const BOM = "﻿";
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };

interface Opened {
  readonly status: string;
  readonly text?: string;
  readonly masked?: boolean;
  readonly protected?: boolean;
  readonly lineEnding?: string;
  readonly bom?: boolean;
  readonly digest?: string;
  readonly bytes?: number;
  readonly editable?: boolean;
  readonly readOnlyReasons?: readonly string[];
}
interface Written {
  readonly status: string;
  readonly digest: string | null;
  readonly readOnlyReasons: readonly string[];
  readonly textProblems: readonly string[];
  readonly lockLeft: boolean;
}

/** The environment the engine host passes: the fake key and the registered value set. */
const appEnv = (): NodeJS.ProcessEnv => cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { [FAKE_SECRET_ENV_A]: FAKE_SECRET_A } });

interface Setup {
  readonly sb: Sandbox;
  readonly app: CodarynApp;
  /** The quick form on the sandbox workspace with the config file (registered value, protected guard/). */
  readonly settings: TaskForm;
}

async function setup(t: TestContext, files: Readonly<Record<string, string | Buffer>> = {}): Promise<Setup> {
  const sb = createSandbox(t);
  for (const [name, content] of Object.entries(files)) writeWorkspaceFile(sb, name, content);
  const config = writeConfigFile(sb, {
    schemaVersion: 1,
    secretEnv: [FAKE_SECRET_ENV_A],
    limits: { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 1000, maxDurationMs: 60_000 },
    policy: { ...POLICY, protectedPaths: ["guard"] },
  });
  const app = createCodarynApp({ ...(await createNodeAppEnvironment()), env: appEnv(), cwd: sb.base, homeDir: null });
  return { sb, app, settings: { input: { kind: "workspace", workspace: sb.workspace }, configPath: config, varsFile: null, profile: null, workflowRef: null } };
}

async function open(s: Setup, file: string, settings: TaskForm = s.settings): Promise<Opened> {
  const outcome = await s.app.readWorkspaceText({ settings, path: file });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return outcome.output as unknown as Opened;
}

async function save(s: Setup, file: string, text: string, baseDigest: string, settings: TaskForm = s.settings): Promise<Written> {
  const outcome = await s.app.writeWorkspaceText({ settings, path: file, text, baseDigest });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return outcome.output as unknown as Written;
}

const bytesOf = (s: Setup, file: string): Buffer => readFileSync(path.join(s.sb.workspace, ...file.split("/")));

test("U-199: a file with the registered value, the key's value or a key shape opens read only; the value never comes back; a save is not_editable", { timeout: 60_000 }, async (t) => {
  const files = { "secret.txt": `token ${FAKE_SECRET_A}\n`, "key.txt": `key ${FAKE_API_KEY}\n`, "shape.txt": `shape ${KEY_SHAPED}\n` };
  const s = await setup(t, files);
  for (const [file, content] of Object.entries(files)) {
    const opened = await open(s, file);
    assert.equal(opened.status, "opened", file);
    assert.deepEqual([opened.masked, opened.editable], [true, false], file);
    assert.ok(opened.readOnlyReasons?.includes("masked"), `${file}: ${JSON.stringify(opened.readOnlyReasons)}`);
    for (const value of [FAKE_SECRET_A, FAKE_API_KEY, KEY_SHAPED]) assert.equal(opened.text?.includes(value), false, `${file}: the value is not in the text`);
    // Judged again on the save: even with its own digest and the text as shown, nothing is written.
    const saved = await save(s, file, opened.text ?? "", opened.digest ?? "");
    assert.equal(saved.status, "not_editable", file);
    assert.ok(saved.readOnlyReasons.includes("masked"), file);
    assert.equal(bytesOf(s, file).toString("utf8"), content, `${file}: unchanged`);
  }
});

test("U-199: protected paths of the config file and of a task file open read only and are not written", { timeout: 60_000 }, async (t) => {
  const s = await setup(t, { "guard/a.txt": "kept\n", "fixed/b.txt": "kept\n", "free.txt": "free\n" });
  const guarded = await open(s, "guard/a.txt");
  assert.deepEqual([guarded.protected, guarded.editable], [true, false]);
  assert.ok(guarded.readOnlyReasons?.includes("protected"));
  assert.equal((await save(s, "guard/a.txt", "changed\n", guarded.digest ?? "")).status, "not_editable");
  assert.equal(bytesOf(s, "guard/a.txt").toString("utf8"), "kept\n");
  // A task file's own protected paths (its policy replaces the config's for a task file run).
  const task = writeGeneralTask(s.sb, { id: "u199-protected", policy: { protectedPaths: ["fixed"] } }, [textStep("done")]);
  const byTask: TaskForm = { input: { kind: "task", taskPath: task }, configPath: null, varsFile: null, profile: null, workflowRef: null };
  const fixed = await open(s, "fixed/b.txt", byTask);
  assert.deepEqual([fixed.protected, fixed.editable], [true, false]);
  assert.equal((await save(s, "fixed/b.txt", "changed\n", fixed.digest ?? "", byTask)).status, "not_editable");
  assert.equal(bytesOf(s, "fixed/b.txt").toString("utf8"), "kept\n");
  const free = await open(s, "free.txt", byTask);
  assert.equal(free.editable, true, JSON.stringify(free.readOnlyReasons));
});

test("U-199: BOM and CRLF are kept byte for byte, LF stays LF; mixed line endings are read only", { timeout: 60_000 }, async (t) => {
  const s = await setup(t, {
    "crlf-bom.txt": Buffer.from(`${BOM}첫 줄\r\n둘째 줄\r\n`, "utf8"),
    "lf.txt": "one\ntwo\n",
    "mixed.txt": "one\r\ntwo\nthree\r\n",
  });
  const crlf = await open(s, "crlf-bom.txt");
  assert.deepEqual([crlf.lineEnding, crlf.bom, crlf.editable, crlf.text], ["crlf", true, true, "첫 줄\n둘째 줄\n"]);
  const savedCrlf = await save(s, "crlf-bom.txt", "첫 줄\n고친 줄\n셋째 줄\n", crlf.digest ?? "");
  assert.equal(savedCrlf.status, "written");
  const onDisk = bytesOf(s, "crlf-bom.txt");
  assert.ok(onDisk.equals(Buffer.from(`${BOM}첫 줄\r\n고친 줄\r\n셋째 줄\r\n`, "utf8")), JSON.stringify(onDisk.toString("utf8")));
  assert.equal(savedCrlf.digest, sha256Of(onDisk), "the digest is the file's bytes now");
  const lf = await open(s, "lf.txt");
  assert.equal((await save(s, "lf.txt", "one\nchanged\n", lf.digest ?? "")).status, "written");
  assert.ok(bytesOf(s, "lf.txt").equals(Buffer.from("one\nchanged\n", "utf8")));
  const mixed = await open(s, "mixed.txt");
  assert.deepEqual([mixed.lineEnding, mixed.editable], ["mixed", false]);
  assert.ok(mixed.readOnlyReasons?.includes("mixed_line_endings"));
  // The same text again: unchanged, nothing written.
  const again = await open(s, "lf.txt");
  assert.equal((await save(s, "lf.txt", again.text ?? "", again.digest ?? "")).status, "unchanged");
});

test("U-199: while a real CLI run holds the workspace lock the file is read only and a save is refused; after the run it is written and no run record changes", { timeout: 120_000 }, async (t) => {
  const s = await setup(t, { "notes.md": "before\n" });
  // A run whose model does not answer for a minute: it holds the lock until its cancel file appears.
  const task = writeGeneralTask(s.sb, { id: "u199-lock" }, [{ delayMs: 60_000, text: "never" }]);
  const run = startCli(["run", "--task", task, "--cancel-file", s.sb.cancelFile], { cwd: s.sb.base, env: cliEnv(), netGuardLog: path.join(s.sb.base, "net-guard.log"), timeoutMs: 90_000 });
  await waitFor(() => readLiveRecords(s.sb.workspace).some((record) => record.type === "model_request"), 30_000, "the run waiting for its model");
  const locked = await open(s, "notes.md");
  assert.equal(locked.editable, false);
  assert.ok(locked.readOnlyReasons?.includes("workspace_locked"), JSON.stringify(locked.readOnlyReasons));
  const refused = await save(s, "notes.md", "during\n", locked.digest ?? "");
  assert.equal(refused.status, "workspace_locked");
  assert.equal(bytesOf(s, "notes.md").toString("utf8"), "before\n", "nothing written while the run holds the lock");
  writeFileSync(s.sb.cancelFile, "cancel");
  const ended = await run.done;
  assert.equal(ended.exitCode, 5, ended.stdout + ended.stderr);
  const runsBefore = readdirSync(path.join(s.sb.workspace, ".codaryn", "runs")).sort();
  const journalsBefore = runsBefore.map((id) => readFileSync(path.join(s.sb.workspace, ".codaryn", "runs", id, "journal.jsonl"), "utf8"));
  const free = await open(s, "notes.md");
  assert.equal(free.editable, true, JSON.stringify(free.readOnlyReasons));
  const written = await save(s, "notes.md", "after\n", free.digest ?? "");
  assert.deepEqual([written.status, written.lockLeft], ["written", false]);
  assert.equal(bytesOf(s, "notes.md").toString("utf8"), "after\n");
  assert.equal(existsSync(path.join(s.sb.workspace, ".codaryn", "lock.json")), false, "the save's own lock is gone");
  assert.deepEqual(readdirSync(path.join(s.sb.workspace, ".codaryn", "runs")).sort(), runsBefore, "the save makes no run");
  assert.deepEqual(runsBefore.map((id) => readFileSync(path.join(s.sb.workspace, ".codaryn", "runs", id, "journal.jsonl"), "utf8")), journalsBefore, "and changes no run record");
});

test("U-199: a real CLI run changes the file after it was opened: the save is a conflict and the run's change stays", { timeout: 120_000 }, async (t) => {
  const s = await setup(t, { "a.txt": "first\n" });
  const opened = await open(s, "a.txt");
  assert.equal(opened.editable, true);
  const task = writeGeneralTask(s.sb, { id: "u199-conflict" }, [
    toolStep("write_file", { path: "a.txt", expectedHash: sha256Of("first\n"), change: { kind: "replace_all", content: "by the run\n" } }),
    textStep("done"),
  ]);
  const run = await runGuarded(s.sb, ["run", "--task", task], cliEnv());
  assert.equal(run.exitCode !== null, true, run.stderr);
  assert.equal(bytesOf(s, "a.txt").toString("utf8"), "by the run\n", run.stdout + run.stderr);
  const saved = await save(s, "a.txt", "by the person\n", opened.digest ?? "");
  assert.deepEqual([saved.status, saved.digest], ["conflict", null]);
  assert.equal(bytesOf(s, "a.txt").toString("utf8"), "by the run\n", "the run's change stays");
  // Read again, the person's edit goes on top of the run's.
  const fresh = await open(s, "a.txt");
  assert.equal((await save(s, "a.txt", "by the run\nby the person\n", fresh.digest ?? "")).status, "written");
});

test("U-199: a new text with a key shape, the registered value or a CR is refused and nothing is written", { timeout: 60_000 }, async (t) => {
  const s = await setup(t, { "plain.txt": "plain\n" });
  const opened = await open(s, "plain.txt");
  for (const [label, text, problem] of [
    ["key shape", `plain\n${KEY_SHAPED}\n`, "masked"],
    ["registered value", `plain\n${FAKE_SECRET_A}\n`, "masked"],
    ["the key's value", `plain\n${FAKE_API_KEY}\n`, "masked"],
    ["a CR", "plain\rmore\n", "control_characters"],
  ] as const) {
    const saved = await save(s, "plain.txt", text, opened.digest ?? "");
    assert.equal(saved.status, "text_refused", label);
    assert.ok(saved.textProblems.includes(problem), `${label}: ${JSON.stringify(saved.textProblems)}`);
    assert.equal(bytesOf(s, "plain.txt").toString("utf8"), "plain\n", `${label}: nothing written`);
  }
});

test("U-199: the size limit counts the line ending and the BOM put back; a larger file is not opened", { timeout: 60_000 }, async (t) => {
  const s = await setup(t, { "lf.txt": "x\n", "crlf.txt": Buffer.from(`${BOM}x\r\n`, "utf8"), "big.txt": "y".repeat(MAX_READ_BYTES + 1) });
  const lf = await open(s, "lf.txt");
  // An LF file: exactly MAX_READ_BYTES is written, one byte more is too large.
  const atLimit = `${"a".repeat(MAX_READ_BYTES - 1)}\n`;
  const written = await save(s, "lf.txt", atLimit, lf.digest ?? "");
  assert.equal(written.status, "written");
  assert.equal(bytesOf(s, "lf.txt").length, MAX_READ_BYTES);
  const over = await save(s, "lf.txt", `${"a".repeat(MAX_READ_BYTES)}\n`, written.digest ?? "");
  assert.equal(over.status, "text_refused");
  assert.ok(over.textProblems.includes("too_large"), JSON.stringify(over.textProblems));
  // A CRLF file with a BOM: a text that fits as LF but not with CRLF and the BOM put back is too large.
  const crlf = await open(s, "crlf.txt");
  const lines = Math.floor(MAX_READ_BYTES / 4);
  const asLf = "ab\n".repeat(lines);
  assert.ok(Buffer.byteLength(asLf, "utf8") <= MAX_READ_BYTES, "fits as LF");
  assert.ok(3 + Buffer.byteLength(asLf.replaceAll("\n", "\r\n"), "utf8") > MAX_READ_BYTES, "does not fit with CRLF and the BOM");
  const crlfOver = await save(s, "crlf.txt", asLf, crlf.digest ?? "");
  assert.equal(crlfOver.status, "text_refused");
  assert.ok(crlfOver.textProblems.includes("too_large"), JSON.stringify(crlfOver.textProblems));
  assert.ok(bytesOf(s, "crlf.txt").equals(Buffer.from(`${BOM}x\r\n`, "utf8")), "nothing written");
  // A file over the limit is not opened at all.
  assert.equal((await open(s, "big.txt")).status, "too_large");
});
