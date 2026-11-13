/**
 * U-183, Codex's verification V-8 M-1: a writable path list narrowed by its text can still open a
 * new real scope. With a junction `a/b` → `c` in a workspace, `["a"]` → `["a/b"]` is narrower by
 * the letters, but the policy gate resolves an allow entry to its real path, so after the change a
 * write to `c/target.txt` is allowed where it was denied. The settings change was not a widening by
 * the text comparison (none for the config, only profile_changed / workflow_changed for the others).
 * A config's, a profile's or a workflow definition's list is used in every workspace, each with its
 * own links, so whether a new entry passes a link cannot be checked when the settings change: an
 * entry that is not one of the old entries (the same by the gate's matching) is a widening.
 * Reproduced first (e7d62d2, todo until the judgment treated a new entry so). Temporary folders, a junction
 * (no privilege needed on Windows), fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { BUILTIN_TOOLS } from "../../../src/contracts/index.js";
import type { CodarynConfig, WritablePathSource } from "../../../src/contracts/index.js";
import { wideningOf } from "../../../src/app/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } as const;
const BASE = { schemaVersion: 1, model: "fake-model-a", maxOutputTokens: 64 } as unknown as CodarynConfig;
type Workflow = NonNullable<CodarynConfig["workflows"]>[string];

const policyWith = (writable: readonly string[]) => ({ ...POLICY, writablePaths: writable });
/** The config with `writable` in one place: the config's policy, the profile `docs`, or the workflow `docs`. */
function placed(where: "config" | "profile" | "definition", writable: readonly string[]): CodarynConfig {
  if (where === "config") return { ...BASE, policy: policyWith(writable) } as unknown as CodarynConfig;
  if (where === "profile") return { ...BASE, profiles: { docs: { policy: policyWith(writable) } } } as unknown as CodarynConfig;
  const docs = { label: "Docs", tools: ["read_file", "write_file"], policy: policyWith(writable) } as unknown as Workflow;
  return { ...BASE, workflows: { docs } } as unknown as CodarynConfig;
}
const FIELD = { config: "policy.writablePaths", profile: "profiles.docs.policy.writablePaths", definition: "workflows.docs.policy.writablePaths" } as const;

describe("U-183 V-8 M-1: an entry narrower by its text through a junction", () => {
  test("the gate allows a new real scope; the judgment says writable_path_added for each list", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codaryn-u183-v8-"));
    await mkdir(path.join(root, "a"));
    await mkdir(path.join(root, "c"));
    await writeFile(path.join(root, "c", "target.txt"), "synthetic\n");
    await symlink(path.join(root, "c"), path.join(root, "a", "b"), "junction");
    const workspace = await createWorkspace({ root });
    const call = { id: "v8", name: "write_file" as const, args: { path: "c/target.txt", expectedHash: null, change: { kind: "replace_all", content: "x" } } };
    for (const where of ["config", "profile", "definition"] as const) {
      const source: WritablePathSource = where;
      const gate = (entries: readonly string[]) => createPolicyGate({ config: POLICY, workspace, writablePathSets: [{ source, entries }] });
      // The fact V-8 found: the change opens c/ to a write.
      assert.equal((await gate(["a"]).checkEffective(call, BUILTIN_TOOLS.write_file)).allowed, false, `${where}: denied before`);
      assert.equal((await gate(["a/b"]).checkEffective(call, BUILTIN_TOOLS.write_file)).allowed, true, `${where}: allowed after`);
      const kinds = wideningOf(placed(where, ["a"]), placed(where, ["a/b"])).map((item) => `${item.kind} ${item.field}`);
      assert.ok(kinds.includes(`writable_path_added ${FIELD[where]}[0]`), `${where}: ${kinds.join(", ")}`);
    }
  });
});
