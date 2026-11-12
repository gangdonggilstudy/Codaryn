/**
 * U-22 (DR-48, AXM-3), the CLI's part: the cleanup's JSON says what happened.
 * Before, a confirmed cleanup that removed nothing (every item kept) printed mode "applied" with
 * outcome.ok true and exit 0, so an agent reading the line took it as done. Now:
 * - status preview (exit 0), removed (0), nothing_removed (3), partly_failed (1); no `mode`
 * - outcome.ok is true for removed only
 * - a confirmed digest that is not the plan's is the error cleanup_plan_changed (exit 2)
 * Real engine and store; scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CLEANUP_EXIT_CODES, RUNS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type { ApplyCleanup, CleanupOutput, EngineResult } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runCleanup } from "../../../src/cli/cleanup.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 900_000;
const clock = { now: () => (now += 1000) };
let seed = 121;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

/** A workspace with one run that wrote a file (not reverted) and one that changed nothing. */
async function workspace(): Promise<{ base: string; work: string; changing: string; plain: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u22-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(work);
  await writeFile(path.join(work, "note.txt"), "old\n", "utf8");
  const hash = createHash("sha256").update("old\n").digest("hex");
  const run = async (id: string, steps: unknown[]): Promise<string> => {
    await writeFile(path.join(base, `${id}.script.json`), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
    const task = {
      schemaVersion: 1,
      id,
      goal: "g",
      workflow: "test",
      workspaceRoot: "./work",
      model: { provider: "scripted", scriptPath: `./${id}.script.json` },
      policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
      privacy: { secretEnv: [] },
      limits: { maxModelTurns: 6, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
      verifiers: [],
    };
    await writeFile(path.join(base, `${id}.task.json`), JSON.stringify(task), "utf8");
    const result = (
      await runCli({
        argv: ["run", "--task", `${id}.task.json`, "--quiet"],
        env: {},
        cwd: base,
        readFile: (file: string) => readFile(file, "utf8"),
        isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
        loadEnvFile: () => {},
        locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
        relatePaths: (target: string, root: string) => relateRealPaths(target, root),
        clock,
        randomBytes,
        cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
        assemble: assembleRun,
      })
    ).output as EngineResult;
    return result.runId;
  };
  const changing = await run("c", [{ toolCalls: [{ name: "write_file", args: { path: "note.txt", expectedHash: hash, change: { kind: "replace_text", oldText: "old", newText: "new" } } }] }, { text: "done" }]);
  const plain = await run("p", [{ text: "done" }]);
  return { base, work, changing, plain };
}

type Printed = { exitCode: number; json: Record<string, unknown> };
async function cleanup(base: string, args: readonly string[], applyCleanup?: ApplyCleanup): Promise<Printed> {
  const outcome = await runCleanup({
    argv: ["cleanup", "--workspace", "work", ...args, "--json"],
    cwd: base,
    env: {},
    clock,
    messages: createMessageCatalog("en"),
    ...(applyCleanup === undefined ? {} : { applyCleanup }),
  });
  const json = "text" in outcome ? (JSON.parse(outcome.text) as Record<string, unknown>) : (outcome.output as unknown as Record<string, unknown>);
  return { exitCode: outcome.exitCode, json };
}
const digestOf = async (base: string, args: readonly string[]): Promise<string> => {
  const shown = (await cleanup(base, args)).json as unknown as CleanupOutput;
  assert.ok(shown.status === "preview", JSON.stringify(shown));
  return shown.plan.digest.slice(0, 12);
};
const runsOf = async (work: string): Promise<string[]> => (await readdir(path.join(work, STATE_DIR_NAME, RUNS_DIR_NAME))).sort();

describe("U-22 (DR-48, AXM-3): the cleanup's JSON says what happened", () => {
  test("a preview: status preview, exit 0, no mode", async () => {
    const { base, plain } = await workspace();
    const shown = await cleanup(base, ["--run", plain]);
    assert.deepEqual([shown.json["kind"], shown.json["status"], shown.json["exitCode"], shown.exitCode], ["cleanup", "preview", 0, 0]);
    assert.equal(Object.hasOwn(shown.json, "mode"), false);
  });

  test("something removed and nothing kept for a problem: removed, exit 0, outcome.ok true", async () => {
    const { base, work, changing, plain } = await workspace();
    const args = ["--run", plain];
    const done = await cleanup(base, [...args, "--confirm", await digestOf(base, args)]);
    assert.deepEqual([done.json["status"], done.exitCode, (done.json["outcome"] as { ok: boolean }).ok], ["removed", 0, true]);
    assert.equal(Object.hasOwn(done.json, "mode"), false);
    assert.deepEqual(await runsOf(work), [changing]);
  });

  test("every item kept for a confirmation not given: nothing_removed, exit 3, outcome.ok false", async () => {
    const { base, work, changing, plain } = await workspace();
    const args = ["--run", changing];
    // The run was not reverted and --include-not-reverted is not given: its records stay.
    const done = await cleanup(base, [...args, "--confirm", await digestOf(base, args)]);
    const outcome = done.json["outcome"] as { ok: boolean; removed: unknown[]; kept: { reason: string }[] };
    assert.deepEqual([done.json["status"], done.json["exitCode"], done.exitCode, outcome.ok, outcome.removed.length], ["nothing_removed", 3, 3, false, 0]);
    assert.deepEqual(outcome.kept.map((item) => item.reason), ["not_reverted_not_confirmed"]);
    assert.deepEqual(await runsOf(work), [changing, plain].sort());
  });

  test("some removed, some kept by the person's choice: removed, exit 0", async () => {
    const { base, changing, plain } = await workspace();
    const args = ["--run", `${changing},${plain}`];
    const done = await cleanup(base, [...args, "--confirm", await digestOf(base, args)]);
    assert.deepEqual([done.json["status"], done.exitCode, (done.json["outcome"] as { ok: boolean }).ok], ["removed", 0, true]);
  });

  test("an item kept for a problem: partly_failed, exit 1, outcome.ok false, whatever else was removed", async () => {
    const { base, changing, plain } = await workspace();
    const args = ["--run", `${changing},${plain}`];
    const store = (async () => ({
      ok: true,
      removed: [{ target: "run", runId: plain, size: { files: 1, bytes: 10 } }],
      kept: [{ target: "run", runId: changing, reason: "io_error" }],
      totals: { runs: { count: 1, files: 1, bytes: 10 }, discarded: { count: 0, files: 0, bytes: 0 } },
    })) as unknown as ApplyCleanup;
    const done = await cleanup(base, [...args, "--confirm", await digestOf(base, args), "--include-not-reverted"], store);
    assert.deepEqual([done.json["status"], done.exitCode, (done.json["outcome"] as { ok: boolean }).ok], ["partly_failed", 1, false]);
  });

  test("a digest that is not the plan's: the error cleanup_plan_changed, exit 2, nothing removed", async () => {
    const { base, work, changing, plain } = await workspace();
    const done = await cleanup(base, ["--run", plain, "--confirm", "0123456789ab"]);
    assert.deepEqual([done.json["kind"], done.json["code"], done.json["exitCode"], done.exitCode], ["error", "cleanup_plan_changed", 2, 2]);
    assert.deepEqual(await runsOf(work), [changing, plain].sort());
  });

  test("the store finding another plan under the lock is the same error", async () => {
    const { base, plain } = await workspace();
    const args = ["--run", plain];
    const store = (async () => ({ ok: false, code: "plan_changed" })) as unknown as ApplyCleanup;
    const done = await cleanup(base, [...args, "--confirm", await digestOf(base, args)], store);
    assert.deepEqual([done.json["kind"], done.json["code"], done.exitCode], ["error", "cleanup_plan_changed", 2]);
  });

  test("the exit codes are the contract's", () => {
    assert.deepEqual(CLEANUP_EXIT_CODES, { preview: 0, removed: 0, nothing_removed: 3, partly_failed: 1 });
  });
});

describe("U-22: the person's text", () => {
  test("a cleanup that removed nothing says so first", async () => {
    const { base, changing } = await workspace();
    const args = ["--run", changing];
    const digest = await digestOf(base, args);
    const outcome = await runCleanup({ argv: ["cleanup", "--workspace", "work", ...args, "--confirm", digest], cwd: base, env: {}, clock, messages: createMessageCatalog("en") });
    assert.ok("text" in outcome, JSON.stringify(outcome));
    assert.equal(outcome.exitCode, 3);
    assert.ok(/nothing was removed/i.test(outcome.text.split("\n")[0] ?? ""), outcome.text);
    assert.ok(outcome.text.includes(`- run ${changing}: `), outcome.text);
  });
});
