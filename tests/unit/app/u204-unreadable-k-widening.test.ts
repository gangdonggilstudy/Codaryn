/**
 * Unit U-204 (DR-69 bundle A, A-7, proposal R-7, the app layer's part): the settings widening
 * judgment (`wideningOf`) knows a policy's `unreadablePaths` and the group size k (`minGroupSize`).
 * - unreadablePaths is a deny list that only adds up (the config's, a profile's, a workflow
 *   definition's and a task file's entries, the union). An old entry that is not in the new list
 *   (the same by the gate's matching, compilePathSet `exact`) is `unreadable_path_removed` at the
 *   list, even where a broader entry stands now: the gate resolves a deny entry to its real path,
 *   so a link there can have covered what the broader entry does not (as V-8 for writable paths).
 *   An entry taken out of a profile's or a workflow's own list that the config's new list still
 *   has is not one: those runs keep it.
 * - k: the config's value (DEFAULT_MIN_GROUP_SIZE when it sets none) is the base; a profile and a
 *   definition can only raise it (effectiveMinGroupSize). A lower effective k is
 *   `min_group_size_lowered`: for the config, and for a profile's or a workflow's own raise judged
 *   on the new base (the config's own change is said once, at the config).
 * - Adding an entry and raising k narrow.
 * The parsers still refuse both fields until A-6, so the judgment is called directly.
 * Reproduced first (todo until the judgment knows the fields). Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CodarynConfig } from "../../../src/contracts/index.js";
import { wideningOf } from "../../../src/app/index.js";

const TODO = { todo: "U-204: the widening judgment does not know unreadablePaths or minGroupSize yet" };
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false } as const;
const BASE = { schemaVersion: 1, model: "fake-model-a", maxOutputTokens: 64 } as unknown as CodarynConfig;
type Workflow = NonNullable<CodarynConfig["workflows"]>[string];
type Extra = { readonly unreadablePaths?: readonly string[]; readonly minGroupSize?: number };

const policyWith = (extra: Extra) => ({ ...POLICY, ...extra });
const withPolicy = (extra: Extra, more: object = {}): CodarynConfig => ({ ...BASE, policy: policyWith(extra), ...more }) as unknown as CodarynConfig;
const kinds = (before: CodarynConfig, after: CodarynConfig): string[] => wideningOf(before, after).map((item) => `${item.kind} ${item.field}`);
const config = (before: Extra, after: Extra): string[] => kinds(withPolicy(before), withPolicy(after));

describe("U-204: the config's unreadablePaths", () => {
  test("an entry taken away is a widening, said at the list; the list gone too", TODO, () => {
    assert.deepEqual(config({ unreadablePaths: ["data/private"] }, { unreadablePaths: [] }), ["unreadable_path_removed policy.unreadablePaths"]);
    assert.deepEqual(config({ unreadablePaths: ["data/private"] }, {}), ["unreadable_path_removed policy.unreadablePaths"]);
    assert.deepEqual(config({ unreadablePaths: ["a", "b"] }, { unreadablePaths: ["b"] }), ["unreadable_path_removed policy.unreadablePaths"]);
  });

  test("an entry replaced by a broader one is a widening too: a link under the old one can lead elsewhere", TODO, () => {
    assert.deepEqual(config({ unreadablePaths: ["data/private"] }, { unreadablePaths: ["data"] }), ["unreadable_path_removed policy.unreadablePaths"]);
  });

  test("adding, the same entries in another order or spelling: no widening", () => {
    assert.deepEqual(config({}, { unreadablePaths: ["data"] }), []);
    assert.deepEqual(config({ unreadablePaths: ["a"] }, { unreadablePaths: ["a", "b"] }), []);
    assert.deepEqual(config({ unreadablePaths: ["a", "b"] }, { unreadablePaths: ["b", "a"] }), []);
    assert.deepEqual(config({ unreadablePaths: ["data/private"] }, { unreadablePaths: ["data/private/"] }), []);
  });
});

describe("U-204: the config's group size k", () => {
  test("a lower effective k is a widening: set lower, lowered, or taken away above the default", TODO, () => {
    assert.deepEqual(config({}, { minGroupSize: 3 }), ["min_group_size_lowered policy.minGroupSize"], "from the default 5");
    assert.deepEqual(config({ minGroupSize: 10 }, { minGroupSize: 8 }), ["min_group_size_lowered policy.minGroupSize"]);
    assert.deepEqual(config({ minGroupSize: 10 }, {}), ["min_group_size_lowered policy.minGroupSize"], "back to the default 5");
  });

  test("raising k, or the same effective k: no widening", () => {
    assert.deepEqual(config({}, { minGroupSize: 10 }), []);
    assert.deepEqual(config({ minGroupSize: 5 }, {}), [], "the default is 5");
    assert.deepEqual(config({ minGroupSize: 3 }, {}), [], "back to the default raises it");
    assert.deepEqual(config({ minGroupSize: 8 }, { minGroupSize: 8 }), []);
  });
});

describe("U-204: a profile's and a workflow's own entries and raise", () => {
  const profile = (extra: Extra | undefined) => ({ docs: extra === undefined ? {} : { policy: policyWith(extra) } });
  const docs = (extra: Extra): Workflow => ({ label: "Docs", tools: ["read_file", "query_table"], policy: policyWith(extra) }) as unknown as Workflow;

  test("a profile's entry taken away is said for it, unless the config's new list still has it", TODO, () => {
    assert.deepEqual(kinds(withPolicy({}, { profiles: profile({ unreadablePaths: ["p"] }) }), withPolicy({}, { profiles: profile({ unreadablePaths: [] }) })), [
      "profile_changed profiles",
      "unreadable_path_removed profiles.docs.policy.unreadablePaths",
    ]);
    assert.deepEqual(kinds(withPolicy({}, { profiles: profile({ unreadablePaths: ["p"] }) }), withPolicy({}, { profiles: profile(undefined) })), [
      "profile_changed profiles",
      "unreadable_path_removed profiles.docs.policy.unreadablePaths",
    ], "the profile's policy gone: its entries with it");
    assert.deepEqual(kinds(withPolicy({ unreadablePaths: ["c"] }, { profiles: profile({ unreadablePaths: ["c"] }) }), withPolicy({ unreadablePaths: ["c"] }, { profiles: profile({ unreadablePaths: [] }) })), ["profile_changed profiles"]);
  });

  test("a profile's raise lowered is said for it; the config's base change is said once, at the config", TODO, () => {
    assert.deepEqual(kinds(withPolicy({}, { profiles: profile({ minGroupSize: 10 }) }), withPolicy({}, { profiles: profile({ minGroupSize: 7 }) })), [
      "profile_changed profiles",
      "min_group_size_lowered profiles.docs.policy.minGroupSize",
    ]);
    assert.deepEqual(kinds(withPolicy({}, { profiles: profile({ minGroupSize: 10 }) }), withPolicy({}, { profiles: profile({}) })), [
      "profile_changed profiles",
      "min_group_size_lowered profiles.docs.policy.minGroupSize",
    ]);
    assert.deepEqual(kinds(withPolicy({}, { profiles: profile({ minGroupSize: 3 }) }), withPolicy({}, { profiles: profile({}) })), ["profile_changed profiles"], "a raise below the base raised nothing");
    assert.deepEqual(kinds(withPolicy({ minGroupSize: 10 }, { profiles: profile({ minGroupSize: 8 }) }), withPolicy({}, { profiles: profile({ minGroupSize: 8 }) })), ["min_group_size_lowered policy.minGroupSize"]);
  });

  test("a workflow definition's own entries and raise, as a profile's", TODO, () => {
    assert.deepEqual(kinds(withPolicy({}, { workflows: { docs: docs({ unreadablePaths: ["w"] }) } }), withPolicy({}, { workflows: { docs: docs({}) } })), [
      "workflow_changed workflows",
      "unreadable_path_removed workflows.docs.policy.unreadablePaths",
    ]);
    assert.deepEqual(kinds(withPolicy({ unreadablePaths: ["w"] }, { workflows: { docs: docs({ unreadablePaths: ["w"] }) } }), withPolicy({ unreadablePaths: ["w"] }, { workflows: { docs: docs({}) } })), ["workflow_changed workflows"]);
    assert.deepEqual(kinds(withPolicy({}, { workflows: { docs: docs({ minGroupSize: 20 }) } }), withPolicy({}, { workflows: { docs: docs({ minGroupSize: 10 }) } })), [
      "workflow_changed workflows",
      "min_group_size_lowered workflows.docs.policy.minGroupSize",
    ]);
  });
});
