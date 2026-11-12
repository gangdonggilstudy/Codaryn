/**
 * U-29 (R-44 R44-L1, contract c6f0792): stateUncheckedSince tells whether the plan run, or a run or
 * apply run whose id sorts after it, recorded a limited state check (`state_checked` with
 * `limited: true`) or has a journal that cannot be read (fail closed). Runs before the plan run do
 * not count. Reads only. Fake values only.
 * U-33 (R-56 R56-L1, PM Q-2): "since" is by the second a run id names; every run of the plan run's
 * second counts, whatever its random part (fail closed), and so does a run id that names no second.
 * U-33 (R-56 R56-L4, PM Q-3, contract 1362e4b): a run since the plan whose journal has no
 * `run_finished` (it ended before its last check) counts too; the apply that asks (applyRunId) is
 * left out, its journal still being written. Here every run but the asking apply has finished.
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
const ASKING = "20260101T070000Z-00000011"; // the apply that asks: no run_finished yet
const at = (runId: string): number => Date.UTC(2026, 0, 1, Number(runId.slice(9, 11)), 0, 1);
const STARTED = { type: "run_started", schemaVersion: 1, taskId: "t", workflow: "organize", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } } as unknown as JournalEvent;
const APPLY_STARTED = { type: "apply_started", schemaVersion: 1, planRunId: PLAN, taskId: "t", digest: "a".repeat(64), approval: "cli-flag", actions: 1, maxDurationMs: 60_000 } as unknown as JournalEvent;
const checked = (limited: boolean, phase = "run_end"): JournalEvent => ({ type: "state_checked", phase, changed: [], limited }) as unknown as JournalEvent;
const FINISHED = { type: "run_finished", status: "done", reason: "verified", usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 5, repairAttempts: 0 } } as unknown as JournalEvent;
const state = (root: string, ...parts: string[]) => join(root, ".codaryn", ...parts);
const since: StateUncheckedSince = stateUncheckedSince;
/** The store's question as the apply ASKING asks it, unless the case names another applyRunId. */
const ask = (request: { readonly workspaceRoot: string; readonly planRunId: string; readonly applyRunId?: string }): Promise<boolean> =>
  since({ applyRunId: ASKING, ...request });

/**
 * Four finished runs, each with complete state checks (`limitedIn` names the run whose last check
 * was limited), and the asking apply, its journal as it is when it asks: started, no run_finished.
 */
async function workspace(limitedIn: string | null = null): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u29-")));
  roots.push(root);
  for (const runId of [BEFORE, PLAN, LATER, APPLY]) {
    const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(runId) } });
    await journal.append(runId === APPLY ? APPLY_STARTED : STARTED);
    await journal.append(checked(false, "run_start"));
    await journal.append(checked(runId === limitedIn));
    await journal.append(FINISHED);
    await journal.close();
  }
  const asking = createJournal({ workspaceRoot: root, runId: ASKING, clock: { now: () => at(ASKING) } });
  await asking.append(APPLY_STARTED);
  await asking.append(checked(false, "run_start"));
  await asking.close();
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

  test("names in the runs folder that are not run ids (toRunId) are not runs; any run id that names no second counts", async () => {
    const root = await workspace();
    await mkdir(state(root, "runs", ".notes"));
    await writeFile(state(root, "runs", "x..y"), "x", "utf8");
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), false);
    // As listRuns has it, a folder named like a run id is a run (a damaged one here) and sorts by its name.
    await mkdir(state(root, "runs", "notes"));
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), true);
    // U-33: one that sorts before the plan run counts too: when it started cannot be told (fail closed).
    const before = await workspace();
    await mkdir(state(before, "runs", "0notes"));
    assert.equal(await ask({ workspaceRoot: before, planRunId: PLAN }), true);
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

describe("U-33 (R-56 R56-L1, PM Q-2): every run of the plan run's second counts, whatever its random part", () => {
  /** A run with complete checks, or a limited last one, started in `second` of 2026-01-01T03:00. */
  async function addRun(root: string, runId: string, limited: boolean): Promise<void> {
    const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(PLAN) } });
    await journal.append(STARTED);
    await journal.append(checked(false, "run_start"));
    await journal.append(checked(limited));
    await journal.append(FINISHED);
    await journal.close();
  }

  test("a limited run of the same second whose id sorts before the plan run's: true", async () => {
    const root = await workspace();
    await addRun(root, "20260101T030000Z-00000000", true);
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), true);
  });

  test("a limited run of the same second whose id sorts after it: true, as before", async () => {
    const root = await workspace();
    await addRun(root, "20260101T030000Z-ffffffff", true);
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), true);
  });

  test("a limited run of the second before: false, as before; a damaged one of that second: false", async () => {
    const root = await workspace();
    await addRun(root, "20260101T025959Z-ffffffff", true);
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), false);
    await mkdir(state(root, "runs", "20260101T025959Z-fffffffe"));
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), false);
  });

  test("a damaged run of the same second (no journal), whatever its random part: true", async () => {
    for (const runId of ["20260101T030000Z-00000000", "20260101T030000Z-ffffffff"]) {
      const root = await workspace();
      await mkdir(state(root, "runs", runId));
      assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), true, runId);
    }
  });

  test("a plan run id that names no second: every run counts (fail closed)", async () => {
    const root = await workspace(BEFORE);
    const plan = "plan-of-hand";
    const journal = createJournal({ workspaceRoot: root, runId: plan, clock: { now: () => at(PLAN) } });
    await journal.append(STARTED);
    await journal.append(checked(false));
    await journal.append(FINISHED);
    await journal.close();
    assert.equal(await ask({ workspaceRoot: root, planRunId: plan }), true);
    assert.equal(await ask({ workspaceRoot: await workspace(BEFORE), planRunId: PLAN }), false, "with a run id that names one, the run before does not count");
  });
});

describe("U-33 (R-56 R56-L4, PM Q-3): a run since the plan without run_finished counts; the asking apply does not", () => {
  /** Leaves out the run_finished line of runId's journal, as a run killed before its end leaves it. */
  async function unfinish(root: string, runId: string): Promise<void> {
    const file = state(root, "runs", runId, "journal.jsonl");
    const lines = (await readFile(file, "utf8")).split(String.fromCharCode(10)).filter((line) => line !== "" && (JSON.parse(line) as { type: string }).type !== "run_finished");
    await writeFile(file, `${lines.join(String.fromCharCode(10))}${String.fromCharCode(10)}`, "utf8");
  }

  test("the plan run, a later run or a later apply run without run_finished: true", async () => {
    for (const runId of [PLAN, LATER, APPLY]) {
      const root = await workspace();
      await unfinish(root, runId);
      assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), true, runId);
    }
  });

  test("a run before the plan run without run_finished does not count", async () => {
    const root = await workspace();
    await unfinish(root, BEFORE);
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), false);
  });

  test("a run of the plan run's second without run_finished, whatever its random part: true", async () => {
    for (const runId of ["20260101T030000Z-00000000", "20260101T030000Z-ffffffff"]) {
      const root = await workspace();
      const journal = createJournal({ workspaceRoot: root, runId, clock: { now: () => at(PLAN) } });
      await journal.append(STARTED);
      await journal.append(checked(false, "run_start"));
      await journal.close();
      assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), true, runId);
    }
  });

  test("the asking apply is left out: as it is when it asks, with a limited check, a journal that cannot be read or none", async () => {
    const root = await workspace();
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), false, "as it is");
    const file = state(root, "runs", ASKING, "journal.jsonl");
    await writeFile(file, `${await readFile(file, "utf8")}${JSON.stringify({ type: "state_checked", phase: "before_verify", changed: [], limited: true })}${String.fromCharCode(10)}`, "utf8");
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), false, "a limited check");
    await writeFile(file, "{", "utf8");
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), false, "cannot be read");
    await rm(state(root, "runs", ASKING), { recursive: true });
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), false, "not there");
  });

  test("only the asking apply's own id is left out: another apply asking, or an id that names no run, leaves ASKING in (fail closed)", async () => {
    const root = await workspace();
    for (const applyRunId of [APPLY, "20260101T070000Z-00000012", "../x"]) {
      assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN, applyRunId }), true, applyRunId);
    }
  });

  test("an applyRunId that is the plan run's id leaves the plan run in (fail closed)", async () => {
    const limited = await workspace(PLAN);
    assert.equal(await ask({ workspaceRoot: limited, planRunId: PLAN, applyRunId: PLAN }), true, "a limited check");
    const root = await workspace();
    await unfinish(root, PLAN);
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN, applyRunId: PLAN }), true, "no run_finished");
  });

  test("a record that only has run_finished elsewhere (another type, a field) is not a run_finished", async () => {
    const root = await workspace();
    const file = state(root, "runs", LATER, "journal.jsonl");
    await unfinish(root, LATER);
    await writeFile(file, `${await readFile(file, "utf8")}${JSON.stringify({ type: "notice", text: "run_finished", run_finished: true })}${String.fromCharCode(10)}`, "utf8");
    assert.equal(await ask({ workspaceRoot: root, planRunId: PLAN }), true);
  });
});
