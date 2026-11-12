/**
 * DR-27 (c), review R-9b: reverting an apply run where hard links cannot be made (N-3), and record
 * indexes outside the plan (N-5). As in the review (R9), `fs/promises.link` itself is made to fail
 * with EPERM (`syncBuiltinESMExports`), so the store's own import sees it; only the revert runs
 * under it. This file runs in its own process, so nothing else sees the patch.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { ContentHash, MaskedText, ResolvedPlanAction } from "../../../src/contracts/index.js";
import { RevertRunError, createApplyJournal, createPlanRecorder, prepareDiscardedRoot, revertRun } from "../../../src/store/index.js";

const fsPromises = createRequire(import.meta.url)("node:fs/promises") as { link: (existing: string, created: string) => Promise<void> };

/** Runs `work` while every hard link fails with `code`, as on a volume without them. */
async function withoutHardLinks<T>(code: string, work: () => Promise<T>): Promise<T> {
  const real = fsPromises.link;
  fsPromises.link = async () => {
    throw Object.assign(new Error(`${code}: no hard links (injected)`), { code });
  };
  syncBuiltinESMExports();
  try {
    return await work();
  } finally {
    fsPromises.link = real;
    syncBuiltinESMExports();
  }
}

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const PLAN_RUN = "20260102T030405Z-0a1b2c3d";
const APPLY_RUN = "20260102T030500Z-11111111";
const REPORT = "quarterly report\n";
const LOG = "old log\n";
const sha = (text: string): ContentHash => createHash("sha256").update(text, "utf8").digest("hex") as ContentHash;
const clock = { now: () => Date.UTC(2026, 0, 2, 3, 5, 0) };

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const key = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        out[`${key}/`] = "dir";
        await walk(join(current, entry.name), `${key}/`);
      } else {
        out[key] = await readFile(join(current, entry.name), "utf8");
      }
    }
  };
  await walk(dir, "");
  return out;
}

/** inbox/report.txt moved to docs/report.txt and inbox/old.log discarded, both recorded. */
async function appliedWorkspace(extra: readonly Record<string, unknown>[] = []): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-nolink-")));
  roots.push(root);
  await mkdir(join(root, "inbox"));
  await writeFile(join(root, "inbox", "report.txt"), REPORT, "utf8");
  await writeFile(join(root, "inbox", "old.log"), LOG, "utf8");
  const actions: ResolvedPlanAction[] = [
    { kind: "move", from: "inbox/report.txt", to: "docs/report.txt", sha256: sha(REPORT) },
    { kind: "discard", path: "inbox/old.log", sha256: sha(LOG) },
  ];
  const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(actions);
  const discarded = await prepareDiscardedRoot(root, APPLY_RUN);
  await mkdir(join(root, "docs"));
  await rename(join(root, "inbox", "report.txt"), join(root, "docs", "report.txt"));
  await rename(join(root, "inbox", "old.log"), join(discarded, "1"));
  const journal = createApplyJournal({ workspaceRoot: root, runId: APPLY_RUN, clock });
  await journal.append({ type: "apply_started", schemaVersion: 1, planRunId: PLAN_RUN, taskId: "organize-task", digest, approval: "cli-flag", actions: 2, maxDurationMs: 60_000 });
  await journal.append({ type: "plan_checked", problems: [], inventoryLimitReached: false });
  await journal.append({ type: "file_moved", index: 0, from: "inbox/report.txt" as MaskedText, to: "docs/report.txt" as MaskedText, sha256: sha(REPORT) });
  await journal.append({ type: "file_discarded", index: 1, path: "inbox/old.log" as MaskedText, stored: "1", sha256: sha(LOG) });
  await journal.close();
  if (extra.length > 0) {
    const file = join(root, ".codaryn", "runs", APPLY_RUN, "journal.jsonl");
    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    for (const record of extra) lines.push(JSON.stringify({ seq: lines.length + 1, at: "2026-01-02T03:05:01.000Z", runId: APPLY_RUN, ...record }));
    await writeFile(file, `${lines.join("\n")}\n`, "utf8");
  }
  return root;
}

describe("R-9b N-3 (DR-27 c): a revert where hard links cannot be made", () => {
  test("review reproduction R9: both files are skipped as unsafe_move, not io_error, and nothing is renamed", async () => {
    const root = await appliedWorkspace();
    const before = await tree(root);
    const outcome = await withoutHardLinks("EPERM", () => revertRun({ workspaceRoot: root, runId: APPLY_RUN }));
    assert.deepEqual(outcome.reverted, []);
    assert.deepEqual(outcome.skipped, [
      { path: "inbox/old.log", reason: "unsafe_move" },
      { path: "inbox/report.txt", reason: "unsafe_move" },
    ]);
    assert.deepEqual(await tree(root), before, "both files stay where the apply left them");
  });
});

describe("R-9b N-5 (DR-27 c): record indexes outside the plan", () => {
  test("a record naming an action the plan does not have rejects as invalid_run_record, and nothing changes", async () => {
    for (const bad of [
      { type: "plan_item_failed", index: 2, problem: "io_error" },
      { type: "plan_item_started", index: 5, action: { kind: "discard", path: "inbox/old.log", sha256: sha(LOG) } },
    ]) {
      const root = await appliedWorkspace([bad]);
      const before = await tree(root);
      for (const dryRun of [true, false]) {
        await assert.rejects(revertRun({ workspaceRoot: root, runId: APPLY_RUN, dryRun }), (error: unknown) => error instanceof RevertRunError && error.code === "invalid_run_record", JSON.stringify(bad));
      }
      assert.deepEqual(await tree(root), before);
    }
  });
});

describe("DR-25: the person's consent to move files back unsafely, for one revert", () => {
  const consent = { channel: "cli-flag" as const, runId: APPLY_RUN };

  test("with consent for this run, both files go back by a rename after the check, reported unsafe", async () => {
    const root = await appliedWorkspace();
    const outcome = await withoutHardLinks("EPERM", () => revertRun({ workspaceRoot: root, runId: APPLY_RUN, unsafeMoveConsent: consent }));
    assert.deepEqual(outcome.reverted, [
      { path: "inbox/old.log", action: "restored_from_discard", unsafe: true },
      { path: "inbox/report.txt", action: "moved_back", from: "docs/report.txt", unsafe: true },
    ]);
    assert.deepEqual(outcome.skipped, []);
    assert.equal(await readFile(join(root, "inbox", "report.txt"), "utf8"), REPORT);
    assert.equal(await readFile(join(root, "inbox", "old.log"), "utf8"), LOG);
    assert.deepEqual(await readdir(join(root, ".codaryn", "discarded", APPLY_RUN)), []);
  });

  test("a consent for another run counts as none: the files are skipped as unsafe_move", async () => {
    const root = await appliedWorkspace();
    const before = await tree(root);
    const other = { channel: "cli-flag" as const, runId: "20260102T030600Z-22222222" };
    const outcome = await withoutHardLinks("EPERM", () => revertRun({ workspaceRoot: root, runId: APPLY_RUN, unsafeMoveConsent: other }));
    assert.deepEqual(outcome.skipped.map((file) => file.reason), ["unsafe_move", "unsafe_move"]);
    assert.deepEqual(await tree(root), before);
  });

  test("with consent, an occupied original path is still original_path_taken: nothing is replaced", async () => {
    const root = await appliedWorkspace();
    await writeFile(join(root, "inbox", "report.txt"), "someone else's file\n", "utf8");
    const outcome = await withoutHardLinks("EPERM", () => revertRun({ workspaceRoot: root, runId: APPLY_RUN, unsafeMoveConsent: consent }));
    assert.deepEqual(outcome.skipped, [{ path: "inbox/report.txt", reason: "original_path_taken" }]);
    assert.equal(await readFile(join(root, "inbox", "report.txt"), "utf8"), "someone else's file\n");
    assert.equal(await readFile(join(root, "docs", "report.txt"), "utf8"), REPORT);
  });

  test("where hard links work, a consent changes nothing: the files move safely and are not marked unsafe", async () => {
    const root = await appliedWorkspace();
    const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN, unsafeMoveConsent: consent });
    assert.deepEqual(outcome.reverted.map((file) => [file.action, file.unsafe]), [
      ["restored_from_discard", undefined],
      ["moved_back", undefined],
    ]);
  });

  test("a dry run creates nothing, judges no volume, lists the moves without unsafe and says so", async () => {
    const root = await appliedWorkspace();
    const before = await tree(root);
    for (const request of [{}, { unsafeMoveConsent: consent }]) {
      const outcome = await withoutHardLinks("EPERM", () => revertRun({ workspaceRoot: root, runId: APPLY_RUN, dryRun: true, ...request }));
      assert.deepEqual(outcome, {
        reverted: [
          { path: "inbox/old.log", action: "restored_from_discard" },
          { path: "inbox/report.txt", action: "moved_back", from: "docs/report.txt" },
        ],
        skipped: [],
        moveSafetyUnchecked: true,
      });
    }
    assert.deepEqual(await tree(root), before);
  });
});
