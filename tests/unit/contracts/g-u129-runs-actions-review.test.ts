/**
 * U-129 (PM's answer): the contract of two additions to `codaryn runs`.
 * (1) An apply run's changes cell says the number is actions (`runs.apply_action_one` for one,
 *     else `runs.apply_actions` with `{count}`); `runs --json` keeps the number as it is.
 * (2) AXM-21: RunListEntry gains an optional `review` ({verdict, at}) for a run that ended awaiting
 *     review and has a readable verdict; the table adds `runs.review` ({verdict}) to the result.
 * Only additions: an entry without `review` is as before, and no message changed.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FIXED_MESSAGES, MESSAGE_IDS, REVIEW_VERDICTS, messageParams, planApplyStateOf, toRunId } from "../../../src/contracts/index.js";
import type { MessageId, RunId, RunListEntry, RunsOutput } from "../../../src/contracts/index.js";

type Checked = Extract<RunListEntry, { readonly state: "checked" }>;

const PLAN_RUN = toRunId("20261113T010000Z-0000aaaa") as RunId;
const APPLY_RUN = toRunId("20261113T020000Z-0000bbbb") as RunId;

const awaiting: Checked = {
  state: "checked",
  runId: PLAN_RUN,
  startedAt: "2026-11-13T01:00:00.000Z",
  taskId: "analysis",
  status: "needs-input",
  reason: "awaiting_review",
  changes: 2,
  reverted: null,
};

describe("U-129 (2): RunListEntry.review", () => {
  test("optional: an entry without it is as before; with it, a verdict of REVIEW_VERDICTS and a time", () => {
    const reviewed: Checked = { ...awaiting, review: { verdict: "accepted", at: "2026-11-13T02:00:00.000Z" } };
    const rejected: Checked = { ...awaiting, review: { verdict: "rejected", at: "2026-11-13T02:05:00.000Z" } };
    assert.equal(awaiting.review, undefined);
    assert.deepEqual(
      [reviewed, rejected].map((entry) => entry.review?.verdict),
      [...REVIEW_VERDICTS],
    );
    // @ts-expect-error the verdict is one of REVIEW_VERDICTS
    const wrong: Checked = { ...awaiting, review: { verdict: "maybe", at: "2026-11-13T02:00:00.000Z" } };
    assert.ok(wrong);
    // @ts-expect-error the note is report's, not the list's
    const withNote: Checked = { ...awaiting, review: { verdict: "accepted", at: "2026-11-13T02:00:00.000Z", note: null } };
    assert.ok(withNote);
  });

  test("a runs line with the field is plain JSON, as runs --json prints it", () => {
    const output: RunsOutput = { schemaVersion: 1, kind: "runs", status: "listed", exitCode: 0, runs: [{ ...awaiting, review: { verdict: "accepted", at: "2026-11-13T02:00:00.000Z" } }], omitted: 0 };
    assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
    const [entry] = output.runs;
    assert.ok(entry !== undefined && entry.state === "checked");
    assert.deepEqual(Object.keys(entry.review ?? {}), ["verdict", "at"]);
  });

  test("the rule for plan runs does not look at it", () => {
    const plan: Checked = { ...awaiting, reason: "plan_pending", appliedBy: { runId: APPLY_RUN, at: "2026-11-13T02:00:00.000Z" }, review: { verdict: "accepted", at: "2026-11-13T02:00:00.000Z" } };
    const apply: Checked = { ...awaiting, runId: APPLY_RUN, kind: "apply", planRunId: plan.runId, status: "done", reason: "verified" };
    assert.deepEqual(planApplyStateOf(plan, [plan, apply]), { state: "applied", applyRunId: apply.runId });
  });
});

describe("U-129: the message ids", () => {
  test("(1) the apply run's actions: one id with {count}, one for exactly one action", () => {
    assert.deepEqual(messageParams("runs.apply_actions" as MessageId), { count: "count" });
    assert.deepEqual(messageParams("runs.apply_action_one" as MessageId), {});
  });

  test("(2) the verdict in the result column: {verdict} is text, as review.recorded's", () => {
    assert.deepEqual(messageParams("runs.review" as MessageId), { verdict: "text" });
    assert.deepEqual(messageParams("runs.review" as MessageId), { verdict: (FIXED_MESSAGES["review.recorded"] as { verdict: string }).verdict });
    for (const verdict of REVIEW_VERDICTS) assert.ok((MESSAGE_IDS as readonly string[]).includes(`review.verdict.${verdict}`), verdict);
  });

  test("the three ids are message ids, each once", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const id of ["runs.apply_actions", "runs.apply_action_one", "runs.review"]) {
      assert.equal(ids.filter((one) => one === id).length, 1, id);
    }
  });
});
