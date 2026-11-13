/**
 * U-249 (PM): U-228's drafts for a plan of another kind and a missing plan tool, made final.
 * - plan_kind_differs names what to give apply as plan.next_apply does: the same task form, "같은
 *   작업 지정" (U-164).
 * - The Korean names a tool or a plan mode before a word ("propose_changes 도구가", "계획 방식
 *   \"run\"에는"), never before a particle that changes with the code's last sound, and a run
 *   "refuses it" as "실행은 이를 거부합니다".
 * The English of plan_tool_missing and of the two doctor lines stays: docs/usage.md quotes it and
 * src/cli/doctor.ts keeps the doctor lines as JSON messages.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_TEXTS } from "../../../src/i18n/index.js";

const IDS = ["error.hint.plan_kind_differs", "error.hint.plan_tool_missing", "doctor.config_file.plan_tool_missing", "doctor.task_file.plan_tool_missing"] as const;

describe("U-249: a plan of another kind, a missing plan tool", () => {
  test("what to give apply: the same task form, as plan.next_apply says", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.ok(en["error.hint.plan_kind_differs"].startsWith("Give apply the same task form the plan run used:"));
    assert.ok(ko["error.hint.plan_kind_differs"].startsWith("계획을 만든 실행과 같은 작업 지정을 apply에 주세요."));
    assert.ok(en["plan.next_apply"].includes("<the same task form>") && ko["plan.next_apply"].includes("<같은 작업 지정>"));
  });

  test("Korean: a tool's or a plan mode's name is followed by a word, not a particle", () => {
    for (const id of IDS) {
      const text = MESSAGE_TEXTS.ko[id];
      assert.ok(!/propose_(changes|plan)(이|가|은|는|을|를)/.test(text), `${id}: ${text}`);
      assert.ok(!/"(run|apply)"(은|는|이|가|을|를)/.test(text), `${id}: ${text}`);
    }
    assert.ok(MESSAGE_TEXTS.ko["doctor.config_file.plan_tool_missing"].endsWith("실행은 이를 거부합니다"));
    assert.ok(MESSAGE_TEXTS.ko["doctor.task_file.plan_tool_missing"].endsWith("실행은 이 task를 거부합니다"));
  });

  test("the English that docs/usage.md and doctor.ts keep stays", () => {
    const { en } = MESSAGE_TEXTS;
    assert.ok(en["error.hint.plan_tool_missing"].startsWith("A task type with plan \"run\" needs propose_changes among its tools"));
    assert.ok(en["doctor.config_file.plan_tool_missing"].endsWith("a run refuses it"));
    assert.ok(en["doctor.task_file.plan_tool_missing"].endsWith("a run refuses the task"));
  });
});
