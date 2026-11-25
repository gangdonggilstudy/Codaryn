/**
 * IR-E1 (review E): a state directory `.codaryn`, or its `runs` directory, that is a link (a Windows
 * junction or a POSIX directory symlink) or not a directory is refused before anything is written
 * through it: the lock answers state_dir_not_plain, the journal, the result and the change
 * recorder reject, and the place the link points at stays empty. A plain layout works as before.
 * Junction cases run on Windows; directory symlink cases run elsewhere (on Windows a directory
 * symlink needs administrator rights or developer mode, so those cases are skipped there).
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import type { EngineResult, JournalEvent, RawText, ResolvedPath } from "../../../src/contracts/index.js";
import { acquireLock, createChangeRecorder, createJournal, releaseLock, writeResult } from "../../../src/store/index.js";

const RUN = "20261127T010203Z-0000e1e1";
const clock = { now: () => Date.now() };

type Place = "state" | "runs";
const LINKS = [
  { kind: "junction" as const, skip: process.platform === "win32" ? false : "junctions exist on Windows only" },
  { kind: "dir" as const, skip: process.platform === "win32" ? "a directory symlink needs administrator rights or developer mode on Windows" : false },
];

async function listed(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    out.push(entry.name);
    if (entry.isDirectory()) out.push(...(await listed(join(dir, entry.name))).map((name) => `${entry.name}/${name}`));
  }
  return out;
}

/** base/ws (the workspace) and base/outside; `place` of the state layout is a link to outside. */
async function layout(t: TestContext, place: Place, kind: "junction" | "dir") {
  const base = await realpath(await mkdtemp(join(tmpdir(), "codaryn-ir-e1-")));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const root = join(base, "ws"), outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  if (place === "state") await symlink(outside, join(root, ".codaryn"), kind);
  else {
    await mkdir(join(root, ".codaryn"));
    await symlink(outside, join(root, ".codaryn", "runs"), kind);
  }
  return { root, outside };
}

const result = { schemaVersion: 1, runId: RUN, status: "done", reason: "verified" } as unknown as EngineResult;
const startEvent = { type: "run_started", provider: "scripted" } as unknown as JournalEvent;

for (const link of LINKS) {
  for (const place of ["state", "runs"] as const) {
    const where = place === "state" ? ".codaryn" : ".codaryn/runs";
    test(`IR-E1 (${link.kind} at ${where}): the lock answers state_dir_not_plain and writes nothing there`, { skip: link.skip }, async (t) => {
      const { root, outside } = await layout(t, place, link.kind);
      const lock = await acquireLock({ workspaceRoot: root, runId: RUN, clock });
      if (lock.ok) await releaseLock({ workspaceRoot: root, runId: RUN });
      if (place === "state") assert.deepEqual(lock, { ok: false, code: "state_dir_not_plain", holder: null });
      assert.deepEqual(await listed(outside), [], "nothing was written through the link");
    });

    test(`IR-E1 (${link.kind} at ${where}): the journal, the result and the change recorder reject and write nothing there`, { skip: link.skip }, async (t) => {
      const { root, outside } = await layout(t, place, link.kind);
      const journal = createJournal({ workspaceRoot: root, runId: RUN, clock });
      await assert.rejects(journal.append(startEvent));
      await journal.close().catch(() => undefined);
      await assert.rejects(writeResult(root, result));
      const recorder = createChangeRecorder({ workspaceRoot: root, runId: RUN });
      const path = { absolute: join(root, "a.txt"), relative: "a.txt" } as unknown as ResolvedPath;
      await assert.rejects(recorder.saveOriginal(path, "original\n" as RawText));
      assert.deepEqual(await listed(outside), [], "nothing was written through the link");
    });
  }
}

test("IR-E1: a file named .codaryn is not a state directory: the lock answers state_dir_not_plain", async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "codaryn-ir-e1-")));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await writeFile(join(base, ".codaryn"), "not a directory\n");
  assert.deepEqual(await acquireLock({ workspaceRoot: base, runId: RUN, clock }), { ok: false, code: "state_dir_not_plain", holder: null });
});

test("IR-E1: a plain layout works as before (lock, journal, result, change recorder)", async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "codaryn-ir-e1-")));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const lock = await acquireLock({ workspaceRoot: base, runId: RUN, clock });
  assert.equal(lock.ok, true);
  const journal = createJournal({ workspaceRoot: base, runId: RUN, clock });
  await journal.append(startEvent);
  await journal.close();
  await writeResult(base, result);
  await createChangeRecorder({ workspaceRoot: base, runId: RUN }).saveOriginal({ absolute: join(base, "a.txt"), relative: "a.txt" } as unknown as ResolvedPath, "original\n" as RawText);
  await releaseLock({ workspaceRoot: base, runId: RUN });
  const files = await listed(join(base, ".codaryn"));
  for (const name of [".gitignore", `runs/${RUN}/journal.jsonl`, `runs/${RUN}/result.json`, `runs/${RUN}/snapshots/index.json`]) assert.ok(files.includes(name), name);
});
