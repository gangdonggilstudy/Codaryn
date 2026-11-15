/**
 * U-158: the draft message ids for the two values the engine and the store now carry. Their texts
 * are nb-i18n's and the lines nc-human's: `summary.folders_left_empty` ({count}) in the apply summary
 * when ApplyResult.foldersLeftEmpty is present, and `runs.running` / `runs.no_result` in the runs
 * table in place of `runs.incomplete` when an entry has a phase.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_IDS, messageParams } from "../../../src/contracts/index.js";
import type { MessageId } from "../../../src/contracts/index.js";

describe("U-158: draft message ids", () => {
  test("the apply summary's line for folders left without files takes a count", () => {
    assert.deepEqual(messageParams("summary.folders_left_empty" as MessageId), { count: "count" });
  });

  test("the runs table's words for a run without a result, by its phase, take nothing", () => {
    assert.deepEqual(messageParams("runs.running" as MessageId), {});
    assert.deepEqual(messageParams("runs.no_result" as MessageId), {});
    assert.deepEqual(messageParams("runs.incomplete" as MessageId), {}, "kept for an entry without a phase");
  });

  test("each is a message id once", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const id of ["summary.folders_left_empty", "runs.running", "runs.no_result"]) assert.equal(ids.filter((one) => one === id).length, 1, id);
  });
});
