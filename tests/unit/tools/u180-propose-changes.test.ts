/**
 * U-180 (DR-69 B-1, B-3, B-5): the `propose_changes` tool. It checks a `run` plan's files
 * (CHANGES_PLAN_PROBLEMS), hashes every `modify` file itself, and stores plan.json through
 * PlanRecorder.saveChangesPlan: each path and the summary as this run's gateway masks them, as visible
 * parts (no token, no secret value). It changes no workspace file. Without a recorder that can store
 * a `run` plan, or when a text cannot be masked, nothing is stored.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { MAX_PLANNED_FILES } from "../../../src/contracts/index.js";
import type { PlannedFileArgs, PlanRecorder, RawWorkflowToolOutcome, StoredPlannedFile, Workspace } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { FAKE_SECRET_A, createFakePrivacy } from "./doubles.js";
import type { FakePrivacy } from "./doubles.js";

const never = new AbortController().signal;
const sha = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

interface Fixture {
  readonly root: string;
  readonly workspace: Workspace;
  cleanup(): Promise<void>;
}

async function fixture(files: Record<string, string>, dirs: readonly string[] = []): Promise<Fixture> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-u180t-"));
  for (const dir of dirs) await fs.mkdir(path.join(base, dir), { recursive: true });
  for (const [relative, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(base, relative)), { recursive: true });
    await fs.writeFile(path.join(base, relative), text, "utf8");
  }
  const workspace = await createWorkspace({ root: base });
  return { root: workspace.root, workspace, cleanup: () => fs.rm(base, { recursive: true, force: true }) };
}

interface Saved {
  readonly summary: readonly string[];
  readonly files: readonly StoredPlannedFile[];
}

function recorder(digest: (saved: Saved) => string = (saved) => sha(JSON.stringify(saved))): { planRecorder: PlanRecorder; saved: Saved[] } {
  const saved: Saved[] = [];
  const planRecorder: PlanRecorder = {
    savePlan: async () => {
      throw new Error("not this kind of plan");
    },
    saveChangesPlan: async (plan) => {
      const one = { summary: [...plan.summary], files: [...plan.files] };
      saved.push(one);
      return digest(one);
    },
  };
  return { planRecorder, saved };
}

async function propose(
  fx: Fixture,
  files: readonly PlannedFileArgs[],
  options: { planRecorder?: PlanRecorder; summary?: string; privacy?: FakePrivacy; signal?: AbortSignal } = {},
): Promise<RawWorkflowToolOutcome> {
  const runner = createToolRunner({
    workspace: fx.workspace,
    privacy: options.privacy ?? createFakePrivacy(),
    ...(options.planRecorder === undefined ? {} : { planRecorder: options.planRecorder }),
  });
  assert.ok(runner.executeWorkflowTool !== undefined);
  return runner.executeWorkflowTool({ id: "c1", name: "propose_changes", args: { summary: options.summary ?? "rewrite the guide", files } }, options.signal ?? never);
}

function rejected(outcome: RawWorkflowToolOutcome, index: number | null, problem: string): void {
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (outcome.ok) return;
  assert.equal(outcome.code, "invalid_plan");
  assert.equal(outcome.message, index === null ? `plan rejected: ${problem}` : `plan rejected: file ${index}: ${problem}`);
}

async function listing(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const child of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, child.name);
      out.push(`${path.relative(root, absolute).split(path.sep).join("/")}:${child.isFile() ? sha(await fs.readFile(absolute, "utf8")) : "dir"}`);
      if (child.isDirectory()) await visit(absolute);
    }
  }
  await visit(root);
  return out.sort();
}

test("U-180 propose_changes: stores the files with the modify hashes and the masked summary; no workspace file changes", async () => {
  const fx = await fixture({ "docs/guide.md": "guide", "src/a.ts": "a" });
  try {
    const before = await listing(fx.root);
    const { planRecorder, saved } = recorder();
    const outcome = await propose(
      fx,
      [
        { path: "docs\\guide.md", change: "modify" },
        { path: "docs/new/intro.md", change: "create" },
      ],
      { planRecorder, summary: `rewrite the guide, keep ${FAKE_SECRET_A} out` },
    );
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok || !("files" in outcome.payload)) return;
    assert.deepEqual(outcome.payload.files, [
      { path: "docs/guide.md", change: "modify", sha256: sha("guide") },
      { path: "docs/new/intro.md", change: "create", sha256: null },
    ]);
    assert.equal(saved.length, 1);
    const stored = saved[0] as Saved;
    assert.deepEqual(stored.summary, ["rewrite the guide, keep ", " out"], "the secret is masked and its token left out");
    assert.deepEqual(stored.files, [
      { path: "docs/guide.md", change: "modify", sha256: sha("guide"), shown: ["docs/guide.md"] },
      { path: "docs/new/intro.md", change: "create", sha256: null, shown: ["docs/new/intro.md"] },
    ]);
    assert.equal(outcome.payload.digest, sha(JSON.stringify(stored)));
    assert.deepEqual(await listing(fx.root), before, "nothing in the workspace changed");
  } finally {
    await fx.cleanup();
  }
});

test("U-180 propose_changes: a path holding a secret is stored with the secret's visible parts only", async () => {
  const fx = await fixture({ [`docs/${FAKE_SECRET_A}.md`]: "x" });
  try {
    const { planRecorder, saved } = recorder();
    const outcome = await propose(fx, [{ path: `docs/${FAKE_SECRET_A}.md`, change: "modify" }], { planRecorder });
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.deepEqual((saved[0] as Saved).files[0]?.shown, ["docs/", ".md"]);
  } finally {
    await fx.cleanup();
  }
});

test("U-180 propose_changes: the problems, each by the first file that has it", async () => {
  const fx = await fixture({ "a.md": "a", "dir/b.md": "b", "file.txt": "f" }, ["folder"]);
  try {
    const { planRecorder, saved } = recorder();
    const check = (files: readonly PlannedFileArgs[]) => propose(fx, files, { planRecorder });
    rejected(await check([]), null, "empty");
    rejected(await check(Array.from({ length: MAX_PLANNED_FILES + 1 }, (_, i) => ({ path: `n${i}.md`, change: "create" as const }))), null, "too_many");
    rejected(await check([{ path: "a.md", change: "modify" }, { path: "./a.md", change: "modify" }]), 1, "duplicate_path");
    rejected(await check([{ path: "missing.md", change: "modify" }]), 0, "file_missing");
    rejected(await check([{ path: "a.md", change: "create" }]), 0, "file_exists");
    rejected(await check([{ path: "folder", change: "modify" }]), 0, "not_file");
    rejected(await check([{ path: "file.txt/inner.md", change: "create" }]), 0, "parent_not_dir");
    rejected(await check([{ path: "new.md", change: "create" }, { path: "new.md/inner.md", change: "create" }]), 1, "parent_not_dir");
    if (process.platform === "win32") rejected(await check([{ path: "a.md", change: "modify" }, { path: "A.MD", change: "modify" }]), 1, "duplicate_path");
    assert.equal(saved.length, 0, "nothing was stored");
  } finally {
    await fx.cleanup();
  }
});

test("U-180 propose_changes: a path outside the workspace or in the state directory is refused as the workspace refuses it", async () => {
  const fx = await fixture({ "a.md": "a" });
  try {
    const { planRecorder, saved } = recorder();
    for (const where of ["../out.md", ".codaryn/x.md"]) {
      const outcome = await propose(fx, [{ path: where, change: "create" }], { planRecorder });
      assert.equal(outcome.ok, false, where);
      if (!outcome.ok) assert.equal(outcome.code, "policy_denied", where);
    }
    assert.equal(saved.length, 0);
  } finally {
    await fx.cleanup();
  }
});

test("U-180 propose_changes: without a recorder that can store a run plan, nothing is stored", async () => {
  const fx = await fixture({ "a.md": "a" });
  try {
    for (const planRecorder of [undefined, { savePlan: async () => sha("x") } satisfies PlanRecorder]) {
      const outcome = await propose(fx, [{ path: "a.md", change: "modify" }], planRecorder === undefined ? {} : { planRecorder });
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.equal(outcome.code, "io_error");
    }
  } finally {
    await fx.cleanup();
  }
});

test("U-180 propose_changes: a store that fails, or returns no valid digest, leaves no plan to approve", async () => {
  const fx = await fixture({ "a.md": "a" });
  try {
    const failing: PlanRecorder = {
      savePlan: async () => sha("x"),
      saveChangesPlan: async () => {
        throw new Error("recorder-detail-must-not-leak a.md");
      },
    };
    const failed = await propose(fx, [{ path: "a.md", change: "modify" }], { planRecorder: failing });
    assert.equal(failed.ok, false);
    if (!failed.ok) {
      assert.equal(failed.code, "io_error");
      assert.doesNotMatch(failed.message, /must-not-leak|a\.md/);
    }
    const { planRecorder } = recorder(() => "not-a-digest");
    const invalid = await propose(fx, [{ path: "a.md", change: "modify" }], { planRecorder });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.code, "io_error");
  } finally {
    await fx.cleanup();
  }
});

test("U-180 propose_changes: masking that fails stores nothing; a cancel before the store stores nothing", async () => {
  const fx = await fixture({ "a.md": "a" });
  try {
    const { planRecorder, saved } = recorder();
    const privacy = createFakePrivacy();
    privacy.failMask = true;
    const masked = await propose(fx, [{ path: "a.md", change: "modify" }], { planRecorder, privacy });
    assert.equal(masked.ok, false);
    if (!masked.ok) assert.equal(masked.code, "io_error");
    const controller = new AbortController();
    controller.abort();
    const cancelled = await propose(fx, [{ path: "a.md", change: "modify" }], { planRecorder, signal: controller.signal });
    assert.equal(cancelled.ok, false);
    if (!cancelled.ok) assert.equal(cancelled.code, "cancelled");
    assert.equal(saved.length, 0);
  } finally {
    await fx.cleanup();
  }
});
