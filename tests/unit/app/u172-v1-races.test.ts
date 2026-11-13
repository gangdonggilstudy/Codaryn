/**
 * U-172, Codex's verification V-1 (and R-100 L-1): a folder on the path swapped for a junction after
 * the checks. probe-v1.mjs's three cases, through the public app calls:
 * - race-read-junction: after the path's checks and before the bytes are read, `sub` becomes a
 *   junction to a folder outside the workspace; the read must not give that folder's text.
 * - race-write-junction: after the file was opened and judged, before the write reads it again,
 *   `sub` becomes a junction to an outside folder holding the same bytes; the write must not change
 *   the outside file.
 * - race-state-read: as the first, with the junction to a folder in the state directory.
 * And V-1 L-1: a lock release that answers false is a lock left (`lockLeft`).
 * Reproduced first at the engine's file layer, as the probe does (todo until the fix).
 * Temporary folders, junctions (no privilege needed on Windows), fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { CodarynApp, TaskForm } from "../../../src/app/index.js";
import { inspectLock, releaseLock } from "../../../src/store/index.js";
import { nodeFileLayer } from "../../../src/workspace/file-layer.js";
import { appEnvironment, setupRun, taskForm } from "./support.js";

const TODO = { todo: "V-1 H-1 and L-1: the checks are not made again after the path was looked at; a false release is taken as done" };

type Outcome = { readonly ok: boolean; readonly output?: Record<string, unknown>; readonly error?: { readonly code: string } };
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

interface Race {
  readonly base: string;
  readonly work: string;
  readonly form: TaskForm;
  readonly app: CodarynApp;
  readonly swap: (to: string) => Promise<void>;
}

/** A workspace with `sub/a.txt`, an outside folder `outside/a.txt`, and a swap of `sub` for a junction. */
async function race(outsideText: string, extra: Readonly<Record<string, string>> = {}, app?: Parameters<typeof createCodarynApp>[1]): Promise<Race> {
  const base = await setupRun({ "sub/a.txt": "baseline\n", ...extra }, {}, []);
  const work = path.join(base, "work");
  await mkdir(path.join(base, "outside"), { recursive: true });
  await writeFile(path.join(base, "outside", "a.txt"), outsideText);
  const swap = async (to: string): Promise<void> => {
    await rename(path.join(work, "sub"), path.join(work, "sub-old"));
    await symlink(to, path.join(work, "sub"), "junction");
  };
  return { base, work, form: taskForm(base), app: createCodarynApp(await appEnvironment(base), app), swap };
}

const read = async (r: Race, file: string): Promise<Outcome> => (await r.app.readWorkspaceText({ settings: r.form, path: file })) as unknown as Outcome;
const write = async (r: Race, file: string, text: string, baseDigest: string): Promise<Outcome> =>
  (await r.app.writeWorkspaceText({ settings: r.form, path: file, text, baseDigest })) as unknown as Outcome;

/** Runs `body` with the engine file layer's `stat` or `readFile` swapping once on the given hit of `target`. */
async function swappingAt(method: "stat" | "readFile", target: string, hit: number, swap: () => Promise<void>, body: () => Promise<Outcome>): Promise<{ readonly outcome: Outcome; readonly fired: boolean }> {
  const layer = nodeFileLayer as unknown as Record<string, (file: string) => Promise<unknown>>;
  const original = layer[method] as (file: string) => Promise<unknown>;
  let hits = 0;
  let fired = false;
  layer[method] = async (file: string) => {
    if (file.toLowerCase() === target.toLowerCase() && ++hits === hit && !fired) {
      fired = true;
      if (method === "readFile") await swap();
      else {
        const stat = await original(file);
        await swap();
        return stat;
      }
    }
    return original(file);
  };
  try {
    return { outcome: await body(), fired };
  } finally {
    layer[method] = original;
  }
}

describe("U-172 V-1 H-1: a folder swapped for a junction after the checks", () => {
  test("race-read-junction: the outside folder's text is never given", TODO, async () => {
    const r = await race("OUTSIDE-SYNTHETIC\n");
    const { outcome } = await swappingAt("stat", path.join(r.work, "sub", "a.txt"), 1, () => r.swap(path.join(r.base, "outside")), () => read(r, "sub/a.txt"));
    assert.equal(outcome.ok, true);
    assert.notEqual(outcome.output?.["text"], "OUTSIDE-SYNTHETIC\n", JSON.stringify(outcome));
    assert.equal(JSON.stringify(outcome).includes("OUTSIDE-SYNTHETIC"), false);
  });

  test("race-write-junction: the outside file (same bytes) is not written", TODO, async () => {
    const r = await race("baseline\n");
    const { outcome } = await swappingAt("readFile", path.join(r.work, "sub", "a.txt"), 2, () => r.swap(path.join(r.base, "outside")), () => write(r, "sub/a.txt", "WRITTEN-OUTSIDE\n", sha("baseline\n")));
    assert.equal(outcome.ok, true);
    assert.equal(await readFile(path.join(r.base, "outside", "a.txt"), "utf8"), "baseline\n", `outside untouched: ${JSON.stringify(outcome)}`);
    assert.notEqual(outcome.output?.["status"], "written");
  });

  test("race-state-read: the state directory's text is never given", TODO, async () => {
    const r = await race("unused\n", { ".codaryn/hidden/a.txt": "STATE-SYNTHETIC\n" });
    const { outcome } = await swappingAt("stat", path.join(r.work, "sub", "a.txt"), 1, () => r.swap(path.join(r.work, ".codaryn", "hidden")), () => read(r, "sub/a.txt"));
    assert.equal(outcome.ok, true);
    assert.equal(JSON.stringify(outcome).includes("STATE-SYNTHETIC"), false, JSON.stringify(outcome));
  });
});

describe("U-172 V-1 L-1: a release that answers false", () => {
  test("is a lock left (lockLeft), as the store's false means the lock was not taken back", TODO, async () => {
    const r = await race("unused\n", {}, { workspaceText: { releaseLock: async () => false } });
    const before = (await read(r, "sub/a.txt")).output as { digest: string };
    const written = await write(r, "sub/a.txt", "b\n", before.digest);
    assert.deepEqual([written.output?.["status"], written.output?.["lockLeft"]], ["written", true]);
    assert.equal((await inspectLock(r.work)).state, "held", "the lock is still there, as told");
    await releaseLock({ workspaceRoot: r.work, runId: JSON.parse(await readFile(path.join(r.work, ".codaryn", "lock.json"), "utf8")).runId });
  });
});
