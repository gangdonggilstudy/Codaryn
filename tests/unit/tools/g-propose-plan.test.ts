/**
 * G-C: `propose_plan` (design general-tasks.md 6.3, contract plan.ts PLAN_PROBLEMS, PlanRecorder).
 * Real files in a temporary workspace; the PlanRecorder is a stand-in at the contract boundary.
 * Every rejected plan must leave the workspace as it was and store nothing.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { MAX_PLAN_ACTIONS, MAX_PLAN_SOURCE_BYTES } from "../../../src/contracts/index.js";
import type {
  PlanActionArgs,
  PlanRecorder,
  RawWorkflowToolOutcome,
  ResolvedPlanAction,
  Workspace,
} from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import type { PlanFileOps } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createFakePrivacy } from "./doubles.js";

const never = new AbortController().signal;

function sha(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

interface Fixture {
  readonly root: string;
  readonly workspace: Workspace;
  cleanup(): Promise<void>;
}

async function fixture(files: Record<string, string>, dirs: readonly string[] = []): Promise<Fixture> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gc-plan-"));
  for (const dir of dirs) await fs.mkdir(path.join(base, dir), { recursive: true });
  for (const [relative, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(base, relative)), { recursive: true });
    await fs.writeFile(path.join(base, relative), text, "utf8");
  }
  const workspace = await createWorkspace({ root: base });
  return { root: workspace.root, workspace, cleanup: () => fs.rm(base, { recursive: true, force: true }) };
}

/** Every entry under the root (state directory included) with file hashes. */
async function tree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function visit(dir: string): Promise<void> {
    for (const child of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, child.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (child.isDirectory()) {
        out[relative] = "dir";
        await visit(absolute);
      } else {
        out[relative] = child.isFile() ? sha(await fs.readFile(absolute, "utf8")) : "other";
      }
    }
  }
  await visit(root);
  return out;
}

function recorder(behaviour: "resolve" | "reject" = "resolve") {
  const saved: (readonly ResolvedPlanAction[])[] = [];
  const planRecorder: PlanRecorder = {
    async savePlan(actions) {
      saved.push(actions);
      if (behaviour === "reject") throw new Error(`recorder-detail-must-not-leak ${JSON.stringify(actions)}`);
      return sha(JSON.stringify(actions));
    },
  };
  return { planRecorder, saved };
}

async function propose(
  fx: Fixture,
  actions: readonly PlanActionArgs[],
  options: { planRecorder?: PlanRecorder; signal?: AbortSignal; fileOps?: Partial<PlanFileOps>; platform?: NodeJS.Platform } = {},
): Promise<RawWorkflowToolOutcome> {
  const runner = createToolRunner({
    workspace: fx.workspace,
    privacy: createFakePrivacy(),
    ...(options.planRecorder === undefined ? {} : { planRecorder: options.planRecorder }),
    ...(options.fileOps === undefined ? {} : { fileOps: options.fileOps }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  });
  assert.ok(runner.executeWorkflowTool !== undefined);
  return runner.executeWorkflowTool(
    { id: "c1", name: "propose_plan", args: { summary: "sort files", actions } },
    options.signal ?? never,
  );
}

function assertRejected(outcome: RawWorkflowToolOutcome, index: number | null, problem: string): void {
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "invalid_plan");
  const expected = index === null ? `plan rejected: ${problem}` : `plan rejected: action ${index}: ${problem}`;
  assert.equal(outcome.message, expected);
}

test("G-C propose_plan: stores the checked actions with source hashes and changes no workspace file", async () => {
  const fx = await fixture({ "a.txt": "alpha", "b.txt": "bravo", "docs/c.md": "charlie" });
  try {
    const before = await tree(fx.root);
    const { planRecorder, saved } = recorder();
    const outcome = await propose(
      fx,
      [
        { kind: "move", from: "a.txt", to: "2023/a.txt" },
        { kind: "discard", path: "b.txt" },
        { kind: "move", from: "docs\\c.md", to: "notes/c.md" },
      ],
      { planRecorder },
    );
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok || !("digest" in outcome.payload)) return;
    const expected: ResolvedPlanAction[] = [
      { kind: "move", from: "a.txt", to: "2023/a.txt", sha256: sha("alpha") },
      { kind: "discard", path: "b.txt", sha256: sha("bravo") },
      { kind: "move", from: "docs/c.md", to: "notes/c.md", sha256: sha("charlie") },
    ];
    assert.deepEqual(outcome.payload.actions, expected);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], expected);
    assert.equal(outcome.payload.digest, sha(JSON.stringify(expected)));
    assert.deepEqual(await tree(fx.root), before, "the workspace is unchanged");
  } finally {
    await fx.cleanup();
  }
});

test("G-C propose_plan: empty and too many actions are rejected before any file is read", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const { planRecorder, saved } = recorder();
    assertRejected(await propose(fx, [], { planRecorder }), null, "empty");
    const many: PlanActionArgs[] = Array.from({ length: MAX_PLAN_ACTIONS + 1 }, (_, i) => ({ kind: "discard", path: `f${i}.txt` }));
    assertRejected(await propose(fx, many, { planRecorder }), null, "too_many");
    assert.equal(saved.length, 0);
  } finally {
    await fx.cleanup();
  }
});

test("G-C propose_plan: each PLAN_PROBLEMS case names the first failing action and stores nothing", async () => {
  const fx = await fixture({ "a.txt": "alpha", "b.txt": "bravo", "c.txt": "charlie", "taken.txt": "t", "plain.txt": "p" }, ["folder"]);
  try {
    const before = await tree(fx.root);
    const { planRecorder, saved } = recorder();
    const cases: { actions: PlanActionArgs[]; index: number; problem: string }[] = [
      { actions: [{ kind: "move", from: "a.txt", to: "./a.txt" }], index: 0, problem: "same_path" },
      { actions: [{ kind: "discard", path: "a.txt" }, { kind: "move", from: "a.txt", to: "x.txt" }], index: 1, problem: "duplicate_source" },
      { actions: [{ kind: "move", from: "a.txt", to: "x.txt" }, { kind: "move", from: "b.txt", to: "x.txt" }], index: 1, problem: "duplicate_destination" },
      { actions: [{ kind: "move", from: "a.txt", to: "b.txt" }, { kind: "discard", path: "b.txt" }], index: 0, problem: "destination_is_source" },
      { actions: [{ kind: "move", from: "c.txt", to: "y.txt" }, { kind: "discard", path: "missing.txt" }], index: 1, problem: "source_missing" },
      { actions: [{ kind: "discard", path: "folder" }], index: 0, problem: "source_not_file" },
      { actions: [{ kind: "move", from: "a.txt", to: "taken.txt" }], index: 0, problem: "destination_exists" },
      { actions: [{ kind: "move", from: "a.txt", to: "plain.txt/inner.txt" }], index: 0, problem: "destination_parent_not_dir" },
      {
        actions: [{ kind: "move", from: "a.txt", to: "n" }, { kind: "move", from: "b.txt", to: "n/inner.txt" }],
        index: 1,
        problem: "destination_parent_not_dir",
      },
    ];
    for (const item of cases) {
      assertRejected(await propose(fx, item.actions, { planRecorder }), item.index, item.problem);
    }
    assert.equal(saved.length, 0);
    assert.deepEqual(await tree(fx.root), before);
  } finally {
    await fx.cleanup();
  }
});

test("G-C propose_plan: rejection messages name no path", async () => {
  const fx = await fixture({ "private-name-ALPHA.txt": "alpha", "other-name.txt": "o" });
  try {
    const outcomes = [
      await propose(fx, [{ kind: "move", from: "private-name-ALPHA.txt", to: "other-name.txt" }]),
      await propose(fx, [{ kind: "discard", path: "private-name-MISSING.txt" }]),
      await propose(fx, [{ kind: "discard", path: "../outside-name.txt" }]),
    ];
    for (const outcome of outcomes) {
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.doesNotMatch(outcome.message, /name/);
    }
  } finally {
    await fx.cleanup();
  }
});

test("G-C propose_plan: paths outside the root or in the state directory are refused", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    await fs.mkdir(path.join(fx.root, ".codaryn"), { recursive: true });
    await fs.writeFile(path.join(fx.root, ".codaryn", "x.txt"), "state", "utf8");
    const { planRecorder, saved } = recorder();
    for (const actions of [
      [{ kind: "discard", path: "../a.txt" }],
      [{ kind: "discard", path: ".codaryn/x.txt" }],
      [{ kind: "move", from: "a.txt", to: ".codaryn/moved.txt" }],
      [{ kind: "move", from: "a.txt", to: "../escaped.txt" }],
    ] as PlanActionArgs[][]) {
      const outcome = await propose(fx, actions, { planRecorder });
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.equal(outcome.code, "policy_denied");
    }
    assert.equal(saved.length, 0);
    assert.equal(await fs.readFile(path.join(fx.root, "a.txt"), "utf8"), "alpha");
  } finally {
    await fx.cleanup();
  }
});

test("G-C propose_plan: a link is not a plan source", async (t) => {
  const fx = await fixture({ "real.txt": "real" });
  try {
    try {
      await fs.symlink(path.join(fx.root, "real.txt"), path.join(fx.root, "link.txt"), "file");
    } catch {
      t.skip("file links cannot be created here (needs a privilege on Windows)");
      return;
    }
    assertRejected(await propose(fx, [{ kind: "discard", path: "link.txt" }]), 0, "source_not_file");
  } finally {
    await fx.cleanup();
  }
});

test("G-C propose_plan: a name the file system reports as a link is refused (simulated link)", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const named = path.join(fx.root, "a.txt");
    const fileOps: Partial<PlanFileOps> = {
      async lstat(target) {
        const stat = await fs.lstat(target, { bigint: true });
        if (target === named) Object.defineProperty(stat, "isSymbolicLink", { value: () => true });
        return stat;
      },
    };
    const { planRecorder, saved } = recorder();
    assertRejected(await propose(fx, [{ kind: "discard", path: "a.txt" }], { planRecorder, fileOps }), 0, "source_not_file");
    assert.equal(saved.length, 0);
  } finally {
    await fx.cleanup();
  }
});

test("G-C propose_plan: on case-insensitive platforms a case-only rename is the same path", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    assertRejected(await propose(fx, [{ kind: "move", from: "a.txt", to: "A.txt" }], { platform: "win32" }), 0, "same_path");
  } finally {
    await fx.cleanup();
  }
});

test("G-C propose_plan: sources over MAX_PLAN_SOURCE_BYTES in total are too_large", async () => {
  const fx = await fixture({ "a.txt": "alpha", "b.txt": "bravo" });
  try {
    const big = BigInt(MAX_PLAN_SOURCE_BYTES) / 2n + 1n;
    const fileOps: Partial<PlanFileOps> = {
      async lstat(target) {
        const stat = await fs.lstat(target, { bigint: true });
        if (stat.isFile()) Object.defineProperty(stat, "size", { value: big });
        return stat;
      },
    };
    const { planRecorder, saved } = recorder();
    assertRejected(
      await propose(fx, [{ kind: "discard", path: "a.txt" }, { kind: "discard", path: "b.txt" }], { planRecorder, fileOps }),
      1,
      "too_large",
    );
    assert.equal(saved.length, 0);
  } finally {
    await fx.cleanup();
  }
});

test("G-C propose_plan: without a recorder, or when storing fails, nothing is stored and no detail leaks", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const none = await propose(fx, [{ kind: "discard", path: "a.txt" }]);
    assert.equal(none.ok, false);
    if (!none.ok) assert.equal(none.code, "io_error");

    const { planRecorder } = recorder("reject");
    const failed = await propose(fx, [{ kind: "discard", path: "a.txt" }], { planRecorder });
    assert.equal(failed.ok, false);
    if (!failed.ok) {
      assert.equal(failed.code, "io_error");
      assert.doesNotMatch(failed.message, /recorder-detail|a\.txt/);
    }
  } finally {
    await fx.cleanup();
  }
});

test("G-C propose_plan (R-5 I-4): a digest that is not 64 lowercase hex characters is not passed on", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    for (const digest of ["", "ABC", "g".repeat(64), "A".repeat(64), `${"a".repeat(64)}\n`]) {
      const planRecorder: PlanRecorder = { savePlan: async () => digest };
      const outcome = await propose(fx, [{ kind: "discard", path: "a.txt" }], { planRecorder });
      assert.equal(outcome.ok, false, JSON.stringify(digest));
      if (!outcome.ok) assert.equal(outcome.code, "io_error");
    }
  } finally {
    await fx.cleanup();
  }
});

test("G-C propose_plan: a cancelled call stores nothing", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const controller = new AbortController();
    controller.abort();
    const { planRecorder, saved } = recorder();
    const outcome = await propose(fx, [{ kind: "discard", path: "a.txt" }], { planRecorder, signal: controller.signal });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "cancelled");
    assert.equal(saved.length, 0);
  } finally {
    await fx.cleanup();
  }
});
