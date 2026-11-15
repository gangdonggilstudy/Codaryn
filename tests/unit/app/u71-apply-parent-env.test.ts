/**
 * Unit U-71 (adapter design gap survey A-1, DR-4): the parent environment of an apply's commands.
 * DR-4 says a run's commands get the run's environment copy (the variables file loaded into it),
 * never the caller's object or `process.env`; the app layer's assembly keeps it for `startRun`
 * (r1-decisions). For `applyPlan` the app layer hands the CLI's `runApply` its environment copy as
 * `env`, and `runApply` builds the verifiers' command runner with `io.parentEnv ?? io.env`
 * (src/cli/plan-commands.ts), so the same holds; nothing tested it.
 * Here a variables file sets an allow-listed variable with a short value (LANG, shorter than the
 * 8 characters from which a value becomes a secret, S-4), and the apply's command verifier passes
 * only when its process sees that value. With `process.env` as the parent it would not: neither
 * the caller's env nor `process.env` gets the value (both are checked unchanged).
 * Real runs through the app (scripted model), the real store and command runner. Fake values only.
 */

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome } from "../../../src/app/index.js";
import type { ApplyResult } from "../../../src/contracts/index.js";
import { PLAN_TASK, appEnvironment, planSteps, setupRun, taskForm, taskRequest } from "./support.js";

/** Short enough not to be registered as a secret (S-4: from 8 characters), so it reaches the child. */
const LANG_VALUE = "u71ko";

test("U-71 (DR-4): the apply's command verifier gets the variables file's LANG from the run's environment copy", async () => {
  const base = await setupRun({ "a.txt": "alpha\n" }, {
    ...PLAN_TASK,
    verifiers: [{ id: "lang", kind: "command", executable: process.execPath, args: [path.join("..", "check-lang.mjs")], expectExitCode: 0 }],
  }, planSteps());
  // Outside the workspace (base/work); the verifier runs from the workspace root.
  await writeFile(path.join(base, "check-lang.mjs"), `process.exit(process.env.LANG === ${JSON.stringify(LANG_VALUE)} ? 0 : 3);\n`, "utf8");
  const varsFile = path.join(base, "run.vars");
  await writeFile(varsFile, `LANG=${LANG_VALUE}\n`, "utf8");

  const environment = await appEnvironment(base);
  const callerEnv = { ...environment.env };
  const processLang = process.env["LANG"];
  const app = createCodarynApp(environment);

  const planned = await app.startRun(taskRequest(base, { varsFile }));
  assert.ok(planned.ok, JSON.stringify(planned));
  const plan = await planned.handle.done;
  assert.ok(plan.ok && plan.result.plan !== undefined, JSON.stringify(plan));

  const applied = await app.applyPlan({
    settings: taskForm(base, { varsFile }),
    planRunId: plan.result.runId,
    digest: plan.result.plan.digest,
    cancelFile: null,
    unsafeMoveConsent: null,
  });
  assert.ok(applied.ok, JSON.stringify(applied));
  const done = (await applied.handle.done) as AppCallOutcome<ApplyResult>;
  assert.ok(done.ok, JSON.stringify(done));

  const lang = done.output.verifiers.find((verifier) => verifier.id === "lang");
  assert.equal(lang?.outcome, "pass", JSON.stringify(done.output.verifiers));
  assert.deepEqual([done.output.status, done.output.reason], ["done", "verified"]);
  // The value went only into the run's copy.
  assert.deepEqual(environment.env, callerEnv, "the caller's env is not changed");
  assert.equal(process.env["LANG"], processLang, "process.env is not changed");
});
