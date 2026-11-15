/**
 * U-175, review V-3 M-1: an allow list must not allow what it could not check. Before the fix a
 * writable entry whose text matched the write allowed it at once, without resolving the entry, so
 * an entry the workspace could not resolve still allowed. The two reproductions of V-3, with the
 * failure injected at the workspace (the entry's own resolve, `read` access; the write's target
 * resolves as usual):
 * - a config list's prefix entry `a`, the write `a/x.txt`;
 * - a plan's exact entry `a/x.txt`, the same write.
 * Both must be `path_not_writable`, also when the resolve throws. The protected paths (a deny list)
 * keep their rule: an entry they cannot resolve still denies.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { BUILTIN_TOOLS } from "../../../src/contracts/index.js";
import type { EffectiveToolCall, PathAccess, PolicyConfig, ResolvePathOutcome, WritablePathSet, Workspace } from "../../../src/contracts/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { compilePathSet } from "../../../src/policy/path-set.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const ALLOW = { allowed: true };
const NOT_WRITABLE = { allowed: false, permission: "path", code: "path_not_writable" };
const PROTECTED = { allowed: false, permission: "path", code: "protected_path" };
const BASE: PolicyConfig = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };

let base: string;
let real: Workspace;

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u175v3-"));
  const root = path.join(base, "root");
  fs.mkdirSync(path.join(root, "a"), { recursive: true });
  fs.writeFileSync(path.join(root, "a", "x.txt"), "x\n");
  real = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** The real workspace, except that resolving one of `failing` for reading fails (refused or thrown). */
function faulty(failing: readonly string[], how: "refused" | "thrown"): Workspace & { readonly entryResolves: () => number } {
  let entryResolves = 0;
  return {
    root: real.root,
    readText: (p) => real.readText(p),
    list: (p) => real.list(p),
    writeText: (r) => real.writeText(r),
    async resolve(given: string, access: PathAccess): Promise<ResolvePathOutcome> {
      if (access === "read" && failing.includes(given)) {
        entryResolves += 1;
        if (how === "thrown") throw new Error("EACCES (injected)");
        return { ok: false, code: "invalid_path" };
      }
      return real.resolve(given, access);
    },
    entryResolves: () => entryResolves,
  };
}

async function writeVerdict(workspace: Workspace, sets: readonly WritablePathSet[], extra: Partial<PolicyConfig> = {}): Promise<object> {
  const gate = createPolicyGate({ config: { ...BASE, ...extra }, workspace, writablePathSets: sets });
  const args = { path: "a/x.txt", expectedHash: null, change: { kind: "replace_all", content: "y" } };
  return gate.checkEffective({ id: "c1", name: "write_file", args } as unknown as EffectiveToolCall, BUILTIN_TOOLS.write_file);
}

const CASES: readonly [string, WritablePathSet][] = [
  ["config prefix entry a", { source: "config", entries: ["a"] }],
  ["plan exact entry a/x.txt", { source: "plan", entries: ["a/x.txt"] }],
];

describe("V-3 M-1: an allow list allows only through an entry it could resolve", () => {
  test("without a failure both lists allow the write (the control)", async () => {
    for (const [name, set] of CASES) assert.deepEqual(await writeVerdict(real, [set]), ALLOW, name);
  });

  for (const how of ["refused", "thrown"] as const) {
    test(`the entry's resolve ${how}: the write is not allowed, and the entry was really asked`, async () => {
      for (const [name, set] of CASES) {
        const workspace = faulty(set.entries, how);
        assert.deepEqual(await writeVerdict(workspace, [set]), NOT_WRITABLE, name);
        assert.ok(workspace.entryResolves() >= 1, `${name}: the entry was resolved, not passed by its text`);
      }
    });

    test(`the matcher itself (${how}): the text alone covers nothing`, async () => {
      for (const [name, set] of CASES) {
        const matcher = compilePathSet(set.entries, { match: set.source === "plan" ? "exact" : "prefix", onUnusable: "misses" });
        assert.equal(await matcher.coversEffective("a/x.txt", faulty(set.entries, how)), false, name);
      }
    });
  }

  test("another entry that resolves still allows: only the unchecked entry allows nothing", async () => {
    const workspace = faulty(["a"], "refused");
    assert.deepEqual(await writeVerdict(workspace, [{ source: "config", entries: ["a", "a/x.txt"] }]), ALLOW);
  });

  test("the protected paths keep their rule: an entry they cannot resolve still denies", async () => {
    assert.deepEqual(await writeVerdict(faulty(["a"], "refused"), [], { protectedPaths: ["a"] }), PROTECTED);
    assert.deepEqual(await writeVerdict(faulty(["b"], "refused"), [], { protectedPaths: ["b"] }), PROTECTED, "unresolvable and not matching: fail closed, as before");
  });
});
