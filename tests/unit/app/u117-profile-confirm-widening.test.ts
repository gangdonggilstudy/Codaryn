/**
 * Unit U-117 (review R-85 L1; PM's decision): a profile without a policy of its own runs with the
 * config's (src/cli/config-file.ts: `profile.policy ?? config.policy`). When such a profile gets a
 * policy of its own, the widening judgement compared it with nothing, so a profile that used the
 * config's asking rule and now has a plain rule for the same calls was only `profile_changed`, never
 * `confirm_removed`. Now a profile's own policy is compared with the commands its runs had before:
 * its own policy, or the config's when it had none. A question gone is `confirm_removed`, a new
 * command `command_added` (with `extra_args_allowed`), in that profile.
 * The config file cannot hold `confirm` yet, so the judgement (wideningOf) is called directly.
 * Reproduced first (todo until fixed). Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { wideningOf } from "../../../src/app/index.js";
import type { CodarynConfig } from "../../../src/contracts/index.js";

const TODO = { todo: "U-117: a profile that gets its own policy is compared with nothing" };

const NODE_ANY = { executable: "node", argsPrefix: [], allowExtraArgs: true } as const;
const ASKING_NODE = { ...NODE_ANY, confirm: true } as const;
const GIT = { executable: "git", argsPrefix: ["status"], allowExtraArgs: false } as const;

const policy = (commands: readonly object[]) => ({ commands, network: "deny", destructive: "deny", restorePathTokens: false });

function config(commands: readonly object[] | null, profiles: Record<string, unknown>): CodarynConfig {
  return { schemaVersion: 1, ...(commands === null ? {} : { policy: policy(commands) }), profiles } as unknown as CodarynConfig;
}

const kinds = (before: CodarynConfig, after: CodarynConfig): string[] => wideningOf(before, after).map((item) => `${item.kind}@${item.field}`);

describe("U-117 (R-85 L1): a profile that gets a policy is compared with the config's it ran with", () => {
  test("the config's asking rule, and the profile now has a plain rule for the same calls: confirm_removed in the profile", TODO, () => {
    assert.deepEqual(kinds(config([ASKING_NODE], { p: {} }), config([ASKING_NODE], { p: { policy: policy([NODE_ANY]) } })), [
      "profile_changed@profiles",
      "confirm_removed@profiles.p.policy.commands[0]",
    ]);
  });

  test("a new command in the profile's new policy: command_added (and extra arguments) in the profile", TODO, () => {
    assert.deepEqual(kinds(config([GIT], { p: {} }), config([GIT], { p: { policy: policy([GIT, NODE_ANY]) } })), [
      "profile_changed@profiles",
      "command_added@profiles.p.policy.commands[1]",
      "extra_args_allowed@profiles.p.policy.commands[1]",
    ]);
    assert.deepEqual(kinds(config(null, { p: {} }), config(null, { p: { policy: policy([GIT]) } })), ["profile_changed@profiles", "command_added@profiles.p.policy.commands[0]"], "no config policy: no command before");
  });

  test("a profile's new policy that repeats the config's, or asks where it did not: only profile_changed", () => {
    assert.deepEqual(kinds(config([GIT, ASKING_NODE], { p: {} }), config([GIT, ASKING_NODE], { p: { policy: policy([GIT, ASKING_NODE]) } })), ["profile_changed@profiles"]);
    assert.deepEqual(kinds(config([NODE_ANY], { p: {} }), config([NODE_ANY], { p: { policy: policy([ASKING_NODE]) } })), ["profile_changed@profiles"], "a question added narrows");
  });

  test("a profile that had its own policy adds a command: command_added in the profile, as when it gets one", TODO, () => {
    assert.deepEqual(kinds(config([], { p: { policy: policy([GIT]) } }), config([], { p: { policy: policy([GIT, NODE_ANY]) } })), [
      "profile_changed@profiles",
      "command_added@profiles.p.policy.commands[1]",
      "extra_args_allowed@profiles.p.policy.commands[1]",
    ]);
  });
});
