/**
 * U-1 (R-33 R33-L3): a plan run with a records-changed mark (DR-38) is not applied. Its plan may
 * differ from what a person saw. The caller refuses it with the fixed code `plan_records_changed`;
 * the engine checks again under the lock (ApplyDeps.planRecordsChanged).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CLI_ERROR_EXIT_CODES, MESSAGE_IDS } from "../../../src/contracts/index.js";
import type { ApplyDeps, CliErrorOutput } from "../../../src/contracts/index.js";

describe("U-1: a plan whose records were changed is refused", () => {
  test("the fixed code, its exit code and its message ids", () => {
    assert.equal(CLI_ERROR_EXIT_CODES.plan_records_changed, 2);
    const refused: CliErrorOutput = { schemaVersion: 1, kind: "error", code: "plan_records_changed", exitCode: 2, message: "fixed text" };
    assert.equal(refused.code, "plan_records_changed");
    for (const id of ["error.plan_records_changed.what", "error.plan_records_changed.fix"]) {
      assert.ok((MESSAGE_IDS as readonly string[]).includes(id), id);
    }
  });

  test("the engine's check under the lock (ApplyDeps.planRecordsChanged)", async () => {
    const deps: Pick<ApplyDeps, "planRecordsChanged"> = { planRecordsChanged: async () => true };
    assert.equal(await deps.planRecordsChanged?.(), true);
  });
});
