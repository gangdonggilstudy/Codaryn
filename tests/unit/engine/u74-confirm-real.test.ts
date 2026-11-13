/**
 * U-74 B-2 and B-3 together, with the real policy gate, workspace, privacy gateway and tool runner
 * (only the model is scripted): a `confirm: true` rule of the user's settings for `node --version`.
 * Nobody to ask: denied by default and not run. Allowed once: run, exit code 0. A rule without
 * confirm: run with no question, as before. No network; the command is this Node.js itself.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { ConfirmPermission, ConfirmableCommandRule, ConfirmablePolicyConfig, ToolCall } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { finalAnswer, harness, response } from "./fakes.js";

let base = "";
let root = "";
before(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-u74-real-")));
  root = path.join(base, "ws");
  await fs.mkdir(root);
});
after(async () => fs.rm(base, { recursive: true, force: true }));

const NODE = process.execPath;
const call: ToolCall = { id: "c1", name: "run_command", args: { executable: NODE, args: ["--version"] } };

async function run(rule: ConfirmableCommandRule, confirm?: ConfirmPermission) {
  const workspace = await createWorkspace({ root });
  const privacy = createPrivacyGateway({ secrets: [] });
  const policy: ConfirmablePolicyConfig = { commands: [rule], network: "deny", destructive: "deny", restorePathTokens: false };
  const h = harness({ steps: [() => response([call]), () => finalAnswer()], task: { workspaceRoot: root, policy, verifiers: [] } });
  h.deps = { ...h.deps, privacy, policy: createPolicyGate({ config: policy, workspace }), tools: createToolRunner({ workspace, privacy }), ...(confirm === undefined ? {} : { confirm }) };
  await runTask(h.deps);
  return {
    requested: h.journal.ofType("confirmation_requested"),
    answered: h.journal.ofType("confirmation_answered").map((event) => [event.decision, event.by]),
    result: h.journal.ofType("tool_result")[0]?.result,
  };
}

describe("U-74: a confirm rule of the user's settings, end to end with the real gate and tools", () => {
  const asked: ConfirmableCommandRule = { executable: NODE, argsPrefix: ["--version"], allowExtraArgs: false, confirm: true };

  test("nobody to ask: denied by default, the command does not run", async () => {
    const outcome = await run(asked);
    assert.equal(outcome.requested[0]?.subject, NODE);
    assert.equal(outcome.requested[0]?.argumentCount, 1);
    assert.deepEqual(outcome.answered, [["deny", "default"]]);
    assert.equal(outcome.result?.errorCode, "policy_denied");
  });

  test("allowed once: it runs and exits 0", async () => {
    const outcome = await run(asked, async () => ({ decision: "allow_once" }));
    assert.deepEqual(outcome.answered, [["allow_once", "user"]]);
    assert.equal(outcome.result?.ok, true, outcome.result?.content);
    assert.match(outcome.result?.content ?? "", /"exitCode":0/);
  });

  test("a rule without confirm: it runs with no question, as before", async () => {
    const outcome = await run({ executable: NODE, argsPrefix: ["--version"], allowExtraArgs: false }, async () => ({ decision: "deny" }));
    assert.equal(outcome.requested.length, 0);
    assert.equal(outcome.result?.ok, true);
  });
});
