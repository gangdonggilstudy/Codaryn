/**
 * G-C: the plan executor (contract plan.ts PlanExecutor, design general-tasks.md 6.4, DR-9).
 * Real files in a temporary workspace. File system failures (no hard links, another volume,
 * a locked source) are simulated by replacing parts of PlanFileOps.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { PlanExecutor, ResolvedPlanAction, Workspace } from "../../../src/contracts/index.js";
import { createPlanExecutor } from "../../../src/tools/index.js";
import type { PlanFileOps } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const never = new AbortController().signal;
const RUN_ID = "20261112T120000Z-0000abcd";

function sha(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

interface Fixture {
  readonly root: string;
  readonly workspace: Workspace;
  cleanup(): Promise<void>;
}

async function fixture(files: Record<string, string>): Promise<Fixture> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gc-exec-"));
  await fs.mkdir(path.join(base, ".codaryn", "runs", RUN_ID), { recursive: true });
  for (const [relative, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(base, relative)), { recursive: true });
    await fs.writeFile(path.join(base, relative), text, "utf8");
  }
  const workspace = await createWorkspace({ root: base });
  return { root: workspace.root, workspace, cleanup: () => fs.rm(base, { recursive: true, force: true }) };
}

function executor(fx: Fixture, fileOps?: Partial<PlanFileOps>): PlanExecutor {
  return createPlanExecutor({
    workspace: fx.workspace,
    workspaceRoot: fx.root,
    runId: RUN_ID,
    ...(fileOps === undefined ? {} : { fileOps }),
  });
}

async function read(root: string, relative: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(root, relative), "utf8");
  } catch {
    return null;
  }
}

const move = (from: string, to: string, text: string): ResolvedPlanAction => ({ kind: "move", from, to, sha256: sha(text) });
const discard = (p: string, text: string): ResolvedPlanAction => ({ kind: "discard", path: p, sha256: sha(text) });

test("G-C executor: a move creates the parents and renames; the content is the same file", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const exec = executor(fx);
    const action = move("a.txt", "2023/q1/a.txt", "alpha");
    assert.equal(await exec.check(action), null);
    const outcome = await exec.apply(action, 0, never);
    assert.deepEqual(outcome, { ok: true, applied: { index: 0, action, stored: null } });
    assert.equal(await read(fx.root, "a.txt"), null);
    assert.equal(await read(fx.root, "2023/q1/a.txt"), "alpha");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: a discard goes to .codaryn/discarded/<runId>/<index>, outside the run directory (DR-9)", async () => {
  const fx = await fixture({ "old/b.txt": "bravo" });
  try {
    const exec = executor(fx);
    const action = discard("old/b.txt", "bravo");
    assert.equal(await exec.check(action), null);
    const outcome = await exec.apply(action, 7, never);
    assert.deepEqual(outcome, { ok: true, applied: { index: 7, action, stored: "7" } });
    assert.equal(await read(fx.root, "old/b.txt"), null);
    assert.equal(await read(fx.root, `.codaryn/discarded/${RUN_ID}/7`), "bravo");
    assert.equal(await read(fx.root, `.codaryn/runs/${RUN_ID}/7`), null);
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: check reports the source and destination problems and changes nothing", async () => {
  const fx = await fixture({ "a.txt": "alpha", "b.txt": "bravo", "taken.txt": "t", "plain.txt": "p" });
  try {
    const exec = executor(fx);
    assert.equal(await exec.check(move("a.txt", "x.txt", "not alpha")), "source_changed");
    assert.equal(await exec.check(discard("gone.txt", "g")), "source_missing");
    assert.equal(await exec.check(move("a.txt", "taken.txt", "alpha")), "destination_exists");
    assert.equal(await exec.check(move("a.txt", "plain.txt/x.txt", "alpha")), "destination_parent_not_dir");
    assert.equal(await exec.check(move("a.txt", "../x.txt", "alpha")), "denied");
    assert.equal(await exec.check(discard(".codaryn/runs", "x")), "denied");
    await fs.mkdir(path.join(fx.root, "dir.txt"));
    assert.equal(await exec.check(discard("dir.txt", "x")), "source_not_file");
    assert.equal(await read(fx.root, "a.txt"), "alpha");
    assert.equal(await read(fx.root, "b.txt"), "bravo");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: a source edited after the check is not applied", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const exec = executor(fx);
    const action = move("a.txt", "b.txt", "alpha");
    assert.equal(await exec.check(action), null);
    await fs.writeFile(path.join(fx.root, "a.txt"), "ALPHA", "utf8"); // same size, new content
    const later = new Date(Date.now() + 5000);
    await fs.utimes(path.join(fx.root, "a.txt"), later, later);
    assert.deepEqual(await exec.apply(action, 0, never), { ok: false, problem: "source_changed" });
    assert.equal(await read(fx.root, "a.txt"), "ALPHA");
    assert.equal(await read(fx.root, "b.txt"), null);
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: apply without a prior check still verifies the source hash", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const exec = executor(fx);
    assert.deepEqual(await exec.apply(move("a.txt", "b.txt", "something else"), 0, never), { ok: false, problem: "source_changed" });
    assert.equal(await read(fx.root, "a.txt"), "alpha");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: a destination that appears after the check is never replaced", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const exec = executor(fx);
    const action = move("a.txt", "b.txt", "alpha");
    assert.equal(await exec.check(action), null);
    await fs.writeFile(path.join(fx.root, "b.txt"), "someone else's", "utf8");
    assert.deepEqual(await exec.apply(action, 0, never), { ok: false, problem: "destination_exists" });
    assert.equal(await read(fx.root, "a.txt"), "alpha");
    assert.equal(await read(fx.root, "b.txt"), "someone else's");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: the link step refuses an existing destination even when the pre-check missed it", async () => {
  const fx = await fixture({ "a.txt": "alpha", "b.txt": "theirs" });
  try {
    // Pretend b.txt does not exist when it is checked (a file created in between).
    const fileOps: Partial<PlanFileOps> = {
      async lstat(target) {
        if (target.endsWith(`${path.sep}b.txt`)) throw errno("ENOENT");
        return fs.lstat(target, { bigint: true });
      },
    };
    const outcome = await executor(fx, fileOps).apply(move("a.txt", "b.txt", "alpha"), 0, never);
    assert.deepEqual(outcome, { ok: false, problem: "destination_exists" });
    assert.equal(await read(fx.root, "a.txt"), "alpha");
    assert.equal(await read(fx.root, "b.txt"), "theirs");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: where hard links are not supported it falls back to a checked rename", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    let renames = 0;
    const fileOps: Partial<PlanFileOps> = {
      link: () => Promise.reject(errno("EPERM")),
      rename: async (from, to) => {
        renames += 1;
        await fs.rename(from, to);
      },
    };
    const outcome = await executor(fx, fileOps).apply(move("a.txt", "b.txt", "alpha"), 0, never);
    assert.equal(outcome.ok, true);
    assert.equal(renames, 1);
    assert.equal(await read(fx.root, "b.txt"), "alpha");
    assert.equal(await read(fx.root, "a.txt"), null);
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: a source that cannot be unlinked is taken back to one name and renamed", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    let refused = false;
    const fileOps: Partial<PlanFileOps> = {
      unlink: async (target) => {
        if (!refused && target.endsWith(`${path.sep}a.txt`)) {
          refused = true;
          throw errno("EPERM");
        }
        await fs.unlink(target);
      },
    };
    const outcome = await executor(fx, fileOps).apply(move("a.txt", "b.txt", "alpha"), 0, never);
    assert.equal(outcome.ok, true);
    assert.equal(await read(fx.root, "a.txt"), null);
    assert.equal(await read(fx.root, "b.txt"), "alpha");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: a move across volumes is cross_device and copies nothing", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const fileOps: Partial<PlanFileOps> = {
      link: () => Promise.reject(errno("EXDEV")),
      rename: () => Promise.reject(errno("EXDEV")),
    };
    assert.deepEqual(await executor(fx, fileOps).apply(move("a.txt", "b.txt", "alpha"), 0, never), {
      ok: false,
      problem: "cross_device",
    });
    assert.equal(await read(fx.root, "a.txt"), "alpha");
    assert.equal(await read(fx.root, "b.txt"), null);
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: an aborted signal ends the item before anything changes", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const controller = new AbortController();
    controller.abort();
    const outcome = await executor(fx).apply(discard("a.txt", "alpha"), 0, controller.signal);
    assert.equal(outcome.ok, false);
    assert.equal(await read(fx.root, "a.txt"), "alpha");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: a discarded directory that is a link is not used", async (t) => {
  const fx = await fixture({ "a.txt": "alpha" });
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gc-outside-"));
  try {
    try {
      await fs.symlink(outside, path.join(fx.root, ".codaryn", "discarded"), "junction");
    } catch {
      t.skip("directory links cannot be created here");
      return;
    }
    assert.deepEqual(await executor(fx).apply(discard("a.txt", "alpha"), 0, never), { ok: false, problem: "io_error" });
    assert.equal(await read(fx.root, "a.txt"), "alpha");
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await fx.cleanup();
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("G-C executor: a source replaced by a link after the plan is not moved", async (t) => {
  const fx = await fixture({ "target.txt": "alpha" });
  try {
    try {
      await fs.symlink(path.join(fx.root, "target.txt"), path.join(fx.root, "a.txt"), "file");
    } catch {
      t.skip("file links cannot be created here (needs a privilege on Windows)");
      return;
    }
    assert.equal(await executor(fx).check(move("a.txt", "b.txt", "alpha")), "source_not_file");
    assert.deepEqual(await executor(fx).apply(move("a.txt", "b.txt", "alpha"), 0, never), { ok: false, problem: "source_not_file" });
    assert.equal(await read(fx.root, "target.txt"), "alpha");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: a source name reported as a link is not moved (simulated link)", async () => {
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
    const exec = executor(fx, fileOps);
    assert.equal(await exec.check(move("a.txt", "b.txt", "alpha")), "source_not_file");
    assert.deepEqual(await exec.apply(move("a.txt", "b.txt", "alpha"), 0, never), { ok: false, problem: "source_not_file" });
    assert.equal(await read(fx.root, "a.txt"), "alpha");
    assert.equal(await read(fx.root, "b.txt"), null);
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor: a bad run id or a root that is not the workspace's is refused at creation", async () => {
  const fx = await fixture({});
  try {
    assert.throws(() => createPlanExecutor({ workspace: fx.workspace, workspaceRoot: fx.root, runId: "../x" }));
    assert.throws(() => createPlanExecutor({ workspace: fx.workspace, workspaceRoot: fx.root, runId: "a..b" }));
    assert.throws(() => createPlanExecutor({ workspace: fx.workspace, workspaceRoot: path.join(fx.root, "x"), runId: RUN_ID }));
  } finally {
    await fx.cleanup();
  }
});
