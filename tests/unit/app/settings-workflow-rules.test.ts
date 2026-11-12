/**
 * GUI report F-5: in the quick form a workflow's own policy and verifiers apply only while the config
 * file has none (src/cli/run.ts `underDefinition`: `config.policy ?? definition.policy`, the same
 * for verifiers). A change that gives the config its first `policy` (or removes it) replaces the
 * rules of every workflow that has its own, though the config's policy only narrowed. The judgment
 * compares the rules as such runs see them. Reproduced first: none of these was a widening.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import type { CodarynConfig } from "../../../src/contracts/index.js";
import { createCodarynApp, wideningOf } from "../../../src/app/index.js";
import type { AppCallOutcome, SettingsChangeProposal } from "../../../src/app/index.js";
import { appEnvironment, tempDir } from "./support.js";

const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } as const;
const BASE: CodarynConfig = { schemaVersion: 1, model: "fake-model-a", maxOutputTokens: 64 };
/** A config workflow that protects a folder and checks with a command. */
const DOCS = {
  label: "Docs",
  tools: ["read_file", "write_file"],
  policy: { ...POLICY, protectedPaths: ["private"] },
  verifiers: [{ id: "lint", kind: "command", executable: "npm", args: ["test"] }],
} as unknown as NonNullable<CodarynConfig["workflows"]>[string];
const kinds = (before: CodarynConfig, after: CodarynConfig): string[] => wideningOf(before, after).map((item) => `${item.kind} ${item.field}`);

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

describe("F-5: a workflow's own rules replaced by the config's first policy or verifiers", () => {
  test("the config's first policy drops a workflow's protected path", () => {
    const before: CodarynConfig = { ...BASE, workflows: { docs: DOCS } };
    const after: CodarynConfig = { ...before, policy: { ...POLICY, protectedPaths: ["tests"] } };
    assert.deepEqual(kinds(before, after), ["protected_path_removed workflows.docs.policy.protectedPaths"]);
  });

  test("removing the config's policy gives organize its plan actions back", () => {
    const before: CodarynConfig = { ...BASE, policy: { ...POLICY } };
    assert.deepEqual(kinds(before, BASE), ["plan_action_allowed workflows.organize.policy.planActions"]);
    // The other way round organize only loses its plan actions: narrower, no confirmation.
    assert.deepEqual(kinds(BASE, before), []);
  });

  test("the config's first verifiers replace a workflow's command verifier", () => {
    const before: CodarynConfig = { ...BASE, workflows: { docs: DOCS } };
    const after: CodarynConfig = { ...before, verifiers: [{ id: "exists", kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }] as unknown as CodarynConfig["verifiers"] };
    assert.deepEqual(kinds(before, after), ["verifier_removed workflows.docs.verifiers"]);
  });

  test("while the config keeps its own policy the workflows' rules are not in play: nothing more is reported", () => {
    const before: CodarynConfig = { ...BASE, policy: { ...POLICY }, workflows: { docs: DOCS } };
    const after: CodarynConfig = { ...before, policy: { ...POLICY, protectedPaths: ["tests"] } };
    assert.deepEqual(kinds(before, after), []);
  });

  test("apply refuses the first policy without the person's confirmation", async () => {
    const base = await tempDir("codaryn-unit-app-workflow-rules-");
    const config = path.join(base, "config.json");
    await writeFile(config, `${JSON.stringify({ ...BASE, workflows: { docs: DOCS } }, null, 2)}\n`, "utf8");
    const before = await readFile(config, "utf8");
    const app = createCodarynApp(await appEnvironment(base));
    const next = { ...BASE, workflows: { docs: DOCS }, policy: { ...POLICY, protectedPaths: ["tests"] } };
    const proposal = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next }));
    assert.deepEqual(proposal.widening, [{ kind: "protected_path_removed", field: "workflows.docs.policy.protectedPaths" }]);
    const refused = await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: false });
    assert.equal(refused.ok ? null : refused.error.code, "invalid_arguments");
    assert.equal(await readFile(config, "utf8"), before);
  });
});
