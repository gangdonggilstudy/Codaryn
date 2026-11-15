/**
 * Unit U-319 (the CLI migration's C-9b: the cleanup becomes one copy in the app layer; PM): the CLI's
 * cleanup keeps its own texts for the three errors that are not about its arguments. The app's cleanup
 * says them otherwise (src/app/cleanup.ts, the GUI's), and the one copy gives codes only, so each caller
 * puts its own text on them. No test pinned the CLI's texts for workspace_locked and internal_error
 * before this one; the board pins the confirmed digest that is not the plan's (cleanup-confirm) and a
 * held lock (cleanup-paths). The store's functions are injected (CleanupEnvironment), so nothing is read
 * or removed but an empty folder; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { CleanupOutcome, CleanupPlan, StateSummary } from "../../../src/contracts/index.js";
import { runCleanup } from "../../../src/cli/cleanup.js";
import type { CleanupEnvironment } from "../../../src/cli/cleanup.js";

const LOCKED = "another Codaryn process holds the workspace lock; nothing was removed";
const PLAN_CHANGED =
  "the confirmed digest is not the cleanup plan's: the state directory changed since the preview, or another preview's digest was given. Nothing was removed. Preview again and confirm its digest";
const INTERNAL = "the cleanup stopped because of an internal error; nothing more was removed";

const DIGEST = "b".repeat(64);
const TOTALS = { runs: { count: 0, notReverted: 0, files: 0, bytes: 0 }, discarded: { count: 0, files: 0, bytes: 0 }, leftovers: { count: 0, files: 0, bytes: 0 } };
const PLAN = { items: [], blocked: [], totals: TOTALS, parked: { files: 0, bytes: 0 }, digest: DIGEST } as unknown as CleanupPlan;
const SUMMARY = {} as unknown as StateSummary;

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

async function base(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "codaryn-u319-"));
  temporaryDirs.push(dir);
  await mkdir(path.join(dir, "work"));
  return dir;
}

type Store = Pick<CleanupEnvironment, "summarizeState" | "planCleanup" | "applyCleanup">;

/** `codaryn cleanup --workspace work --run <id> [args]` with the store's functions given. */
async function cleanupWith(args: readonly string[], store: Store): Promise<{ code: string; message: string; exitCode: number }> {
  const argv = ["cleanup", "--workspace", "work", "--run", "20260101T000000Z-0000abcd", ...args];
  const outcome = await runCleanup({ argv, cwd: await base(), env: {}, clock: { now: () => 1_700_000_000_000 }, ...store });
  assert.ok("output" in outcome, `an error, not a cleanup: ${JSON.stringify(outcome)}`);
  const output = outcome.output as { kind: string; code: string; message: string };
  assert.equal(output.kind, "error");
  return { code: output.code, message: output.message, exitCode: outcome.exitCode };
}

const notCalled = async (): Promise<never> => {
  throw new Error("not to be called");
};

describe("U-319: the CLI's cleanup keeps its own error texts", () => {
  for (const json of [[], ["--json"]] as const) {
    const form = json.length === 0 ? "text" : "JSON";
    test(`the store finds the workspace locked: workspace_locked with the CLI's text (${form})`, async () => {
      const outcome = { ok: false, code: "workspace_locked" } as unknown as CleanupOutcome;
      const got = await cleanupWith(["--confirm", DIGEST.slice(0, 12), ...json], { planCleanup: async () => PLAN, applyCleanup: async () => outcome, summarizeState: notCalled });
      assert.deepEqual({ code: got.code, message: got.message }, { code: "workspace_locked", message: LOCKED });
    });

    test(`the store's plan under the lock is another: cleanup_plan_changed with the CLI's text (${form})`, async () => {
      const outcome = { ok: false, code: "plan_changed" } as unknown as CleanupOutcome;
      const got = await cleanupWith(["--confirm", DIGEST.slice(0, 12), ...json], { planCleanup: async () => PLAN, applyCleanup: async () => outcome, summarizeState: notCalled });
      assert.deepEqual({ code: got.code, message: got.message }, { code: "cleanup_plan_changed", message: PLAN_CHANGED });
    });
  }

  test("a confirmed digest that is not the plan's shown: cleanup_plan_changed with the same text, and the store's cleanup is not called", async () => {
    const got = await cleanupWith(["--confirm", "c".repeat(12)], { planCleanup: async () => PLAN, applyCleanup: notCalled, summarizeState: notCalled });
    assert.deepEqual({ code: got.code, message: got.message }, { code: "cleanup_plan_changed", message: PLAN_CHANGED });
  });

  test("the plan throws: internal_error with the CLI's text", async () => {
    const got = await cleanupWith([], { planCleanup: notCalled, applyCleanup: notCalled, summarizeState: async () => SUMMARY });
    assert.deepEqual({ code: got.code, message: got.message }, { code: "internal_error", message: INTERNAL });
  });

  test("the preview's summary throws: internal_error with the CLI's text", async () => {
    const got = await cleanupWith([], { planCleanup: async () => PLAN, applyCleanup: notCalled, summarizeState: notCalled });
    assert.deepEqual({ code: got.code, message: got.message }, { code: "internal_error", message: INTERNAL });
  });

  test("the store's cleanup throws: internal_error with the CLI's text", async () => {
    const got = await cleanupWith(["--confirm", DIGEST.slice(0, 12)], { planCleanup: async () => PLAN, applyCleanup: notCalled, summarizeState: notCalled });
    assert.deepEqual({ code: got.code, message: got.message }, { code: "internal_error", message: INTERNAL });
  });
});
