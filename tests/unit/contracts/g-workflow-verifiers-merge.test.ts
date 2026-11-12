/**
 * DR-43 (a), R-31 L-2: a given list of verifiers (the profile's or the config's in the quick form, a
 * task file's own when it names a workflow) is added to a workflow definition's own checks instead
 * of replacing them. "today" is the rule before DR-43, `given ?? definition` (src/cli/run.ts).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FIXED_MESSAGES, POLICY_NARROWING_KINDS, mergeWorkflowVerifiers, workflowVerifierNarrowings } from "../../../src/contracts/index.js";
import type { VerifierConfig } from "../../../src/contracts/index.js";

const exists = (id: string, path: string): VerifierConfig => ({ id, kind: "file_rules", rules: [{ type: "exists", path }] });
const OWN = [exists("w1-must", "must.txt")];
const today = (definition: readonly VerifierConfig[] | undefined, given: readonly VerifierConfig[] | undefined) => given ?? definition;

describe("DR-43 (a): given verifiers are added to a workflow's own checks", () => {
  test("R-31 L-2: a configured verifier no longer takes the workflow's check away", () => {
    const given = [exists("seed", "seed.txt")];
    assert.deepEqual(today(OWN, given)?.map((v) => v.id), ["seed"], "today: w1's check does not run");
    assert.deepEqual(mergeWorkflowVerifiers(OWN, given)?.map((v) => v.id), ["w1-must", "seed"]);
  });

  test("an empty given list cannot remove the workflow's checks; either side absent gives the other", () => {
    assert.deepEqual(mergeWorkflowVerifiers(OWN, [])?.map((v) => v.id), ["w1-must"]);
    assert.equal(mergeWorkflowVerifiers(OWN, undefined), OWN);
    const given = [exists("seed", "seed.txt")];
    assert.equal(mergeWorkflowVerifiers(undefined, given), given, "a definition without verifiers (every built-in)");
    assert.equal(mergeWorkflowVerifiers([], given), given);
  });

  test("a given verifier with a workflow verifier's id is left out and told; the identical check is not counted", () => {
    const clash = [exists("w1-must", "other.txt"), exists("seed", "seed.txt")];
    assert.deepEqual(mergeWorkflowVerifiers(OWN, clash)?.map((v) => (v.kind === "file_rules" ? v.rules[0] : null)), [{ type: "exists", path: "must.txt" }, { type: "exists", path: "seed.txt" }]);
    assert.deepEqual(workflowVerifierNarrowings(OWN, clash), [{ kind: "verifiers_dropped", count: 1 }]);
    assert.deepEqual(workflowVerifierNarrowings(OWN, [{ rules: [{ path: "must.txt", type: "exists" }], kind: "file_rules", id: "w1-must" }]), [], "the same check in another key order");
    assert.deepEqual(workflowVerifierNarrowings(undefined, clash), []);
  });

  test("the notice kind has its message ids", () => {
    assert.ok((POLICY_NARROWING_KINDS as readonly string[]).includes("verifiers_dropped"));
    assert.deepEqual(FIXED_MESSAGES["doctor.workflow_policy.verifiers_dropped"], { count: "count" });
    assert.deepEqual(FIXED_MESSAGES["progress.workflow_policy.verifiers_dropped"], { count: "count" });
  });
});
