/**
 * E1R-1 (review of IR-E1): the state guard's records-changed mark for the run itself goes through
 * the same rule as every other state writer: `.codaryn`, `runs` and the run's directory must be plain
 * (no link anywhere down), or no mark is written and markRecordsChanged rejects as a mark it could not
 * write (the engine then ends the run state_changed, as for any mark failure; unchanged). A static
 * link only: the run's directory already exists behind a junction. Junctions are Windows only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { RECORDS_CHANGED_FILE_NAME } from "../../../src/contracts/index.js";
import type { MaskedText } from "../../../src/contracts/index.js";
import { createApplyRecorders, createRunRecorders } from "../../../src/store/index.js";

const RUN = "20261127T010203Z-0000e1a1";
const PLAN = "20261127T010100Z-0000e1a0";
const clock = { now: () => Date.parse("2026-11-27T01:02:03Z") };
const SKIP = process.platform === "win32" ? false : "junctions exist on Windows only";
const CHANGED = [`runs/${RUN}/journal.jsonl`] as unknown as MaskedText[];

async function listed(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    out.push(entry.name);
    if (entry.isDirectory()) out.push(...(await listed(join(dir, entry.name))).map((name) => `${entry.name}/${name}`));
  }
  return out;
}

/** base/ws and base/outside; the run's directory exists behind a junction at `.codaryn` or `.codaryn/runs`. */
async function layout(t: TestContext, place: "state" | "runs") {
  const base = await realpath(await mkdtemp(join(tmpdir(), "codaryn-e1r1-")));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const root = join(base, "ws"), outside = join(base, "outside");
  await mkdir(root);
  if (place === "state") {
    await mkdir(join(outside, "runs", RUN), { recursive: true });
    await symlink(outside, join(root, ".codaryn"), "junction");
  } else {
    await mkdir(join(outside, RUN), { recursive: true });
    await mkdir(join(root, ".codaryn"));
    await symlink(outside, join(root, ".codaryn", "runs"), "junction");
  }
  return { root, outside, before: await listed(outside) };
}

for (const place of ["state", "runs"] as const) {
  const where = place === "state" ? ".codaryn" : ".codaryn/runs";
  for (const factory of ["run", "apply"] as const) {
    test(`E1R-1 (${factory} recorders, junction at ${where}): no mark for the run itself is written through the link`, { skip: SKIP }, async (t) => {
      const { root, outside, before } = await layout(t, place);
      const recorders = factory === "run"
        ? createRunRecorders({ workspaceRoot: root, runId: RUN, clock })
        : createApplyRecorders({ workspaceRoot: root, runId: RUN, planRunId: PLAN, clock });
      await assert.rejects(recorders.stateGuard.markRecordsChanged(CHANGED), /no records-changed mark could be written/);
      assert.deepEqual(await listed(outside), before, "nothing new behind the link");
    });
  }
}

test("E1R-1: in a plain layout the run's own mark is written as before", async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "codaryn-e1r1-")));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await mkdir(join(base, ".codaryn", "runs", RUN), { recursive: true });
  await createRunRecorders({ workspaceRoot: base, runId: RUN, clock }).stateGuard.markRecordsChanged(CHANGED);
  assert.deepEqual(await listed(join(base, ".codaryn", "runs", RUN)), [RECORDS_CHANGED_FILE_NAME]);
});
