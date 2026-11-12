/**
 * U-29 (R-44 R44-L1, contract c6f0792): stateUncheckedSince tells whether the plan run, or a run or
 * apply run whose id sorts after it, recorded a limited state check (`state_checked` with
 * `limited: true`) or has a journal that cannot be read (fail closed). Runs before the plan run do
 * not count. Reads only. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import type { JournalEvent, StateUncheckedSince } from "../../../src/contracts/index.js";
import { createJournal, stateUncheckedSince } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const BEFORE = "20260101T020000Z-0000000b"; // a run before the plan run
const PLAN = "20260101T030000Z-0000000c";
const LATER = "20260101T040000Z-0000000d"; // a model run after it
const APPLY = "20260101T050000Z-0000000e"; // an apply run after it
const at = (runId: string): number => Date.UTC(2026, 0, 1, Number(runId.slice(9, 11)), 0, 1);
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "organize", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const APPLY_STARTED = { type: "apply_started", schemaVersion: 1, planRunId: PLAN, taskId: "t", digest: "a".repeat(64), approval: "cli-flag", actions: 1, maxDurationMs: 60_000 } as unknown as JournalEvent;
const checked = (limited: boolean, phase = "run_end"): JournalEvent => ({ type: "state_checked", phase, changed: [], limited }) as unknown as JournalEvent;
const state = (root: string, ...parts: string[]) => join(root, ".codaryn", ...parts);
const ask: StateUncheckedSince = stateUncheckedSince;

/** Four runs, each with complete state checks; `limitedIn` names the run whose last check was limited. */
async function workspace(limitedIn: string | null = null): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u29-")));
  roots.push(root);
  for (const runId of [BEFORE, PLAN, LATER, APPLY]) {
    const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(runId) } });
    await journal.append(runId === APPLY ? APPLY_STARTED : STARTED);
    await journal.append(checked(false, "run_start"));
    await journal.append(checked(runId === limitedIn));
    await journal.close();
  }
  return root;
}

describe("U-29: whether a run since the plan run could not check the state directory", () => {
  test("every check complete: false", async () => {
    assert.equal(await ask({ workspaceRoot: await workspace(), planRunId: PLAN }), false);
  });

  test("a limited check in the plan run, a later run or a later apply run: true", async () => {
    for (const runId of [PLAN, LATER, APPLY]) assert.equal(await ask({ workspaceRoot: await workspace(runId), planRunId: PLAN }), true, runId);
  });

  test("a limited check in a run before the plan run does not count", async () => {
    assert.equal(await ask({ workspaceRoot: await workspace(BEFORE), planRunId: PLAN }), false);
  });

  test("a later journal that cannot be read counts (fail closed); one before the plan run does not", async () => {
    const cases: [string, (root: string) => Promise<void>][] = [
      ["a line that is not JSON", (root) => writeFile(state(root, "runs", LATER, "journal.jsonl"), "not a record\n", "utf8")],
      ["a line that is not an object", async (root) => writeFile(state(root, "runs", LATER, "journal.jsonl"), `${await readFile(state(root, "runs", LATER, "journal.jsonl"), "utf8")}7\n`, "utf8")],
      ["a last line cut off", async (root) => writeFile(state(root, "runs", LATER, "journal.jsonl"), `${await readFile(state(root, "runs", LATER, "journal.jsonl"), "utf8")}{"type":"state_ch`, "utf8")],
      ["no journal", (root) => rm(state(root, "runs", LATER, "journal.jsonl"))],
      ["a directory in its place", async (root) => { await rm(state(root, "runs", LATER, "journal.jsonl")); await mkdir(state(root, "runs", LATER, "journal.jsonl")); }],
      ["a run entry that is a file", async (root) => writeFile(state(root, "runs", "20260101T060000Z-0000000f"), "x", "utf8")],
      ["the plan run's own journal", (root) => writeFile(state(root, "runs", PLAN, "journal.jsonl"), "{", "utf8")],
    ];
    for (const [name, make] of cases) {
      const root = await workspace();
      await make(root);
      assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), true, name);
    }
    const root = await workspace();
    await writeFile(state(root, "runs", BEFORE, "journal.jsonl"), "not a record\n", "utf8");
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), false, "a damaged run before the plan run");
  });

  test("names in the runs folder that are not run ids (toRunId) are not runs; any run id that sorts after counts", async () => {
    const root = await workspace();
    await mkdir(state(root, "runs", ".notes"));
    await writeFile(state(root, "runs", "x..y"), "x", "utf8");
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), false);
    // As listRuns has it, a folder named like a run id is a run (a damaged one here) and sorts by its name.
    await mkdir(state(root, "runs", "notes"));
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), true);
  });

  test("the plan run missing, or no runs folder: true (fail closed)", async () => {
    const root = await workspace();
    await rm(state(root, "runs", PLAN), { recursive: true });
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), true);
    await rm(state(root, "runs"), { recursive: true });
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), true);
  });

  test("a check that only names changes, without limited, is not 'unchecked'; other records with limited do not count", async () => {
    const root = await workspace();
    const file = state(root, "runs", LATER, "journal.jsonl");
    await writeFile(file, `${await readFile(file, "utf8")}${JSON.stringify({ type: "state_checked", phase: "after_command", changed: ["x"], limited: false })}\n${JSON.stringify({ type: "integrity_checked", phase: "run_end", changed: [], limited: true })}\n`, "utf8");
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), false);
  });

  test("it reads only: nothing in the state directory changes", async () => {
    const root = await workspace(LATER);
    const before = await Promise.all((await readdir(state(root, "runs"), { recursive: true })).sort().map(async (name) => [name, (await stat(state(root, "runs", name))).mtimeMs]));
    await ask({ workspaceRoot: root, planRunId: PLAN });
    const now = await Promise.all((await readdir(state(root, "runs"), { recursive: true })).sort().map(async (name) => [name, (await stat(state(root, "runs", name))).mtimeMs]));
    assert.deepEqual(now, before);
  });

  test("a plan run id that is not a run id is refused (the apply counts a refusal as unchecked)", async () => {
    await assert.rejects(ask({ workspaceRoot: await workspace(), planRunId: "../x" }));
  });
});
