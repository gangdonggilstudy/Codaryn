/**
 * G-C (PQ-1): the policy gate judges plan actions (contracts: ToolRequirements.planAction,
 * PolicyConfig.planActions, PLAN_ACTION_DESCRIPTORS, denial `destructive`/`plan_action_not_allowed`).
 * A kind the policy does not list is denied before and after restoration; the path rules
 * (outside the root, state directory, protected paths, links) apply to every action path.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { BUILTIN_TOOLS, PLAN_ACTION_DESCRIPTORS } from "../../../src/contracts/index.js";
import type {
  EffectiveToolCall,
  PlanActionKind,
  PolicyConfig,
  PolicyDecision,
  ToolCall,
  ToolDescriptor,
  Workspace,
} from "../../../src/contracts/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const ALLOW: PolicyDecision = { allowed: true };
const NOT_ALLOWED: PolicyDecision = { allowed: false, permission: "destructive", code: "plan_action_not_allowed" };

function policy(planActions?: readonly PlanActionKind[]): PolicyConfig {
  return {
    commands: [],
    network: "deny",
    destructive: "deny",
    restorePathTokens: false,
    protectedPaths: ["keep"],
    ...(planActions === undefined ? {} : { planActions }),
  };
}

const move = (from: string, to: string): ToolCall => ({ id: "m", name: "plan.move", args: { from, to } });
const discard = (target: string): ToolCall => ({ id: "d", name: "plan.discard", args: { path: target } });
const effective = (call: ToolCall): EffectiveToolCall => call as unknown as EffectiveToolCall;

let base: string;
let root: string;
let outside: string;
let workspace: Workspace;
let linksWork = false;

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-gc-policy-"));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  fs.mkdirSync(path.join(root, "keep"), { recursive: true });
  fs.mkdirSync(path.join(root, ".codaryn"));
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, "a.txt"), "a");
  fs.writeFileSync(path.join(root, "keep", "k.txt"), "k");
  fs.writeFileSync(path.join(outside, "o.txt"), "o");
  try {
    // Directory links need no privilege on Windows ("junction"); elsewhere the type is ignored.
    fs.symlinkSync(outside, path.join(root, "jump"), "junction");
    fs.symlinkSync(path.join(root, "keep"), path.join(root, "alias"), "junction");
    linksWork = true;
  } catch {
    linksWork = false;
  }
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

async function both(config: PolicyConfig, call: ToolCall, descriptor: ToolDescriptor): Promise<[PolicyDecision, PolicyDecision]> {
  const gate = createPolicyGate({ config, workspace });
  return [gate.checkRequested(call, descriptor), await gate.checkEffective(effective(call), descriptor)];
}

describe("G-C policy gate: plan action kinds", () => {
  test("a kind the policy lists is allowed before and after restoration", async () => {
    const config = policy(["move", "discard"]);
    assert.deepEqual(await both(config, move("a.txt", "docs/a.txt"), PLAN_ACTION_DESCRIPTORS.move), [ALLOW, ALLOW]);
    assert.deepEqual(await both(config, discard("a.txt"), PLAN_ACTION_DESCRIPTORS.discard), [ALLOW, ALLOW]);
  });

  test("a kind the policy does not list is denied as destructive/plan_action_not_allowed", async () => {
    const onlyMove = policy(["move"]);
    assert.deepEqual(await both(onlyMove, discard("a.txt"), PLAN_ACTION_DESCRIPTORS.discard), [NOT_ALLOWED, NOT_ALLOWED]);
    assert.deepEqual(await both(onlyMove, move("a.txt", "b.txt"), PLAN_ACTION_DESCRIPTORS.move), [ALLOW, ALLOW]);
    const onlyDiscard = policy(["discard"]);
    assert.deepEqual(await both(onlyDiscard, move("a.txt", "b.txt"), PLAN_ACTION_DESCRIPTORS.move), [NOT_ALLOWED, NOT_ALLOWED]);
  });

  test("absent or empty planActions allows no plan action", async () => {
    for (const config of [policy(), policy([])]) {
      assert.deepEqual(await both(config, move("a.txt", "b.txt"), PLAN_ACTION_DESCRIPTORS.move), [NOT_ALLOWED, NOT_ALLOWED]);
      assert.deepEqual(await both(config, discard("a.txt"), PLAN_ACTION_DESCRIPTORS.discard), [NOT_ALLOWED, NOT_ALLOWED]);
    }
  });

  test("a path denial is reported before the kind denial (report order)", async () => {
    const [requested, effectiveDecision] = await both(policy(["move"]), discard("../x.txt"), PLAN_ACTION_DESCRIPTORS.discard);
    assert.deepEqual(requested, { allowed: false, permission: "path", code: "outside_root" });
    assert.deepEqual(effectiveDecision, { allowed: false, permission: "path", code: "outside_root" });
  });

  test("a descriptor named like a built-in tool that claims a plan action is still judged", async () => {
    const disguised: ToolDescriptor = {
      ...BUILTIN_TOOLS.read_file,
      requires: { ...BUILTIN_TOOLS.read_file.requires, planAction: "discard" },
    };
    const call: ToolCall = { id: "r", name: "read_file", args: { path: "a.txt" } };
    assert.deepEqual(await both(policy([]), call, disguised), [NOT_ALLOWED, NOT_ALLOWED]);
    assert.deepEqual(await both(policy(["discard"]), call, disguised), [ALLOW, ALLOW]);
  });

  test("tools without a plan action are not affected by planActions", async () => {
    const call: ToolCall = { id: "r", name: "read_file", args: { path: "a.txt" } };
    assert.deepEqual(await both(policy(), call, BUILTIN_TOOLS.read_file), [ALLOW, ALLOW]);
  });
});

describe("G-C policy gate: paths of plan actions", () => {
  const config = policy(["move", "discard"]);

  test("outside the root, the state directory and protected paths are denied for every action path", async () => {
    const cases: [ToolCall, string][] = [
      [move("../a.txt", "b.txt"), "outside_root"],
      [move("a.txt", "../b.txt"), "outside_root"],
      [discard("../a.txt"), "outside_root"],
      [move(".codaryn/x", "b.txt"), "state_dir"],
      [move("a.txt", ".codaryn/b.txt"), "state_dir"],
      [discard(".codaryn/x"), "state_dir"],
      [move("keep/k.txt", "b.txt"), "protected_path"],
      [move("a.txt", "keep/b.txt"), "protected_path"],
      [discard("keep/k.txt"), "protected_path"],
    ];
    for (const [call, code] of cases) {
      const descriptor = PLAN_ACTION_DESCRIPTORS[call.name === "plan.move" ? "move" : "discard"];
      const expected = { allowed: false, permission: "path", code };
      assert.deepEqual(await both(config, call, descriptor), [expected, expected], JSON.stringify(call.args));
    }
  });

  test("after links are resolved, a path that leaves the root or reaches a protected path is denied", async (t) => {
    if (!linksWork) {
      t.skip("directory links cannot be created here");
      return;
    }
    const gate = createPolicyGate({ config, workspace });
    const cases: [ToolCall, string][] = [
      [move("a.txt", "jump/x.txt"), "outside_root"],
      [move("jump/o.txt", "b.txt"), "outside_root"],
      [discard("jump/o.txt"), "outside_root"],
      [move("a.txt", "alias/x.txt"), "protected_path"],
      [discard("alias/k.txt"), "protected_path"],
    ];
    for (const [call, code] of cases) {
      const descriptor = PLAN_ACTION_DESCRIPTORS[call.name === "plan.move" ? "move" : "discard"];
      assert.deepEqual(
        await gate.checkEffective(effective(call), descriptor),
        { allowed: false, permission: "path", code },
        JSON.stringify(call.args),
      );
    }
  });
});
