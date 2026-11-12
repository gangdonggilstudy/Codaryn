/**
 * DR-41 (PM after ff71597): the engine copies what the workflow's rules left out of the given policy
 * (ResolvedTaskSpec.policyNarrowings) into run_started, kinds and counts only, so the run's start
 * can tell the person. Only listed kinds with a positive whole count, each once, in the contract's
 * order; none gives no field, as before.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PolicyNarrowing } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { finalAnswer, harness } from "./fakes.js";

async function startedWith(policyNarrowings: readonly PolicyNarrowing[] | undefined) {
  const run = harness({ steps: [() => finalAnswer()], ...(policyNarrowings === undefined ? {} : { task: { policyNarrowings } }) });
  await runTask(run.deps);
  const [started] = run.journal.ofType("run_started");
  assert.ok(started);
  return started;
}

describe("DR-41: run_started records the policy narrowings", () => {
  test("the narrowings are recorded as given", async () => {
    const narrowings: PolicyNarrowing[] = [
      { kind: "commands_dropped", count: 2 },
      { kind: "restore_path_tokens_off", count: 1 },
    ];
    assert.deepEqual((await startedWith(narrowings)).policyNarrowings, narrowings);
  });

  test("none, or an empty list: no field, as before", async () => {
    assert.equal(Object.hasOwn(await startedWith(undefined), "policyNarrowings"), false);
    assert.equal(Object.hasOwn(await startedWith([]), "policyNarrowings"), false);
  });

  test("only listed kinds with a positive whole count, each once, in the contract's order", async () => {
    const given = [
      { kind: "plan_actions_dropped", count: 1 },
      { kind: "commands_dropped", count: 0 },
      { kind: "not_a_kind", count: 3 },
      { kind: "commands_narrowed", count: 1.5 },
      { kind: "plan_actions_dropped", count: 4 },
      { kind: "commands_dropped", count: 3 },
    ] as unknown as PolicyNarrowing[];
    assert.deepEqual((await startedWith(given)).policyNarrowings, [
      { kind: "commands_dropped", count: 3 },
      { kind: "plan_actions_dropped", count: 1 },
    ]);
  });
});
