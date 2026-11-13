/**
 * U-172, Codex's verification V-1 (and R-100 L-1): a folder on the path swapped for a junction after
 * the checks. probe-v1.mjs's three cases, through the public app calls:
 * - race-read-junction: after the path's checks and before the bytes are read, `sub` becomes a
 *   junction to a folder outside the workspace; the read must not give that folder's text.
 * - race-write-junction: after the file was opened and judged, before the write, `sub` becomes a
 *   junction to an outside folder holding the same bytes; the write must not change the outside file.
 * - race-state-read: as the first, with the junction to a folder in the state directory.
 * And V-1 L-1: a lock release that answers false is a lock left (`lockLeft`).
 * Reproduced first (cc77a09, at the engine's file layer, as the probe does: 4 of 4 failed on
 * 3616c5b). The fix reads and writes through its own checked steps, so the swaps are made at each
 * of its pauses (WorkspaceTextStage); every test checks the swap did happen.
 * The last case is the gap that cannot be closed (no rename by folder handle in Node): a swap in the
 * instant before the rename, with the temporary file moved too, lands the rename outside; the write
 * says so (`path_changed`).
 * Temporary folders, junctions (no privilege needed on Windows), fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rmdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { CodarynApp, TaskForm, WorkspaceTextStage } from "../../../src/app/index.js";
import { inspectLock, releaseLock } from "../../../src/store/index.js";
import { appEnvironment, exists, setupRun, taskForm } from "./support.js";

type Outcome = { readonly ok: boolean; readonly output?: Record<string, unknown>; readonly error?: { readonly code: string } };
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

interface Race {
  readonly base: string;
  readonly work: string;
  readonly form: TaskForm;
  readonly app: CodarynApp;
  /** Whether the stage came (the swap was tried). */
  readonly fired: () => boolean;
  /**
   * Whether the swap was made. On Windows a folder holding an open file cannot be renamed, so at
   * `opened` (the file's handle open) the swap fails there and the call stops (`unreadable`).
   */
  readonly swapped: () => boolean;
}

/**
 * A workspace with `sub/a.txt` and an outside folder `outside/a.txt`; at `stage` (the first time it
 * comes) `sub` is renamed `sub-old` and a junction `sub` → `to(base, work)` takes its place, after
 * `before(work)` when given. With `undoAt`, that later stage takes the junction away and puts `sub`
 * back (a swap undone before the next check).
 */
async function race(
  outsideText: string,
  stage: WorkspaceTextStage,
  to: (base: string, work: string) => string,
  options: { readonly extra?: Readonly<Record<string, string>>; readonly before?: (work: string, base: string) => Promise<void>; readonly undoAt?: WorkspaceTextStage } = {},
): Promise<Race> {
  const base = await setupRun({ "sub/a.txt": "baseline\n", ...(options.extra ?? {}) }, {}, []);
  const work = path.join(base, "work");
  await mkdir(path.join(base, "outside"), { recursive: true });
  await writeFile(path.join(base, "outside", "a.txt"), outsideText);
  let fired = false;
  let swapped = false;
  let undone = false;
  const pause = async (at: WorkspaceTextStage): Promise<void> => {
    if (swapped && !undone && at === options.undoAt) {
      undone = true;
      await rmdir(path.join(work, "sub"));
      await rename(path.join(work, "sub-old"), path.join(work, "sub"));
      return;
    }
    if (at !== stage || fired) return;
    fired = true;
    await options.before?.(work, base);
    await rename(path.join(work, "sub"), path.join(work, "sub-old"));
    await symlink(to(base, work), path.join(work, "sub"), "junction");
    swapped = true;
  };
  const app = createCodarynApp(await appEnvironment(base), { workspaceText: { pause } });
  return { base, work, form: taskForm(base), app, fired: () => fired, swapped: () => swapped };
}

/** At `opened` the swap is made (POSIX: the second walk refuses) or cannot be (Windows: the open file holds the folder). */
function expectedAt(stage: WorkspaceTextStage, r: Race): string {
  if (stage !== "opened") {
    assert.equal(r.swapped(), true, `${stage}: the swap was made`);
    return "refused";
  }
  return r.swapped() ? "refused" : "unreadable";
}

const outside = (base: string): string => path.join(base, "outside");
const read = async (r: Race, file: string): Promise<Outcome> => (await r.app.readWorkspaceText({ settings: r.form, path: file })) as unknown as Outcome;
const write = async (r: Race, file: string, text: string, baseDigest: string): Promise<Outcome> =>
  (await r.app.writeWorkspaceText({ settings: r.form, path: file, text, baseDigest })) as unknown as Outcome;
const temporaries = async (dir: string): Promise<string[]> => (await readdir(dir)).filter((name) => name.endsWith(".codaryn-tmp"));

describe("U-172 V-1 H-1: a folder swapped for a junction after the checks", () => {
  // The second walk's case: a swap between the first walk's folders and its file makes that lstat
  // see through the junction (the outside file, whose handle then has the same identity).
  test("swapped in the middle of the first walk: the second walk refuses", async () => {
    const r = await race("OUTSIDE-SYNTHETIC\n", "walking", outside);
    const outcome = await read(r, "sub/a.txt");
    assert.equal(r.swapped(), true);
    assert.equal(outcome.output?.["status"], "refused", JSON.stringify(outcome));
    assert.equal(JSON.stringify(outcome).includes("OUTSIDE-SYNTHETIC"), false);
  });

  // The handle's case: swapped before the open, put back before the second walk (every folder and
  // the file are the walked ones again); only the open handle's identity tells it is another file.
  test("swapped before the open and put back before the second walk: the handle's identity refuses", async () => {
    const r = await race("OUTSIDE-SYNTHETIC\n", "checked", outside, { undoAt: "opened" });
    const outcome = await read(r, "sub/a.txt");
    assert.equal(r.swapped(), true);
    assert.equal(outcome.output?.["status"], "refused", JSON.stringify(outcome));
    assert.equal(JSON.stringify(outcome).includes("OUTSIDE-SYNTHETIC"), false);
  });

  test("race-read-junction: swapped after the walk (before the open), or after the open: refused, never the outside text", async () => {
    for (const stage of ["checked", "opened"] as const) {
      const r = await race("OUTSIDE-SYNTHETIC\n", stage, outside);
      const outcome = await read(r, "sub/a.txt");
      assert.equal(r.fired(), true, `${stage}: the swap was made`);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.output?.["status"], expectedAt(stage, r), `${stage}: ${JSON.stringify(outcome)}`);
      assert.equal(JSON.stringify(outcome).includes("OUTSIDE-SYNTHETIC"), false, stage);
    }
  });

  test("race-write-junction: swapped after opening and judging: refused, the outside file (same bytes) and the moved one stay", async () => {
    for (const stage of ["checked", "opened", "judged", "before_temp"] as const) {
      const r = await race("baseline\n", stage, outside);
      const outcome = await write(r, "sub/a.txt", "WRITTEN-OUTSIDE\n", sha("baseline\n"));
      assert.equal(r.fired(), true, `${stage}: the swap was made`);
      assert.equal(outcome.output?.["status"], expectedAt(stage, r), `${stage}: ${JSON.stringify(outcome)}`);
      assert.equal(outcome.output?.["lockLeft"], false);
      // The file's own folder: moved to sub-old by the swap, or still sub where the swap could not be made.
      const own = path.join(r.work, r.swapped() ? "sub-old" : "sub");
      assert.equal(await readFile(path.join(r.base, "outside", "a.txt"), "utf8"), "baseline\n", `${stage}: outside untouched`);
      assert.equal(await readFile(path.join(own, "a.txt"), "utf8"), "baseline\n", `${stage}: the file untouched`);
      assert.deepEqual(await temporaries(outside(r.base)), [], `${stage}: no temporary file outside`);
      assert.deepEqual(await temporaries(own), [], `${stage}: no temporary file left`);
    }
  });

  test("race-state-read: a junction to the state directory: refused, never its text", async () => {
    for (const stage of ["checked", "opened"] as const) {
      const r = await race("unused\n", stage, (_base, work) => path.join(work, ".codaryn", "hidden"), { extra: { ".codaryn/hidden/a.txt": "STATE-SYNTHETIC\n" } });
      const outcome = await read(r, "sub/a.txt");
      assert.equal(r.fired(), true, `${stage}: the swap was made`);
      assert.equal(outcome.output?.["status"], expectedAt(stage, r), `${stage}: ${JSON.stringify(outcome)}`);
      assert.equal(JSON.stringify(outcome).includes("STATE-SYNTHETIC"), false, stage);
    }
  });

  test("swapped after the last check, before the rename: the rename finds no temporary file there (write_failed); the outside file stays", async () => {
    const r = await race("baseline\n", "before_rename", outside);
    const outcome = await write(r, "sub/a.txt", "WRITTEN-OUTSIDE\n", sha("baseline\n"));
    assert.equal(r.fired(), true);
    assert.equal(outcome.output?.["status"], "write_failed", JSON.stringify(outcome));
    assert.equal(await readFile(path.join(r.base, "outside", "a.txt"), "utf8"), "baseline\n");
    assert.equal(await readFile(path.join(r.work, "sub-old", "a.txt"), "utf8"), "baseline\n");
  });

  // The gap that stays: Node renames by path only. Someone who, in the instant before the rename,
  // moves the temporary file into another folder and points the junction there makes the rename
  // replace that folder's file. The check right after the rename sees it: path_changed, told.
  test("the gap that stays: the temporary file moved too, the rename lands outside; the write says path_changed", async () => {
    const r = await race("baseline\n", "before_rename", outside, {
      before: async (work, base) => {
        for (const name of await temporaries(path.join(work, "sub"))) await rename(path.join(work, "sub", name), path.join(base, "outside", name));
      },
    });
    const outcome = await write(r, "sub/a.txt", "WRITTEN-OUTSIDE\n", sha("baseline\n"));
    assert.equal(r.fired(), true);
    assert.deepEqual([outcome.output?.["status"], outcome.output?.["digest"]], ["path_changed", null], JSON.stringify(outcome));
    assert.equal(await readFile(path.join(r.base, "outside", "a.txt"), "utf8"), "WRITTEN-OUTSIDE\n", "where the text went: the gap, told");
    assert.equal(await readFile(path.join(r.work, "sub-old", "a.txt"), "utf8"), "baseline\n");
  });

  test("without a swap the same pauses change nothing: read opened, write written", async () => {
    const base = await setupRun({ "sub/a.txt": "baseline\n" }, {}, []);
    const stages: string[] = [];
    const app = createCodarynApp(await appEnvironment(base), { workspaceText: { pause: async (stage) => void stages.push(stage) } });
    const opened = (await app.readWorkspaceText({ settings: taskForm(base), path: "sub/a.txt" })) as unknown as Outcome;
    assert.equal(opened.output?.["status"], "opened");
    const written = (await app.writeWorkspaceText({ settings: taskForm(base), path: "sub/a.txt", text: "next\n", baseDigest: String(opened.output?.["digest"]) })) as unknown as Outcome;
    assert.deepEqual([written.output?.["status"], written.output?.["digest"]], ["written", sha("next\n")]);
    assert.deepEqual(stages, ["walking", "checked", "opened", "walking", "checked", "opened", "judged", "before_temp", "before_rename"]);
    assert.equal(await exists(path.join(base, "work", ".codaryn", "lock.json")), false);
  });
});

describe("U-172 V-1 L-1: a release that answers false", () => {
  test("is a lock left (lockLeft), as the store's false means the lock was not taken back", async () => {
    const base = await setupRun({ "sub/a.txt": "baseline\n" }, {}, []);
    const work = path.join(base, "work");
    const app = createCodarynApp(await appEnvironment(base), { workspaceText: { releaseLock: async () => false } });
    const before = (await app.readWorkspaceText({ settings: taskForm(base), path: "sub/a.txt" })) as unknown as Outcome;
    const written = (await app.writeWorkspaceText({ settings: taskForm(base), path: "sub/a.txt", text: "b\n", baseDigest: String(before.output?.["digest"]) })) as unknown as Outcome;
    assert.deepEqual([written.output?.["status"], written.output?.["lockLeft"]], ["written", true]);
    assert.equal((await inspectLock(work)).state, "held", "the lock is still there, as told");
    await releaseLock({ workspaceRoot: work, runId: JSON.parse(await readFile(path.join(work, ".codaryn", "lock.json"), "utf8")).runId });
  });
});
