/**
 * U-221 (drafts for nb-i18n): the texts of a run plan in one sense, in both languages, and a plan of
 * moves' texts as they were.
 * - summary.plan_ready_changes: the plan run's end summary of a run plan, its files counted as the plan
 *   view counts them; its summary takes plan.changes.summary_label (approved with the plan).
 * - plan.changes.status_carried_out, plan.changes.carried_by: the plan view of a run plan carried out,
 *   in the report's words ("carried out by run …").
 * - runs.plan_carried_out, _ended, runs.plan_carrying, runs.plan_carried_reverted: the plan run's row
 *   of a run plan, by the run that carried it out.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CatalogText, MessageCatalog, RunId, RunReason } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const RUN = "20261113T130000Z-11111111" as RunId;
const say = (catalog: MessageCatalog, id: string, params: object = {}): CatalogText => (catalog.format as (id: string, params: object) => CatalogText)(id, params);

describe("U-221: the run plan's drafts", () => {
  test("English", () => {
    const en = createMessageCatalog("en");
    assert.equal(say(en, "summary.plan_ready_changes", { count: 2 }), "A plan is ready: 2 file(s) to write. Nothing was changed; it waits for approval.");
    assert.equal(say(en, "plan.changes.status_carried_out"), "carried out");
    assert.equal(say(en, "plan.changes.carried_by", { runId: RUN }), `Carried out by run ${RUN}`);
    assert.equal(say(en, "runs.plan_carried_out", { runId: RUN }), `plan carried out by run ${RUN}`);
    assert.equal(say(en, "runs.plan_carried_ended", { runId: RUN, reason: "no_verifier" as RunReason }), `plan carried out by run ${RUN}, which ended as no_verifier`);
    assert.equal(say(en, "runs.plan_carrying", { runId: RUN }), `plan being carried out by run ${RUN}, or that run stopped (no result yet)`);
    assert.equal(say(en, "runs.plan_carried_reverted", { runId: RUN }), `plan carried out by run ${RUN}, then reverted`);
  });

  test("Korean", () => {
    const ko = createMessageCatalog("ko");
    assert.equal(say(ko, "summary.plan_ready_changes", { count: 2 }), "계획을 만들었습니다: 쓸 파일 2개. 아무것도 바꾸지 않았고 승인을 기다립니다.");
    assert.equal(say(ko, "plan.changes.status_carried_out"), "수행됨");
    assert.equal(say(ko, "plan.changes.carried_by", { runId: RUN }), `실행 ${RUN}에서 수행함`);
    assert.equal(say(ko, "runs.plan_carried_out", { runId: RUN }), `계획 수행됨(실행 ${RUN})`);
    assert.equal(say(ko, "runs.plan_carried_ended", { runId: RUN, reason: "no_verifier" as RunReason }), `계획 수행됨(실행 ${RUN}, 끝남: no_verifier)`);
    assert.equal(say(ko, "runs.plan_carrying", { runId: RUN }), `계획 수행 중이거나 그 실행이 멈춤(실행 ${RUN}, 결과 없음)`);
    assert.equal(say(ko, "runs.plan_carried_reverted", { runId: RUN }), `계획을 수행했다가 되돌림(실행 ${RUN})`);
  });

  test("a plan of moves' texts are as they were (both languages)", () => {
    const en = createMessageCatalog("en");
    const ko = createMessageCatalog("ko");
    assert.equal(en.format("summary.plan_ready", { actions: 2 }), "A plan is ready: actions 2. Nothing was changed; it waits for approval.");
    assert.equal(en.format("plan.summary_label"), "The agent's description (the model's own words, not checked, and not what you approve)");
    assert.equal(en.format("plan.status.applied"), "applied");
    assert.equal(en.format("plan.applied_by", { runId: RUN }), `Applied by run ${RUN}`);
    assert.equal(en.format("runs.plan_apply_unfinished", { runId: RUN, reason: "no_verifier" }), `plan apply not finished (apply run ${RUN}, no_verifier)`);
    assert.equal(ko.format("summary.plan_ready", { actions: 2 }), "계획을 만들었습니다: 동작 2개. 아무것도 바꾸지 않았고 승인을 기다립니다.");
    assert.equal(ko.format("plan.summary_label"), "에이전트의 설명(모델이 쓴 말이며 검증되지 않았고, 승인하는 대상이 아님)");
    assert.equal(ko.format("plan.status.applied"), "적용됨");
    assert.equal(ko.format("plan.applied_by", { runId: RUN }), `적용 실행 ${RUN}에서 적용함`);
    assert.equal(ko.format("runs.plan_apply_unfinished", { runId: RUN, reason: "no_verifier" }), `계획 적용이 끝나지 않음(적용 실행 ${RUN}, no_verifier)`);
  });
});
