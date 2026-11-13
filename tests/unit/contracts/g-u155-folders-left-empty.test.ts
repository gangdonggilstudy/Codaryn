/**
 * U-155 (GT-D14, the contract's part): an apply leaves the folders its moves and discards empty in
 * place, and its result can tell how many (ApplyResult.foldersLeftEmpty, by foldersLeftEmptyOf over
 * the inventories before and after the actions). Only additions: no apply sets the field yet, so the
 * apply's JSON is unchanged; the engine and the human line follow.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { asRawText, foldersLeftEmptyOf } from "../../../src/contracts/index.js";
import type { AppliedPlanAction, ApplyResult, InventoryManifest, ResolvedPlanAction } from "../../../src/contracts/index.js";

const HASH = "a".repeat(64);
const manifest = (paths: readonly string[], options: { limitReached?: boolean; unchecked?: readonly string[] } = {}): InventoryManifest => ({
  entries: [
    ...paths.map((path) => ({ path: asRawText(path), kind: "file" as const, size: 1 })),
    ...(options.unchecked ?? []).map((path) => ({ path: asRawText(path), kind: "unchecked" as const })),
  ].sort((a, b) => (a.path < b.path ? -1 : 1)),
  limitReached: options.limitReached === true,
});
const applied = (...actions: ResolvedPlanAction[]): AppliedPlanAction[] =>
  actions.map((action, index) => ({ index, action, stored: action.kind === "discard" ? String(index) : null }));
const move = (from: string, to: string): ResolvedPlanAction => ({ kind: "move", from, to, sha256: HASH });
const discard = (path: string): ResolvedPlanAction => ({ kind: "discard", path, sha256: HASH });

describe("U-155: foldersLeftEmptyOf", () => {
  test("moving every file out of a folder leaves it, and its parent, without files", () => {
    const before = manifest(["photos/2025/a.jpg", "photos/2025/b.jpg", "notes.txt"]);
    const after = manifest(["sorted/a.jpg", "sorted/b.jpg", "notes.txt"]);
    assert.equal(foldersLeftEmptyOf(before, after, applied(move("photos/2025/a.jpg", "sorted/a.jpg"), move("photos/2025/b.jpg", "sorted/b.jpg"))), 2, "photos/2025 and photos");
  });

  test("a folder that keeps another file is not counted; a move inside its folder empties nothing", () => {
    const before = manifest(["docs/a.md", "docs/b.md", "x/old.txt"]);
    const after = manifest(["docs/b.md", "archive/a.md", "x/new.txt"]);
    assert.equal(foldersLeftEmptyOf(before, after, applied(move("docs/a.md", "archive/a.md"), move("x/old.txt", "x/new.txt"))), 0);
  });

  test("a discard empties a folder as a move does; files at the root empty no folder", () => {
    const before = manifest(["tmp/cache.bin", "top.txt"]);
    const after = manifest([]);
    assert.equal(foldersLeftEmptyOf(before, after, applied(discard("tmp/cache.bin"), discard("top.txt"))), 1);
  });

  test("it cannot be told: a manifest at its limit, or an unchecked entry under such a folder", () => {
    const before = manifest(["a/x.txt"]);
    const after = manifest([]);
    const actions = applied(move("a/x.txt", "b/x.txt"));
    assert.equal(foldersLeftEmptyOf(manifest(["a/x.txt"], { limitReached: true }), after, actions), null);
    assert.equal(foldersLeftEmptyOf(before, manifest([], { limitReached: true }), actions), null);
    assert.equal(foldersLeftEmptyOf(before, manifest([], { unchecked: ["a/locked.bin"] }), actions), null);
    assert.equal(foldersLeftEmptyOf(before, manifest([], { unchecked: ["elsewhere/locked.bin"] }), actions), 1, "an unchecked entry elsewhere does not matter");
  });

  test("a folder name that is a prefix of another is not confused with it", () => {
    const before = manifest(["a/x.txt", "ab/y.txt"]);
    const after = manifest(["ab/y.txt", "z/x.txt"]);
    assert.equal(foldersLeftEmptyOf(before, after, applied(move("a/x.txt", "z/x.txt"))), 1);
  });

  test("no action: nothing to count", () => {
    assert.equal(foldersLeftEmptyOf(manifest(["a/x"]), manifest([]), []), 0);
  });
});

describe("U-155: ApplyResult.foldersLeftEmpty", () => {
  test("optional: a result without it is as before; with it, a count", () => {
    const base: ApplyResult = {
      schemaVersion: 1,
      kind: "apply",
      runId: "20261113T040000Z-0000dddd",
      planRunId: "20261113T035900Z-0000eeee",
      taskId: "tidy",
      digest: HASH,
      status: "done",
      reason: "verified",
      exitCode: 0,
      applied: [],
      verifiers: [],
      usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, repairAttempts: 0 },
      journalPath: ".codaryn/runs/20261113T040000Z-0000dddd/journal.jsonl",
      notices: [],
    };
    assert.equal(base.foldersLeftEmpty, undefined);
    const told: ApplyResult = { ...base, foldersLeftEmpty: 2 };
    assert.deepEqual(JSON.parse(JSON.stringify(told)), told);
  });
});
