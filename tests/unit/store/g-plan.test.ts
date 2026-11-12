/**
 * G-E: the stored plan (plan.json, DR-5), loading it for `plan` and `apply`, and claiming it once
 * (applied.json). Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { planActionShown, planActionShownMatches } from "../../../src/contracts/index.js";
import type { ContentHash, MaskedPlanAction, MaskedText, ResolvedPlanAction, StoredPlanAction } from "../../../src/contracts/index.js";
import { createPlanRecorder, loadPlan, markPlanApplied } from "../../../src/store/index.js";
import { createExclusive } from "../../../src/store/common.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-g-plan-"));
  roots.push(root);
  return root;
}

const PLAN_RUN = "20260102T030405Z-0a1b2c3d";
const APPLY_RUN = "20260102T030500Z-11111111";
const HASH_A = "a".repeat(64) as ContentHash;
const HASH_B = "b".repeat(64) as ContentHash;
const ACTIONS: ResolvedPlanAction[] = [
  { kind: "move", from: "inbox/report.pdf", to: "docs/2026/report.pdf", sha256: HASH_A },
  { kind: "discard", path: "inbox/tmp.log", sha256: HASH_B },
];

const sha = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const runDir = (root: string, runId = PLAN_RUN): string => join(root, ".codaryn", "runs", runId);
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

/** The plan run's journal and result.json, as a run that ended plan_pending leaves them. */
async function planRun(root: string, digest: string, extra: Record<string, unknown> = {}): Promise<void> {
  await mkdir(runDir(root), { recursive: true });
  const started = { seq: 1, at: "2026-01-02T03:04:05.000Z", runId: PLAN_RUN, type: "run_started", schemaVersion: 1, taskId: "organize-task", workflow: "organize", provider: "scripted", limits: { maxModelTurns: 2, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 1000 } };
  await writeFile(join(runDir(root), "journal.jsonl"), `${JSON.stringify(started)}\n`, "utf8");
  const result = {
    schemaVersion: 1,
    kind: "run",
    runId: PLAN_RUN,
    taskId: "organize-task",
    status: "needs-input",
    reason: "plan_pending",
    exitCode: 3,
    provider: "scripted",
    verifiers: [],
    changes: [],
    usage: { modelTurns: 2, toolCalls: 3, inputTokens: null, outputTokens: null, durationMs: 9 },
    journalPath: `.codaryn/runs/${PLAN_RUN}/journal.jsonl`,
    notices: [],
    plan: { digest, actions: ACTIONS.length },
    ...extra,
  };
  await writeFile(join(runDir(root), "result.json"), `${JSON.stringify(result)}\n`, "utf8");
}

describe("createPlanRecorder (G-E, DR-5)", () => {
  test("writes plan.json with the actions and their hashes only, and returns the SHA-256 of its bytes", async () => {
    const root = await workspace();
    const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(ACTIONS);
    const bytes = await readFile(join(runDir(root), "plan.json"));
    assert.equal(digest, sha(bytes));
    const stored = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(stored).sort(), ["actions", "kind", "runId", "schemaVersion"], "DR-5: nothing but the actions");
    assert.deepEqual(stored, { schemaVersion: 1, kind: "plan", runId: PLAN_RUN, actions: ACTIONS });
    assert.deepEqual((await readdir(runDir(root))).sort(), ["plan.json"], "no temporary file is left");
  });

  test("is written once: an existing plan.json stays as it was and the call rejects", async () => {
    const root = await workspace();
    const recorder = createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN });
    await recorder.savePlan(ACTIONS);
    const before = await readFile(join(runDir(root), "plan.json"));
    await assert.rejects(recorder.savePlan([ACTIONS[0] as ResolvedPlanAction]));
    assert.ok((await readFile(join(runDir(root), "plan.json"))).equals(before));
  });

  test("refuses actions that are not resolved workspace paths with hashes; nothing is written", async () => {
    const bad: unknown[][] = [
      [],
      [{ kind: "move", from: "/etc/passwd", to: "x", sha256: HASH_A }],
      [{ kind: "move", from: "a/../b", to: "x", sha256: HASH_A }],
      [{ kind: "move", from: ".codaryn/lock.json", to: "x", sha256: HASH_A }],
      [{ kind: "discard", path: "a", sha256: "nothex" }],
      [{ kind: "copy", from: "a", to: "b", sha256: HASH_A }],
      [{ kind: "move", from: "a", to: "b", sha256: HASH_A, extra: 1 }],
    ];
    for (const actions of bad) {
      const root = await workspace();
      await assert.rejects(createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(actions as ResolvedPlanAction[]), TypeError, JSON.stringify(actions));
      assert.equal(await exists(join(runDir(root), "plan.json")), false);
    }
  });
});

describe("exclusive creation without hard links (DR-24 c)", () => {
  test("falls back to an exclusive create where links are not supported, and still creates once", async () => {
    const root = await workspace();
    const target = join(root, "applied.json");
    for (const code of ["EPERM", "EXDEV", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]) {
      await rm(target, { force: true });
      const unsupported = {
        link: async () => {
          throw Object.assign(new Error(code), { code });
        },
      };
      assert.equal(await createExclusive(target, "first\n", unsupported), true, code);
      assert.equal(await createExclusive(target, "second\n", unsupported), false, `${code}: exists`);
      assert.equal(await readFile(target, "utf8"), "first\n");
    }
    assert.deepEqual((await readdir(root)).sort(), ["applied.json"], "no temporary file is left");
  });
});

describe("stored paths follow the workspace's path rules (DR-24 d)", () => {
  test("names Windows would open as something else are refused when stored and when loaded", { skip: process.platform !== "win32" }, async () => {
    for (const path of [".codaryn./x", ".codaryn /x", "a.txt:hidden", "NUL", "dir/con.txt"]) {
      const root = await workspace();
      const actions = [{ kind: "discard", path, sha256: HASH_A }] as ResolvedPlanAction[];
      await assert.rejects(createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(actions), TypeError, path);
      const text = `${JSON.stringify({ schemaVersion: 1, kind: "plan", runId: PLAN_RUN, actions })}\n`;
      await planRun(root, sha(text));
      await writeFile(join(runDir(root), "plan.json"), text, "utf8");
      const outcome = await loadPlan({ workspaceRoot: root, runId: PLAN_RUN });
      assert.deepEqual(outcome, { ok: false, code: "invalid_run_record" }, path);
    }
  });
});

describe("loadPlan (G-E)", () => {
  test("gives the plan, its digest and no applied record for a plan run", async () => {
    const root = await workspace();
    const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(ACTIONS);
    await planRun(root, digest);
    const outcome = await loadPlan({ workspaceRoot: root, runId: PLAN_RUN });
    assert.deepEqual(outcome, { ok: true, plan: { schemaVersion: 1, kind: "plan", runId: PLAN_RUN, actions: ACTIONS }, digest, applied: null });
  });

  test("run_not_found, run_not_plan, plan_run_missing and invalid_run_record as the contract says", async () => {
    const code = async (root: string): Promise<string> => {
      const outcome = await loadPlan({ workspaceRoot: root, runId: PLAN_RUN });
      return outcome.ok ? "ok" : outcome.code;
    };
    assert.equal(await code(await workspace()), "run_not_found");

    const notPending = await workspace();
    const digest = await createPlanRecorder({ workspaceRoot: notPending, runId: PLAN_RUN }).savePlan(ACTIONS);
    await planRun(notPending, digest, { status: "done", reason: "verified", exitCode: 0 });
    assert.equal(await code(notPending), "run_not_plan");

    const noResult = await workspace();
    await planRun(noResult, HASH_A);
    await rm(join(runDir(noResult), "result.json"));
    assert.equal(await code(noResult), "run_not_plan");

    // R-9c C-1: the run ended as plan_pending but its plan.json is gone (deleted).
    const noPlan = await workspace();
    await planRun(noPlan, HASH_A);
    assert.equal(await code(noPlan), "plan_run_missing");

    const otherDigest = await workspace();
    await createPlanRecorder({ workspaceRoot: otherDigest, runId: PLAN_RUN }).savePlan(ACTIONS);
    await planRun(otherDigest, HASH_A);
    assert.equal(await code(otherDigest), "invalid_run_record", "the digest must be EngineResult.plan.digest");

    const otherRun = await workspace();
    await planRun(otherRun, HASH_A);
    const text = `${JSON.stringify({ schemaVersion: 1, kind: "plan", runId: "20260102T000000Z-00000000", actions: ACTIONS })}\n`;
    await writeFile(join(runDir(otherRun), "plan.json"), text, "utf8");
    await planRun(otherRun, sha(text));
    assert.equal(await code(otherRun), "invalid_run_record", "plan.json naming another run");

    const broken = await workspace();
    await planRun(broken, sha("{"));
    await writeFile(join(runDir(broken), "plan.json"), "{", "utf8");
    assert.equal(await code(broken), "invalid_run_record");

    const badApplied = await workspace();
    const badDigest = await createPlanRecorder({ workspaceRoot: badApplied, runId: PLAN_RUN }).savePlan(ACTIONS);
    await planRun(badApplied, badDigest);
    await writeFile(join(runDir(badApplied), "applied.json"), '{"kind":"plan_applied"}', "utf8");
    assert.equal(await code(badApplied), "invalid_run_record");
  });

  test("a linked run directory is invalid_run_record and is not read through", async () => {
    const elsewhere = await workspace();
    const digest = await createPlanRecorder({ workspaceRoot: elsewhere, runId: PLAN_RUN }).savePlan(ACTIONS);
    await planRun(elsewhere, digest);
    const root = await workspace();
    await mkdir(join(root, ".codaryn", "runs"), { recursive: true });
    await symlink(runDir(elsewhere), runDir(root), "junction");
    const outcome = await loadPlan({ workspaceRoot: root, runId: PLAN_RUN });
    assert.deepEqual(outcome, { ok: false, code: "invalid_run_record" });
  });
});

describe("markPlanApplied (G-E, applied.json)", () => {
  test("claims the plan exactly once, also when applies race; loadPlan then shows the claim", async () => {
    const root = await workspace();
    const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(ACTIONS);
    await planRun(root, digest);
    const at = "2026-01-02T03:05:00.000Z";
    const outcomes = await Promise.all(
      [0, 1, 2, 3, 4].map((n) => markPlanApplied({ workspaceRoot: root, planRunId: PLAN_RUN, applyRunId: `20260102T03050${n}Z-1111111${n}`, at })),
    );
    assert.equal(outcomes.filter((outcome) => outcome === "marked").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome === "already_applied").length, 4);
    const loaded = await loadPlan({ workspaceRoot: root, runId: PLAN_RUN });
    assert.ok(loaded.ok);
    assert.equal(loaded.applied?.kind, "plan_applied");
    assert.equal(loaded.applied?.planRunId, PLAN_RUN);
    assert.equal(loaded.applied?.at, at);
    const winner = outcomes.indexOf("marked");
    assert.equal(loaded.applied?.applyRunId, `20260102T03050${winner}Z-1111111${winner}`);
    assert.equal((await readdir(runDir(root))).filter((name) => name.endsWith(".tmp")).length, 0);
  });

  test("refuses to claim a run that has no directory of its own", async () => {
    const root = await workspace();
    await assert.rejects(markPlanApplied({ workspaceRoot: root, planRunId: PLAN_RUN, applyRunId: APPLY_RUN, at: "2026-01-02T03:05:00.000Z" }));
    assert.equal(await exists(join(root, ".codaryn")), false, "nothing is created");
  });
});

describe("DR-28 (R-11 M-1): each action keeps how the plan run masked its paths", () => {
  const TOKEN = "[[CODARYN_SECRET:00000000000000aa]]";
  const SECRET_DIR = "zz-r11-fake-secret-value-zz";
  const real: ResolvedPlanAction[] = [
    { kind: "move", from: `${SECRET_DIR}/a.jpg`, to: `photos/${SECRET_DIR}/a.jpg`, sha256: HASH_A },
    { kind: "discard", path: "inbox/tmp.log", sha256: HASH_B },
  ];
  /** The actions as the plan run's gateway masked them (the secret registered then). */
  const maskedThen: MaskedPlanAction[] = [
    { kind: "move", from: `${TOKEN}/a.jpg` as MaskedText, to: `photos/${TOKEN}/a.jpg` as MaskedText, sha256: HASH_A },
    { kind: "discard", path: "inbox/tmp.log" as MaskedText, sha256: HASH_B },
  ];
  const stored: StoredPlanAction[] = real.map((action, index) => ({ ...action, shown: planActionShown(maskedThen[index] as MaskedPlanAction) }) as StoredPlanAction);

  test("review reproduction: the stored masked form tells a masking with other secrets apart before anything is shown", async () => {
    const root = await workspace();
    const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(stored);
    await planRun(root, digest);
    const outcome = await loadPlan({ workspaceRoot: root, runId: PLAN_RUN });
    assert.equal(outcome.ok, true);
    const actions = outcome.ok ? outcome.plan.actions : [];
    assert.deepEqual(actions, stored, "loadPlan gives the actions with their masked form");
    // Masked again with the same secret (a new token id): the same visible text.
    const sameSecret: MaskedPlanAction = { kind: "move", from: "[[CODARYN_SECRET:00000000000000bb]]/a.jpg" as MaskedText, to: "photos/[[CODARYN_SECRET:00000000000000bb]]/a.jpg" as MaskedText, sha256: HASH_A };
    assert.equal(planActionShownMatches(actions[0] as StoredPlanAction, sameSecret), true);
    // Masked with secrets that do not include it (the review's plan --workspace): the value would show.
    const otherSecrets: MaskedPlanAction = { kind: "move", from: `${SECRET_DIR}/a.jpg` as MaskedText, to: `photos/${SECRET_DIR}/a.jpg` as MaskedText, sha256: HASH_A };
    assert.equal(planActionShownMatches(actions[0] as StoredPlanAction, otherSecrets), false);
    assert.equal(planActionShownMatches(actions[1] as StoredPlanAction, maskedThen[1] as MaskedPlanAction), true);
  });

  test("plan.json holds the visible parts only: no secret value, no token, no hash of a secret", async () => {
    const root = await workspace();
    await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(stored);
    const text = await readFile(join(runDir(root), "plan.json"), "utf8");
    const parsed = JSON.parse(text) as { actions: Record<string, unknown>[] };
    assert.deepEqual(parsed.actions[0]?.["shown"], { from: ["", "/a.jpg"], to: ["photos/", "/a.jpg"] });
    assert.deepEqual(parsed.actions[1]?.["shown"], { path: ["inbox/tmp.log"] });
    assert.equal(text.includes("CODARYN_SECRET"), false);
    assert.equal(text.split(SECRET_DIR).length - 1, 2, "the real paths only (from, to), as before DR-28");
  });

  test("a plan written before DR-28 (no shown) still loads; its actions have no shown", async () => {
    const root = await workspace();
    const digest = await createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan(ACTIONS);
    await planRun(root, digest);
    const outcome = await loadPlan({ workspaceRoot: root, runId: PLAN_RUN });
    assert.deepEqual(outcome.ok ? outcome.plan.actions : null, ACTIONS);
    assert.equal(planActionShownMatches((outcome.ok ? outcome.plan.actions[0] : undefined) as StoredPlanAction, maskedThen[0] as MaskedPlanAction), false, "no shown: treated as masked differently");
  });

  test("a shown of the wrong shape is refused when saved and when loaded", async () => {
    const bad: unknown[] = [
      { ...real[0], shown: { path: ["x"] } },
      { ...real[0], shown: { from: [""], to: ["photos/", "/a.jpg"], extra: [] } },
      { ...real[0], shown: { from: "x", to: ["y"] } },
      { ...real[0], shown: { from: [], to: ["y"] } },
      { ...real[0], shown: { from: [1], to: ["y"] } },
      { ...real[0], shown: { from: [`a${TOKEN}b`], to: ["y"] } },
      { ...real[1], shown: { from: ["x"], to: ["y"] } },
      { ...real[1], shown: null },
    ];
    for (const action of bad) {
      const root = await workspace();
      await assert.rejects(createPlanRecorder({ workspaceRoot: root, runId: PLAN_RUN }).savePlan([action as StoredPlanAction]), TypeError, JSON.stringify(action));
      assert.equal(await exists(join(runDir(root), "plan.json")), false);
      // Written by hand with a matching digest, it is not loaded either.
      await mkdir(runDir(root), { recursive: true });
      const text = `${JSON.stringify({ schemaVersion: 1, kind: "plan", runId: PLAN_RUN, actions: [action] })}\n`;
      await writeFile(join(runDir(root), "plan.json"), text, "utf8");
      await planRun(root, sha(text), { plan: { digest: sha(text), actions: 1 } });
      assert.deepEqual(await loadPlan({ workspaceRoot: root, runId: PLAN_RUN }), { ok: false, code: "invalid_run_record" }, JSON.stringify(action));
    }
  });
});
