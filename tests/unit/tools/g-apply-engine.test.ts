/**
 * G-C with G-B: the real engine `applyPlan` driving the real plan executor on real files.
 * The plan comes from the real `propose_plan`; the policy is the real gate (PQ-1) and the privacy
 * gateway is the real one. Only the parts other work items own and that do not exist yet stand in
 * at the contract boundary: the inventory check (G-D), the apply journal (G-E) and the verifier
 * runner (no verifiers are configured).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { PLAN_FILE_NAME, RUNS_DIR_NAME, STATE_DIR_NAME, asRawText } from "../../../src/contracts/index.js";
import type {
  ApplyJournalEntryRecord,
  ApplyDeps,
  ApplyJournalEvent,
  ApplyResult,
  InventoryCheckInput,
  InventoryChecker,
  PlanActionArgs,
  PlanActionKind,
  PolicyConfig,
  RawVerifierResult,
  ResolvedPlanAction,
  StoredPlan,
  VerifierRunner,
  Workspace,
} from "../../../src/contracts/index.js";
import { applyPlan } from "../../../src/engine/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { canonicalActions, createPlanRecorder } from "../../../src/store/index.js";
import { createPlanExecutor, createToolRunner, discardedRootOf } from "../../../src/tools/index.js";
import type { PlanFileOps } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const PLAN_RUN = "20261112T100000Z-0000aaaa";
const APPLY_RUN = "20261112T100500Z-0000bbbb";
/** Fake secret; it does not look like any real key. */
const FAKE_SECRET = "fake-secret-NAME-gc01";

function sha(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

interface Fixture {
  readonly root: string;
  readonly workspace: Workspace;
  cleanup(): Promise<void>;
}

async function fixture(files: Record<string, string>): Promise<Fixture> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gc-apply-"));
  await fs.mkdir(path.join(base, ".codaryn", "runs", PLAN_RUN), { recursive: true });
  await fs.mkdir(path.join(base, ".codaryn", "runs", APPLY_RUN), { recursive: true });
  for (const [relative, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(base, relative)), { recursive: true });
    await fs.writeFile(path.join(base, relative), text, "utf8");
  }
  const workspace = await createWorkspace({ root: base });
  return { root: workspace.root, workspace, cleanup: () => fs.rm(base, { recursive: true, force: true }) };
}

async function read(root: string, relative: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(root, relative), "utf8");
  } catch {
    return null;
  }
}

/** The plan run's part: the real propose_plan checks, hashes and hands the actions to a recorder. */
async function proposeReal(fx: Fixture, actions: readonly PlanActionArgs[]): Promise<StoredPlan> {
  let stored: readonly ResolvedPlanAction[] | null = null;
  const runner = createToolRunner({
    workspace: fx.workspace,
    privacy: createPrivacyGateway({ secrets: [FAKE_SECRET] }),
    planRecorder: {
      async savePlan(resolved) {
        stored = resolved;
        return sha(JSON.stringify(resolved));
      },
    },
  });
  assert.ok(runner.executeWorkflowTool !== undefined);
  const outcome = await runner.executeWorkflowTool(
    { id: "p1", name: "propose_plan", args: { summary: "tidy", actions } },
    new AbortController().signal,
  );
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.ok(stored !== null);
  return { schemaVersion: 1, kind: "plan", runId: PLAN_RUN, actions: stored };
}

class MemoryJournal {
  readonly events: ApplyJournalEvent[] = [];
  async append(event: ApplyJournalEvent): Promise<ApplyJournalEntryRecord> {
    this.events.push(event);
    return { seq: this.events.length, at: new Date(0).toISOString(), runId: "fake-apply", ...event };
  }
  async close(): Promise<void> {}
  types(): string[] {
    return this.events.map((event) => event.type);
  }
}

/** Stand-in for G-D's inventory: records what the engine hands it and passes. */
class RecordingInventory implements InventoryChecker {
  readonly inputs: InventoryCheckInput[] = [];
  async capture() {
    return { entries: [], limitReached: false };
  }
  async check(input: InventoryCheckInput): Promise<RawVerifierResult> {
    this.inputs.push(input);
    return {
      id: "inventory",
      kind: "inventory",
      outcome: "pass",
      evidence: asRawText(`${input.applied.length} actions`),
      checked: ["stand-in inventory"],
      limits: ["stand-in: G-D's inventory is not used here"],
    };
  }
}

const NO_VERIFIERS: VerifierRunner = {
  run() {
    throw new Error("no verifier is configured in these cases");
  },
};

interface Run {
  result: ApplyResult;
  journal: MemoryJournal;
  inventory: RecordingInventory;
  marks: number;
}

async function apply(
  fx: Fixture,
  plan: StoredPlan,
  options: {
    planActions?: readonly PlanActionKind[];
    protectedPaths?: readonly string[];
    fileOps?: Partial<PlanFileOps>;
    controller?: AbortController;
    onMark?: () => Promise<void>;
    /** DR-21: no consent, a person's consent for this plan's digest, or one given for another plan. */
    consent?: "none" | "this_plan" | "other_plan";
    /** DR-28: the secrets registered when applying. Default: the plan run's (FAKE_SECRET). */
    secrets?: readonly string[];
  } = {},
): Promise<Run> {
  const planActions = options.planActions ?? ["move", "discard"];
  const config: PolicyConfig = {
    commands: [],
    network: "deny",
    destructive: "deny",
    restorePathTokens: false,
    planActions,
    ...(options.protectedPaths === undefined ? {} : { protectedPaths: options.protectedPaths }),
  };
  const journal = new MemoryJournal();
  const inventory = new RecordingInventory();
  const digest = sha(JSON.stringify(plan.actions));
  const consent = options.consent ?? "none";
  let marks = 0;
  const deps: ApplyDeps = {
    plan,
    planRunId: PLAN_RUN,
    digest,
    approval: "cli-flag",
    ...(consent === "none"
      ? {}
      : { unsafeMoveConsent: { channel: "cli-flag" as const, digest: consent === "this_plan" ? digest : sha("another plan") } }),
    runId: APPLY_RUN,
    taskId: "tidy",
    maxDurationMs: 60_000,
    verifierConfigs: [],
    executor: createPlanExecutor({
      workspace: fx.workspace,
      workspaceRoot: fx.workspace.root,
      runId: APPLY_RUN,
      ...(options.fileOps === undefined ? {} : { fileOps: options.fileOps }),
    }),
    policy: createPolicyGate({ config, workspace: fx.workspace }),
    planActions,
    discardedRoot: discardedRootOf(fx.workspace.root, APPLY_RUN),
    privacy: createPrivacyGateway({ secrets: [...(options.secrets ?? [FAKE_SECRET])] }),
    verifiers: NO_VERIFIERS,
    inventory,
    journal,
    clock: { now: () => Date.now() },
    signal: (options.controller ?? new AbortController()).signal,
    async markApplied() {
      marks += 1;
      await options.onMark?.();
      return "marked";
    },
  };
  const result = await applyPlan(deps);
  return { result, journal, inventory, marks };
}

test("G-C+G-B: an approved plan is applied, discarded files land in the DR-9 root, and paths stay masked", async () => {
  const secretName = `photos/${FAKE_SECRET}.jpg`;
  const fx = await fixture({ "photos/a.jpg": "AAA", "tmp/b.tmp": "BBB", [secretName]: "SSS" });
  try {
    const plan = await proposeReal(fx, [
      { kind: "move", from: "photos/a.jpg", to: "2026/a.jpg" },
      { kind: "discard", path: "tmp/b.tmp" },
      { kind: "move", from: secretName, to: "2026/s.jpg" },
    ]);
    const { result, journal, inventory, marks } = await apply(fx, plan);

    assert.equal(result.status, "done", JSON.stringify(result));
    assert.equal(result.reason, "verified");
    assert.equal(marks, 1);
    assert.deepEqual(result.applied.map((item) => [item.index, item.stored]), [[0, null], [1, "1"], [2, null]]);

    assert.equal(await read(fx.root, "2026/a.jpg"), "AAA");
    assert.equal(await read(fx.root, "photos/a.jpg"), null);
    assert.equal(await read(fx.root, "tmp/b.tmp"), null);
    assert.equal(await read(fx.root, "2026/s.jpg"), "SSS");
    const discardedRoot = discardedRootOf(fx.root, APPLY_RUN);
    assert.equal(await fs.readFile(path.join(discardedRoot, "1"), "utf8"), "BBB");

    assert.equal(inventory.inputs.length, 1);
    assert.equal(inventory.inputs[0]?.discardedRoot, discardedRoot);
    assert.deepEqual(inventory.inputs[0]?.applied.map((item) => item.stored), [null, "1", null]);

    const types = journal.types();
    assert.equal(types[0], "apply_started");
    for (const type of ["plan_checked", "file_moved", "file_discarded", "verifier_result", "run_finished"]) {
      assert.ok(types.includes(type), `${type} is recorded`);
    }
    assert.doesNotMatch(JSON.stringify(journal.events), new RegExp(FAKE_SECRET), "the journal holds masked paths only");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(FAKE_SECRET), "the result holds masked paths only");
  } finally {
    await fx.cleanup();
  }
});

test("G-C+G-B: a source edited after the plan stops the apply as plan_stale with nothing moved", async () => {
  const fx = await fixture({ "a.txt": "alpha", "b.txt": "bravo" });
  try {
    const plan = await proposeReal(fx, [
      { kind: "move", from: "a.txt", to: "x/a.txt" },
      { kind: "discard", path: "b.txt" },
    ]);
    await fs.writeFile(path.join(fx.root, "b.txt"), "changed", "utf8");
    const { result, journal, marks } = await apply(fx, plan);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "plan_stale");
    assert.equal(marks, 0, "the plan is not claimed");
    assert.deepEqual(result.applied, []);
    const checked = journal.events.find((event) => event.type === "plan_checked");
    assert.deepEqual(checked !== undefined && "problems" in checked ? checked.problems : null, [{ index: 1, problem: "source_changed" }]);
    assert.equal(await read(fx.root, "a.txt"), "alpha");
    assert.equal(await read(fx.root, "b.txt"), "changed");
  } finally {
    await fx.cleanup();
  }
});

test("G-C+G-B: the apply-time policy decides (DR-5): an unlisted kind or a protected path stops it before any move", async () => {
  const fx = await fixture({ "a.txt": "alpha", "keep/b.txt": "bravo" });
  try {
    const plan = await proposeReal(fx, [
      { kind: "move", from: "a.txt", to: "x/a.txt" },
      { kind: "discard", path: "keep/b.txt" },
    ]);
    for (const options of [{ planActions: ["move"] as const }, { protectedPaths: ["keep"] }]) {
      const { result, marks } = await apply(fx, plan, options);
      assert.equal(result.status, "failed", JSON.stringify(options));
      assert.equal(result.reason, "plan_stale", JSON.stringify(options));
      assert.equal(marks, 0);
      assert.equal(await read(fx.root, "a.txt"), "alpha");
      assert.equal(await read(fx.root, "keep/b.txt"), "bravo");
    }
  } finally {
    await fx.cleanup();
  }
});

/** A volume without hard links: every link (the preflight's probe and the moves) is refused. */
const NO_HARD_LINKS: Partial<PlanFileOps> = {
  link: () => Promise.reject(Object.assign(new Error("ENOTSUP"), { code: "ENOTSUP" })),
};

function eventOf<T extends ApplyJournalEvent["type"]>(journal: MemoryJournal, type: T): Extract<ApplyJournalEvent, { type: T }> | undefined {
  return journal.events.find((event): event is Extract<ApplyJournalEvent, { type: T }> => event.type === type);
}

test("G-C+G-B (DR-21): without consent a volume without hard links ends the apply as consent_required with nothing moved", async () => {
  const fx = await fixture({ "a.txt": "alpha", "b.txt": "bravo" });
  try {
    const plan = await proposeReal(fx, [
      { kind: "move", from: "a.txt", to: "x/a.txt" },
      { kind: "discard", path: "b.txt" },
    ]);
    for (const consent of ["none", "other_plan"] as const) {
      const { result, journal, marks } = await apply(fx, plan, { fileOps: NO_HARD_LINKS, consent });
      assert.equal(result.status, "needs-input", consent);
      assert.equal(result.reason, "consent_required", consent);
      assert.equal(marks, 0, "the plan is not claimed");
      assert.deepEqual(result.applied, []);
      assert.equal(eventOf(journal, "apply_started")?.unsafeMoveConsent, null, "no consent recorded");
      const checked = eventOf(journal, "plan_checked");
      assert.deepEqual(checked?.problems, [], "unsafe moves are not problems");
      assert.deepEqual(checked?.unsafeMoves, [0, 1], "the preflight finds both, the discard too");
      assert.equal(eventOf(journal, "file_moved"), undefined);
      assert.equal(await read(fx.root, "a.txt"), "alpha");
      assert.equal(await read(fx.root, "b.txt"), "bravo");
      assert.equal(await read(fx.root, "x/a.txt"), null);
    }
  } finally {
    await fx.cleanup();
  }
});

test("G-C+G-B (DR-21): with the person's consent for this plan the unsafe moves are made and marked unsafe", async () => {
  const fx = await fixture({ "a.txt": "alpha", "b.txt": "bravo" });
  try {
    const plan = await proposeReal(fx, [
      { kind: "move", from: "a.txt", to: "x/a.txt" },
      { kind: "discard", path: "b.txt" },
    ]);
    const { result, journal, marks } = await apply(fx, plan, { fileOps: NO_HARD_LINKS, consent: "this_plan" });
    assert.equal(result.status, "done", JSON.stringify(result));
    assert.equal(result.reason, "verified");
    assert.equal(marks, 1);
    assert.deepEqual(
      result.applied.map((item) => [item.index, item.stored, item.unsafe]),
      [
        [0, null, true],
        [1, "1", true],
      ],
    );
    assert.equal(eventOf(journal, "apply_started")?.unsafeMoveConsent, "cli-flag");
    assert.deepEqual(eventOf(journal, "plan_checked")?.unsafeMoves, [0, 1]);
    assert.equal(eventOf(journal, "file_moved")?.unsafe, true);
    assert.equal(eventOf(journal, "file_discarded")?.unsafe, true);
    assert.equal(await read(fx.root, "a.txt"), null);
    assert.equal(await read(fx.root, "x/a.txt"), "alpha");
    assert.equal(await read(fx.root, "b.txt"), null);
    assert.equal(await fs.readFile(path.join(discardedRootOf(fx.root, APPLY_RUN), "1"), "utf8"), "bravo");
  } finally {
    await fx.cleanup();
  }
});

test("G-C+G-B (DR-21): with consent, a destination taken after the preflight is still not replaced", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const plan = await proposeReal(fx, [{ kind: "move", from: "a.txt", to: "b.txt" }]);
    const { result, marks } = await apply(fx, plan, {
      fileOps: NO_HARD_LINKS,
      consent: "this_plan",
      // After the preflight and the claim, before the move: someone creates the destination.
      onMark: () => fs.writeFile(path.join(fx.root, "b.txt"), "created in the window", "utf8"),
    });
    assert.equal(marks, 1);
    assert.equal(result.status, "failed", JSON.stringify(result));
    assert.equal(result.reason, "apply_incomplete");
    assert.equal(await read(fx.root, "a.txt"), "alpha");
    assert.equal(await read(fx.root, "b.txt"), "created in the window");
  } finally {
    await fx.cleanup();
  }
});

test("G-C+G-B: a cancel during an action finishes that action and ends the apply as cancelled", async () => {
  const fx = await fixture({ "a.txt": "alpha", "b.txt": "bravo" });
  try {
    const plan = await proposeReal(fx, [
      { kind: "move", from: "a.txt", to: "x/a.txt" },
      { kind: "move", from: "b.txt", to: "x/b.txt" },
    ]);
    const controller = new AbortController();
    const fileOps: Partial<PlanFileOps> = {
      async link(existing, created) {
        // The preflight's hard link probe (PQ-6) is not a move; cancel during the first real move.
        if (!path.basename(created).startsWith(".codaryn-link-probe-")) controller.abort();
        await fs.link(existing, created);
      },
    };
    const { result, marks } = await apply(fx, plan, { fileOps, controller });
    assert.equal(result.status, "cancelled", JSON.stringify(result));
    assert.equal(result.reason, "cancelled");
    assert.equal(marks, 1);
    assert.deepEqual(result.applied.map((item) => item.index), [0]);
    assert.equal(await read(fx.root, "x/a.txt"), "alpha");
    assert.equal(await read(fx.root, "b.txt"), "bravo", "the second action was not started");
  } finally {
    await fx.cleanup();
  }
});

test("G-C+G-B: a cancel before the first action moves nothing", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const plan = await proposeReal(fx, [{ kind: "discard", path: "a.txt" }]);
    const controller = new AbortController();
    const { result } = await apply(fx, plan, { controller, onMark: async () => controller.abort() });
    assert.equal(result.status, "cancelled");
    assert.deepEqual(result.applied, []);
    assert.equal(await read(fx.root, "a.txt"), "alpha");
  } finally {
    await fx.cleanup();
  }
});

test("G-C+G-B: a destination taken after the preflight ends the apply as apply_incomplete and keeps what was done", async () => {
  const fx = await fixture({ "a.txt": "alpha", "b.txt": "bravo" });
  try {
    const plan = await proposeReal(fx, [
      { kind: "move", from: "a.txt", to: "x/a.txt" },
      { kind: "move", from: "b.txt", to: "x/b.txt" },
    ]);
    // Someone creates the second destination after the preflight passed.
    const onMark = async (): Promise<void> => {
      await fs.mkdir(path.join(fx.root, "x"), { recursive: true });
      await fs.writeFile(path.join(fx.root, "x", "b.txt"), "theirs", "utf8");
    };
    const { result, journal } = await apply(fx, plan, { onMark });
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "apply_incomplete");
    assert.deepEqual(result.applied.map((item) => item.index), [0]);
    const failed = journal.events.find((event) => event.type === "plan_item_failed");
    assert.deepEqual(failed !== undefined && "problem" in failed ? [failed.index, failed.problem] : null, [1, "destination_exists"]);
    assert.equal(await read(fx.root, "x/a.txt"), "alpha");
    assert.equal(await read(fx.root, "b.txt"), "bravo");
    assert.equal(await read(fx.root, "x/b.txt"), "theirs", "the other file is not replaced");
  } finally {
    await fx.cleanup();
  }
});

test("G-C+G-B+store (DR-28): a plan stored by the real store is applied with the plan run's secrets and refused with other secrets", async () => {
  const secretName = `photos/${FAKE_SECRET}.jpg`;
  for (const [label, secrets, applies] of [
    ["same secrets", [FAKE_SECRET], true],
    ["another secret", ["fake-other-secret-gc02"], false],
    ["no secret", [], false],
  ] as const) {
    const fx = await fixture({ [secretName]: "SSS", "a.txt": "alpha" });
    try {
      // The plan run: the real tool with the real store's recorder writes plan.json.
      const runner = createToolRunner({
        workspace: fx.workspace,
        privacy: createPrivacyGateway({ secrets: [FAKE_SECRET] }),
        planRecorder: createPlanRecorder({ workspaceRoot: fx.root, runId: PLAN_RUN }),
      });
      assert.ok(runner.executeWorkflowTool !== undefined);
      const proposed = await runner.executeWorkflowTool(
        {
          id: "p1",
          name: "propose_plan",
          args: { summary: "tidy", actions: [{ kind: "move", from: secretName, to: "2026/s.jpg" }, { kind: "discard", path: "a.txt" }] },
        },
        new AbortController().signal,
      );
      assert.equal(proposed.ok, true, JSON.stringify(proposed));
      const text = await fs.readFile(path.join(fx.root, STATE_DIR_NAME, RUNS_DIR_NAME, PLAN_RUN, PLAN_FILE_NAME), "utf8");
      const actions = canonicalActions((JSON.parse(text) as { actions: unknown }).actions);
      assert.ok(actions !== null && actions.every((action) => action.shown !== undefined), "every stored action has its masked form");
      assert.doesNotMatch(JSON.stringify(actions.map((action) => action.shown)), new RegExp(FAKE_SECRET), "the masked form holds no secret");
      const plan: StoredPlan = { schemaVersion: 1, kind: "plan", runId: PLAN_RUN, actions };

      // The apply, with the secrets registered now.
      const { result, journal, marks } = await apply(fx, plan, { secrets });
      if (applies) {
        assert.equal(result.status, "done", `${label}: ${JSON.stringify(result)}`);
        assert.equal(marks, 1);
        assert.equal(await read(fx.root, "2026/s.jpg"), "SSS");
        assert.equal(await read(fx.root, "a.txt"), null);
      } else {
        assert.equal(result.status, "failed", label);
        assert.equal(result.reason, "plan_stale", label);
        assert.equal(marks, 0, `${label}: the plan is not claimed`);
        assert.ok(result.notices.some((notice) => notice.includes("plan_secrets_differ")), `${label}: ${JSON.stringify(result.notices)}`);
        assert.equal(journal.events.some((event) => event.type === "plan_checked" || event.type === "file_moved"), false, `${label}: nothing checked or moved`);
        assert.equal(await read(fx.root, secretName), "SSS");
        assert.equal(await read(fx.root, "a.txt"), "alpha");
        assert.doesNotMatch(JSON.stringify({ result, events: journal.events }), new RegExp(FAKE_SECRET), `${label}: no plain secret in the result or the record`);
      }
    } finally {
      await fx.cleanup();
    }
  }
});
