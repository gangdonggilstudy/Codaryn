/**
 * U-140 (UXM-18, design gap survey 4): what the task type's own rules left out of the given policy
 * was told only on the run's start line, where it is easy to pass over. RunSummaryContext gains an
 * optional `policyNarrowings`, so the end summary can tell it once more with the start line's texts
 * (`progress.workflow_policy.<kind>`). Only an addition: no JSON field, no message and no pinned
 * value changed, and a context without it is as before.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_IDS, POLICY_NARROWING_KINDS, messageParams, workflowPolicyNarrowings } from "../../../src/contracts/index.js";
import type { MessageId, PolicyConfig, PolicyNarrowing, RunSummaryContext } from "../../../src/contracts/index.js";

const BASE: RunSummaryContext = {
  workspaceForm: "given",
  configDefault: null,
  profileApplied: false,
  deniedToolCalls: 0,
  deniedCommandCalls: 0,
  policySource: "config",
};

describe("U-140: RunSummaryContext.policyNarrowings", () => {
  test("optional: a context without it is as before; with it, the narrowings as run_started records them", () => {
    assert.equal(BASE.policyNarrowings, undefined);
    const narrowings: readonly PolicyNarrowing[] = [
      { kind: "commands_dropped", count: 2 },
      { kind: "restore_path_tokens_off", count: 1 },
    ];
    const withThem: RunSummaryContext = { ...BASE, policyNarrowings: narrowings };
    assert.deepEqual(withThem.policyNarrowings, narrowings);
    const none: RunSummaryContext = { ...BASE, policyNarrowings: [] };
    assert.equal(none.policyNarrowings?.length, 0);
  });

  test("it takes what workflowPolicyNarrowings gives, the list the CLI puts on the resolved task", () => {
    const definition: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] };
    const configured: PolicyConfig = {
      commands: [{ executable: "node", argsPrefix: ["x.mjs"], allowExtraArgs: false }],
      network: "deny",
      destructive: "deny",
      restorePathTokens: true,
    };
    const narrowings = workflowPolicyNarrowings(definition, configured);
    assert.deepEqual(narrowings, [
      { kind: "commands_dropped", count: 1 },
      { kind: "restore_path_tokens_off", count: 1 },
    ]);
    const context: RunSummaryContext = { ...BASE, policyNarrowings: narrowings };
    assert.deepEqual(context.policyNarrowings, narrowings);
  });

  test("every kind has the start line's text the summary reuses, with {count} where the kind has one", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const kind of POLICY_NARROWING_KINDS) {
      const id = `progress.workflow_policy.${kind}`;
      assert.ok(ids.includes(id), id);
      assert.deepEqual(messageParams(id as MessageId), kind === "restore_path_tokens_off" ? {} : { count: "count" }, id);
    }
  });
});
