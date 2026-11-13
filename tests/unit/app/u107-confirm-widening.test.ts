/**
 * Unit U-107 (review R-79 F-1, before the config takes `confirm`): the settings change's widening
 * judgement did not look at a command rule's `confirm` (U-74, DR-3). A rule that asked a person
 * before each call and now does not, or a plain copy of an asking rule (the gate allows a call any
 * rule without `confirm` allows), lets runs do without a question what they did only with one: that
 * is widening, `confirm_removed`, so the GUI's main process asks the person before it is written.
 * Making a rule ask is narrowing; a new asking rule is still a command added.
 * The config file cannot hold `confirm` yet, so the judgement (wideningOf) is called directly.
 * Reproduced first (todo until fixed). Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wideningOf } from "../../../src/app/index.js";
import type { CodarynConfig } from "../../../src/contracts/index.js";

const TODO = { todo: "U-107: the widening judgement does not look at confirm yet" };

const GIT = { executable: "git", argsPrefix: ["status"], allowExtraArgs: false } as const;
const ASKING_GIT = { ...GIT, confirm: true } as const;
const NODE_ANY = { executable: "node", argsPrefix: [], allowExtraArgs: true } as const;

function config(commands: readonly object[], profiles?: Record<string, unknown>): CodarynConfig {
  return {
    schemaVersion: 1,
    policy: { commands, network: "deny", destructive: "deny", restorePathTokens: false },
    ...(profiles === undefined ? {} : { profiles }),
  } as unknown as CodarynConfig;
}

const kinds = (before: CodarynConfig, after: CodarynConfig): string[] => wideningOf(before, after).map((item) => `${item.kind}@${item.field}`);

describe("U-107 (R-79 F-1): a command that asked and no longer asks is widening", () => {
  test("confirm taken off a rule: confirm_removed, not a command added", TODO, () => {
    assert.deepEqual(kinds(config([ASKING_GIT]), config([GIT])), ["confirm_removed@policy.commands[0]"]);
  });

  test("a plain copy of an asking rule added: confirm_removed (the gate allows it without asking)", TODO, () => {
    assert.deepEqual(kinds(config([ASKING_GIT]), config([ASKING_GIT, GIT])), ["confirm_removed@policy.commands[1]"]);
  });

  test("an asking rule with extra arguments loses confirm: confirm_removed only (the arguments were allowed already)", TODO, () => {
    assert.deepEqual(kinds(config([{ ...NODE_ANY, confirm: true }]), config([NODE_ANY])), ["confirm_removed@policy.commands[0]"]);
  });

  test("a profile's rule loses confirm: profile_changed and confirm_removed in that profile", TODO, () => {
    const profile = (rule: object) => ({ docs: { policy: { commands: [rule], network: "deny", destructive: "deny", restorePathTokens: false } } });
    assert.deepEqual(kinds(config([], profile(ASKING_GIT)), config([], profile(GIT))), ["profile_changed@profiles", "confirm_removed@profiles.docs.policy.commands[0]"]);
  });

  test("making a rule ask is narrowing; a new asking rule is a command added; nothing changed is nothing", TODO, () => {
    assert.deepEqual(kinds(config([GIT]), config([ASKING_GIT])), [], "a question added narrows");
    assert.deepEqual(kinds(config([ASKING_GIT, GIT]), config([ASKING_GIT])), [], "the plain copy removed narrows");
    assert.deepEqual(kinds(config([]), config([{ ...NODE_ANY, confirm: true }])), ["command_added@policy.commands[0]", "extra_args_allowed@policy.commands[0]"]);
    assert.deepEqual(kinds(config([ASKING_GIT]), config([ASKING_GIT])), []);
    assert.deepEqual(kinds(config([ASKING_GIT, GIT]), config([GIT])), [], "it did not ask before either: the plain rule allowed it");
  });
});
