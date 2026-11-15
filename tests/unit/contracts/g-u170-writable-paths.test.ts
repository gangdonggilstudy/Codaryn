/**
 * U-170 (DR-69, P1 bundle B, proposal B-4): `writablePaths`, a policy field that only narrows, before
 * anything reads it. Each source's list stays its own list (ResolvedTaskSpec.writablePathSets,
 * PolicyGateOptions.writablePathSets) and a write must be covered by every one of them, so no
 * source can widen another; mergeWorkflowPolicy does not combine them. The plan's approved files are
 * the last list (`plan`). The parsers refuse the field and the gate does not judge it until B-2 and
 * B-4.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { WRITABLE_PATH_SOURCES, mergeWorkflowPolicy } from "../../../src/contracts/index.js";
import type { PolicyConfig, PolicyGateOptions, ResolvedTaskSpec, WritablePathSet } from "../../../src/contracts/index.js";

describe("U-170 B-4: writablePaths", () => {
  const base: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };

  test("a policy field; the sources in narrowing order, the plan's files last", () => {
    const policy: PolicyConfig = { ...base, writablePaths: ["out", "docs/guide.md"] };
    assert.deepEqual(policy.writablePaths, ["out", "docs/guide.md"]);
    assert.deepEqual([...WRITABLE_PATH_SOURCES], ["config", "profile", "definition", "task", "plan"]);
  });

  test("the resolved task and the gate take every list as its own list", () => {
    const sets: readonly WritablePathSet[] = [
      { source: "config", entries: ["out", "docs"] },
      { source: "task", entries: ["docs"] },
      { source: "plan", entries: ["docs/guide.md"] },
    ];
    const task: Pick<ResolvedTaskSpec, "writablePathSets"> = { writablePathSets: sets };
    const gate: Pick<PolicyGateOptions, "writablePathSets"> = { writablePathSets: sets };
    assert.equal(task.writablePathSets, gate.writablePathSets);
    // @ts-expect-error a source is one of WRITABLE_PATH_SOURCES
    const wrong: WritablePathSet = { source: "model", entries: [] };
    assert.ok(wrong);
  });

  test("mergeWorkflowPolicy does not combine two lists into one: each source keeps its own", () => {
    const merged = mergeWorkflowPolicy({ ...base, writablePaths: ["out"] }, { ...base, writablePaths: ["docs"] });
    assert.ok(merged !== undefined);
    assert.equal(Object.hasOwn(merged, "writablePaths"), false);
    assert.deepEqual(mergeWorkflowPolicy(base, base), base, "without the field the merge is as before");
  });
});
