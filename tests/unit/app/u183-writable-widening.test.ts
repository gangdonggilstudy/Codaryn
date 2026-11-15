/**
 * Unit U-183 (DR-69 bundle B, B-4, the app layer's part): the settings widening judgment
 * (`wideningOf`, src/app/settings-change.ts) knows a policy's `writablePaths`. Absent is no limit;
 * a list is an allow list where an entry covers itself and everything below it, and every source's
 * list is its own list (the config's, a profile's, a workflow definition's: a write must be covered
 * by each).
 * - Widening: an entry that is not one of the old entries (the policy gate's matching, path-set.ts
 *   `exact`: whole segments, ignoring case and taking `\` on Windows), `writable_path_added` at that
 *   entry; the list removed (back to no limit), `writable_paths_unlimited` at the list.
 *   V-8 M-1 (u183-v8-writable-links.test.ts): an entry inside an old one is a widening too, since a
 *   link there can point elsewhere in any workspace the list is used in; at first (ba7cec7) only an
 *   entry covering more by its letters was.
 * - Narrowing (no confirmation): an entry removed, the same entries in another order or spelling, an
 *   empty list, a list newly set where there was none.
 * The config parser still refuses the field until B-4, so the judgment is called directly.
 * Reproduced first (8648107, todo until the judgment knew the field). Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CodarynConfig } from "../../../src/contracts/index.js";
import { wideningOf } from "../../../src/app/index.js";

const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } as const;
const BASE = { schemaVersion: 1, model: "fake-model-a", maxOutputTokens: 64 } as unknown as CodarynConfig;
type Workflow = NonNullable<CodarynConfig["workflows"]>[string];
const WINDOWS = process.platform === "win32";

/** A config whose policy has `writable` (left out when undefined). */
const withPaths = (writable: readonly string[] | undefined, extra: object = {}): CodarynConfig =>
  ({ ...BASE, policy: { ...POLICY, ...(writable === undefined ? {} : { writablePaths: writable }) }, ...extra }) as unknown as CodarynConfig;
const kinds = (before: CodarynConfig, after: CodarynConfig): string[] => wideningOf(before, after).map((item) => `${item.kind} ${item.field}`);
const config = (before: readonly string[] | undefined, after: readonly string[] | undefined): string[] => kinds(withPaths(before), withPaths(after));

describe("U-183: the config's writablePaths in the widening judgment", () => {
  test("the list removed: back to no limit, a widening", () => {
    assert.deepEqual(config(["out"], undefined), ["writable_paths_unlimited policy.writablePaths"]);
    assert.deepEqual(config([], undefined), ["writable_paths_unlimited policy.writablePaths"], "from no writes at all");
  });

  test("an entry that covers more: added, a broader prefix, the root; named at the entry", () => {
    assert.deepEqual(config(["out"], ["out", "docs"]), ["writable_path_added policy.writablePaths[1]"]);
    assert.deepEqual(config(["out/reports"], ["out"]), ["writable_path_added policy.writablePaths[0]"]);
    assert.deepEqual(config(["out"], ["."]), ["writable_path_added policy.writablePaths[0]"]);
    assert.deepEqual(config([], ["out"]), ["writable_path_added policy.writablePaths[0]"], "an empty list allowed no write");
    assert.deepEqual(config(["out", "docs"], ["notes", "out", "drafts"]), ["writable_path_added policy.writablePaths[0]", "writable_path_added policy.writablePaths[2]"]);
  });

  test("narrowing needs no confirmation: removed, the same entries, a new list, an empty list", () => {
    assert.deepEqual(config(undefined, undefined), []);
    assert.deepEqual(config(undefined, ["out"]), [], "a list where there was none narrows");
    assert.deepEqual(config(undefined, []), [], "an empty list allows no write");
    assert.deepEqual(config(["out", "docs"], ["docs"]), []);
    assert.deepEqual(config(["out"], []), []);
    assert.deepEqual(config(["out", "docs"], ["docs", "out"]), [], "the order is not a widening");
    assert.deepEqual(config(["out"], ["out/"]), [], "a trailing slash is the same entry");
    assert.deepEqual(config(["out/reports"], ["./out//reports"]), [], "`./` and a doubled `/` are the same entry");
  });

  // V-8 M-1: inside an old entry by the letters, but a link there can point anywhere.
  test("an entry inside an old one is a widening too: it cannot be checked for a link in every workspace", () => {
    assert.deepEqual(config(["out"], ["out/reports"]), ["writable_path_added policy.writablePaths[0]"]);
    assert.deepEqual(config(["out"], ["out", "out/sub", "out/x/y.md"]), ["writable_path_added policy.writablePaths[1]", "writable_path_added policy.writablePaths[2]"]);
    assert.deepEqual(config(["."], ["out"]), ["writable_path_added policy.writablePaths[0]"]);
  });

  test("the gate's matching: whole segments; case and backslashes as the platform has them", () => {
    assert.deepEqual(config(["out"], ["output"]), ["writable_path_added policy.writablePaths[0]"], "not the same by letters");
    assert.deepEqual(config(["out"], ["OUT"]), WINDOWS ? [] : ["writable_path_added policy.writablePaths[0]"]);
    if (WINDOWS) assert.deepEqual(config(["out/reports"], ["out\\reports"]), []);
  });
});

describe("U-183: a profile's and a workflow's own writablePaths", () => {
  const profile = (writable: readonly string[] | undefined, own = true) => ({ docs: own ? { policy: { ...POLICY, ...(writable === undefined ? {} : { writablePaths: writable }) } } : {} });

  test("a profile's list removed or widened is said for that profile, besides profile_changed", () => {
    assert.deepEqual(kinds(withPaths(undefined, { profiles: profile(["out"]) }), withPaths(undefined, { profiles: profile(undefined) })), [
      "profile_changed profiles",
      "writable_paths_unlimited profiles.docs.policy.writablePaths",
    ]);
    assert.deepEqual(kinds(withPaths(undefined, { profiles: profile(["out"]) }), withPaths(undefined, { profiles: profile(undefined, false) })), [
      "profile_changed profiles",
      "writable_paths_unlimited profiles.docs.policy.writablePaths",
    ], "the profile's policy gone: its list with it");
    assert.deepEqual(kinds(withPaths(undefined, { profiles: profile(["out"]) }), withPaths(undefined, { profiles: profile(["out", "docs"]) })), [
      "profile_changed profiles",
      "writable_path_added profiles.docs.policy.writablePaths[1]",
    ]);
  });

  test("a profile's list narrowed or new is profile_changed only; the config's list judges itself", () => {
    assert.deepEqual(kinds(withPaths(undefined, { profiles: profile(undefined) }), withPaths(undefined, { profiles: profile(["out"]) })), ["profile_changed profiles"]);
    assert.deepEqual(kinds(withPaths(undefined, { profiles: profile(["out", "docs"]) }), withPaths(undefined, { profiles: profile(["out"]) })), ["profile_changed profiles"]);
    assert.deepEqual(kinds(withPaths(["out"], { profiles: profile(["out"]) }), withPaths(undefined, { profiles: profile(["out"]) })), ["writable_paths_unlimited policy.writablePaths"]);
  });

  test("a workflow definition's list is its own: widened or removed is said for that workflow", () => {
    const docs = (writable: readonly string[] | undefined): Workflow =>
      ({ label: "Docs", tools: ["read_file", "write_file"], policy: { ...POLICY, ...(writable === undefined ? {} : { writablePaths: writable }) } }) as unknown as Workflow;
    assert.deepEqual(kinds(withPaths(undefined, { workflows: { docs: docs(["out"]) } }), withPaths(undefined, { workflows: { docs: docs(["out", "docs"]) } })), [
      "workflow_changed workflows",
      "writable_path_added workflows.docs.policy.writablePaths[1]",
    ]);
    assert.deepEqual(kinds(withPaths(undefined, { workflows: { docs: docs(["out"]) } }), withPaths(undefined, { workflows: { docs: docs(undefined) } })), [
      "workflow_changed workflows",
      "writable_paths_unlimited workflows.docs.policy.writablePaths",
    ]);
    assert.deepEqual(kinds(withPaths(undefined, { workflows: { docs: docs(["out", "docs"]) } }), withPaths(undefined, { workflows: { docs: docs(["docs"]) } })), ["workflow_changed workflows"], "an entry removed narrows");
    // V-8 M-1: inside the old entry by the letters is still a new entry.
    assert.deepEqual(kinds(withPaths(undefined, { workflows: { docs: docs(["out"]) } }), withPaths(undefined, { workflows: { docs: docs(["out/a"]) } })), [
      "workflow_changed workflows",
      "writable_path_added workflows.docs.policy.writablePaths[0]",
    ]);
    // The config's list and the workflow's are separate lists: each change is said where it is.
    assert.deepEqual(kinds(withPaths(["out"], { workflows: { docs: docs(["out"]) } }), withPaths(["out", "docs"], { workflows: { docs: docs(["out", "docs"]) } })), [
      "writable_path_added policy.writablePaths[1]",
      "workflow_changed workflows",
      "writable_path_added workflows.docs.policy.writablePaths[1]",
    ]);
  });
});
