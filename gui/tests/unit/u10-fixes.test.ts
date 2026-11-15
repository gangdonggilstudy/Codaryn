/**
 * U-10: small GUI fixes. R38-L-1: the save dialog asks before it replaces a file on Linux too.
 * R-39 I-3: the window has its own words for plan_records_changed, not the default text.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { saveDialogOptions } from "../../src/main/save-file.js";
import { errorText, textsFor } from "../../src/renderer/i18n/catalog.js";

test("R38-L-1: the report's save dialog asks before replacing an existing file (Linux needs it said)", () => {
  const options = saveDialogOptions("C:\Users\me\Documents\codaryn-report-x.md");
  assert.deepEqual(options.properties, ["showOverwriteConfirmation"]);
  assert.equal(options.defaultPath, "C:\Users\me\Documents\codaryn-report-x.md");
  assert.deepEqual(options.filters, [{ name: "Markdown", extensions: ["md"] }]);
});

test("R-39 I-3: plan_records_changed has its own words in both languages, not the default text", () => {
  for (const language of ["ko", "en"] as const) {
    const t = textsFor(language);
    assert.ok(t.has("error.plan_records_changed"), language);
    assert.notEqual(errorText(t, "plan_records_changed"), t.format("error.default"), language);
  }
});
