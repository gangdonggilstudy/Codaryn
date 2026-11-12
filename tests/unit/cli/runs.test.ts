/**
 * N-7: revert dry run, the run list, the revert record, `codaryn runs` and `--run latest`.
 * Runs are made by the real CLI with the scripted model, or written by hand where a test needs
 * exact records. Fake values only, no network.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import type { EngineResult, HumanOutput, RunListEntry, RunsOutput } from "../../../src/contracts/index.js";
import { LATEST_RUN_ALIAS, RUNS_DEFAULT_LIMIT, RUNS_MAX_LIMIT } from "../../../src/contracts/index.js";
import { runCli } from "../../../src/cli/run.js";
import { parseRunsArgs, resolveRunRef, runRuns } from "../../../src/cli/runs.js";
import {
  RevertRunError,
  RunListError,
  latestRunId,
  listRuns,
  readRevertRecord,
  revertRun,
  writeRevertRecord,
} from "../../../src/store/index.js";
import { cliIo, exists, setupRun, tempDir } from "./k-support.js";

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const README = "# Title\n";
/** Key-shaped for hideKeys, built so the secret scan does not see a key in this file. */
const KEY_SHAPED = ["sk", "ant", "FAKEfake0000FAKEfake0000"].join("-");

/** A real run that changes README.md and creates notes.txt. */
async function changingRun(): Promise<{ base: string; work: string; result: EngineResult }> {
  const base = await setupRun({ "README.md": README }, {}, [
    {
      toolCalls: [
        {
          name: "write_file",
          args: { path: "README.md", expectedHash: sha(README), change: { kind: "replace_text", oldText: "# Title\n", newText: "# Title\n\n## Added\n" } },
        },
      ],
    },
    { toolCalls: [{ name: "write_file", args: { path: "notes.txt", expectedHash: null, change: { kind: "replace_all", content: "x\n" } } }] },
    { text: "done" },
  ]);
  const outcome = await runCli(cliIo(base));
  assert.equal(outcome.output.kind, "run");
  return { base, work: await realWork(base), result: outcome.output as EngineResult };
}

async function realWork(base: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(path.join(base, "work"));
}

/** Every file under `dir` with its content and modification time, for "nothing changed" checks. */
async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const key = path.relative(dir, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        out[`${key}/`] = "dir";
        await walk(full);
      } else {
        out[key] = `${sha(await readFile(full, "utf8"))} ${(await stat(full)).mtimeMs}`;
      }
    }
  };
  await walk(dir);
  return out;
}

const runsDir = (work: string): string => path.join(work, ".codaryn", "runs");

type Checked = Extract<RunListEntry, { state: "checked" }>;

function checked(entry: RunListEntry | undefined): Checked {
  assert.ok(entry !== undefined && entry.state === "checked", "a checked run");
  return entry;
}

/** Hand-written records of one run: the journal's first line and, unless `result` is null, result.json. */
async function writeRun(
  work: string,
  runId: string,
  options: {
    at?: string;
    firstLine?: string;
    result?: Partial<EngineResult> | null;
    resultText?: string;
  } = {},
): Promise<void> {
  const dir = path.join(runsDir(work), runId);
  await mkdir(dir, { recursive: true });
  const first =
    options.firstLine ??
    `${JSON.stringify({
      seq: 1,
      at: options.at ?? "2026-01-02T03:04:05.000Z",
      runId,
      type: "run_started",
      schemaVersion: 1,
      taskId: "hand-task",
      workflow: "test",
      provider: "scripted",
      limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: null, maxDurationMs: 1000 },
    })}\n`;
  await writeFile(path.join(dir, "journal.jsonl"), first, "utf8");
  if (options.resultText !== undefined) {
    await writeFile(path.join(dir, "result.json"), options.resultText, "utf8");
  } else if (options.result !== null) {
    const result = {
      schemaVersion: 1,
      kind: "run",
      runId,
      taskId: "hand-task",
      status: "done",
      reason: "verified",
      exitCode: 0,
      provider: "scripted",
      verifiers: [],
      changes: [],
      usage: { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 5 },
      journalPath: `.codaryn/runs/${runId}/journal.jsonl`,
      notices: [],
      ...(options.result ?? {}),
    };
    await writeFile(path.join(dir, "result.json"), `${JSON.stringify(result)}\n`, "utf8");
  }
}

describe("revertRun dryRun (N-7)", () => {
  test("decides every file as the revert does and changes nothing, before and after the revert", async () => {
    const { work, result } = await changingRun();
    const before = await tree(work);

    const preview = await revertRun({ workspaceRoot: work, runId: result.runId, dryRun: true });
    assert.deepEqual(preview, {
      reverted: [
        { path: "README.md", action: "restored" },
        { path: "notes.txt", action: "deleted" },
      ],
      skipped: [],
    });
    assert.deepEqual(await tree(work), before, "a dry run writes, deletes and creates nothing");

    const real = await revertRun({ workspaceRoot: work, runId: result.runId });
    assert.deepEqual(real, preview, "the real revert does what the dry run said");
    assert.equal(await readFile(path.join(work, "README.md"), "utf8"), README);
    assert.equal(await exists(path.join(work, "notes.txt")), false);

    const after = await tree(work);
    const again = await revertRun({ workspaceRoot: work, runId: result.runId, dryRun: true });
    assert.deepEqual(again.reverted, []);
    assert.deepEqual(
      again.skipped.map((file) => file.reason),
      ["changed_since_run", "changed_since_run"],
    );
    assert.deepEqual(await tree(work), after);
  });

  test("a file changed after the run is skipped by the dry run exactly as by the revert", async () => {
    const { work, result } = await changingRun();
    await writeFile(path.join(work, "README.md"), "# Title\nedited by the user\n", "utf8");
    const preview = await revertRun({ workspaceRoot: work, runId: result.runId, dryRun: true });
    assert.deepEqual(preview.skipped, [{ path: "README.md", reason: "changed_since_run" }]);
    assert.deepEqual(preview.reverted, [{ path: "notes.txt", action: "deleted" }]);
    assert.equal(await readFile(path.join(work, "README.md"), "utf8"), "# Title\nedited by the user\n");
    assert.equal(await exists(path.join(work, "notes.txt")), true, "the dry run deleted nothing");

    assert.deepEqual(await revertRun({ workspaceRoot: work, runId: result.runId }), preview);
  });

  test("a run without a journal rejects as run_not_found and creates no state directory", async () => {
    const work = await tempDir();
    await assert.rejects(
      revertRun({ workspaceRoot: work, runId: "20260102T030405Z-0a1b2c3d", dryRun: true }),
      (error: unknown) => error instanceof RevertRunError && error.code === "run_not_found",
    );
    assert.equal(await exists(path.join(work, ".codaryn")), false);
  });
});

describe("listRuns (N-7, N-16)", () => {
  test("a workspace without records has no runs, and nothing is created", async () => {
    const work = await tempDir();
    assert.deepEqual(await listRuns({ workspaceRoot: work }), { runs: [] });
    assert.equal(await latestRunId(work), null);
    assert.equal(await exists(path.join(work, ".codaryn")), false);
  });

  test("real runs are listed newest first with their task, status, changes and revert record", async () => {
    const { base, work, result: first } = await changingRun();
    const second = await runCli(cliIo(base));
    assert.equal(second.output.kind, "run");
    const secondId = (second.output as EngineResult).runId;

    const listing = await listRuns({ workspaceRoot: work });
    assert.deepEqual(
      listing.runs.map((run) => [run.state, run.runId]),
      [
        ["checked", secondId],
        ["checked", first.runId],
      ],
    );
    const older = checked(listing.runs[1]);
    assert.equal(older.taskId, "k1-task");
    assert.equal(older.status, "done");
    assert.equal(older.reason, "verified");
    assert.equal(older.changes, 2);
    assert.equal(older.reverted, null);
    assert.match(older.startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(await latestRunId(work), secondId);

    await writeRevertRecord(work, {
      schemaVersion: 1,
      kind: "revert_record",
      runId: first.runId,
      at: "2026-11-12T05:06:07.000Z",
      status: "complete",
      reverted: 2,
      skipped: 0,
    });
    const marked = await listRuns({ workspaceRoot: work });
    assert.deepEqual(checked(marked.runs[1]).reverted, { at: "2026-11-12T05:06:07.000Z", status: "complete" });
  });

  test("runs of the same second keep the order of their start time, milliseconds or not", async () => {
    const work = await tempDir();
    await writeRun(work, "20260102T030405Z-aaaaaaaa", { at: "2026-01-02T03:04:05.900Z" });
    await writeRun(work, "20260102T030405Z-bbbbbbbb", { at: "2026-01-02T03:04:05.100Z" });
    await writeRun(work, "20260102T030405Z-cccccccc", { at: "2026-01-02T03:04:05Z" });
    const listing = await listRuns({ workspaceRoot: work });
    assert.deepEqual(
      listing.runs.map((run) => [run.runId, checked(run).startedAt]),
      [
        ["20260102T030405Z-aaaaaaaa", "2026-01-02T03:04:05.900Z"],
        ["20260102T030405Z-bbbbbbbb", "2026-01-02T03:04:05.100Z"],
        ["20260102T030405Z-cccccccc", "2026-01-02T03:04:05Z"],
      ],
    );
    assert.deepEqual(checked(listing.runs[0]), {
      state: "checked",
      runId: "20260102T030405Z-aaaaaaaa",
      startedAt: "2026-01-02T03:04:05.900Z",
      taskId: "hand-task",
      status: "done",
      reason: "verified",
      changes: 0,
      reverted: null,
    });
  });

  test("a run without result.json is checked with null status; one still writing its first record is damaged", async () => {
    const work = await tempDir();
    await writeRun(work, "20260102T030405Z-aaaaaaaa", { result: null });
    await writeRun(work, "20260102T030406Z-bbbbbbbb", { firstLine: '{"seq":1,"at":"2026-01-02T03:04', result: null });
    const listing = await listRuns({ workspaceRoot: work });
    assert.deepEqual(listing.runs, [
      {
        state: "checked",
        runId: "20260102T030405Z-aaaaaaaa",
        startedAt: "2026-01-02T03:04:05.000Z",
        taskId: "hand-task",
        status: null,
        reason: null,
        changes: null,
        reverted: null,
      },
      { state: "damaged", runId: "20260102T030406Z-bbbbbbbb" },
    ]);
    assert.equal(await latestRunId(work), null, "N-23(b): a run without result.json is never latest");
  });

  test("N-23(b): a forged run dated in the future is damaged, so latest keeps the real run and revert --run latest cannot delete user files", async () => {
    const { work, result } = await changingRun();
    const notes = path.join(work, "notes.txt");
    const notesText = await readFile(notes, "utf8");
    // The reviewer's forgery: a run "from 2099" that claims to have created notes.txt as it is now.
    const forged = "20991231T235959Z-deadbeef";
    const dir = path.join(runsDir(work), forged);
    await mkdir(path.join(dir, "snapshots"), { recursive: true });
    const records = [
      { seq: 1, at: "2099-12-31T23:59:59.000Z", runId: forged, type: "run_started", schemaVersion: 1, taskId: "forged", workflow: "x", provider: "scripted", limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1 } },
      { seq: 2, at: "2099-12-31T23:59:59.100Z", runId: forged, type: "file_changed", callId: "c", path: "notes.txt", previousHash: null, newHash: sha(notesText), created: true },
    ];
    await writeFile(path.join(dir, "journal.jsonl"), records.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf8");
    await writeFile(path.join(dir, "snapshots", "index.json"), JSON.stringify({ schemaVersion: 1, entries: [{ path: "notes.txt", existed: false }] }), "utf8");

    const listing = await listRuns({ workspaceRoot: work });
    assert.deepEqual(listing.runs.find((run) => run.runId === forged), { state: "damaged", runId: forged });
    assert.equal(await latestRunId(work), result.runId);
    assert.deepEqual(await resolveRunRef(work, LATEST_RUN_ALIAS), { ok: true, value: result.runId });

    // Also with a result.json, so only the time gives the forgery away.
    await writeRun(work, forged, { at: "2099-12-31T23:59:59.000Z" });
    assert.equal(await latestRunId(work), result.runId);
    assert.equal(await readFile(notes, "utf8"), notesText, "nothing was reverted or deleted");
  });

  test("N-23(b): the run id's time and the first record's time must be the same second; other id forms are damaged", async () => {
    const work = await tempDir();
    await writeRun(work, "20260102T030405Z-aaaaaaaa", { at: "2026-01-02T03:04:05.999Z" });
    await writeRun(work, "20260102T030405Z-bbbbbbbb", { at: "2026-01-02T03:04:06.000Z" });
    await writeRun(work, "20260102T030405Z-cccccccc", { at: "2026-01-02T03:04:04.999Z" });
    await writeRun(work, "hand-made-run", { at: "2026-01-02T03:04:05.000Z" });
    await writeRun(work, "20261340T030405Z-dddddddd", { at: "2026-01-02T03:04:05.000Z" });
    const listing = await listRuns({ workspaceRoot: work });
    assert.deepEqual(
      listing.runs.map((run) => [run.runId, run.state]),
      [
        ["20260102T030405Z-aaaaaaaa", "checked"],
        ["hand-made-run", "damaged"],
        ["20261340T030405Z-dddddddd", "damaged"],
        ["20260102T030405Z-cccccccc", "damaged"],
        ["20260102T030405Z-bbbbbbbb", "damaged"],
      ],
    );
  });

  test("N-23(b): latest is the newest run that has a result; a newer run without one is listed but skipped", async () => {
    const work = await tempDir();
    await writeRun(work, "20260102T030401Z-00000001", { at: "2026-01-02T03:04:01.000Z" });
    await writeRun(work, "20260102T030402Z-00000002", { at: "2026-01-02T03:04:02.000Z", result: null });
    const listing = await listRuns({ workspaceRoot: work });
    assert.deepEqual(
      listing.runs.map((run) => [run.runId, run.state]),
      [
        ["20260102T030402Z-00000002", "checked"],
        ["20260102T030401Z-00000001", "checked"],
      ],
    );
    assert.equal(await latestRunId(work), "20260102T030401Z-00000001");
    assert.deepEqual(await resolveRunRef(work, LATEST_RUN_ALIAS), { ok: true, value: "20260102T030401Z-00000001" });
  });

  test("N-23(g): a damaged revert record alone leaves the run checked, without a revert mark; reading the record rejects", async () => {
    const work = await tempDir();
    await writeRun(work, "20260102T030401Z-00000001", { at: "2026-01-02T03:04:01.000Z" });
    await writeRun(work, "20260102T030402Z-00000002", { at: "2026-01-02T03:04:02.000Z" });
    await writeFile(path.join(runsDir(work), "20260102T030402Z-00000002", "revert.json"), "{not json", "utf8");
    const listing = await listRuns({ workspaceRoot: work });
    assert.deepEqual(
      listing.runs.map((run) => [run.runId, run.state]),
      [
        ["20260102T030402Z-00000002", "checked"],
        ["20260102T030401Z-00000001", "checked"],
      ],
    );
    assert.equal(checked(listing.runs[0]).reverted, null);
    assert.equal(checked(listing.runs[0]).status, "done");
    assert.equal(await latestRunId(work), "20260102T030402Z-00000002");
    // N-22 contract: read rejects, and revert goes on without revertedBefore (N-A's revert).
    await assert.rejects(readRevertRecord(work, "20260102T030402Z-00000002"), RunListError);
  });

  test("records that fail a check are listed as damaged with their id only and never chosen as latest", async () => {
    const work = await tempDir();
    const at = (second: number): string => `2026-01-02T03:04:${String(second).padStart(2, "0")}.000Z`;
    await writeRun(work, "20260102T030400Z-00000000", { at: at(0) });
    // Each of these is newer than the good run and damaged in one way.
    await writeRun(work, "20260102T030401Z-00000001", { at: at(1), result: { runId: "20260102T030400Z-00000000" } });
    await writeRun(work, "20260102T030402Z-00000002", { at: at(2), result: { status: "done", reason: "model_error" } as never });
    await writeRun(work, "20260102T030403Z-00000003", { at: at(3), result: { exitCode: 1 } });
    await writeRun(work, "20260102T030404Z-00000004", { at: at(4), resultText: "{not json" });
    await writeRun(work, "20260102T030405Z-00000005", {
      firstLine: `${JSON.stringify({ seq: 1, at: at(5), runId: "20260102T030400Z-00000000", type: "run_started", schemaVersion: 1, taskId: "t", provider: "scripted" })}\n`,
    });
    await writeRun(work, "20260102T030406Z-00000006", {
      firstLine: `${JSON.stringify({ seq: 1, at: "yesterday", runId: "20260102T030406Z-00000006", type: "run_started", schemaVersion: 1, taskId: "t", provider: "scripted" })}\n`,
    });
    await writeRun(work, "20260102T030407Z-00000007", { at: at(7), result: { changes: [{ path: "a", created: true, newHash: "zz", previousHash: null }] } as never });
    await writeRun(work, "20260102T030408Z-00000008", { at: at(8), resultText: '{"schemaVersion":1,"kind":"run"}' });
    await mkdir(path.join(runsDir(work), "20260102T030409Z-00000009"));
    await writeFile(path.join(runsDir(work), "20260102T030410Z-0000000a"), "a file, not a run directory", "utf8");
    // Not run ids: ignored, not counted.
    await mkdir(path.join(runsDir(work), "not a run"));
    await writeFile(path.join(runsDir(work), ".gitkeep"), "", "utf8");

    const listing = await listRuns({ workspaceRoot: work });
    assert.deepEqual(listing.runs[0], checked(listing.runs[0]));
    assert.equal(listing.runs[0]?.runId, "20260102T030400Z-00000000");
    const damaged = listing.runs.slice(1);
    assert.deepEqual(
      damaged.map((run) => run.state),
      new Array(10).fill("damaged"),
    );
    assert.deepEqual(
      damaged.map((run) => run.runId),
      [...damaged.map((run) => run.runId)].sort().reverse(),
      "damaged runs come after the checked ones, by run id descending",
    );
    for (const run of damaged) assert.deepEqual(Object.keys(run).sort(), ["runId", "state"], "a damaged run carries its id only");
    assert.equal(await latestRunId(work), "20260102T030400Z-00000000");
  });

  test("a run directory that is a link is damaged; a linked runs directory is refused", async () => {
    const work = await tempDir();
    const elsewhere = await tempDir();
    await writeRun(elsewhere, "20260102T030405Z-0a1b2c3d");
    await mkdir(runsDir(work), { recursive: true });
    await symlink(path.join(runsDir(elsewhere), "20260102T030405Z-0a1b2c3d"), path.join(runsDir(work), "20260102T030405Z-0a1b2c3d"), "junction");
    assert.deepEqual(await listRuns({ workspaceRoot: work }), { runs: [{ state: "damaged", runId: "20260102T030405Z-0a1b2c3d" }] });

    const other = await tempDir();
    await mkdir(path.join(other, ".codaryn"));
    await symlink(runsDir(elsewhere), runsDir(other), "junction");
    await assert.rejects(listRuns({ workspaceRoot: other }), RunListError);
  });
});

describe("revert record (N-7)", () => {
  test("is written atomically, read back, and replaced by a later one", async () => {
    const { work, result } = await changingRun();
    assert.equal(await readRevertRecord(work, result.runId), null);
    const record = { schemaVersion: 1, kind: "revert_record", runId: result.runId, at: "2026-11-12T05:06:07.000Z", status: "partial", reverted: 1, skipped: 1 } as const;
    await writeRevertRecord(work, record);
    assert.deepEqual(await readRevertRecord(work, result.runId), record);
    await writeRevertRecord(work, { ...record, status: "complete", reverted: 2, skipped: 0 });
    assert.equal((await readRevertRecord(work, result.runId))?.status, "complete");
    const names = await readdir(path.join(runsDir(work), result.runId));
    assert.equal(names.filter((name) => name.endsWith(".tmp")).length, 0, "no temporary file is left");
  });

  test("a run directory that is a link is never written through", async () => {
    const work = await tempDir();
    const elsewhere = await tempDir();
    const runId = "20260102T030405Z-0a1b2c3d";
    await writeRun(elsewhere, runId);
    await mkdir(runsDir(work), { recursive: true });
    await symlink(path.join(runsDir(elsewhere), runId), path.join(runsDir(work), runId), "junction");
    const record = { schemaVersion: 1, kind: "revert_record", runId, at: "2026-11-12T05:06:07.000Z", status: "complete", reverted: 0, skipped: 0 } as const;
    await assert.rejects(writeRevertRecord(work, record), RunListError);
    assert.equal(await exists(path.join(runsDir(elsewhere), runId, "revert.json")), false, "nothing is written where the link leads");
    await assert.rejects(readRevertRecord(work, runId), RunListError);
  });

  test("an invalid record is not written, and a broken one is not read", async () => {
    const { work, result } = await changingRun();
    await assert.rejects(
      writeRevertRecord(work, { schemaVersion: 1, kind: "revert_record", runId: result.runId, at: "now", status: "complete", reverted: 0, skipped: 0 }),
      TypeError,
    );
    assert.equal(await exists(path.join(runsDir(work), result.runId, "revert.json")), false);
    await writeFile(path.join(runsDir(work), result.runId, "revert.json"), "{", "utf8");
    await assert.rejects(readRevertRecord(work, result.runId), RunListError);
  });
});

/** A HumanOutput whose runsText shows the object it got; other methods are not used here. */
function stubHuman(seen: RunsOutput[]): HumanOutput {
  const unused = (): never => {
    throw new Error("not used by runs");
  };
  return {
    error: unused,
    runSummary: unused,
    progressLine: unused,
    revertSummary: unused,
    runsText(output) {
      seen.push(output);
      return `runs ${output.runs.length} ${KEY_SHAPED}\n`;
    },
  };
}

describe("codaryn runs (N-7)", () => {
  test("parses its options with defaults and bounds", () => {
    assert.deepEqual(parseRunsArgs(["runs"]), { ok: true, args: { command: "runs", workspace: null, limit: RUNS_DEFAULT_LIMIT, json: false } });
    assert.deepEqual(parseRunsArgs(["runs", "--json", "--limit", "5", "--workspace", "w"]), {
      ok: true,
      args: { command: "runs", workspace: "w", limit: 5, json: true },
    });
    assert.equal(parseRunsArgs(["runs", "--limit", String(RUNS_MAX_LIMIT)]).ok, true);
    for (const bad of [
      ["runs", "--limit", "0"],
      ["runs", "--limit", String(RUNS_MAX_LIMIT + 1)],
      ["runs", "--limit", "1e3"],
      ["runs", "--limit", "-1"],
      ["runs", "--limit"],
      ["runs", "--json", "--json"],
      ["runs", "--workspace", "a", "--workspace", "b"],
      ["runs", "--all"],
      ["runs", "extra"],
    ]) {
      assert.equal(parseRunsArgs(bad).ok, false, bad.join(" "));
    }
  });

  test("--json prints RunsOutput in list order with the omitted count; the workspace defaults to cwd", async () => {
    const work = await tempDir();
    await writeRun(work, "20260102T030401Z-00000001", { at: "2026-01-02T03:04:01.000Z" });
    await writeRun(work, "20260102T030402Z-00000002", { at: "2026-01-02T03:04:02.000Z" });
    await writeRun(work, "20260102T030403Z-00000003", { at: "2026-01-02T03:04:03.000Z", resultText: "[]" });
    const outcome = await runRuns({ argv: ["runs", "--json", "--limit", "1"], cwd: work, env: {}, human: stubHuman([]) });
    assert.ok("output" in outcome);
    const output = outcome.output as RunsOutput;
    assert.equal(outcome.exitCode, 0);
    assert.equal(output.kind, "runs");
    assert.equal(output.status, "listed");
    assert.deepEqual(
      output.runs.map((run) => [run.state, run.runId]),
      [["checked", "20260102T030402Z-00000002"]],
    );
    assert.equal(output.omitted, 2, "one checked and one damaged run are beyond --limit");
  });

  test("the text comes from HumanOutput.runsText with key-shaped text hidden; nothing is created", async () => {
    const work = await tempDir();
    const seen: RunsOutput[] = [];
    const outcome = await runRuns({ argv: ["runs", "--workspace", work], cwd: path.dirname(work), env: {}, human: stubHuman(seen) });
    assert.ok("text" in outcome);
    assert.equal(outcome.text, "runs 0 [key]\n");
    assert.deepEqual(seen[0], { schemaVersion: 1, kind: "runs", status: "listed", exitCode: 0, runs: [], omitted: 0 });
    assert.equal(await exists(path.join(work, ".codaryn")), false);
  });

  test("N-23(a): --json hides key-shaped text and the current key, as report does", async () => {
    const work = await tempDir();
    const currentKey = "fake-current-key-N23a-0123456789";
    await mkdir(path.join(runsDir(work), KEY_SHAPED), { recursive: true });
    await mkdir(path.join(runsDir(work), currentKey));
    const outcome = await runRuns({ argv: ["runs", "--json"], cwd: work, env: { ANTHROPIC_API_KEY: currentKey }, human: stubHuman([]) });
    const printed = JSON.stringify("output" in outcome ? outcome.output : outcome.text);
    assert.equal(printed.includes(KEY_SHAPED), false, "a key-shaped run directory name is hidden");
    assert.equal(printed.includes(currentKey), false, "the current key is hidden");
    assert.ok(printed.includes("[key]"));
  });

  test("a missing workspace, a network path and bad options are CliErrorOutput", async () => {
    const work = await tempDir();
    const run = (argv: string[]) => runRuns({ argv, cwd: work, env: {}, human: stubHuman([]) });
    const codeOf = (outcome: Awaited<ReturnType<typeof run>>): string =>
      "output" in outcome && outcome.output.kind === "error" ? outcome.output.code : "";
    assert.equal(codeOf(await run(["runs", "--workspace", "missing"])), "workspace_not_found");
    assert.equal(codeOf(await run(["runs", "--workspace", "\\\\server\\share"])), "invalid_arguments");
    assert.equal(codeOf(await run(["runs", "--limit", "0"])), "invalid_arguments");
  });
});

describe("--run latest (N-7, N-18)", () => {
  test("names the newest checked run; other values pass through", async () => {
    const work = await tempDir();
    assert.deepEqual(await resolveRunRef(work, "20260102T030405Z-0a1b2c3d"), { ok: true, value: "20260102T030405Z-0a1b2c3d" });
    const none = await resolveRunRef(work, LATEST_RUN_ALIAS);
    assert.equal(!none.ok && none.error.output.kind === "error" ? none.error.output.code : "", "run_not_found");

    await writeRun(work, "20260102T030401Z-00000001", { at: "2026-01-02T03:04:01.000Z" });
    await writeRun(work, "20260102T030402Z-00000002", { at: "2026-01-02T03:04:02.000Z", resultText: "{" });
    assert.deepEqual(await resolveRunRef(work, LATEST_RUN_ALIAS), { ok: true, value: "20260102T030401Z-00000001" });
  });

  test("is refused when a run directory is literally named latest", async () => {
    const work = await tempDir();
    await writeRun(work, "20260102T030401Z-00000001");
    await mkdir(path.join(runsDir(work), "latest"));
    const outcome = await resolveRunRef(work, LATEST_RUN_ALIAS);
    assert.equal(!outcome.ok && outcome.error.output.kind === "error" ? outcome.error.output.code : "", "invalid_arguments");
  });
});
