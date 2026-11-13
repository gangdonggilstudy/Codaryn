/**
 * U-192 (U-183, DR-69 B-4): the app layer names two more widenings for the lists of writable paths,
 * `writable_path_added` (an entry that covers more) and `writable_paths_unlimited` (a list gone, no
 * limit again). The widening dialog and the settings screen name them in both languages; a proposal
 * with them is written after the person's confirmation instead of being refused as unknown_widening.
 * The app layer's own judgment (the root build's wideningOf) gives exactly kinds the GUI can name.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { KNOWN_WIDENING_KINDS, WIDENING_KINDS, unnamedWidening, widenText } from "../../src/main/dialog-texts.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";

// This file runs as gui/build/tests/unit/u192-writable-widening.test.js.
const APP = path.join(fileURLToPath(new URL("../../../", import.meta.url)), "..", "dist", "src", "app", "index.js");

test("U-192: the two writable-path widenings are known, named in both languages, and no longer refused", () => {
  for (const kind of ["writable_path_added", "writable_paths_unlimited"] as const) {
    assert.ok((WIDENING_KINDS as readonly string[]).includes(kind), kind);
    assert.ok(KNOWN_WIDENING_KINDS.includes(kind), kind);
    assert.equal(unnamedWidening([{ kind }]), false, `${kind} is not unknown_widening any more`);
    assert.ok(`widen.${kind}` in KO && `widen.${kind}` in EN, kind);
  }
  assert.equal(widenText("ko", "writable_path_added", "policy.writablePaths[1]"), "- 쓰기 허용 경로 넓힘 (policy.writablePaths[1])");
  assert.equal(widenText("en", "writable_paths_unlimited", "profiles.doc.policy.writablePaths"), "- the writable paths limit removed (file tools may write anywhere in the workspace) (profiles.doc.policy.writablePaths)");
  assert.equal(unnamedWidening([{ kind: "writable_path_added" }, { kind: "made_up" }]), true, "an unknown kind is still refused");
});

test("U-192: what the app layer finds for writable paths, the dialog can name", async () => {
  const app = (await import(pathToFileURL(APP).href)) as { wideningOf: (before: unknown, after: unknown) => readonly { kind: string; field: string }[] };
  const base = { policy: { commands: [], network: "deny", destructive: "deny", writablePaths: ["docs"] } };
  const cases = [
    { ...base, policy: { ...base.policy, writablePaths: ["docs", "src"] } },
    { ...base, policy: { ...base.policy, writablePaths: ["."] } },
    { policy: { commands: [], network: "deny", destructive: "deny" } },
    { ...base, profiles: { doc: { policy: { writablePaths: ["out"] } } } },
  ];
  const kinds = new Set<string>();
  for (const after of cases) for (const widening of app.wideningOf(base, after)) kinds.add(widening.kind);
  assert.ok(kinds.has("writable_path_added"));
  assert.ok(kinds.has("writable_paths_unlimited"));
  for (const kind of kinds) assert.ok(KNOWN_WIDENING_KINDS.includes(kind), `${kind} is named by the dialog`);
});
