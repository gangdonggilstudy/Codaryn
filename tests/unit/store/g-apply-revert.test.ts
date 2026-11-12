/**
 * G-E: reverting an apply run (RevertRun, G-A part): moves go back from `to` to `from`, discarded
 * files come back from `.codaryn/discarded/<runId>/` (DR-9), last action first, by rename only.
 * A file changed since is `changed_since_run`, an occupied original path is `original_path_taken`,
 * a file already back is `already_reverted`. Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { ContentHash, MaskedText, ResolvedPlanAction } from "../../../src/contracts/index.js";
import { RevertRunError, createApplyJournal, createPlanRecorder, prepareDiscardedRoot, revertRun } from "../../../src/store/index.js";
import { moveWithoutReplacing } from "../../../src/store/apply-revert.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const PLAN_RUN = "20260102T030405Z-0a1b2c3d";
const APPLY_RUN = "20260102T030500Z-11111111";
const TOKEN = "[[CODARYN_SECRET:00000000000000aa]]";
const sha = (text: string): ContentHash => createHash("sha256").update(text, "utf8").digest("hex") as ContentHash;
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);
const clock = { now: () => Date.UTC(2026, 0, 2, 3, 5, 0) };

const REPORT = "quarterly report\n";
const LOG = "old log\n";

/** Every file under `dir` with its content, for "nothing changed" checks. */
async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const key = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) {
        out[key] = "link";
      } else if (entry.isDirectory()) {
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

interface Applied {
  readonly root: string;
  readonly discarded: string;
}

/**
 * A workspace as an apply run leaves it: inbox/report.txt moved to docs/report.txt, inbox/old.log
 * discarded to `.codaryn/discarded/<applyRun>/1`. The plan is stored; the apply journal records
 * both actions. `paths` lets a test record masked paths instead of the real ones.
 */
async function appliedWorkspace(options: { recordedFrom?: string; withPlan?: boolean } = {}): Promise<Applied> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-revert-")));
  roots.push(root);
  await mkdir(join(root, "inbox"));
  await writeFile(join(root, "inbox", "report.txt"), REPORT, "utf8");
  await writeFile(join(root, "inbox", "old.log"), LOG, "utf8");
  const actions: ResolvedPlanAction[] = [
    { kind: "move", from: "inbox/report.txt", to: "docs/report.txt", sha256: sha(REPORT) },
    { kind: "discard", path: "inbox/old.log", sha256: sha(LOG) },
  ];
  const digest = options.withPlan !== false ? await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(actions) : ("d".repeat(64) as ContentHash);

  const discarded = await prepareDiscardedRoot(root, APPLY_RUN);
  await mkdir(join(root, "docs"));
  await rename(join(root, "inbox", "report.txt"), join(root, "docs", "report.txt"));
  await rename(join(root, "inbox", "old.log"), join(discarded, "1"));

  const journal = createApplyJournal({ workspaceRoot: root, runId: APPLY_RUN, clock });
  await journal.append({ type: "apply_started", schemaVersion: 1, planRunId: PLAN_RUN, taskId: "organize-task", digest, approval: "cli-flag", actions: 2, maxDurationMs: 60_000 });
  await journal.append({ type: "plan_checked", problems: [], inventoryLimitReached: false });
  await journal.append({ type: "file_moved", index: 0, from: (options.recordedFrom ?? "inbox/report.txt") as MaskedText, to: "docs/report.txt" as MaskedText, sha256: sha(REPORT) });
  await journal.append({ type: "file_discarded", index: 1, path: "inbox/old.log" as MaskedText, stored: "1", sha256: sha(LOG) });
  await journal.close();
  return { root, discarded };
}

describe("revertRun on an apply run (G-E)", () => {
  test("a dry run says it would put back the discarded file and the moved file, last action first, and changes nothing", async () => {
    const { root } = await appliedWorkspace();
    const before = await tree(root);
    const preview = await revertRun({ workspaceRoot: root, runId: APPLY_RUN, dryRun: true });
    assert.deepEqual(preview, {
      reverted: [
        { path: "inbox/old.log", action: "restored_from_discard" },
        { path: "inbox/report.txt", action: "moved_back", from: "docs/report.txt" },
      ],
      skipped: [],
      // DR-25: a dry run does not judge whether this volume can move the files back safely.
      moveSafetyUnchecked: true,
    });
    assert.deepEqual(await tree(root), before);
  });

  test("a revert renames both files back; directories the apply made stay; a second revert finds them already back", async () => {
    const { root, discarded } = await appliedWorkspace();
    const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN });
    assert.deepEqual(outcome.reverted.map((file) => file.action), ["restored_from_discard", "moved_back"]);
    assert.deepEqual(outcome.skipped, []);
    assert.equal(await readFile(join(root, "inbox", "report.txt"), "utf8"), REPORT);
    assert.equal(await readFile(join(root, "inbox", "old.log"), "utf8"), LOG);
    assert.equal(await exists(join(root, "docs", "report.txt")), false);
    assert.equal(await exists(join(discarded, "1")), false);
    assert.equal(await exists(join(root, "docs")), true, "the directory the apply created is left in place");

    const again = await revertRun({ workspaceRoot: root, runId: APPLY_RUN });
    assert.deepEqual(again, {
      reverted: [],
      skipped: [
        { path: "inbox/old.log", reason: "already_reverted" },
        { path: "inbox/report.txt", reason: "already_reverted" },
      ],
    });
  });

  test("an occupied original path is original_path_taken and a changed file is changed_since_run; neither is replaced", async () => {
    const { root, discarded } = await appliedWorkspace();
    await writeFile(join(root, "inbox", "report.txt"), "a new file the user made\n", "utf8");
    await writeFile(join(discarded, "1"), "changed in the discarded directory\n", "utf8");
    const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN });
    assert.deepEqual(outcome, {
      reverted: [],
      skipped: [
        { path: "inbox/old.log", reason: "changed_since_run" },
        { path: "inbox/report.txt", reason: "original_path_taken" },
      ],
    });
    assert.equal(await readFile(join(root, "inbox", "report.txt"), "utf8"), "a new file the user made\n");
    assert.equal(await readFile(join(root, "docs", "report.txt"), "utf8"), REPORT, "the moved file stays where it is");
  });

  test("a moved file edited after the apply is changed_since_run; a missing parent of the original path is created", async () => {
    const { root } = await appliedWorkspace();
    await writeFile(join(root, "docs", "report.txt"), "edited after the apply\n", "utf8");
    await rm(join(root, "inbox"), { recursive: true });
    const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN });
    assert.deepEqual(outcome.skipped, [{ path: "inbox/report.txt", reason: "changed_since_run" }]);
    assert.deepEqual(outcome.reverted, [{ path: "inbox/old.log", action: "restored_from_discard" }]);
    assert.equal(await readFile(join(root, "inbox", "old.log"), "utf8"), LOG);
  });

  test("a path recorded with a privacy token goes back through the stored plan; without a plan run the revert rejects (DR-24 f, R-9c C-1)", async () => {
    const masked = `inbox/${TOKEN}.txt`;
    const withPlan = await appliedWorkspace({ recordedFrom: masked });
    const outcome = await revertRun({ workspaceRoot: withPlan.root, runId: APPLY_RUN });
    assert.deepEqual(outcome.reverted.find((file) => file.action === "moved_back"), { path: masked, action: "moved_back", from: "docs/report.txt" });
    assert.equal(await readFile(join(withPlan.root, "inbox", "report.txt"), "utf8"), REPORT, "the real path comes from plan.json");

    const noPlan = await appliedWorkspace({ recordedFrom: masked, withPlan: false });
    for (const dryRun of [true, false]) {
      await assert.rejects(revertRun({ workspaceRoot: noPlan.root, runId: APPLY_RUN, dryRun }), (error: unknown) => error instanceof RevertRunError && error.code === "plan_run_missing");
    }
    assert.equal(await readFile(join(noPlan.root, "docs", "report.txt"), "utf8"), REPORT, "not touched");
  });

  test("records that do not belong to the run or name a stored file outside the discarded directory reject, and nothing changes", async () => {
    for (const bad of [
      { type: "file_discarded", index: 1, path: "inbox/old.log", stored: "../../../evil", sha256: sha(LOG) },
      { type: "file_moved", index: -1, from: "a", to: "b", sha256: sha(REPORT) },
      { type: "file_moved", index: 0, from: "a", to: "b", sha256: "nothex" },
    ]) {
      const { root } = await appliedWorkspace();
      const file = join(root, ".codaryn", "runs", APPLY_RUN, "journal.jsonl");
      const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
      lines.push(JSON.stringify({ seq: lines.length + 1, at: "2026-01-02T03:05:01.000Z", runId: APPLY_RUN, ...bad }));
      await writeFile(file, `${lines.join("\n")}\n`, "utf8");
      const before = await tree(root);
      await assert.rejects(revertRun({ workspaceRoot: root, runId: APPLY_RUN }), (error: unknown) => error instanceof RevertRunError && error.code === "invalid_run_record");
      assert.deepEqual(await tree(root), before, JSON.stringify(bad));
    }
  });

  test("DR-24 (a): a stored name through a junction in the discarded directory is refused; the outside file stays", async () => {
    const { root, discarded } = await appliedWorkspace();
    const outside = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-outside-")));
    roots.push(outside);
    await writeFile(join(outside, "precious.doc"), "precious\n", "utf8");
    await symlink(outside, join(discarded, "sub"), "junction");
    const file = join(root, ".codaryn", "runs", APPLY_RUN, "journal.jsonl");
    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    lines.push(JSON.stringify({ seq: lines.length + 1, at: "2026-01-02T03:05:01.000Z", runId: APPLY_RUN, type: "file_discarded", index: 1, path: "b.txt", stored: "sub/precious.doc", sha256: sha("precious\n") }));
    await writeFile(file, `${lines.join("\n")}\n`, "utf8");
    await assert.rejects(revertRun({ workspaceRoot: root, runId: APPLY_RUN }), (error: unknown) => error instanceof RevertRunError && error.code === "invalid_run_record");
    assert.equal(await readFile(join(outside, "precious.doc"), "utf8"), "precious\n", "the file outside the workspace is not moved");
    assert.equal(await exists(join(root, "b.txt")), false);
  });

  test("DR-24 (a): a stored file that is itself a link is not followed", async () => {
    const { root, discarded } = await appliedWorkspace();
    const outside = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-outside-")));
    roots.push(outside);
    await writeFile(join(outside, "old.log"), LOG, "utf8");
    await rm(join(discarded, "1"));
    await symlink(outside, join(discarded, "1"), "junction");
    const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN });
    assert.deepEqual(outcome.skipped, [{ path: "inbox/old.log", reason: "changed_since_run" }]);
    assert.equal(await readFile(join(outside, "old.log"), "utf8"), LOG);
  });

  test("DR-24 (f): plan.json paths are used only when its bytes have the approved digest", async () => {
    const masked = `inbox/${TOKEN}.txt`;
    const { root } = await appliedWorkspace({ recordedFrom: masked });
    const planFile = join(root, ".codaryn", "runs", PLAN_RUN, "plan.json");
    const stored = JSON.parse(await readFile(planFile, "utf8")) as { actions: { from?: string }[] };
    stored.actions[0] = { ...stored.actions[0], from: "elsewhere/report.txt" };
    await writeFile(planFile, `${JSON.stringify(stored)}\n`, "utf8");
    for (const dryRun of [true, false]) {
      await assert.rejects(revertRun({ workspaceRoot: root, runId: APPLY_RUN, dryRun }), (error: unknown) => error instanceof RevertRunError && error.code === "invalid_run_record", "a changed plan.json is not trusted");
    }
    assert.equal(await exists(join(root, "elsewhere")), false);
    assert.equal(await readFile(join(root, "docs", "report.txt"), "utf8"), REPORT);
  });

  test("DR-24 (b): a move back that cannot be made safely is unsafe_move; nothing is renamed", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-move-")));
    roots.push(dir);
    await writeFile(join(dir, "from.txt"), "x\n", "utf8");
    for (const code of ["EPERM", "EXDEV", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EMLINK"]) {
      const outcome = await moveWithoutReplacing(join(dir, "from.txt"), join(dir, "to.txt"), { link: async () => { throw Object.assign(new Error(code), { code }); } });
      assert.equal(outcome, "unsafe", code);
    }
    const other = await moveWithoutReplacing(join(dir, "from.txt"), join(dir, "to.txt"), { link: async () => { throw Object.assign(new Error("EIO"), { code: "EIO" }); } });
    assert.equal(other, "failed");
    assert.equal(await exists(join(dir, "to.txt")), false, "nothing was renamed");
    assert.equal(await readFile(join(dir, "from.txt"), "utf8"), "x\n");
  });

  test("a record whose hash is not the plan action's, or a stored name outside the contract's pattern, rejects", async () => {
    for (const bad of [
      { type: "file_moved", index: 0, from: "inbox/report.txt", to: "docs/report.txt", sha256: sha("other\n") },
      { type: "file_discarded", index: 1234567, path: "inbox/old.log", stored: "1234567", sha256: sha(LOG) },
    ]) {
      const { root } = await appliedWorkspace();
      const file = join(root, ".codaryn", "runs", APPLY_RUN, "journal.jsonl");
      const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
      lines.push(JSON.stringify({ seq: lines.length + 1, at: "2026-01-02T03:05:01.000Z", runId: APPLY_RUN, ...bad }));
      await writeFile(file, `${lines.join("\n")}\n`, "utf8");
      const before = await tree(root);
      await assert.rejects(revertRun({ workspaceRoot: root, runId: APPLY_RUN }), (error: unknown) => error instanceof RevertRunError && error.code === "invalid_run_record", JSON.stringify(bad));
      assert.deepEqual(await tree(root), before);
    }
  });

  test("R-9 I-4: an action started but not recorded is reverted when it was done, ignored when it was not, and skipped otherwise", async () => {
    // The journal ends after plan_item_started for action 1 (the discard): the process stopped.
    const started = async (doneDiscard: boolean | "changed"): Promise<Applied> => {
      const applied = await appliedWorkspace();
      const file = join(applied.root, ".codaryn", "runs", APPLY_RUN, "journal.jsonl");
      const lines = (await readFile(file, "utf8")).trimEnd().split("\n").filter((line) => !line.includes('"file_discarded"'));
      lines.push(JSON.stringify({ seq: lines.length + 1, at: "2026-01-02T03:05:01.000Z", runId: APPLY_RUN, type: "plan_item_started", index: 1, action: { kind: "discard", path: "inbox/old.log", sha256: sha(LOG) } }));
      await writeFile(file, `${lines.map((line, index) => JSON.stringify({ ...JSON.parse(line), seq: index + 1 })).join("\n")}\n`, "utf8");
      if (doneDiscard === false) await rename(join(applied.discarded, "1"), join(applied.root, "inbox", "old.log"));
      if (doneDiscard === "changed") await writeFile(join(applied.discarded, "1"), "changed\n", "utf8");
      return applied;
    };
    const done = await started(true);
    assert.deepEqual((await revertRun({ workspaceRoot: done.root, runId: APPLY_RUN })).reverted.map((file) => [file.path, file.action]), [
      ["inbox/old.log", "restored_from_discard"],
      ["inbox/report.txt", "moved_back"],
    ]);
    assert.equal(await readFile(join(done.root, "inbox", "old.log"), "utf8"), LOG);

    const notDone = await started(false);
    const outcome = await revertRun({ workspaceRoot: notDone.root, runId: APPLY_RUN });
    assert.deepEqual(outcome.reverted.map((file) => file.path), ["inbox/report.txt"], "the action that was not done is not listed");
    assert.deepEqual(outcome.skipped, []);

    const changed = await started("changed");
    const skipped = await revertRun({ workspaceRoot: changed.root, runId: APPLY_RUN });
    assert.deepEqual(skipped.skipped, [{ path: "inbox/old.log", reason: "changed_since_run" }]);
    assert.equal(await readFile(join(changed.discarded, "1"), "utf8"), "changed\n", "nothing is touched");
  });

  test("an action that failed while applying is not listed", async () => {
    const { root } = await appliedWorkspace();
    const file = join(root, ".codaryn", "runs", APPLY_RUN, "journal.jsonl");
    const lines = (await readFile(file, "utf8")).trimEnd().split("\n").filter((line) => !line.includes('"file_discarded"'));
    lines.push(JSON.stringify({ seq: 0, at: "2026-01-02T03:05:01.000Z", runId: APPLY_RUN, type: "plan_item_started", index: 1, action: { kind: "discard", path: "inbox/old.log", sha256: sha(LOG) } }));
    lines.push(JSON.stringify({ seq: 0, at: "2026-01-02T03:05:01.000Z", runId: APPLY_RUN, type: "plan_item_failed", index: 1, problem: "io_error" }));
    await writeFile(file, `${lines.map((line, index) => JSON.stringify({ ...JSON.parse(line), seq: index + 1 })).join("\n")}\n`, "utf8");
    const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN, dryRun: true });
    assert.deepEqual(outcome.reverted.map((entry) => entry.path), ["inbox/report.txt"]);
    assert.deepEqual(outcome.skipped, []);
  });

  test("a model run's journal is reverted as before; an apply_started that is not first is not an apply run", async () => {
    const { root } = await appliedWorkspace();
    const file = join(root, ".codaryn", "runs", APPLY_RUN, "journal.jsonl");
    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    const started = { seq: 1, at: "2026-01-02T03:05:00.000Z", runId: APPLY_RUN, type: "run_started", schemaVersion: 1, taskId: "t", workflow: "x", provider: "scripted", limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1 } };
    await writeFile(file, `${[JSON.stringify(started), ...lines.map((line, index) => JSON.stringify({ ...JSON.parse(line), seq: index + 2 }))].join("\n")}\n`, "utf8");
    const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN, dryRun: true });
    assert.deepEqual(outcome, { reverted: [], skipped: [] }, "a model run without file_changed records has nothing to revert");
  });
});

describe("R-9b N-1 (DR-27 a): an action done but not recorded, as the engine's journal leaves it", () => {
  /**
   * The engine writes plan_item_started before each action and file_moved/file_discarded after it
   * (565ac15). The apply stops (no result.json) right after doing action `doneUpTo`, before its record.
   */
  async function stoppedApply(doneUpTo: 0 | 1): Promise<Applied> {
    const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-stop-")));
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
    const journal = createApplyJournal({ workspaceRoot: root, runId: APPLY_RUN, clock });
    await journal.append({ type: "apply_started", schemaVersion: 1, planRunId: PLAN_RUN, taskId: "organize-task", digest, approval: "cli-flag", actions: 2, maxDurationMs: 60_000 });
    await journal.append({ type: "plan_checked", problems: [], inventoryLimitReached: false });
    await journal.append({ type: "plan_item_started", index: 0, action: { kind: "move", from: "inbox/report.txt" as MaskedText, to: "docs/report.txt" as MaskedText, sha256: sha(REPORT) } });
    await mkdir(join(root, "docs"));
    await rename(join(root, "inbox", "report.txt"), join(root, "docs", "report.txt"));
    if (doneUpTo === 1) {
      await journal.append({ type: "file_moved", index: 0, from: "inbox/report.txt" as MaskedText, to: "docs/report.txt" as MaskedText, sha256: sha(REPORT) });
      await journal.append({ type: "plan_item_started", index: 1, action: { kind: "discard", path: "inbox/old.log" as MaskedText, sha256: sha(LOG) } });
      await rename(join(root, "inbox", "old.log"), join(discarded, "1"));
    }
    await journal.close();
    return { root, discarded };
  }

  test("review reproduction 1: a discard done before its record is put back, not left out of a complete revert", async () => {
    const { root, discarded } = await stoppedApply(1);
    const preview = await revertRun({ workspaceRoot: root, runId: APPLY_RUN, dryRun: true });
    assert.deepEqual(preview.reverted.map((file) => [file.path, file.action]), [
      ["inbox/old.log", "restored_from_discard"],
      ["inbox/report.txt", "moved_back"],
    ]);
    const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN });
    assert.deepEqual(outcome.reverted.map((file) => [file.path, file.action]), [
      ["inbox/old.log", "restored_from_discard"],
      ["inbox/report.txt", "moved_back"],
    ]);
    assert.deepEqual(outcome.skipped, []);
    assert.equal(await readFile(join(root, "inbox", "old.log"), "utf8"), LOG);
    assert.equal(await readFile(join(root, "inbox", "report.txt"), "utf8"), REPORT);
    assert.deepEqual(await readdir(discarded), [], "nothing is left in the discarded directory");
  });

  test("review reproduction 2 (R10b): a move done before its record is moved back, not an empty outcome", async () => {
    const { root } = await stoppedApply(0);
    const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN });
    assert.deepEqual(outcome.reverted, [{ path: "inbox/report.txt", action: "moved_back", from: "docs/report.txt" }]);
    assert.deepEqual(outcome.skipped, []);
    assert.equal(await readFile(join(root, "inbox", "report.txt"), "utf8"), REPORT);
    assert.equal(await exists(join(root, "docs", "report.txt")), false);
  });

  test("a started move whose files are in neither recorded state is skipped as changed_since_run, so the revert is not complete", async () => {
    const { root } = await stoppedApply(0);
    await writeFile(join(root, "inbox", "report.txt"), "a new file at the original path\n", "utf8");
    const before = await tree(root);
    const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN });
    assert.deepEqual(outcome.reverted, []);
    assert.deepEqual(outcome.skipped, [{ path: "inbox/report.txt", reason: "changed_since_run" }]);
    assert.deepEqual(await tree(root), before, "nothing is touched");
  });
});

describe("R-9c C-2: a discard whose directory was never made, or is gone", () => {
  /** A plan with one discard. The apply stops right after the start record, before the discarded directory exists. */
  async function stoppedBeforeDiscardDir(): Promise<string> {
    const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-d1-")));
    roots.push(root);
    await mkdir(join(root, "inbox"));
    await writeFile(join(root, "inbox", "old.log"), LOG, "utf8");
    const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan([{ kind: "discard", path: "inbox/old.log", sha256: sha(LOG) }]);
    const journal = createApplyJournal({ workspaceRoot: root, runId: APPLY_RUN, clock });
    await journal.append({ type: "apply_started", schemaVersion: 1, planRunId: PLAN_RUN, taskId: "organize-task", digest, approval: "cli-flag", actions: 1, maxDurationMs: 60_000 });
    await journal.append({ type: "plan_checked", problems: [], inventoryLimitReached: false });
    await journal.append({ type: "plan_item_started", index: 0, action: { kind: "discard", path: "inbox/old.log" as MaskedText, sha256: sha(LOG) } });
    await journal.close();
    return root;
  }

  test("review reproduction D1: a started discard with no discarded directory and the file in place was not done: not listed", async () => {
    const root = await stoppedBeforeDiscardDir();
    const before = await tree(root);
    for (const dryRun of [true, false]) {
      const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN, dryRun });
      assert.deepEqual([outcome.reverted, outcome.skipped], [[], []], `dryRun ${dryRun}`);
    }
    assert.deepEqual(await tree(root), before);
  });

  test("a recorded discard whose discarded directory is gone is changed_since_run, or already_reverted when the file is back", async () => {
    const { root, discarded } = await appliedWorkspace();
    await rm(discarded, { recursive: true });
    const gone = await revertRun({ workspaceRoot: root, runId: APPLY_RUN, dryRun: true });
    assert.deepEqual(gone.skipped, [{ path: "inbox/old.log", reason: "changed_since_run" }]);
    await writeFile(join(root, "inbox", "old.log"), LOG, "utf8");
    const back = await revertRun({ workspaceRoot: root, runId: APPLY_RUN, dryRun: true });
    assert.deepEqual(back.skipped, [{ path: "inbox/old.log", reason: "already_reverted" }]);
  });

  test("a discarded directory that is a link is still not read: io_error, nothing moved", async () => {
    const { root, discarded } = await appliedWorkspace();
    const elsewhere = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-elsewhere-")));
    roots.push(elsewhere);
    await rename(join(discarded, "1"), join(elsewhere, "1"));
    await rm(discarded, { recursive: true });
    await symlink(elsewhere, discarded, "junction");
    const outcome = await revertRun({ workspaceRoot: root, runId: APPLY_RUN });
    assert.deepEqual(outcome.skipped, [{ path: "inbox/old.log", reason: "io_error" }]);
    assert.equal(await readFile(join(elsewhere, "1"), "utf8"), LOG, "the file behind the link stays");
  });
});

describe("R-9c C-1: an apply whose plan run is gone", () => {
  const rejectsWith = async (root: string, code: string): Promise<void> => {
    const before = await tree(root);
    for (const dryRun of [true, false]) {
      await assert.rejects(revertRun({ workspaceRoot: root, runId: APPLY_RUN, dryRun }), (error: unknown) => error instanceof RevertRunError && error.code === code, `dryRun ${dryRun}`);
    }
    assert.deepEqual(await tree(root), before, "nothing changes");
  };

  test("review reproduction F5: the plan run's directory was deleted: plan_run_missing, not invalid_run_record", async () => {
    const { root } = await appliedWorkspace();
    await rm(join(root, ".codaryn", "runs", PLAN_RUN), { recursive: true });
    await rejectsWith(root, "plan_run_missing");
  });

  test("the plan run's directory stays but its plan.json was deleted: plan_run_missing", async () => {
    const { root } = await appliedWorkspace();
    await rm(join(root, ".codaryn", "runs", PLAN_RUN, "plan.json"));
    await rejectsWith(root, "plan_run_missing");
  });

  test("a plan.json that exists but differs, or a plan run directory that is a link, stays invalid_run_record", async () => {
    const changed = await appliedWorkspace();
    await writeFile(join(changed.root, ".codaryn", "runs", PLAN_RUN, "plan.json"), "{}\n", "utf8");
    await rejectsWith(changed.root, "invalid_run_record");

    const linked = await appliedWorkspace();
    const elsewhere = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-planrun-")));
    roots.push(elsewhere);
    const planDir = join(linked.root, ".codaryn", "runs", PLAN_RUN);
    await rename(planDir, join(elsewhere, PLAN_RUN));
    await symlink(join(elsewhere, PLAN_RUN), planDir, "junction");
    await rejectsWith(linked.root, "invalid_run_record");
  });
});
