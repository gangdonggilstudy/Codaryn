/**
 * Review R-14 L-2 (docs/reviews/2026-11-12-r14-review-app-layer-additions.md), reproduction first:
 * adding or changing a `command` verifier widens what a run does (it runs with the person's rights
 * on every run), so a settings change that does it needs the person's confirmation. Fake values only.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createCodarynApp, wideningOf } from "../../../src/app/index.js";
import type { AppCallOutcome, SettingsChangeProposal } from "../../../src/app/index.js";
import type { CodarynConfig } from "../../../src/contracts/index.js";
import { appEnvironment, setupRun } from "./support.js";

function code<T>(outcome: AppCallOutcome<T>): string | null {
  return outcome.ok ? null : outcome.error.code;
}

function ok<T>(outcome: AppCallOutcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}

describe("R-14 L-2: a command verifier added is widening", () => {
  const policy = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } as const;
  const before = { schemaVersion: 1, policy, verifiers: [{ id: "notes", kind: "file_rules", rules: [{ type: "exists", path: "NOTES.md" }] }] } as unknown as CodarynConfig;
  const command = { id: "check", kind: "command", executable: "node", args: ["-e", "0"] };

  test("adding or changing a command verifier is named; adding a file rule verifier is not", () => {
    const kinds = (after: object) => wideningOf(before, { ...before, ...after } as CodarynConfig).map((item) => `${item.kind}@${item.field}`);
    assert.deepEqual(kinds({ verifiers: [...(before.verifiers ?? []), command] }), ["verifier_command_added@verifiers[1]"]);
    const withCommand = { ...before, verifiers: [command] } as unknown as CodarynConfig;
    const changed = wideningOf(withCommand, { ...withCommand, verifiers: [{ ...command, args: ["-e", "1"] }] } as CodarynConfig);
    assert.deepEqual(changed.map((item) => item.kind).sort(), ["verifier_command_added", "verifier_removed"], "the old command is gone and a new one runs");
    assert.deepEqual(kinds({ verifiers: [...(before.verifiers ?? []), { id: "more", kind: "file_rules", rules: [{ type: "exists", path: "a" }] }] }), []);
  });

  test("so the change is written only with the person's confirmation", async () => {
    const base = await setupRun({}, {}, []);
    const config = path.join(base, "config.json");
    const app = createCodarynApp(await appEnvironment(base));
    assert.ok((await app.createSettings({ configPath: config, workspace: null })).ok);
    const current = JSON.parse(await readFile(config, "utf8")) as Record<string, unknown>;
    const next = { ...current, verifiers: [command] };
    const proposal = ok<SettingsChangeProposal>(await app.proposeSettingsChange({ configPath: config, next }));
    assert.deepEqual(proposal.widening.map((item) => item.kind), ["verifier_command_added"]);
    const unconfirmed = await app.applySettingsChange({ configPath: config, next, baseDigest: proposal.baseDigest, confirmWidening: false });
    assert.equal(code(unconfirmed), "invalid_arguments");
    assert.equal((JSON.parse(await readFile(config, "utf8")) as { verifiers?: unknown }).verifiers, undefined, "nothing was written");
  });
});
