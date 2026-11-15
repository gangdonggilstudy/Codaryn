/**
 * U-212 (U-204, DR-69 bundle A, A-7): the app layer names two more widenings, `unreadable_path_removed`
 * (an unreadable path no longer kept out: the model may read those files) and `min_group_size_lowered`
 * (a lower group size k: smaller groups of the tables under unreadable paths are shown to the model).
 * The widening dialog and the settings screen name them in both languages; a proposal with them is
 * written after the person's confirmation instead of being refused as unknown_widening. The app
 * layer's own judgment (the root build's wideningOf) gives exactly kinds the GUI can name. The config
 * parser takes neither field yet (A-6), so no proposal has them today.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { KNOWN_WIDENING_KINDS, WIDENING_KINDS, unnamedWidening, widenText } from "../../src/main/dialog-texts.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";

// This file runs as gui/build/tests/unit/u212-unreadable-k-widening.test.js.
const APP = path.join(fileURLToPath(new URL("../../../", import.meta.url)), "..", "dist", "src", "app", "index.js");
const KINDS = ["unreadable_path_removed", "min_group_size_lowered"] as const;

test("U-212: the unreadable-path and group-size widenings are known, named in both languages, and not refused", () => {
  for (const kind of KINDS) {
    assert.ok((WIDENING_KINDS as readonly string[]).includes(kind), kind);
    assert.ok(KNOWN_WIDENING_KINDS.includes(kind), kind);
    assert.equal(unnamedWidening([{ kind }]), false, `${kind} is not unknown_widening`);
    // The dialog's words and the settings screen's are the same text.
    assert.equal(widenText("ko", kind, "f"), `- ${KO[`widen.${kind}`]} (f)`, kind);
    assert.equal(widenText("en", kind, "f"), `- ${EN[`widen.${kind}`]} (f)`, kind);
  }
  assert.equal(widenText("ko", "unreadable_path_removed", "policy.unreadablePaths"), "- 읽기 제외 경로 뺌(모델이 그 파일을 읽을 수 있게 됨) (policy.unreadablePaths)");
  assert.equal(
    widenText("en", "min_group_size_lowered", "profiles.doc.policy.minGroupSize"),
    "- the minimum group size k lowered (smaller groups of the tables under unreadable paths are shown to the model) (profiles.doc.policy.minGroupSize)",
  );
  assert.equal(unnamedWidening([{ kind: "min_group_size_lowered" }, { kind: "made_up" }]), true, "an unknown kind is still refused");
});

test("U-212: what the app layer finds for unreadable paths and k, the dialog can name; narrowing finds nothing", async () => {
  const app = (await import(pathToFileURL(APP).href)) as { wideningOf: (before: unknown, after: unknown) => readonly { kind: string; field: string }[] };
  const policy = { commands: [], network: "deny", destructive: "deny" };
  const base = { policy: { ...policy, unreadablePaths: ["data/private"], minGroupSize: 10 } };
  const widened = (after: unknown): string[] => app.wideningOf(base, after).map((item) => `${item.kind} ${item.field}`);
  assert.deepEqual(widened({ policy: { ...base.policy, unreadablePaths: [] } }), ["unreadable_path_removed policy.unreadablePaths"]);
  assert.deepEqual(widened({ policy: { ...base.policy, unreadablePaths: ["data"] } }), ["unreadable_path_removed policy.unreadablePaths"], "a broader entry does not keep a link's target out");
  assert.deepEqual(widened({ policy: { ...base.policy, minGroupSize: 6 } }), ["min_group_size_lowered policy.minGroupSize"]);
  assert.deepEqual(widened({ policy: { ...policy, unreadablePaths: ["data/private"] } }), ["min_group_size_lowered policy.minGroupSize"], "k gone is k 5 again");
  assert.deepEqual(widened({ policy: { ...base.policy, unreadablePaths: ["data/private", "notes"], minGroupSize: 12 } }), [], "an entry added and k raised narrow");
  const kinds = new Set<string>();
  for (const after of [{ policy }, { ...base, profiles: { doc: { policy: { minGroupSize: 4 } } } }, { policy: { ...base.policy, unreadablePaths: ["data/private/"] } }]) {
    for (const item of app.wideningOf(base, after)) kinds.add(item.kind);
  }
  assert.ok(kinds.has("unreadable_path_removed") && kinds.has("min_group_size_lowered"));
  for (const kind of kinds) assert.ok(KNOWN_WIDENING_KINDS.includes(kind), `${kind} is named by the dialog`);
});
