/** U-328: preserve old module/barrel bindings and canonical structural type compatibility. */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as source from "../../../src/app/changes-plan-output.js";
import * as legacy from "../../../src/cli/human/changes-plan.js";
import * as barrel from "../../../src/cli/human/index.js";
import type { LoadedChangesPlan, ChangesPlanViewOutcome } from "../../../src/app/changes-plan-output.js";
import type { LoadedChangesPlan as OldLoaded, ChangesPlanViewOutcome as OldOutcome } from "../../../src/cli/human/changes-plan.js";
import type { LoadedChangesPlan as BarrelLoaded, ChangesPlanViewOutcome as BarrelOutcome } from "../../../src/cli/human/index.js";

// Both directions must compile without a cast; no duplicate plan model or altered null/readonly shape.
const oldToNew: (value: OldLoaded) => LoadedChangesPlan = (value) => value;
const newToOld: (value: LoadedChangesPlan) => OldLoaded = (value) => value;
const newToBarrel: (value: LoadedChangesPlan) => BarrelLoaded = (value) => value;
const barrelToNew: (value: BarrelLoaded) => LoadedChangesPlan = (value) => value;
const oldOutcome: (value: ChangesPlanViewOutcome) => OldOutcome = (value) => value;
const oldOutcomeToNew: (value: OldOutcome) => ChangesPlanViewOutcome = (value) => value;
const barrelOutcome: (value: BarrelOutcome) => ChangesPlanViewOutcome = (value) => value;
const newOutcomeToBarrel: (value: ChangesPlanViewOutcome) => BarrelOutcome = (value) => value;
void [oldToNew, newToOld, newToBarrel, barrelToNew, oldOutcome, oldOutcomeToNew, barrelOutcome, newOutcomeToBarrel];

test("U-328: old path and human index expose the exact pure output bindings", () => {
  assert.strictEqual(legacy.changesPlanOutput, source.changesPlanOutput);
  assert.strictEqual(barrel.changesPlanOutput, source.changesPlanOutput);
  assert.strictEqual(legacy.changesPlanSummaryText, source.changesPlanSummaryText);
  assert.strictEqual(barrel.changesPlanSummaryText, source.changesPlanSummaryText);
  assert.equal(legacy.SUMMARY_HIDDEN_MARKER, source.SUMMARY_HIDDEN_MARKER);
  assert.equal(barrel.SUMMARY_HIDDEN_MARKER, source.SUMMARY_HIDDEN_MARKER);
  assert.equal(source.SUMMARY_HIDDEN_MARKER, "[masked]");
  assert.equal(source.changesPlanSummaryText.length, 1);
  assert.equal(source.changesPlanOutput.length, 2);
});
