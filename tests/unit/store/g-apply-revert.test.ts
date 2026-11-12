/**
 * G-E: reverting an apply run (RevertRun, G-A part): moves go back from `to` to `from`, discarded
 * files come back from `.codaryn/discarded/<runId>/` (DR-9), last action first, by rename only.
 * A file changed since is `changed_since_run`, an occupied original path is `original_path_taken`,
 * a file already back is `already_reverted`. Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { ContentHash, MaskedText, ResolvedPlanAction } from "../../../src/contracts/index.js";
import { RevertRunError, createApplyJournal, createPlanRecorder, prepareDiscardedRoot, revertRun } from "../../../src/store/index.js";

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
  if (options.withPlan !== false) await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(actions);

  const discarded = await prepareDiscardedRoot(root, APPLY_RUN);
  await mkdir(join(root, "docs"));
  await rename(join(root, "inbox", "report.txt"), join(root, "docs", "report.txt"));
  await rename(join(root, "inbox", "old.log"), join(discarded, "1"));

  const journal = createApplyJournal({ workspaceRoot: root, runId: APPLY_RUN, clock });
  await journal.append({ type: "apply_started", schemaVersion: 1, planRunId: PLAN_RUN, taskId: "organize-task", digest: "d".repeat(64) as ContentHash, approval: "cli-flag", actions: 2, maxDurationMs: 60_000 });
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

  test("a path recorded with a privacy token goes back through the stored plan; without a plan it is missing_snapshot", async () => {
    const masked = `inbox/${TOKEN}.txt`;
    const withPlan = await appliedWorkspace({ recordedFrom: masked });
    const outcome = await revertRun({ workspaceRoot: withPlan.root, runId: APPLY_RUN });
    assert.deepEqual(outcome.reverted.find((file) => file.action === "moved_back"), { path: masked, action: "moved_back", from: "docs/report.txt" });
    assert.equal(await readFile(join(withPlan.root, "inbox", "report.txt"), "utf8"), REPORT, "the real path comes from plan.json");

    const noPlan = await appliedWorkspace({ recordedFrom: masked, withPlan: false });
    const skipped = await revertRun({ workspaceRoot: noPlan.root, runId: APPLY_RUN });
    assert.deepEqual(skipped.skipped, [{ path: masked, reason: "missing_snapshot" }]);
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
