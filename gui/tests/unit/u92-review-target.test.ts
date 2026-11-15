/**
 * U-92 (review R-73, U-79 L1): the main process records a verdict only for a run the person was shown
 * (listed in the run list, or started here so its result screen showed it) and with the task form
 * it remembers for that run, never one the page names. A run without a remembered form (started
 * elsewhere, or from a task file) is refused, as the window says to use the CLI for it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { RunHistory, reviewTarget } from "../../src/main/history.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";

const WS = "1".repeat(32);
const RUN = "20261113T080000Z-0000a092";

test("U-92: a verdict needs a run the person was shown and the form the main process remembers", () => {
  assert.deepEqual(reviewTarget(false, { profile: "doc", workflow: "analyze" }), { ok: false, code: "unknown_run" });
  assert.deepEqual(reviewTarget(true, undefined), { ok: false, code: "form_unknown" });
  assert.deepEqual(reviewTarget(true, { profile: null, workflow: "analyze" }), { ok: true, form: { profile: null, workflow: "analyze" } });
});

test("U-92: a run this main process started counts as shown; a list replaces what was listed", () => {
  const history = new RunHistory(() => new Uint8Array(32), () => 0);
  assert.equal(history.wasListed(WS, RUN), false);
  history.noteStarted(WS, RUN);
  assert.equal(history.wasListed(WS, RUN), true, "its result screen showed it");
  history.listedRuns(WS, ["20261113T080000Z-0000b092"]);
  assert.equal(history.wasListed(WS, RUN), false, "the newest list decides, as for previews");
  history.noteStarted(WS, RUN);
  assert.equal(history.wasListed(WS, "20261113T080000Z-0000b092") && history.wasListed(WS, RUN), true, "added to the list, not in place of it");
  assert.equal(history.wasListed("2".repeat(32), RUN), false, "per workspace");
});

test("U-92: the window has words for both refusals, in both languages", () => {
  for (const language of ["ko", "en"] as const) {
    const t = textsFor(language);
    assert.ok(t.has("error.unknown_run") && t.has("error.form_unknown"), language);
    assert.match(t.format("error.form_unknown"), /codaryn review/);
  }
});
