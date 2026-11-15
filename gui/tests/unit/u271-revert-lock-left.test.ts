/**
 * U-271 (p4g's design check, design 3.9's "what remains"; U-229, R-106 L-1): a revert whose workspace
 * lock could not be released at its end says so on its result, as a run's does (U-240's words: the next
 * run clears it once Codaryn has closed; if a run is refused before then, the checks screen). The
 * engine host passes RevertCallOutcome.lockLeft, the main process takes it as true only.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { revertValue } from "../../src/engine-host/history.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { toRevertView } from "../../src/shared/ipc.js";

const RUN = "20261114T050000Z-0000e271";
const same = (text: string): string => text;
const output = { runId: RUN, status: "complete", dryRun: false, reverted: [{ path: "a.txt", action: "restored", from: null, unsafe: false }], skipped: [], moveSafetyUnchecked: false, revertedBefore: null };

test("U-271: a revert's lock left reaches the window; a released one adds nothing", () => {
  const left = revertValue({ ok: true, output, lockLeft: true }, same) as Record<string, unknown>;
  assert.equal(left["lockLeft"], true);
  const view = toRevertView(left);
  assert.ok(view.ok && view.view.lockLeft === true);
  const released = revertValue({ ok: true, output }, same) as Record<string, unknown>;
  assert.equal("lockLeft" in released, false);
  assert.ok(toRevertView(released).ok);
  assert.equal(toRevertView({ ...left, lockLeft: false }).ok, false, "only true");
  for (const texts of [KO, EN]) {
    assert.ok(texts["runs.revertLockLeft"].endsWith(texts["run.lockLeft"].split(/(?<=\.) /).slice(1).join(" ")), "the same advice as a run's");
  }
});
