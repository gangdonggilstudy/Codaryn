/**
 * G-C, DR-21: the plan executor's consent path for unsafe moves (contract plan.ts PlanExecutor,
 * UnsafeMoveConsent). Without `allowUnsafeMove` a move that could replace a file is not done
 * (DR-18 b, kept). With it the executor checks that the destination is still absent, renames,
 * and marks the outcome `unsafe: true`. Volumes without hard links, another volume and a source
 * that cannot be unlinked are simulated by replacing parts of PlanFileOps.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { PlanExecutor, ResolvedPlanAction, Workspace } from "../../../src/contracts/index.js";
import { HARD_LINK_UNAVAILABLE_PROBLEM, createPlanExecutor, discardedRootOf } from "../../../src/tools/index.js";
import type { PlanFileOps } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const never = new AbortController().signal;
const RUN_ID = "20261112T130000Z-0000cdef";
const CONSENT = { allowUnsafeMove: true } as const;

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
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gc-unsafe-"));
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

async function read(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

const move = (from: string, to: string, text: string): ResolvedPlanAction => ({ kind: "move", from, to, sha256: sha(text) });
const discard = (p: string, text: string): ResolvedPlanAction => ({ kind: "discard", path: p, sha256: sha(text) });

/** A volume without hard links: every link is refused with ENOTSUP. Renames are counted. */
function noHardLinks(counter: { renames: number }): Partial<PlanFileOps> {
  return {
    link: () => Promise.reject(errno("ENOTSUP")),
    rename: async (from, to) => {
      counter.renames += 1;
      await fs.rename(from, to);
    },
  };
}

test("G-C executor (DR-21): without consent an unsafe move is not done, also with allowUnsafeMove false", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const counter = { renames: 0 };
    const action = move("a.txt", "b.txt", "alpha");
    const run = executor(fx, noHardLinks(counter));
    assert.equal(await run.check(action), HARD_LINK_UNAVAILABLE_PROBLEM, "the check finds the risk ahead");
    assert.deepEqual(await run.apply(action, 0, never), { ok: false, problem: "unsafe_move" });
    assert.deepEqual(await run.apply(action, 0, never, { allowUnsafeMove: false }), { ok: false, problem: "unsafe_move" });
    assert.equal(counter.renames, 0);
    assert.equal(await read(path.join(fx.root, "a.txt")), "alpha");
    assert.equal(await read(path.join(fx.root, "b.txt")), null);
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor (DR-21): with consent a move without hard links is renamed after the destination check and marked unsafe", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const counter = { renames: 0 };
    const action = move("a.txt", "sub/b.txt", "alpha");
    const outcome = await executor(fx, noHardLinks(counter)).apply(action, 3, never, CONSENT);
    assert.deepEqual(outcome, { ok: true, applied: { index: 3, action, stored: null, unsafe: true } });
    assert.equal(counter.renames, 1);
    assert.equal(await read(path.join(fx.root, "a.txt")), null);
    assert.equal(await read(path.join(fx.root, "sub", "b.txt")), "alpha");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor (DR-21): with consent a discard without hard links goes to the discarded directory, marked unsafe", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const counter = { renames: 0 };
    const action = discard("a.txt", "alpha");
    const outcome = await executor(fx, noHardLinks(counter)).apply(action, 2, never, CONSENT);
    assert.deepEqual(outcome, { ok: true, applied: { index: 2, action, stored: "2", unsafe: true } });
    assert.equal(await read(path.join(fx.root, "a.txt")), null);
    assert.equal(await read(path.join(discardedRootOf(fx.root, RUN_ID), "2")), "alpha");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor (DR-21): with consent a destination that appears before the rename is not replaced", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    let renames = 0;
    const fileOps: Partial<PlanFileOps> = {
      // The destination is created between the executor's first look and the move.
      async link(_existing, created) {
        await fs.writeFile(created, "created in the window", "utf8");
        throw errno("ENOTSUP");
      },
      rename: async (from, to) => {
        renames += 1;
        await fs.rename(from, to);
      },
    };
    const outcome = await executor(fx, fileOps).apply(move("a.txt", "b.txt", "alpha"), 0, never, CONSENT);
    assert.deepEqual(outcome, { ok: false, problem: "destination_exists" });
    assert.equal(renames, 0, "no rename once the destination exists");
    assert.equal(await read(path.join(fx.root, "a.txt")), "alpha");
    assert.equal(await read(path.join(fx.root, "b.txt")), "created in the window");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor (DR-21): consent does not change a move where hard links work; it is not marked unsafe", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    let renames = 0;
    const action = move("a.txt", "b.txt", "alpha");
    const outcome = await executor(fx, {
      rename: async (from, to) => {
        renames += 1;
        await fs.rename(from, to);
      },
    }).apply(action, 0, never, CONSENT);
    assert.deepEqual(outcome, { ok: true, applied: { index: 0, action, stored: null } });
    assert.equal(renames, 0, "the exclusive link and unlink move was used");
    assert.equal(await read(path.join(fx.root, "b.txt")), "alpha");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor (DR-21): with consent a rename across volumes is cross_device and moves nothing", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    const fileOps: Partial<PlanFileOps> = {
      link: () => Promise.reject(errno("ENOTSUP")),
      rename: () => Promise.reject(errno("EXDEV")),
    };
    assert.deepEqual(await executor(fx, fileOps).apply(move("a.txt", "b.txt", "alpha"), 0, never, CONSENT), {
      ok: false,
      problem: "cross_device",
    });
    assert.equal(await read(path.join(fx.root, "a.txt")), "alpha");
    assert.equal(await read(path.join(fx.root, "b.txt")), null);
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor (DR-21): with consent a source that cannot be unlinked is moved by rename and marked unsafe", async () => {
  const fx = await fixture({ "a.txt": "alpha" });
  try {
    let refused = false;
    const counter = { renames: 0 };
    const fileOps: Partial<PlanFileOps> = {
      unlink: async (target) => {
        if (!refused && target.endsWith(`${path.sep}a.txt`)) {
          refused = true;
          throw errno("EPERM");
        }
        await fs.unlink(target);
      },
      rename: async (from, to) => {
        counter.renames += 1;
        await fs.rename(from, to);
      },
    };
    const action = move("a.txt", "b.txt", "alpha");
    const outcome = await executor(fx, fileOps).apply(action, 0, never, CONSENT);
    assert.deepEqual(outcome, { ok: true, applied: { index: 0, action, stored: null, unsafe: true } });
    assert.equal(counter.renames, 1);
    assert.equal(await read(path.join(fx.root, "a.txt")), null);
    assert.equal(await read(path.join(fx.root, "b.txt")), "alpha");
  } finally {
    await fx.cleanup();
  }
});

test("G-C executor (DR-21): with consent a source changed since the plan is still refused", async () => {
  const fx = await fixture({ "a.txt": "edited" });
  try {
    const counter = { renames: 0 };
    assert.deepEqual(await executor(fx, noHardLinks(counter)).apply(move("a.txt", "b.txt", "alpha"), 0, never, CONSENT), {
      ok: false,
      problem: "source_changed",
    });
    assert.equal(counter.renames, 0);
    assert.equal(await read(path.join(fx.root, "a.txt")), "edited");
  } finally {
    await fx.cleanup();
  }
});
