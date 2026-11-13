/**
 * U-203 (P1 bundle A, A-3): the contract's helpers the CLI and the app call when they wire unreadable
 * paths (A-6): every source's entries united (R-2), the user's settings added to a task file's own
 * policy, the integrity targets (R-3) and the resolution's refusal beside commands (R-5).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { integrityPathsOf, privateDataProblem, unreadablePathsOf, withUnreadablePaths } from "../../../src/contracts/index.js";
import type { PolicyConfig, VerifierConfig } from "../../../src/contracts/index.js";

const base: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const commandVerifier = { id: "v", kind: "command", executable: "node", args: ["x"] } as unknown as VerifierConfig;
const fileVerifier = { id: "f", kind: "file_rules", rules: [{ type: "exists", path: "a" }] } as VerifierConfig;

describe("U-203: unreadable path helpers", () => {
  test("R-2: the union of the sources, in order, each entry once", () => {
    assert.deepEqual(unreadablePathsOf([["data"], undefined, ["data", "people"], []]), ["data", "people"]);
    assert.deepEqual(unreadablePathsOf([]), []);
  });

  test("R-2: a task file's own policy gets the settings' entries; nothing added leaves it as it was", () => {
    const task: PolicyConfig = { ...base, unreadablePaths: ["mine"] };
    assert.deepEqual(withUnreadablePaths(task, [["data"], undefined]).unreadablePaths, ["mine", "data"]);
    assert.equal(withUnreadablePaths(base, [undefined, []]), base, "the same object, no key added");
    assert.deepEqual(withUnreadablePaths(base, [["data"]]).unreadablePaths, ["data"]);
  });

  test("R-3: the integrity checks watch the protected and the unreadable paths", () => {
    assert.deepEqual(integrityPathsOf({ ...base, protectedPaths: ["tests"], unreadablePaths: ["data", "tests"] }), ["tests", "data"]);
    assert.deepEqual(integrityPathsOf(base), []);
  });

  test("R-5: unreadable paths with a command rule or a command verifier are refused; without them, nothing", () => {
    const rule = { executable: "node", argsPrefix: [], allowExtraArgs: true };
    assert.deepEqual(privateDataProblem({ ...base, unreadablePaths: ["data"], commands: [rule] }, []), { problem: "unreadable_with_commands", field: "policy.commands" });
    assert.deepEqual(privateDataProblem({ ...base, unreadablePaths: ["data"] }, [fileVerifier, commandVerifier]), { problem: "unreadable_with_commands", field: "verifiers[1]" });
    assert.equal(privateDataProblem({ ...base, unreadablePaths: ["data"] }, [fileVerifier]), null);
    assert.equal(privateDataProblem({ ...base, commands: [rule] }, [commandVerifier]), null, "no unreadable path: commands as before");
  });
});
