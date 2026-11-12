/**
 * U-8 (R-39 L-1): when the state guard could not check the state directory entirely (it is larger
 * than MAX_STATE_ENTRIES or MAX_STATE_HASH_BYTES), a plan run's records may have changed without a
 * mark. The apply is not refused, but it always says so: a notice kind in the result with its own
 * text, and the run's progress line for an unchecked part (progress.state_unchecked).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { APPLY_NOTICE_KINDS, FIXED_MESSAGES, MESSAGE_IDS } from "../../../src/contracts/index.js";
import type { ApplyNoticeKind, ApplyResult } from "../../../src/contracts/index.js";

describe("U-8: an apply whose plan run's records could not be checked says so", () => {
  test("the notice kind and its text id", () => {
    assert.deepEqual([...APPLY_NOTICE_KINDS], ["plan_records_unchecked"]);
    const kind: ApplyNoticeKind = "plan_records_unchecked";
    assert.ok((MESSAGE_IDS as readonly string[]).includes(`apply.notice.${kind}`));
  });

  test("present only when a check was limited; a checked apply adds nothing", () => {
    const unchecked: Pick<ApplyResult, "status" | "reason" | "noticeKinds"> = { status: "done", reason: "verified", noticeKinds: ["plan_records_unchecked"] };
    const checked: Pick<ApplyResult, "status" | "reason" | "noticeKinds"> = { status: "done", reason: "verified" };
    assert.deepEqual([unchecked.noticeKinds, Object.hasOwn(checked, "noticeKinds")], [["plan_records_unchecked"], false]);
  });

  test("the run's progress line for an unchecked part keeps its id", () => {
    assert.deepEqual(FIXED_MESSAGES["progress.state_unchecked"], {});
  });
});
