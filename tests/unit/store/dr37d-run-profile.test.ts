/**
 * DR-37 (d): the run list names each run's profile and workflow definition (RunListEntry.profile,
 * workflowRef) from its `run_started`: the recorded name, or null when none is recorded; an apply
 * run has null for both; a recorded value that is neither null nor such a name makes the run
 * damaged, like the other checked strings. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { ApplyJournalEvent, ContentHash, JournalEvent } from "../../../src/contracts/index.js";
import { createApplyJournal, createJournal, listRuns } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const HASH = "a".repeat(64) as ContentHash;
const at = (runId: string): number => Date.UTC(2026, 0, 2, Number(runId.slice(9, 11)), Number(runId.slice(11, 13)), 1);
const started = (extra: Record<string, unknown>): JournalEvent =>
  ({ type: "run_started", schemaVersion: 1, taskId: "t", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 }, ...extra }) as unknown as JournalEvent;

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-dr37d-")));
  roots.push(root);
  return root;
}

async function modelRun(root: string, runId: string, extra: Record<string, unknown>): Promise<void> {
  const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(runId) } });
  await journal.append(started(extra));
  await journal.close();
}

async function entryOf(root: string, runId: string) {
  return (await listRuns({ workspaceRoot: root })).runs.find((entry) => entry.runId === runId);
}

describe("DR-37 (d): profile and workflowRef in the run list", () => {
  test("the names run_started records, null when it records none or null", async () => {
    const root = await workspace();
    await modelRun(root, "20260102T010000Z-00000001", { profile: "work", workflowRef: "docs-flow" });
    await modelRun(root, "20260102T020000Z-00000002", {});
    await modelRun(root, "20260102T030000Z-00000003", { workflowRef: null });
    const named = await entryOf(root, "20260102T010000Z-00000001");
    assert.deepEqual(named?.state === "checked" ? [named.profile, named.workflowRef] : null, ["work", "docs-flow"]);
    const none = await entryOf(root, "20260102T020000Z-00000002");
    assert.deepEqual(none?.state === "checked" ? [none.profile, none.workflowRef] : null, [null, null]);
    const legacy = await entryOf(root, "20260102T030000Z-00000003");
    assert.deepEqual(legacy?.state === "checked" ? [legacy.profile, legacy.workflowRef] : null, [null, null]);
  });

  test("an apply run has null for both", async () => {
    const root = await workspace();
    await modelRun(root, "20260102T010000Z-00000001", { profile: "work" });
    const apply: ApplyJournalEvent = { type: "apply_started", schemaVersion: 1, planRunId: "20260102T010000Z-00000001", taskId: "t", digest: HASH, approval: "cli-flag", actions: 1, maxDurationMs: 60_000 };
    const journal = createApplyJournal({ workspaceRoot: root, runId: "20260102T020000Z-00000002", clock: { now: () => at("20260102T020000Z-00000002") } });
    await journal.append(apply);
    await journal.close();
    const entry = await entryOf(root, "20260102T020000Z-00000002");
    assert.deepEqual(entry?.state === "checked" ? [entry.kind, entry.profile, entry.workflowRef] : null, ["apply", null, null]);
  });

  test("a recorded value that is neither null nor such a name makes the run damaged", async () => {
    const root = await workspace();
    const bad: Record<string, unknown>[] = [{ profile: "bad name!" }, { profile: 7 }, { profile: "" }, { workflowRef: "../x" }, { workflowRef: 3 }, { workflowRef: "a".repeat(65) }];
    for (const [index, extra] of bad.entries()) await modelRun(root, `20260102T0${index + 1}0000Z-0000000${index + 1}`, extra);
    for (const [index] of bad.entries()) assert.equal((await entryOf(root, `20260102T0${index + 1}0000Z-0000000${index + 1}`))?.state, "damaged", JSON.stringify(bad[index]));
  });
});
