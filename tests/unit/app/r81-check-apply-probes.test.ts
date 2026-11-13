/**
 * Review R-81 L1 of U-91 (`checkApply`): a check or an apply whose process ended between making a
 * hard link probe and removing it left a second name of a person's file in the state directory,
 * and no later answer removed or told it; a probe one check reported left (`probesLeft`) was
 * skipped by the next check as already there. Now each check, under the workspace lock (so no live
 * check or apply is probing this workspace), removes every probe name it finds in the state
 * directory and in the plan's source folders before it checks, and tells how many it removed
 * (`probesRemoved`) and how many it could not (in `probesLeft`).
 * Reproduced first (3ac88e1, todo until fixed). Scripted model, temporary folders, fake values only. Every
 * probe a test leaves is taken back by the test.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { link, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, AppHooks, PlanCheck } from "../../../src/app/index.js";
import { appEnvironment, plannedRun, taskForm } from "./support.js";

type Check = PlanCheck;

function ok(outcome: AppCallOutcome<PlanCheck>): Check {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: PlanCheck }).output as Check;
}

/** A probe name as tools' probeHardLink makes it, of a process that is gone. */
const LEFT_NAME = ".codaryn-link-probe-99999999-kz1abc-x1y2z3w4";

async function probes(work: string): Promise<string[]> {
  const found: string[] = [];
  for (const dir of [path.join(work, ".codaryn"), work]) {
    for (const name of await readdir(dir).catch(() => [] as string[])) if (name.startsWith(".codaryn-link-probe-")) found.push(path.join(dir, name));
  }
  return found;
}

describe("R-81 L1: a probe an earlier check or apply left is removed by the next check, and told", () => {
  test("a probe in the state directory from a process that ended: removed, probesRemoved 1, the file kept", async () => {
    const { base, app, plan, digest } = await plannedRun();
    const work = path.join(base, "work");
    await link(path.join(work, "a.txt"), path.join(work, ".codaryn", LEFT_NAME));
    try {
      const checked = ok(await app.checkApply({ settings: taskForm(base), planRunId: plan.runId, digest }));
      assert.deepEqual([checked.probesRemoved, checked.probesLeft], [1, 0]);
      assert.deepEqual(await probes(work), []);
      assert.equal(await readFile(path.join(work, "a.txt"), "utf8"), "alpha\n", "the person's file is as it was");
    } finally {
      for (const probe of await probes(work)) await rm(probe);
    }
  });

  test("one that cannot be removed is told in probesLeft; a later check removes it", async () => {
    const { base, app, plan, digest } = await plannedRun();
    const work = path.join(base, "work");
    await link(path.join(work, "a.txt"), path.join(work, ".codaryn", LEFT_NAME));
    const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
    const failing = createCodarynApp(await appEnvironment(base), { applyCheck: { removeProbe: async () => Promise.reject(busy) } } as AppHooks);
    try {
      const first = ok(await failing.checkApply({ settings: taskForm(base), planRunId: plan.runId, digest }));
      assert.deepEqual([first.probesRemoved, first.probesLeft], [0, 1]);
      assert.equal(existsSync(path.join(work, ".codaryn", LEFT_NAME)), true);
      const second = ok(await app.checkApply({ settings: taskForm(base), planRunId: plan.runId, digest }));
      assert.deepEqual([second.probesRemoved, second.probesLeft], [1, 0], "the name told before is not skipped as already there");
      assert.deepEqual(await probes(work), []);
    } finally {
      for (const probe of await probes(work)) await rm(probe);
    }
  });
});
