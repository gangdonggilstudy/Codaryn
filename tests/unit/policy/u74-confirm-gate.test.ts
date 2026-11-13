/**
 * U-74 B-2 (DR-3; PM: the policy gate is this unit's, as an exception): a command that only a
 * `confirm: true` rule of the user's settings allows passes the first check and gets the confirm
 * mark from the second, so the engine asks. A rule without `confirm` that allows it wins: no
 * question. Anything the policy denies outright stays a plain denial and is never asked: no rule,
 * other arguments, a cwd outside the root. The mark comes only when it is the only denial. Without
 * any confirm rule every decision is as before.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { BUILTIN_TOOLS } from "../../../src/contracts/index.js";
import type { ConfirmableCommandRule, ConfirmablePolicyConfig, EffectiveToolCall, PolicyDecision, ToolCall, Workspace } from "../../../src/contracts/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

let base = "";
let workspace: Workspace;
before(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u74-policy-")));
  fs.mkdirSync(path.join(base, "ws"));
  workspace = await createWorkspace({ root: path.join(base, "ws") });
});
after(() => fs.rmSync(base, { recursive: true, force: true }));

const policy = (commands: ConfirmableCommandRule[]): ConfirmablePolicyConfig => ({ commands, network: "deny", destructive: "deny", restorePathTokens: false });
const call = (executable: string, args: string[], cwd?: string): ToolCall => ({ id: "c1", name: "run_command", args: { executable, args, ...(cwd === undefined ? {} : { cwd }) } });
const MARK: PolicyDecision = { allowed: false, permission: "command", code: "confirmation_required", confirm: true };

async function both(commands: ConfirmableCommandRule[], one: ToolCall): Promise<[PolicyDecision, PolicyDecision]> {
  const gate = createPolicyGate({ config: policy(commands), workspace });
  return [gate.checkRequested(one, BUILTIN_TOOLS.run_command), await gate.checkEffective(one as unknown as EffectiveToolCall, BUILTIN_TOOLS.run_command)];
}

describe("U-74 B-2: the confirm mark of the policy gate", () => {
  test("only a confirm rule allows it: the first check passes, the second gives the mark", async () => {
    const [requested, effective] = await both([{ executable: "npm", argsPrefix: ["test"], allowExtraArgs: false, confirm: true }], call("npm", ["test"]));
    assert.deepEqual(requested, { allowed: true });
    assert.deepEqual(effective, MARK);
  });

  test("a rule without confirm that allows it wins: no question", async () => {
    const rules: ConfirmableCommandRule[] = [
      { executable: "npm", argsPrefix: [], allowExtraArgs: true, confirm: true },
      { executable: "npm", argsPrefix: ["test"], allowExtraArgs: false },
    ];
    assert.deepEqual(await both(rules, call("npm", ["test"])), [{ allowed: true }, { allowed: true }]);
    const [, other] = await both(rules, call("npm", ["run", "build"]));
    assert.deepEqual(other, MARK, "other arguments only the confirm rule covers");
  });

  test("what the policy denies outright is never asked", async () => {
    const asked: ConfirmableCommandRule[] = [{ executable: "npm", argsPrefix: ["test"], allowExtraArgs: false, confirm: true }];
    assert.deepEqual((await both(asked, call("node", [])))[1], { allowed: false, permission: "command", code: "command_not_allowed" });
    assert.deepEqual((await both(asked, call("npm", ["test", "--x"])))[1], { allowed: false, permission: "command", code: "args_not_allowed" });
    const [requested, effective] = await both(asked, call("npm", ["test"], "../outside"));
    assert.deepEqual(requested, { allowed: false, permission: "path", code: "outside_root" });
    assert.deepEqual(effective, { allowed: false, permission: "path", code: "outside_root" }, "the mark only when it is the only denial");
  });

  test("without any confirm rule every decision is as before", async () => {
    const plain: ConfirmableCommandRule[] = [{ executable: "npm", argsPrefix: ["test"], allowExtraArgs: false }];
    assert.deepEqual(await both(plain, call("npm", ["test"])), [{ allowed: true }, { allowed: true }]);
    assert.deepEqual((await both(plain, call("npm", ["run"])))[1], { allowed: false, permission: "command", code: "args_not_allowed" });
    assert.deepEqual((await both([], call("npm", ["test"])))[1], { allowed: false, permission: "command", code: "command_not_allowed" });
  });
});
