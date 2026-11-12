/**
 * U-36 (UXM-7 ③ ④; the U-19 survey, sections 3 C and 3 D): the text of `plan`, `apply`'s terminal
 * questions, `review`'s lines and `changes` were fixed English. They get message ids.
 *
 * - No message takes a digest (G-A, 0a9f9ec) or a time: the renderer puts the plan digest's first
 *   MIN_PLAN_DIGEST_PREFIX characters after `plan.next_apply`, and the apply's time after
 *   `plan.applied_by` in local wall time, as `runs` shows times (UXM-23).
 * - A status, an action, a verdict, a file state and why a file's text is not shown are listed ids
 *   over a contract list. The two lists of `changes` are those of the app's ChangedFileView.
 * - `changes.apply_run` (U-16) is already there; the CLI is to use it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CHANGED_FILE_STATES,
  CHANGED_FILE_UNAVAILABLE_REASONS,
  FIXED_MESSAGES,
  MESSAGE_IDS,
  PLAN_ACTION_KINDS,
  PLAN_STATUSES,
  REVIEW_VERDICTS,
  messageParams,
} from "../../../src/contracts/index.js";
import type { ChangedFileState, ChangedFileUnavailableReason, MessageId, MessageParamKind } from "../../../src/contracts/index.js";
import type { ChangedFileUnavailable, ChangedFileView } from "../../../src/app/index.js";

const FIXED: { readonly [id: string]: { readonly [param: string]: MessageParamKind } } = {
  "plan.heading": { runId: "runId", count: "count", status: "text" },
  "plan.digest_label": {},
  "plan.discard_kept": {},
  "plan.inventory_limit": {},
  "plan.applied_by": { runId: "runId" },
  "plan.next_apply": { runId: "runId" },
  "apply.question": {},
  "apply.unsafe_move_question": { count: "count" },
  "review.recorded": { runId: "runId", verdict: "text" },
  "review.recorded_replaced": { runId: "runId", verdict: "text" },
  "review.unchanged": {},
  "changes.heading": { runId: "runId" },
  "changes.no_text_note": {},
  "changes.none": {},
  "changes.file.created": {},
  "changes.file.changed": {},
  "changes.no_difference": {},
  "changes.more_lines": { count: "count" },
};

/** Exactly the same union, both ways. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("U-36: plan, apply, review and changes have message ids", () => {
  test("the fixed lines, with counts, run ids and catalog texts only", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const [id, params] of Object.entries(FIXED)) {
      assert.equal(ids.filter((entry) => entry === id).length, 1, id);
      assert.ok(Object.hasOwn(FIXED_MESSAGES, id), id);
      assert.deepEqual(messageParams(id as MessageId), params, id);
    }
  });

  test("the listed words: plan status, action, review verdict, file state, why the text is not shown", () => {
    const listed = [
      ...PLAN_STATUSES.map((status) => `plan.status.${status}`),
      ...PLAN_ACTION_KINDS.map((kind) => `plan.action.${kind}`),
      ...REVIEW_VERDICTS.map((verdict) => `review.verdict.${verdict}`),
      ...CHANGED_FILE_STATES.map((state) => `changes.state.${state}`),
      ...CHANGED_FILE_UNAVAILABLE_REASONS.map((reason) => `changes.unavailable.${reason}`),
    ];
    assert.equal(listed.length, 2 + 2 + 2 + 4 + 7);
    const ids = MESSAGE_IDS as readonly string[];
    for (const id of listed) {
      assert.equal(ids.filter((entry) => entry === id).length, 1, id);
      assert.deepEqual(messageParams(id as MessageId), {}, id);
    }
    const typed: MessageId[] = ["plan.status.applied", "plan.action.discard", "review.verdict.rejected", "changes.state.missing", "changes.unavailable.masking_unverified"];
    assert.equal(typed.length, 5);
  });

  test("the lists of changes are the app's ChangedFileView unions", () => {
    assert.deepEqual([...CHANGED_FILE_STATES], ["as_run_left", "changed_since_run", "missing", "unknown"]);
    assert.deepEqual([...CHANGED_FILE_UNAVAILABLE_REASONS], ["masked_path", "snapshot_missing", "not_text", "too_large", "unreadable", "mask_failed", "masking_unverified"]);
    const states: Same<ChangedFileState, ChangedFileView["state"]> = true;
    const reasons: Same<ChangedFileUnavailableReason, ChangedFileUnavailable> = true;
    assert.ok(states && reasons);
  });

  test("no message takes a digest or a time; the apply run's line of changes stays (U-16)", () => {
    for (const id of Object.keys(FIXED)) {
      for (const kind of Object.values(messageParams(id as MessageId))) assert.ok(["count", "runId", "text"].includes(kind), `${id}: ${kind}`);
    }
    assert.deepEqual(messageParams("changes.apply_run"), { count: "count", runId: "runId" });
  });
});
