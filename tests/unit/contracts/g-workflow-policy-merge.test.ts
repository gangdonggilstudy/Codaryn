/**
 * DR-41 (A-8, F-5): a given policy is merged with a workflow definition's own policy instead of
 * replacing it, in the quick form (the profile's or config's) and in a task file that names a
 * workflow (the task's own, PM after 27afb01). The reproduction cases are the app layer's (A-8
 * section 4); "today" is the quick form's rule before DR-41, `configured ?? definition`
 * (src/cli/run.ts); a task file's own policy replaced the definition's entirely.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FIXED_MESSAGES, POLICY_NARROWING_KINDS, mergeWorkflowPolicy, workflowPolicyNarrowings } from "../../../src/contracts/index.js";
import type { CommandRule, DoctorCheck, JournalEvent, PolicyConfig, ResolvedTaskSpec } from "../../../src/contracts/index.js";

const base = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } as const;
const ORGANIZE: PolicyConfig = { ...base, planActions: ["move", "discard"] };
const today = (definition: PolicyConfig | undefined, configured: PolicyConfig | undefined) => configured ?? definition;
const rule = (executable: string, argsPrefix: string[], allowExtraArgs: boolean): CommandRule => ({ executable, argsPrefix, allowExtraArgs });

describe("DR-41: a configured policy never loosens a workflow definition's own rules", () => {
  test("A-8: a policy that only adds a protected path keeps organize's plan actions", () => {
    const configured: PolicyConfig = { ...base, protectedPaths: ["secrets"] };
    assert.equal(today(ORGANIZE, configured)?.planActions, undefined, "today: organize loses move and discard");
    const merged = mergeWorkflowPolicy(ORGANIZE, configured);
    assert.deepEqual(merged?.planActions, ["move", "discard"]);
    assert.deepEqual(merged?.protectedPaths, ["secrets"]);
  });

  test("A-8: a configured workflow's protected paths stay when the config gets its first policy", () => {
    const own: PolicyConfig = { ...base, protectedPaths: ["data", "reports"] };
    const configured: PolicyConfig = { ...base, protectedPaths: ["secrets", "data"] };
    assert.deepEqual(today(own, configured)?.protectedPaths, ["secrets", "data"], "today: reports is no longer protected");
    assert.deepEqual(mergeWorkflowPolicy(own, configured)?.protectedPaths, ["data", "reports", "secrets"], "union, each once");
  });

  test("plan actions the configured policy states narrow the definition's; it cannot add one", () => {
    assert.deepEqual(mergeWorkflowPolicy(ORGANIZE, { ...base, planActions: ["move"] })?.planActions, ["move"]);
    assert.equal(mergeWorkflowPolicy({ ...base }, { ...base, planActions: ["move", "discard"] })?.planActions, undefined, "the definition allows none");
    assert.equal(mergeWorkflowPolicy(ORGANIZE, { ...base, planActions: [] })?.planActions, undefined, "stated as none");
  });

  test("commands: only the command lines both allow", () => {
    const own: PolicyConfig = { ...base, commands: [rule("npm", ["test"], true), rule("git", ["status"], false)] };
    const configured: PolicyConfig = { ...base, commands: [rule("npm", ["test", "--", "unit"], false), rule("npm", ["run", "build"], false), rule("git", ["status"], true)] };
    assert.deepEqual(mergeWorkflowPolicy(own, configured)?.commands, [rule("npm", ["test", "--", "unit"], false), rule("git", ["status"], false)]);
  });

  test("command rule intersections, one by one", () => {
    const one = (a: CommandRule, b: CommandRule) => mergeWorkflowPolicy({ ...base, commands: [a] }, { ...base, commands: [b] })?.commands;
    assert.deepEqual(one(rule("npm", ["test"], true), rule("npm", ["test"], true)), [rule("npm", ["test"], true)], "the same rule");
    assert.deepEqual(one(rule("npm", ["test"], true), rule("npm", ["test"], false)), [rule("npm", ["test"], false)], "extra arguments only if both allow them");
    assert.deepEqual(one(rule("npm", [], true), rule("npm", ["test"], true)), [rule("npm", ["test"], true)], "a longer prefix inside a shorter one with extra arguments");
    assert.deepEqual(one(rule("npm", [], false), rule("npm", ["test"], true)), [], "the shorter one allows its exact line only");
    assert.deepEqual(one(rule("npm", ["test"], true), rule("npm", ["run"], true)), [], "different prefixes");
    assert.deepEqual(one(rule("npm", ["test"], true), rule("pnpm", ["test"], true)), [], "different executables");
  });

  test("a definition that allows no command drops configured rules instead of refusing the run", () => {
    const configured: PolicyConfig = { ...base, commands: [rule("npm", ["test"], true)] };
    assert.equal(today(ORGANIZE, configured)?.commands.length, 1, "today: the rule reaches organize (commands_not_allowed)");
    assert.deepEqual(mergeWorkflowPolicy(ORGANIZE, configured)?.commands, []);
  });

  test("a task file naming organize with its own policy cannot take organize's rules away either", () => {
    const taskPolicy: PolicyConfig = { ...base, restorePathTokens: true, planActions: ["move", "discard"], protectedPaths: ["src"] };
    const merged = mergeWorkflowPolicy(ORGANIZE, taskPolicy);
    assert.deepEqual([merged?.planActions, merged?.protectedPaths, merged?.restorePathTokens, merged?.commands], [["move", "discard"], ["src"], false, []]);
  });

  test("restoring path tokens only when both allow it; either side absent gives the other as before", () => {
    assert.equal(mergeWorkflowPolicy({ ...base, restorePathTokens: true }, { ...base, restorePathTokens: false })?.restorePathTokens, false);
    assert.equal(mergeWorkflowPolicy({ ...base, restorePathTokens: true }, { ...base, restorePathTokens: true })?.restorePathTokens, true);
    const configured: PolicyConfig = { ...base, protectedPaths: ["x"] };
    assert.equal(mergeWorkflowPolicy(undefined, configured), configured, "a definition without a policy (general, code, document, analyze)");
    assert.equal(mergeWorkflowPolicy(ORGANIZE, undefined), ORGANIZE);
  });
});

describe("DR-41: what the merge left out is told, as kinds and counts only", () => {
  test("configured command rules under organize: dropped, counted", () => {
    const configured: PolicyConfig = { ...base, commands: [rule("npm", ["test"], true), rule("git", ["status"], false)] };
    assert.deepEqual(workflowPolicyNarrowings(ORGANIZE, configured), [{ kind: "commands_dropped", count: 2 }]);
  });

  test("a rule kept in part is narrowed; one kept whole is not counted", () => {
    const own: PolicyConfig = { ...base, commands: [rule("npm", ["test"], true), rule("git", ["status"], true)] };
    const configured: PolicyConfig = { ...base, commands: [rule("npm", [], true), rule("git", ["status"], false), rule("make", [], true)] };
    assert.deepEqual(workflowPolicyNarrowings(own, configured), [
      { kind: "commands_dropped", count: 1 },
      { kind: "commands_narrowed", count: 1 },
    ]);
  });

  test("plan actions the definition does not list, and token restoring turned off", () => {
    const configured: PolicyConfig = { ...base, restorePathTokens: true, planActions: ["move", "discard", "move"] };
    assert.deepEqual(workflowPolicyNarrowings({ ...base, planActions: ["move"] }, configured), [
      { kind: "plan_actions_dropped", count: 1 },
      { kind: "restore_path_tokens_off", count: 1 },
    ]);
  });

  test("nothing left out, or either side absent: none", () => {
    assert.deepEqual(workflowPolicyNarrowings(ORGANIZE, { ...base, protectedPaths: ["secrets"] }), []);
    assert.deepEqual(workflowPolicyNarrowings(undefined, { ...base, commands: [rule("npm", [], true)] }), []);
    assert.deepEqual(workflowPolicyNarrowings(ORGANIZE, undefined), []);
  });

  test("the slots: the resolved task, run_started, doctor's notes and the run's start lines", () => {
    const narrowings = workflowPolicyNarrowings(ORGANIZE, { ...base, commands: [rule("npm", ["test"], true)] });
    const task: Pick<ResolvedTaskSpec, "policyNarrowings"> = { policyNarrowings: narrowings };
    const started: Extract<JournalEvent, { type: "run_started" }>["policyNarrowings"] = task.policyNarrowings;
    const check: Pick<DoctorCheck, "notes"> = { notes: [{ id: "doctor.workflow_policy.commands_dropped", params: { count: 1 } }] };
    assert.ok(started && check.notes?.length === 1);
    for (const kind of POLICY_NARROWING_KINDS) {
      for (const prefix of ["doctor", "progress"]) {
        const id = `${prefix}.workflow_policy.${kind}` as keyof typeof FIXED_MESSAGES;
        assert.deepEqual(FIXED_MESSAGES[id], kind === "restore_path_tokens_off" ? {} : { count: "count" }, id);
      }
    }
  });
});
