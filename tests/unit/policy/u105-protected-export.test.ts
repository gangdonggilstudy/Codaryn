/**
 * U-105 (app layer U-89): the policy gives out its own matcher for `protectedPaths` from its index,
 * so the app layer's workspace list marks protected entries with the gate's rule and no longer
 * imports `policy/protected.js` directly. The export is the same function; its lexical answer is
 * the one the gate gives for a write before resolving paths. Only an addition: nothing else changed.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { BUILTIN_TOOLS } from "../../../src/contracts/index.js";
import type { PolicyConfig, ToolDescriptor, Workspace } from "../../../src/contracts/index.js";
import * as policy from "../../../src/policy/index.js";
import type { ProtectedPaths } from "../../../src/policy/index.js";
import * as direct from "../../../src/policy/protected.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const BASE: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const ENTRIES = ["keep", "docs/fixed.md"];

let base = "";
let workspace: Workspace;
before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u105-pp-"));
  const root = path.join(base, "root");
  fs.mkdirSync(path.join(root, "keep"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  workspace = await createWorkspace({ root });
});
after(() => fs.rmSync(base, { recursive: true, force: true }));

describe("U-105: compileProtectedPaths from the policy's index", () => {
  test("it is the gate's own function, and its type is given out with it", () => {
    assert.equal(policy.compileProtectedPaths, direct.compileProtectedPaths);
    const matcher: ProtectedPaths = policy.compileProtectedPaths(ENTRIES);
    assert.equal(typeof matcher.covers, "function");
    assert.equal(typeof matcher.coversEffective, "function");
  });

  test("its lexical answer is the gate's first answer for a write", () => {
    const matcher = policy.compileProtectedPaths(ENTRIES);
    const gate = policy.createPolicyGate({ config: { ...BASE, protectedPaths: ENTRIES }, workspace });
    const descriptor: ToolDescriptor = BUILTIN_TOOLS.write_file;
    const denied: string[] = [];
    for (const relative of ["keep", "keep/a.txt", "KEEP/b.txt", "docs/fixed.md", "docs/other.md", "notes.txt", "keeper.txt"]) {
      const call = { id: "c1", name: "write_file", args: { path: relative, change: { kind: "replace_all", content: "x" } } };
      const decision = gate.checkRequested(call, descriptor);
      const deniedAsProtected = !decision.allowed && decision.code === "protected_path";
      if (relative === "KEEP/b.txt" && !(process.platform === "win32" || process.platform === "darwin")) continue;
      assert.equal(matcher.covers(relative), deniedAsProtected, relative);
      if (deniedAsProtected) denied.push(relative);
    }
    const folds = process.platform === "win32" || process.platform === "darwin";
    assert.deepEqual(denied, folds ? ["keep", "keep/a.txt", "KEEP/b.txt", "docs/fixed.md"] : ["keep", "keep/a.txt", "docs/fixed.md"]);
  });

  test("absent or empty protects nothing; a value the format rule refuses protects everything", () => {
    assert.equal(policy.compileProtectedPaths(undefined).covers("a.txt"), false);
    assert.equal(policy.compileProtectedPaths([]).covers("a.txt"), false);
    assert.equal(policy.compileProtectedPaths(["../outside"]).covers("a.txt"), true);
    assert.equal(policy.compileProtectedPaths("keep").covers("a.txt"), true);
  });
});
