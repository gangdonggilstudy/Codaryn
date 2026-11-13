/**
 * U-158 (GT-D14, the engine's part of U-155): applyPlan sets ApplyResult.foldersLeftEmpty from its
 * two inventories (before the actions, in the preflight; after them, in the verification), with the
 * contract's rule foldersLeftEmptyOf. The folders stay; nothing else in the result changes. Left out
 * when the count is 0, when the second inventory was not taken, or when it cannot be told.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { asRawText, planActionShown } from "../../../src/contracts/index.js";
import type {
  ApplyDeps,
  ApplyJournalEntry,
  InventoryChecker,
  InventoryManifest,
  MaskedPlanAction,
  MaskedText,
  PlanExecutor,
  PlanItemOutcome,
  ResolvedPlanAction,
  StoredPlanAction,
} from "../../../src/contracts/index.js";
import { applyPlan } from "../../../src/engine/index.js";
import { FakeClock, FakePolicy, FakeVerifiers, fakePrivacy } from "./fakes.js";

const HASH = "a".repeat(64);
const move = (from: string, to: string): ResolvedPlanAction => ({ kind: "move", from, to, sha256: HASH });
const files = (paths: readonly string[]): InventoryManifest => ({ entries: paths.map((path) => ({ path: asRawText(path), kind: "file" as const, size: 1 })), limitReached: false });

function stored(action: ResolvedPlanAction): StoredPlanAction {
  const masked: MaskedPlanAction =
    action.kind === "move"
      ? { kind: "move", from: action.from as MaskedText, to: action.to as MaskedText, sha256: action.sha256 }
      : { kind: "discard", path: action.path as MaskedText, sha256: action.sha256 };
  return { ...action, shown: planActionShown(masked) } as StoredPlanAction;
}

/** Inventories: the first capture is `before`, every later one `after` (or a throw when "throws"). */
function inventoryOf(before: InventoryManifest, after: InventoryManifest | "throws"): InventoryChecker {
  let captures = 0;
  return {
    capture: async () => {
      captures += 1;
      if (captures === 1) return before;
      if (after === "throws") throw new Error("cannot list");
      return after;
    },
    check: async () => ({ id: "inventory", kind: "inventory", outcome: "pass", evidence: asRawText("ok"), checked: [], limits: [] }),
  };
}

const executor = (onApply: (index: number) => void = () => undefined): PlanExecutor => ({
  check: async () => null,
  apply: async (action, index): Promise<PlanItemOutcome> => {
    onApply(index);
    return { ok: true, applied: { index, action, stored: null } };
  },
});

function deps(actions: readonly ResolvedPlanAction[], inventory: InventoryChecker, exec: PlanExecutor = executor()) {
  const events: ApplyJournalEntry[] = [];
  const controller = new AbortController();
  const value: ApplyDeps = {
    plan: { schemaVersion: 1, kind: "plan", runId: "20261113T050000Z-0000aaaa", actions: actions.map(stored) },
    planRunId: "20261113T050000Z-0000aaaa",
    digest: "d".repeat(64),
    approval: "cli-flag",
    runId: "20261113T050100Z-0000bbbb",
    taskId: "tidy",
    maxDurationMs: 60_000,
    verifierConfigs: [],
    executor: exec,
    policy: new FakePolicy(),
    planActions: ["move", "discard"],
    discardedRoot: "/work/.codaryn/discarded/20261113T050100Z-0000bbbb",
    privacy: fakePrivacy(),
    verifiers: new FakeVerifiers(),
    inventory,
    journal: { append: async (event) => void events.push(event), close: async () => undefined },
    clock: new FakeClock(),
    signal: controller.signal,
    markApplied: async () => "marked",
  };
  return { deps: value, events, controller };
}

describe("U-158: applyPlan tells the folders its actions left without files", () => {
  test("every file moved out of photos/2025: two folders (it and photos), the result says 2", async () => {
    const actions = [move("photos/2025/a.jpg", "sorted/a.jpg"), move("photos/2025/b.jpg", "sorted/b.jpg")];
    const run = deps(actions, inventoryOf(files(["notes.txt", "photos/2025/a.jpg", "photos/2025/b.jpg"]), files(["notes.txt", "sorted/a.jpg", "sorted/b.jpg"])));
    const result = await applyPlan(run.deps);
    assert.deepEqual([result.status, result.reason], ["done", "verified"]);
    assert.equal(result.foldersLeftEmpty, 2);
  });

  test("no folder left without files: the field is left out, and the result is as before", async () => {
    const actions = [move("docs/a.md", "archive/a.md")];
    const run = deps(actions, inventoryOf(files(["docs/a.md", "docs/b.md"]), files(["archive/a.md", "docs/b.md"])));
    const result = await applyPlan(run.deps);
    assert.equal(Object.hasOwn(result, "foldersLeftEmpty"), false);
    assert.deepEqual(Object.keys(result), ["schemaVersion", "kind", "runId", "planRunId", "taskId", "digest", "status", "reason", "exitCode", "applied", "verifiers", "usage", "journalPath", "notices"]);
  });

  test("the second inventory was not taken (it threw): left out, though the move emptied a folder", async () => {
    const actions = [move("a/x.txt", "b/x.txt")];
    const run = deps(actions, inventoryOf(files(["a/x.txt"]), "throws"));
    const result = await applyPlan(run.deps);
    assert.equal(result.foldersLeftEmpty, undefined);
  });

  test("a stop between actions (cancelled) leaves it out: there is no inventory after the actions", async () => {
    const actions = [move("a/x.txt", "b/x.txt"), move("a/y.txt", "b/y.txt")];
    let controller: AbortController | undefined;
    const run = deps(actions, inventoryOf(files(["a/x.txt", "a/y.txt"]), files(["b/x.txt", "b/y.txt"])), executor(() => controller?.abort()));
    controller = run.controller;
    const result = await applyPlan(run.deps);
    assert.equal(result.status, "cancelled");
    assert.equal(result.foldersLeftEmpty, undefined);
  });

  test("an inventory at its limit cannot tell: left out", async () => {
    const actions = [move("a/x.txt", "b/x.txt")];
    const full: InventoryManifest = { ...files(["a/x.txt"]), limitReached: false };
    const after: InventoryManifest = { ...files(["b/x.txt"]), limitReached: true };
    const run = deps(actions, inventoryOf(full, after));
    const result = await applyPlan(run.deps);
    assert.equal(result.foldersLeftEmpty, undefined);
  });

  test("the journal is unchanged: no record carries the count", async () => {
    const actions = [move("photos/a.jpg", "sorted/a.jpg")];
    const run = deps(actions, inventoryOf(files(["photos/a.jpg"]), files(["sorted/a.jpg"])));
    const result = await applyPlan(run.deps);
    assert.equal(result.foldersLeftEmpty, 1);
    assert.equal(JSON.stringify(run.events).includes("foldersLeftEmpty"), false);
    assert.deepEqual(run.events.map((event) => event.type), ["apply_started", "plan_checked", "plan_item_started", "file_moved", "verifier_result", "run_finished"]);
  });
});
