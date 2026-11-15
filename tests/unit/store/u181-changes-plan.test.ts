/**
 * U-181 (DR-69 B-1, B-3, B-7; contract U-175): the store's share of a `run` plan. The plan recorder's
 * saveChangesPlan writes plan.json of `kind: "changes"` once, under the same digest rule (the SHA-256
 * of its bytes, the summary among them); loadAnyPlan reads either kind, told apart by `kind`, while
 * loadPlan still refuses a `run` plan; a move plan's bytes are as before, to the letter; the run that
 * carries out such a plan claims it with the same applied.json, once (createRunRecorders with
 * planRunId, noted by its state guard). Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { MAX_PLANNED_FILES } from "../../../src/contracts/index.js";
import type { ContentHash, StoredPlanAction, StoredPlannedFile } from "../../../src/contracts/index.js";
import { createPlanRecorder, createRunRecorders, loadAnyPlan, loadPlan, markPlanApplied } from "../../../src/store/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u181-")));
  roots.push(root);
  return root;
}

const PLAN_RUN = "20260102T030405Z-0a1b2c3d";
const CARRY_RUN = "20260102T030500Z-11111111";
const HASH_A = "a".repeat(64) as ContentHash;
const HASH_B = "b".repeat(64) as ContentHash;
const TOKEN = ["[[CODARYN", "_SECRET:", "0123456789abcdef]]"].join(""); // G-10: built from parts
const SUMMARY = ["Rewrite the guide's intro and add a changelog"];
const FILES: StoredPlannedFile[] = [
  { path: "docs/guide.md", change: "modify", sha256: HASH_A, shown: ["docs/guide.md"] },
  { path: "docs/CHANGELOG.md", change: "create", sha256: null, shown: ["docs/CHANGELOG.md"] },
];
const ACTIONS: StoredPlanAction[] = [
  { kind: "move", from: "inbox/report.pdf", to: "docs/2026/report.pdf", sha256: HASH_A },
  { kind: "discard", path: "inbox/tmp.log", sha256: HASH_B, shown: { path: ["inbox/tmp.log"] } },
];

const sha = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const runDir = (root: string, runId = PLAN_RUN): string => join(root, ".codaryn", "runs", runId);
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

/** A plan run's journal and result.json as a run that ended plan_pending leaves them (`kind` with a `run` plan). */
async function planRun(root: string, digest: string, plan: Record<string, unknown> = {}): Promise<void> {
  await mkdir(runDir(root), { recursive: true });
  const started = { seq: 1, at: "2026-01-02T03:04:05.000Z", runId: PLAN_RUN, type: "run_started", schemaVersion: 1, taskId: "docs-task", workflow: "write", provider: "scripted", limits: { maxModelTurns: 2, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 1000 } };
  await writeFile(join(runDir(root), "journal.jsonl"), `${JSON.stringify(started)}\n`, "utf8");
  const result = {
    schemaVersion: 1, kind: "run", runId: PLAN_RUN, taskId: "docs-task", status: "needs-input", reason: "plan_pending", exitCode: 3, provider: "scripted",
    verifiers: [], changes: [], usage: { modelTurns: 2, toolCalls: 3, inputTokens: null, outputTokens: null, durationMs: 9 },
    journalPath: `.codaryn/runs/${PLAN_RUN}/journal.jsonl`, notices: [], plan: { digest, actions: 2, ...plan },
  };
  await writeFile(join(runDir(root), "result.json"), `${JSON.stringify(result)}\n`, "utf8");
}

/** A stored `run` plan with its plan run, as the engine leaves them; resolves with the digest. */
async function storedChangesPlan(root: string): Promise<ContentHash> {
  const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).saveChangesPlan!({ summary: SUMMARY, files: FILES });
  await planRun(root, digest, { kind: "changes" });
  return digest;
}

/** plan.json written by hand with its digest in result.json (`kind` in result.plan when given). */
async function handWrittenPlan(root: string, stored: unknown, resultKind?: string): Promise<void> {
  const text = `${JSON.stringify(stored)}\n`;
  await mkdir(runDir(root), { recursive: true });
  await writeFile(join(runDir(root), "plan.json"), text, "utf8");
  await planRun(root, sha(text), resultKind === undefined ? {} : { kind: resultKind });
}

describe("U-181: a move plan's plan.json is as before, to the letter", () => {
  test("savePlan writes the same bytes and digest as before B-3", async () => {
    const root = await workspace();
    // Keys given out of order: the stored order is the canonical one, as before.
    const scrambled = [{ sha256: HASH_A, to: "docs/2026/report.pdf", from: "inbox/report.pdf", kind: "move" }, ACTIONS[1]] as unknown as StoredPlanAction[];
    const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(scrambled);
    const expected =
      `{"schemaVersion":1,"kind":"plan","runId":"${PLAN_RUN}","actions":[` +
      `{"kind":"move","from":"inbox/report.pdf","to":"docs/2026/report.pdf","sha256":"${HASH_A}"},` +
      `{"kind":"discard","path":"inbox/tmp.log","sha256":"${HASH_B}","shown":{"path":["inbox/tmp.log"]}}]}\n`;
    const bytes = await readFile(join(runDir(root), "plan.json"));
    assert.equal(bytes.toString("utf8"), expected);
    assert.equal(digest, sha(expected));
  });

  test("loadAnyPlan reads a move plan exactly as loadPlan does", async () => {
    const root = await workspace();
    const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(ACTIONS);
    await planRun(root, digest);
    const outcome = await loadPlan({ workspaceRoot: root, runId: PLAN_RUN });
    assert.deepEqual(outcome, { ok: true, plan: { schemaVersion: 1, kind: "plan", runId: PLAN_RUN, actions: ACTIONS }, digest, applied: null });
    assert.deepEqual(await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN }), outcome);
  });
});

describe("U-181 (B-1): saveChangesPlan", () => {
  test("writes plan.json of kind changes with the summary and the files, and returns the SHA-256 of its bytes", async () => {
    const root = await workspace();
    // Keys given out of order: stored in the contract's order (path, change, sha256, shown).
    const scrambled = FILES.map((file) => ({ shown: file.shown, sha256: file.sha256, change: file.change, path: file.path })) as unknown as StoredPlannedFile[];
    const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).saveChangesPlan!({ summary: SUMMARY, files: scrambled });
    const expected =
      `{"schemaVersion":1,"kind":"changes","runId":"${PLAN_RUN}","summary":["Rewrite the guide's intro and add a changelog"],"files":[` +
      `{"path":"docs/guide.md","change":"modify","sha256":"${HASH_A}","shown":["docs/guide.md"]},` +
      `{"path":"docs/CHANGELOG.md","change":"create","sha256":null,"shown":["docs/CHANGELOG.md"]}]}\n`;
    const bytes = await readFile(join(runDir(root), "plan.json"));
    assert.equal(bytes.toString("utf8"), expected);
    assert.equal(digest, sha(expected), "the digest covers the summary too (R-99 L-1)");
    assert.deepEqual((await readdir(runDir(root))).sort(), ["plan.json"], "no temporary file is left");
  });

  test("a summary masked around a secret keeps its visible parts", async () => {
    const root = await workspace();
    const summary = ["Use ", " for the sample"]; // the parts of "Use <token> for the sample"
    await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).saveChangesPlan!({ summary, files: FILES });
    const stored = JSON.parse(await readFile(join(runDir(root), "plan.json"), "utf8")) as { summary: unknown };
    assert.deepEqual(stored.summary, summary);
  });

  test("is written once, whichever kind came first: the file stays as it was and the call rejects", async () => {
    const root = await workspace();
    const recorder = createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN });
    await recorder.saveChangesPlan!({ summary: SUMMARY, files: FILES });
    const before = await readFile(join(runDir(root), "plan.json"));
    await assert.rejects(recorder.saveChangesPlan!({ summary: SUMMARY, files: [FILES[1] as StoredPlannedFile] }));
    await assert.rejects(recorder.savePlan(ACTIONS));
    assert.ok((await readFile(join(runDir(root), "plan.json"))).equals(before));

    const other = await workspace();
    const second = createPlanRecorder({ workspaceRoot: other, runId: PLAN_RUN });
    await second.savePlan(ACTIONS);
    await assert.rejects(second.saveChangesPlan!({ summary: SUMMARY, files: FILES }));
    assert.equal(JSON.parse(await readFile(join(runDir(other), "plan.json"), "utf8")).kind, "plan");
  });

  test("refuses what is not a planned file list or a summary's visible parts; nothing is written", async () => {
    const file = FILES[0] as StoredPlannedFile;
    const many = Array.from({ length: MAX_PLANNED_FILES + 1 }, (_, index) => ({ ...file, path: `docs/f${index}.md`, shown: [`docs/f${index}.md`] }));
    const badFiles: unknown[] = [
      [],
      many,
      [file, { ...file }], // the same path twice
      [{ ...file, change: "create" }], // create with a hash
      [{ ...file, sha256: null }], // modify without one
      [{ ...file, sha256: "A".repeat(64) }],
      [{ ...file, change: "delete" }],
      [{ path: file.path, change: file.change, sha256: file.sha256 }], // no shown
      [{ ...file, extra: true }],
      [{ ...file, path: "../outside.md" }],
      [{ ...file, path: "docs\\guide.md" }],
      [{ ...file, path: "/docs/guide.md" }],
      [{ ...file, path: ".codaryn/runs/x" }],
      [{ ...file, path: "docs/" }],
      [{ ...file, shown: [] }],
      [{ ...file, shown: [`docs/${TOKEN}.md`] }], // a privacy token in a visible part
      "docs/guide.md",
    ];
    const badSummaries: unknown[] = [[], "Rewrite", [1], [`Use ${TOKEN}`], Array.from({ length: 502 }, () => ""), ["x".repeat(2001)]];
    for (const files of badFiles) {
      const root = await workspace();
      await assert.rejects(createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).saveChangesPlan!({ summary: SUMMARY, files: files as StoredPlannedFile[] }), TypeError, JSON.stringify(files).slice(0, 80));
      assert.equal(await exists(join(runDir(root), "plan.json")), false);
    }
    for (const summary of badSummaries) {
      const root = await workspace();
      await assert.rejects(createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).saveChangesPlan!({ summary: summary as string[], files: FILES }), TypeError, JSON.stringify(summary).slice(0, 80));
      assert.equal(await exists(join(runDir(root), "plan.json")), false);
    }
  });

  test("takes MAX_PLANNED_FILES files", async () => {
    const root = await workspace();
    const file = FILES[1] as StoredPlannedFile;
    const most = Array.from({ length: MAX_PLANNED_FILES }, (_, index) => ({ ...file, path: `docs/f${index}.md`, shown: [`docs/f${index}.md`] }));
    const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).saveChangesPlan!({ summary: SUMMARY, files: most });
    await planRun(root, digest, { kind: "changes" });
    const outcome = await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN });
    assert.equal(outcome.ok && outcome.plan.kind === "changes" ? outcome.plan.files.length : null, MAX_PLANNED_FILES);
  });
});

describe("U-181 (B-3): loadAnyPlan and loadPlan with a run plan", () => {
  test("loadAnyPlan reads a run plan with its digest; loadPlan still answers invalid_run_record", async () => {
    const root = await workspace();
    const digest = await storedChangesPlan(root);
    assert.deepEqual(await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN }), {
      ok: true,
      plan: { schemaVersion: 1, kind: "changes", runId: PLAN_RUN, summary: SUMMARY, files: FILES },
      digest,
      applied: null,
    });
    assert.deepEqual(await loadPlan({ workspaceRoot: root, runId: PLAN_RUN }), { ok: false, code: "invalid_run_record" });
  });

  test("applied.json once (B-7): the plan read as applied by the run that carried it out", async () => {
    const root = await workspace();
    await storedChangesPlan(root);
    const at = "2026-01-02T03:05:01.000Z";
    assert.equal(await markPlanApplied({ workspaceRoot: root, planRunId: PLAN_RUN, applyRunId: CARRY_RUN, at }), "marked");
    assert.equal(await markPlanApplied({ workspaceRoot: root, planRunId: PLAN_RUN, applyRunId: "20260102T030600Z-22222222", at }), "already_applied");
    const outcome = await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN });
    assert.deepEqual(outcome.ok ? outcome.applied : outcome, { schemaVersion: 1, kind: "plan_applied", planRunId: PLAN_RUN, applyRunId: CARRY_RUN, at });
  });

  test("the result names a run plan exactly when plan.json is one", async () => {
    const changes = { schemaVersion: 1, kind: "changes", runId: PLAN_RUN, summary: SUMMARY, files: FILES };
    const moves = { schemaVersion: 1, kind: "plan", runId: PLAN_RUN, actions: ACTIONS };
    const cases: [string, unknown, string | undefined, string][] = [
      ["a run plan whose result has no plan kind", changes, undefined, "invalid_run_record"],
      ["a run plan whose result says another kind", changes, "plan", "invalid_run_record"],
      ["a move plan whose result says changes", moves, "changes", "invalid_run_record"],
    ];
    for (const [name, stored, resultKind, code] of cases) {
      const root = await workspace();
      await handWrittenPlan(root, stored, resultKind);
      const any = await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN });
      assert.equal(any.ok ? "ok" : any.code, code, name);
      const moveOnly = await loadPlan({ workspaceRoot: root, runId: PLAN_RUN });
      assert.equal(moveOnly.ok ? "ok" : moveOnly.code, "invalid_run_record", name);
    }
  });

  test("a run plan.json that fails its checks is invalid_run_record, with the digest right", async () => {
    const good = { schemaVersion: 1, kind: "changes", runId: PLAN_RUN, summary: SUMMARY, files: FILES };
    const bad: [string, unknown][] = [
      ["an extra key", { ...good, policy: {} }],
      ["no summary", { schemaVersion: 1, kind: "changes", runId: PLAN_RUN, files: FILES }],
      ["actions in place of files", { schemaVersion: 1, kind: "changes", runId: PLAN_RUN, summary: SUMMARY, actions: ACTIONS }],
      ["another run", { ...good, runId: CARRY_RUN }],
      ["schema version 2", { ...good, schemaVersion: 2 }],
      ["a path outside", { ...good, files: [{ ...FILES[0], path: "../x.md" }] }],
      ["a path twice", { ...good, files: [FILES[0], FILES[0]] }],
      ["a file without shown", { ...good, files: [{ path: "docs/guide.md", change: "modify", sha256: HASH_A }] }],
      ["an unknown kind", { ...good, kind: "edits" }],
    ];
    for (const [name, stored] of bad) {
      const root = await workspace();
      await handWrittenPlan(root, stored, "changes");
      const outcome = await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN });
      assert.deepEqual(outcome, { ok: false, code: "invalid_run_record" }, name);
    }
  });

  test("the other codes are LoadPlan's: digest, missing plan.json, no result, no journal", async () => {
    const root = await workspace();
    await storedChangesPlan(root);
    await writeFile(join(runDir(root), "plan.json"), (await readFile(join(runDir(root), "plan.json"), "utf8")).replace("intro", "outro"), "utf8");
    assert.deepEqual(await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN }), { ok: false, code: "invalid_run_record" }, "the summary is under the digest");
    await rm(join(runDir(root), "plan.json"));
    assert.deepEqual(await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN }), { ok: false, code: "plan_run_missing" });
    await rm(join(runDir(root), "result.json"));
    assert.deepEqual(await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN }), { ok: false, code: "run_not_plan" });
    await rm(join(runDir(root), "journal.jsonl"));
    assert.deepEqual(await loadAnyPlan({ workspaceRoot: root, runId: PLAN_RUN }), { ok: false, code: "run_not_found" });
    assert.deepEqual(await loadAnyPlan({ workspaceRoot: root, runId: "not-a-run" }), { ok: false, code: "run_not_found" });
  });
});

describe("U-181 (B-3, B-7): createRunRecorders for a run that carries out a run plan", () => {
  const clock = { now: () => Date.parse("2026-01-02T03:05:01.000Z") };

  test("markApplied claims the plan once, with this run, and its state guard knows the write", async () => {
    const root = await workspace();
    await storedChangesPlan(root);
    const records = createRunRecorders({ workspaceRoot: root, runId: CARRY_RUN, clock, planRunId: PLAN_RUN });
    const base = await records.stateGuard.capture("state");
    assert.equal(await records.markApplied(), "marked");
    assert.deepEqual(records.stateGuard.compare(base, await records.stateGuard.capture("state")), { changed: [], limited: false });
    assert.equal(await records.markApplied(), "already_applied");
    const applied = JSON.parse(await readFile(join(runDir(root), "applied.json"), "utf8")) as unknown;
    assert.deepEqual(applied, { schemaVersion: 1, kind: "plan_applied", planRunId: PLAN_RUN, applyRunId: CARRY_RUN, at: "2026-01-02T03:05:01.000Z" });

    // Another run's guard did not write it: to that guard it is a change of the plan run's records.
    const other = await workspace();
    await storedChangesPlan(other);
    const plain = createRunRecorders({ workspaceRoot: other, runId: CARRY_RUN, clock });
    const otherBase = await plain.stateGuard.capture("state");
    assert.equal(await markPlanApplied({ workspaceRoot: other, planRunId: PLAN_RUN, applyRunId: CARRY_RUN, at: "2026-01-02T03:05:01.000Z" }), "marked");
    assert.deepEqual(plain.stateGuard.compare(otherBase, await plain.stateGuard.capture("state")).changed, [`runs/${PLAN_RUN}/applied.json`]);
  });

  test("without planRunId the recorders are as before (no markApplied); a run cannot carry out its own plan", async () => {
    const root = await workspace();
    const plain = createRunRecorders({ workspaceRoot: root, runId: CARRY_RUN, clock });
    assert.deepEqual(Object.keys(plain).sort(), ["changeRecorder", "journal", "planRecorder", "stateGuard"]);
    assert.throws(() => createRunRecorders({ workspaceRoot: root, runId: CARRY_RUN, clock, planRunId: CARRY_RUN }), TypeError);
    assert.throws(() => createRunRecorders({ workspaceRoot: root, runId: CARRY_RUN, clock, planRunId: "../plan" }));
  });
});
