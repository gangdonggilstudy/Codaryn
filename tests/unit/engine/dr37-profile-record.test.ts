/**
 * DR-37 (d): the engine records the applied profile in run_started, only a name of
 * PROFILE_NAME_PATTERN_SOURCE; a run without one records as before.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runTask } from "../../../src/engine/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { finalAnswer, harness } from "./fakes.js";

async function startedWith(profile: string | undefined, secrets: string[] = []) {
  const run = harness({
    steps: [() => finalAnswer()],
    ...(profile === undefined ? {} : { task: { profile } }),
    ...(secrets.length === 0 ? {} : { privacy: createPrivacyGateway({ secrets }) }),
  });
  await runTask(run.deps);
  const [started] = run.journal.ofType("run_started");
  assert.ok(started);
  return started;
}

describe("DR-37 (d): run_started records the applied profile", () => {
  test("a profile name is recorded", async () => {
    assert.equal((await startedWith("safe")).profile, "safe");
  });

  test("no profile: no field, as before", async () => {
    assert.equal(Object.hasOwn(await startedWith(undefined), "profile"), false);
  });

  test("a name holding a registered secret is left out, not recorded as a token", async () => {
    const started = await startedWith("team-zz-secret-value-0001", ["zz-secret-value-0001"]);
    assert.equal(Object.hasOwn(started, "profile"), false);
    assert.equal(JSON.stringify(started).includes("zz-secret-value-0001"), false);
  });

  test("a name outside the pattern is left out", async () => {
    for (const bad of ["", "has space", "-starts-with-hyphen", "x".repeat(65)]) {
      assert.equal(Object.hasOwn(await startedWith(bad), "profile"), false, JSON.stringify(bad));
    }
  });
});
