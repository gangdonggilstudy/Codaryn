/**
 * G-F, general-tasks.md 7.1, PM answer Q5: doctor's commands check warns when a command rule takes
 * any further arguments (`allowExtraArgs: true`) while plans may move or discard files
 * (`policy.planActions`). No new check id.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import type { DoctorOutput } from "../../../src/contracts/index.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { lexicalLocate } from "./locate.js";

const base = path.resolve("/tmp/codaryn-q5");

function task(policy: Record<string, unknown>): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: "q5",
    goal: "g",
    workflow: "label",
    workspaceRoot: "./ws",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { network: "deny", destructive: "deny", restorePathTokens: false, ...policy },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 },
    verifiers: [],
  });
}

async function commandsCheck(policy: Record<string, unknown>): Promise<{ status: string; message: string; text?: { id: string; params?: unknown } }> {
  const outcome = await runDoctor({
    argv: ["doctor", "--task", "task.json", "--json"],
    env: {},
    cwd: base,
    nodeVersion: "26.0.0",
    readFile: async (file) => {
      if (path.basename(file) === "task.json") return task(policy);
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    isDirectory: async () => true,
    isFile: async () => true,
    locateInWorkspace: lexicalLocate,
    relatePaths: async () => "separate",
    inspectLock: async () => "none",
  });
  assert.ok("text" in outcome, JSON.stringify(outcome));
  const check = (JSON.parse(outcome.text) as DoctorOutput).checks.find((item) => item.id === "commands");
  assert.ok(check !== undefined);
  return check as unknown as { status: string; message: string; text?: { id: string; params?: unknown } };
}

/** Node itself, by its absolute path, so the lookup finds it without PATH. */
const RULE = (allowExtraArgs: boolean) => ({ executable: process.execPath, argsPrefix: ["tools/fmt.js"], allowExtraArgs });

describe("Q5: command rules with extra arguments beside plan actions", () => {
  test("a rule with allowExtraArgs and plan actions together warn, with the number of such rules", async () => {
    const check = await commandsCheck({ commands: [RULE(true), RULE(false), RULE(true)], planActions: ["move"] });
    assert.equal(check.status, "warn", JSON.stringify(check));
    assert.ok(check.message.includes("allowExtraArgs") && check.message.includes("policy.planActions"), check.message);
    assert.ok(check.message.startsWith("2 command rule(s)"), check.message);
    // Until the contract base has doctor.commands.extra_args_with_plan, the check has no typed text
    // and the renderer prints the English message.
    assert.equal(check.text, undefined);
  });

  test("either alone does not", async () => {
    for (const policy of [{ commands: [RULE(true)] }, { commands: [RULE(false)], planActions: ["move", "discard"] }, { commands: [RULE(true)], planActions: [] }]) {
      const check = await commandsCheck(policy);
      assert.ok(!check.message.includes("allowExtraArgs"), JSON.stringify(policy));
    }
  });
});
