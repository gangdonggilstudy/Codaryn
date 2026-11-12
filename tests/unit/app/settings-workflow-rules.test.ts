/**
 * DR-41 (GUI report F-5, A-8): a workflow definition's own policy is merged with the configured one
 * (mergeWorkflowPolicy: protected paths joined, command lines and plan actions only where both
 * allow) instead of being replaced by it. The widening judgment compares, for every workflow that
 * has its own policy, the merged policy its quick runs get before and after the change. DR-43 (a):
 * verifiers likewise, merged with mergeWorkflowVerifiers (the workflow's own always run, given ones
 * added unless their id is one of the workflow's). What a workflow's rules leave out of the
 * configured policy and verifiers is told, kinds and counts only (workflowPolicyNarrowings,
 * workflowVerifierNarrowings), in the settings view and a change proposal.
 * Reproduced first: the judgment still followed the replacement rule. Fake values only.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import type { CodarynConfig } from "../../../src/contracts/index.js";
import { createCodarynApp, wideningOf } from "../../../src/app/index.js";
import type { AppCallOutcome, SettingsChangeProposal, SettingsView } from "../../../src/app/index.js";
import { appEnvironment, tempDir } from "./support.js";

const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } as const;
const NPM_TEST = { executable: "npm", argsPrefix: ["test"], allowExtraArgs: false };
const BASE: CodarynConfig = { schemaVersion: 1, model: "fake-model-a", maxOutputTokens: 64 };
/** A config workflow that protects a folder, allows npm with any arguments and checks with a command. */
const DOCS = {
  label: "Docs",
  tools: ["read_file", "write_file", "run_command"],
  policy: { ...POLICY, commands: [{ executable: "npm", argsPrefix: [], allowExtraArgs: true }], protectedPaths: ["private"] },
  verifiers: [{ id: "lint", kind: "command", executable: "npm", args: ["test"] }],
} as unknown as NonNullable<CodarynConfig["workflows"]>[string];
const EXISTS = { id: "exists", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] } as unknown as NonNullable<CodarynConfig["verifiers"]>[number];
const kinds = (before: CodarynConfig, after: CodarynConfig): string[] => wideningOf(before, after).map((item) => `${item.kind} ${item.field}`);

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

describe("DR-41: the widening judgment compares the merged policies", () => {
  test("the config's first policy keeps a workflow's protected path, so it is not a widening", () => {
    const before: CodarynConfig = { ...BASE, workflows: { docs: DOCS } };
    assert.deepEqual(kinds(before, { ...before, policy: { ...POLICY, protectedPaths: ["tests"] } }), []);
  });

  test("a configured command is said once; a workflow's own entry comes only where its runs widen otherwise", () => {
    const before: CodarynConfig = { ...BASE, policy: { ...POLICY }, workflows: { docs: DOCS } };
    const after: CodarynConfig = { ...before, policy: { ...POLICY, commands: [NPM_TEST] } };
    // docs allows it (merged in), organize drops it (a narrowing, below): the config's entry says it.
    assert.deepEqual(kinds(before, after), ["command_added policy.commands[0]"]);
    // The workflow's own rule changes: its runs gain a command the config already allowed.
    const own = (commands: unknown[]) => ({ ...DOCS, policy: { ...POLICY, commands } }) as unknown as NonNullable<CodarynConfig["workflows"]>[string];
    const withRule: CodarynConfig = { ...BASE, policy: { ...POLICY, commands: [NPM_TEST] }, workflows: { docs: own([]) } };
    assert.deepEqual(
      kinds(withRule, { ...withRule, workflows: { docs: own([NPM_TEST]) } }),
      ["workflow_changed workflows", "command_added workflows.docs.policy.commands[0]"],
      "no config entry says it, so the workflow's own entry does",
    );
  });

  test("a config that stops narrowing organize's plan actions gives them back", () => {
    const narrowing: CodarynConfig = { ...BASE, policy: { ...POLICY, planActions: ["move"] } };
    assert.deepEqual(kinds(narrowing, { ...BASE, policy: { ...POLICY } }), ["plan_action_allowed workflows.organize.policy.planActions"], "planActions no longer stated");
    assert.deepEqual(kinds(narrowing, BASE), ["plan_action_allowed workflows.organize.policy.planActions"], "the config's policy removed");
    // A configured policy that states no plan actions leaves organize's as they are (DR-41).
    assert.deepEqual(kinds(BASE, { ...BASE, policy: { ...POLICY } }), []);
  });

  test("DR-43 (a): the config's first verifiers are added to a workflow's own, so its check stays: not a widening", () => {
    const before: CodarynConfig = { ...BASE, workflows: { docs: DOCS } };
    const after: CodarynConfig = { ...before, verifiers: [EXISTS] };
    assert.deepEqual(kinds(before, after), []);
  });

  test("DR-43 (a): an empty config list removes none of a workflow's verifiers", () => {
    const before: CodarynConfig = { ...BASE, workflows: { docs: DOCS } };
    assert.deepEqual(kinds(before, { ...before, verifiers: [] }), []);
  });

  test("DR-43 (a): a workflow's own verifier removed from its definition is said for that workflow", () => {
    const before: CodarynConfig = { ...BASE, verifiers: [EXISTS], workflows: { docs: DOCS } };
    const without = { ...DOCS, verifiers: [] } as unknown as NonNullable<CodarynConfig["workflows"]>[string];
    assert.deepEqual(kinds(before, { ...before, workflows: { docs: without } }), ["workflow_changed workflows", "verifier_removed workflows.docs.verifiers"]);
  });

  test("a narrowing change asks for nothing", () => {
    const before: CodarynConfig = { ...BASE, policy: { ...POLICY, commands: [NPM_TEST] }, workflows: { docs: DOCS } };
    assert.deepEqual(kinds(before, { ...before, policy: { ...POLICY, protectedPaths: ["tests"] } }), []);
  });
});

describe("DR-41: what a workflow's rules leave out of the configured policy", () => {
  async function setup(value: CodarynConfig) {
    const base = await tempDir("codaryn-unit-app-workflow-rules-");
    const config = path.join(base, "config.json");
    await writeFile(config, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return { config, app: createCodarynApp(await appEnvironment(base)) };
  }

  test("the settings view and a proposal name each workflow's narrowings, kinds and counts only", async () => {
    const { config, app } = await setup({ ...BASE, workflows: { docs: DOCS } });
    assert.deepEqual(ok<SettingsView>(await app.readSettings({ configPath: config })).policyNarrowings, [], "no configured policy: nothing left out");
    const next = { ...BASE, workflows: { docs: DOCS }, policy: { ...POLICY, commands: [NPM_TEST], planActions: ["move"], restorePathTokens: true } };
    const proposal = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next }));
    assert.deepEqual(proposal.policyNarrowings, [
      { workflow: "organize", kind: "commands_dropped", count: 1 },
      { workflow: "organize", kind: "restore_path_tokens_off", count: 1 },
      { workflow: "docs", kind: "plan_actions_dropped", count: 1 },
      { workflow: "docs", kind: "restore_path_tokens_off", count: 1 },
    ]);
    assert.equal(JSON.stringify(proposal.policyNarrowings).includes("npm"), false, "no rule or command in them");
  });

  test("DR-43 (a): a config verifier whose id is one of a workflow's, and is another check, is left out and told", async () => {
    const { config, app } = await setup({ ...BASE, workflows: { docs: DOCS } });
    // Same id as docs' own command verifier, another check: docs keeps its own, this one is dropped.
    const clash = { id: "lint", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] } as unknown as NonNullable<CodarynConfig["verifiers"]>[number];
    const proposal = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next: { ...BASE, workflows: { docs: DOCS }, verifiers: [clash, EXISTS] } }));
    assert.deepEqual(proposal.policyNarrowings, [{ workflow: "docs", kind: "verifiers_dropped", count: 1 }]);
    assert.deepEqual(proposal.widening, [], "docs' own check stays");
    assert.equal(JSON.stringify(proposal.policyNarrowings).includes("README"), false);
  });

  test("apply still asks for a merged widening", async () => {
    const before: CodarynConfig = { ...BASE, policy: { ...POLICY, planActions: ["move"] } };
    const { config, app } = await setup(before);
    const text = await readFile(config, "utf8");
    const next = { ...BASE, policy: { ...POLICY } };
    const proposal = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next }));
    assert.deepEqual(proposal.widening, [{ kind: "plan_action_allowed", field: "workflows.organize.policy.planActions" }]);
    const refused = await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: false });
    assert.equal(refused.ok ? null : refused.error.code, "invalid_arguments");
    assert.equal(await readFile(config, "utf8"), text);
  });
});
