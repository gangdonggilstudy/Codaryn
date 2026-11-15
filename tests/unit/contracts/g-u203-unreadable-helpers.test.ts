/**
 * U-203 (P1 bundle A, A-3; review R-102 M-1): the contract's helpers the CLI and the app call when
 * they wire unreadable paths (A-6): every source's entries united into the run's list
 * (ResolvedTaskSpec.unreadablePaths, R-2), the integrity targets (R-3) and the resolution's refusal
 * beside commands (R-5), both from the run's list, not one source's.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { integrityPathsOf, privateDataProblem, unreadablePathsOf } from "../../../src/contracts/index.js";
import type { VerifierConfig } from "../../../src/contracts/index.js";

const commandVerifier = { id: "v", kind: "command", executable: "node", args: ["x"] } as unknown as VerifierConfig;
const fileVerifier = { id: "f", kind: "file_rules", rules: [{ type: "exists", path: "a" }] } as VerifierConfig;
const rule = { executable: "node", argsPrefix: [], allowExtraArgs: true };

describe("U-203: unreadable path helpers", () => {
  test("R-2: the run's list is the union of the sources, in order, each entry once", () => {
    // config file, profile, definition, task file: the config's own also in a task file's run.
    assert.deepEqual(unreadablePathsOf([["data"], undefined, ["data", "people"], ["mine"]]), ["data", "people", "mine"]);
    assert.deepEqual(unreadablePathsOf([]), []);
  });

  test("R-3: the integrity checks watch the protected paths and the run's unreadable paths", () => {
    assert.deepEqual(integrityPathsOf(["tests"], ["data", "tests"]), ["tests", "data"]);
    assert.deepEqual(integrityPathsOf(undefined, undefined), []);
  });

  test("R-5: the run's unreadable paths with a command rule or a command verifier are refused; without them, nothing", () => {
    assert.deepEqual(privateDataProblem(["data"], { commands: [rule] }, []), { problem: "unreadable_with_commands", field: "policy.commands" });
    assert.deepEqual(privateDataProblem(["data"], { commands: [] }, [fileVerifier, commandVerifier]), { problem: "unreadable_with_commands", field: "verifiers[1]" });
    assert.equal(privateDataProblem(["data"], { commands: [] }, [fileVerifier]), null);
    assert.equal(privateDataProblem(undefined, { commands: [rule] }, [commandVerifier]), null, "no unreadable path: commands as before");
    assert.equal(privateDataProblem([], { commands: [rule] }, []), null);
  });
});
