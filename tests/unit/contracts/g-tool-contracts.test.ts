/**
 * G-A: the workflow tools (`inspect_files`, `propose_plan`) and the plan action descriptors.
 * The built-in tool set stays as it was; the new tools live beside it. Their definitions reach
 * the model without the privacy gateway, so they must be fixed text. The plan action descriptors
 * must be judged by today's policy gate as given (design premise, policy/index.ts:49-53).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  ALL_TOOL_DEFINITIONS,
  ALL_TOOL_DESCRIPTORS,
  ALL_TOOL_NAMES,
  BUILTIN_TOOLS,
  FIXED_MESSAGES,
  MAX_PLAN_ACTIONS,
  MESSAGE_IDS,
  MAX_PLAN_SUMMARY_CHARS,
  PLAN_ACTION_DESCRIPTORS,
  PLAN_ACTION_KINDS,
  PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  UNKNOWN_TOOL_RECORD_NAME,
  WORKFLOW_TOOLS,
  WORKFLOW_TOOL_DEFINITIONS,
  WORKFLOW_TOOL_NAMES,
} from "../../../src/contracts/index.js";
import type { JsonObject, JsonValue, PolicyConfig, ToolCall, Workspace } from "../../../src/contracts/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const FRAGMENT = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");

function strings(value: JsonValue): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as JsonObject).flatMap(([key, item]) => [key, ...strings(item)]);
  }
  return [];
}

function obj(value: JsonValue | undefined): JsonObject {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "an object");
  return value as JsonObject;
}

describe("G-A tool names", () => {
  test("the built-in tool set is unchanged and keyed as before", () => {
    assert.deepEqual([...TOOL_NAMES], ["read_file", "search_files", "write_file", "run_command"]);
    assert.deepEqual(Object.keys(TOOL_DEFINITIONS).sort(), [...TOOL_NAMES].sort());
    assert.deepEqual(Object.keys(BUILTIN_TOOLS).sort(), [...TOOL_NAMES].sort());
  });

  test("workflow tools are separate from the built-in ones; ALL_TOOL_NAMES lists the built-ins first", () => {
    // U-180 (DR-69 B-3): propose_changes, the plan tool of plan mode run, joins them; U-208 (A-5):
    // query_table, the aggregate tool, last.
    assert.deepEqual([...WORKFLOW_TOOL_NAMES], ["inspect_files", "propose_plan", "propose_changes", "query_table"]);
    for (const name of WORKFLOW_TOOL_NAMES) assert.equal((TOOL_NAMES as readonly string[]).includes(name), false, name);
    assert.deepEqual([...ALL_TOOL_NAMES], [...TOOL_NAMES, ...WORKFLOW_TOOL_NAMES]);
    assert.equal(new Set(ALL_TOOL_NAMES).size, ALL_TOOL_NAMES.length);
  });

  test("ALL_ maps hold exactly every tool, with the same objects as their sources", () => {
    assert.deepEqual(Object.keys(ALL_TOOL_DEFINITIONS).sort(), [...ALL_TOOL_NAMES].sort());
    assert.deepEqual(Object.keys(ALL_TOOL_DESCRIPTORS).sort(), [...ALL_TOOL_NAMES].sort());
    for (const name of TOOL_NAMES) {
      assert.strictEqual(ALL_TOOL_DEFINITIONS[name], TOOL_DEFINITIONS[name]);
      assert.strictEqual(ALL_TOOL_DESCRIPTORS[name], BUILTIN_TOOLS[name]);
    }
    for (const name of WORKFLOW_TOOL_NAMES) {
      assert.strictEqual(ALL_TOOL_DEFINITIONS[name], WORKFLOW_TOOL_DEFINITIONS[name]);
      assert.strictEqual(ALL_TOOL_DESCRIPTORS[name], WORKFLOW_TOOLS[name]);
    }
  });

  test("every tool, built-in or workflow, has a name for people; only an unknown one has none", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const name of ALL_TOOL_NAMES) assert.ok(ids.includes(`tool.${name}`), name);
    assert.ok(ids.includes("tool.inspect_files"));
    assert.ok(ids.includes("tool.propose_plan"));
    assert.equal(ids.includes(`tool.${UNKNOWN_TOOL_RECORD_NAME}`), false);
    assert.deepEqual(
      ids.filter((id) => id.startsWith("tool.")).sort(),
      ALL_TOOL_NAMES.map((name) => `tool.${name}`).sort(),
    );
    assert.deepEqual(FIXED_MESSAGES["progress.unknown_tool"], {});
  });
});

describe("G-A workflow tool definitions", () => {
  test("every workflow tool has exactly one definition", () => {
    assert.deepEqual(Object.keys(WORKFLOW_TOOL_DEFINITIONS).sort(), [...WORKFLOW_TOOL_NAMES].sort());
  });

  test("definitions are fixed text the real gateway leaves unchanged", () => {
    const privacy = createPrivacyGateway({ secrets: ["fake-secret-VALUE-0003"] });
    for (const name of WORKFLOW_TOOL_NAMES) {
      const definition = WORKFLOW_TOOL_DEFINITIONS[name];
      for (const text of [definition.description, ...strings(definition.inputSchema)]) {
        assert.equal(FRAGMENT.test(text), false, `${name}: no token marker`);
        const masked = privacy.mask(text);
        assert.ok(masked.ok);
        assert.equal(masked.text, text, `${name}: unchanged by masking`);
      }
    }
  });

  test("inspect_files takes path, after and hash only; path is required", () => {
    const schema = WORKFLOW_TOOL_DEFINITIONS.inspect_files.inputSchema;
    assert.equal(schema["type"], "object");
    assert.equal(schema["additionalProperties"], false);
    assert.deepEqual(Object.keys(obj(schema["properties"])).sort(), ["after", "hash", "path"]);
    assert.deepEqual(schema["required"], ["path"]);
  });

  test("propose_plan takes a summary and 1 to MAX_PLAN_ACTIONS move or discard actions", () => {
    const schema = WORKFLOW_TOOL_DEFINITIONS.propose_plan.inputSchema;
    assert.equal(schema["additionalProperties"], false);
    assert.deepEqual(schema["required"], ["summary", "actions"]);
    const properties = obj(schema["properties"]);
    assert.equal(obj(properties["summary"])["maxLength"], MAX_PLAN_SUMMARY_CHARS);
    const actions = obj(properties["actions"]);
    assert.equal(actions["minItems"], 1);
    assert.equal(actions["maxItems"], MAX_PLAN_ACTIONS);
    const variants = obj(actions["items"])["anyOf"] as JsonValue[];
    const byKind = new Map(
      variants.map((variant) => {
        const v = obj(variant);
        return [obj(obj(v["properties"])["kind"])["const"], v] as const;
      }),
    );
    assert.deepEqual([...byKind.keys()].sort(), [...PLAN_ACTION_KINDS].sort());
    assert.deepEqual(obj(byKind.get("move"))["required"], ["kind", "from", "to"]);
    assert.deepEqual(obj(byKind.get("discard"))["required"], ["kind", "path"]);
    for (const variant of byKind.values()) assert.equal(obj(variant)["additionalProperties"], false);
  });
});

describe("G-A workflow tool descriptors", () => {
  test("names match their keys", () => {
    for (const name of WORKFLOW_TOOL_NAMES) assert.equal(WORKFLOW_TOOLS[name].name, name);
  });

  test("inspect_files is a read of its path field and may restore it", () => {
    const tool = WORKFLOW_TOOLS.inspect_files;
    assert.equal(tool.displayClass, "read");
    assert.deepEqual(tool.requires.paths, [{ field: "path", access: "read" }]);
    assert.deepEqual(tool.restoreFields, ["path"]);
    assert.equal(tool.requires.command || tool.requires.network || tool.requires.destructive, false);
    assert.equal(tool.endsRun, undefined);
  });

  test("propose_plan ends the run, declares no path of its own and is not retried as a read", () => {
    const tool = WORKFLOW_TOOLS.propose_plan;
    assert.equal(tool.endsRun, "plan");
    assert.notEqual(tool.displayClass, "read");
    assert.deepEqual(tool.requires.paths, []);
    assert.deepEqual(tool.restoreFields, []);
    assert.equal(tool.requires.command || tool.requires.network || tool.requires.destructive, false);
  });

  test("no built-in tool ends a run or carries a plan action", () => {
    for (const name of TOOL_NAMES) {
      assert.equal(BUILTIN_TOOLS[name].endsRun, undefined, name);
      assert.equal(BUILTIN_TOOLS[name].requires.planAction, undefined, name);
    }
  });
});

describe("G-A plan action descriptors", () => {
  test("one per plan action kind, named apart from every tool", () => {
    assert.deepEqual(Object.keys(PLAN_ACTION_DESCRIPTORS).sort(), [...PLAN_ACTION_KINDS].sort());
    for (const kind of PLAN_ACTION_KINDS) {
      const descriptor = PLAN_ACTION_DESCRIPTORS[kind];
      assert.equal((ALL_TOOL_NAMES as readonly string[]).includes(descriptor.name), false, descriptor.name);
      assert.equal(descriptor.requires.planAction, kind);
    }
  });

  test("every path is a write, every path may be restored, and nothing else is required", () => {
    for (const kind of PLAN_ACTION_KINDS) {
      const descriptor = PLAN_ACTION_DESCRIPTORS[kind];
      assert.ok(descriptor.requires.paths.length > 0, kind);
      for (const entry of descriptor.requires.paths) assert.equal(entry.access, "write", `${kind}.${entry.field}`);
      assert.deepEqual([...descriptor.restoreFields].sort(), descriptor.requires.paths.map((entry) => entry.field).sort());
      assert.deepEqual(descriptor.documentFields, []);
      assert.equal(descriptor.requires.command || descriptor.requires.network || descriptor.requires.destructive, false);
    }
    assert.deepEqual(PLAN_ACTION_DESCRIPTORS.move.requires.paths.map((entry) => entry.field), ["from", "to"]);
    assert.deepEqual(PLAN_ACTION_DESCRIPTORS.discard.requires.paths.map((entry) => entry.field), ["path"]);
  });
});

describe("G-A plan action descriptors with today's policy gate", () => {
  let base: string;
  let workspace: Workspace;
  const policy: PolicyConfig = {
    commands: [],
    network: "deny",
    destructive: "deny",
    restorePathTokens: false,
    protectedPaths: ["keep"],
    planActions: ["move", "discard"],
  };

  before(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-ga-"));
    fs.writeFileSync(path.join(base, "a.txt"), "a");
    fs.mkdirSync(path.join(base, "keep"));
    workspace = await createWorkspace({ root: base });
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  const move = (from: string, to: string): ToolCall => ({ id: "m", name: "plan.move", args: { from, to } });
  const discard = (target: string): ToolCall => ({ id: "d", name: "plan.discard", args: { path: target } });

  test("an action inside the workspace is allowed", () => {
    const gate = createPolicyGate({ config: policy, workspace });
    assert.deepEqual(gate.checkRequested(move("a.txt", "docs/a.txt"), PLAN_ACTION_DESCRIPTORS.move), { allowed: true });
    assert.deepEqual(gate.checkRequested(discard("a.txt"), PLAN_ACTION_DESCRIPTORS.discard), { allowed: true });
  });

  test("a destination outside the root, in the state directory or under a protected path is denied", () => {
    const gate = createPolicyGate({ config: policy, workspace });
    const cases: [ToolCall, string][] = [
      [move("a.txt", "../out.txt"), "outside_root"],
      [move("a.txt", ".codaryn/a.txt"), "state_dir"],
      [move("a.txt", "keep/a.txt"), "protected_path"],
      [move("keep/x.txt", "a2.txt"), "protected_path"],
      [discard("keep/x.txt"), "protected_path"],
    ];
    for (const [call, code] of cases) {
      const descriptor = PLAN_ACTION_DESCRIPTORS[call.name === "plan.move" ? "move" : "discard"];
      const decision = gate.checkRequested(call, descriptor);
      assert.deepEqual(decision, { allowed: false, permission: "path", code }, JSON.stringify(call.args));
    }
  });

  test("a path holding a privacy token is not restored when the policy does not allow it", () => {
    const gate = createPolicyGate({ config: policy, workspace });
    assert.deepEqual(gate.restorableFields(PLAN_ACTION_DESCRIPTORS.move), []);
    const call = move("[[CODARYN_SECRET:00000000000000aa]].txt", "b.txt");
    assert.deepEqual(gate.checkRequested(call, PLAN_ACTION_DESCRIPTORS.move), {
      allowed: false,
      permission: "restore",
      code: "restore_denied",
    });
  });
});
