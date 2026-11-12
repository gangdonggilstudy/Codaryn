/**
 * U-36 (UXM-7 ③ ④; the U-19 survey, sections 3 C and 3 D): the text of `plan`, `apply`'s terminal
 * questions, `review`'s lines and `changes` are in the catalog. The English is the CLI's lines where
 * one template can say them, so the English output and its tests stay. The Korean uses DR-50's words.
 *
 * G-A, UXM-23: no text takes a digest or a time. The renderer puts the digest's first characters
 * after plan.digest_label and plan.next_apply, the apply's time after plan.applied_by, the code in
 * parentheses after changes.unavailable.<reason>, and prompt.yes_no_default_no after a question.
 *
 * PM (combined board 0229b40): a text carries no mark the renderer joins it with (a colon, a
 * semicolon, parentheses around it, a space at either end), in both languages. The renderers
 * (unit/U-36-nc-human plan-commands.ts, unit/U-36-p5a-adapter changes.ts) add them.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CHANGED_FILE_STATES, CHANGED_FILE_UNAVAILABLE_REASONS, PLAN_ACTION_KINDS, PLAN_STATUSES, REVIEW_VERDICTS } from "../../../src/contracts/index.js";
import type { MessageId } from "../../../src/contracts/index.js";
import { createMessageCatalog, MESSAGE_TEXTS } from "../../../src/i18n/index.js";
import { loose } from "./support.js";

const HANGUL = /[가-힣]/u;
const RUN = "20261112T010203Z-0123abcd";
const DIGEST = "0123456789abcdef";

const FIXED = [
  "plan.heading",
  "plan.digest_label",
  "plan.discard_kept",
  "plan.inventory_limit",
  "plan.applied_by",
  "plan.next_apply",
  "apply.question",
  "apply.unsafe_move_question",
  "review.recorded",
  "review.recorded_replaced",
  "review.unchanged",
  "changes.heading",
  "changes.no_text_note",
  "changes.none",
  "changes.file.created",
  "changes.file.changed",
  "changes.no_difference",
  "changes.more_lines",
] as const;

const LISTED: readonly MessageId[] = [
  ...PLAN_STATUSES.map((status) => `plan.status.${status}` as const),
  ...PLAN_ACTION_KINDS.map((kind) => `plan.action.${kind}` as const),
  ...REVIEW_VERDICTS.map((verdict) => `review.verdict.${verdict}` as const),
  ...CHANGED_FILE_STATES.map((state) => `changes.state.${state}` as const),
  ...CHANGED_FILE_UNAVAILABLE_REASONS.map((reason) => `changes.unavailable.${reason}` as const),
];

describe("U-36: the text of plan, apply's questions, review and changes", () => {
  test("the English gives the CLI's lines as they were", () => {
    const { en } = MESSAGE_TEXTS;
    const format = loose(createMessageCatalog("en"));
    assert.equal(format("plan.heading", { runId: RUN, count: 1, status: format("plan.status.pending") }), `Plan of run ${RUN}: 1 action(s), pending`);
    assert.equal(`${en["plan.digest_label"]}: ${DIGEST}`, `Digest: ${DIGEST}`);
    assert.equal(`(${en["plan.discard_kept"]})`, "(kept in .codaryn/discarded/ until removed)");
    assert.equal(en["review.unchanged"], "The run's result and records are unchanged; `codaryn report` shows the verdict.");
    assert.equal(en["plan.inventory_limit"], "The workspace has more files than the inventory check can list; an apply would stop as plan_stale and move nothing.");
    assert.equal(
      `${format("plan.next_apply", { runId: RUN })} ${DIGEST.slice(0, 12)}`,
      `To apply it: codaryn apply <the same task form> --run ${RUN} --digest ${DIGEST.slice(0, 12)}`,
    );
    assert.equal(`${en["apply.question"]} ${en["prompt.yes_no_default_no"]}`, "Apply this plan? [y/N]");
    assert.equal(format("review.recorded", { runId: RUN, verdict: format("review.verdict.accepted") }), `Review of run ${RUN}: accepted.`);
    assert.equal(
      format("review.recorded_replaced", { runId: RUN, verdict: format("review.verdict.rejected") }),
      `Review of run ${RUN}: rejected (an earlier review was replaced).`,
    );
    assert.equal(format("changes.heading", { runId: RUN }), `changes of run ${RUN}, masked with the secrets registered now (not the run's own masking)`);
    assert.equal(en["changes.none"], "the run changed no file");
    assert.equal(`${en["changes.file.changed"]}; ${en["changes.state.as_run_left"]}`, "changed by the run; as the run left it");
    assert.equal(`${en["changes.file.created"]}; ${en["changes.state.changed_since_run"]}`, "created by the run; changed again since the run");
    assert.deepEqual([en["changes.state.missing"], en["changes.state.unknown"]], ["no longer exists", "could not be read now"]);
    assert.equal(en["changes.no_difference"], "no difference to the original");
    assert.equal(format("changes.more_lines", { count: 5 }), "... 5 more lines");
    // g-changes-wire and changes.test pin this line and the one DR-29 line.
    assert.equal(`${en["changes.unavailable.masking_unverified"]} (masking_unverified)`, "the text is not shown (masking_unverified)");
    assert.equal(en["changes.no_text_note"].match(/DR-29/g)?.length, 1);
    // The listed words of plan and review are the codes the lines showed.
    assert.deepEqual(
      [...PLAN_STATUSES, ...PLAN_ACTION_KINDS, ...REVIEW_VERDICTS].map((code) => code),
      [en["plan.status.pending"], en["plan.status.applied"], en["plan.action.move"], en["plan.action.discard"], en["review.verdict.accepted"], en["review.verdict.rejected"]],
    );
  });

  test("no text takes a digest or a time; the renderer puts them after the text", () => {
    for (const language of ["en", "ko"] as const) {
      const t = MESSAGE_TEXTS[language];
      for (const id of [...FIXED, ...LISTED]) assert.ok(!/<digest>|<다이제스트>|\{(digest|at|time)\}/.test(t[id]), `${language} ${id}`);
      assert.ok(t["plan.next_apply"].endsWith(" --digest"), language);
      assert.ok(t["plan.next_apply"].includes("--run {runId}"), language);
      // It stands alone when the time is left out, and the time can follow it.
      assert.ok(!/\.$|\d{4}/.test(t["plan.applied_by"]), language);
      // The questions end as questions; [y/N] is the renderer's (prompt.yes_no_default_no).
      for (const id of ["apply.question", "apply.unsafe_move_question"] as const) {
        assert.ok(t[id].endsWith("?") && !t[id].includes("[y/N]"), `${language} ${id}`);
      }
    }
  });

  test("no text carries a mark the renderer joins it with (PM)", () => {
    for (const language of ["en", "ko"] as const) {
      const t = MESSAGE_TEXTS[language];
      for (const id of [...FIXED, ...LISTED]) {
        assert.equal(t[id], t[id].trim(), `${language} ${id}: a space at an end`);
        assert.ok(!/[:;]$/.test(t[id]), `${language} ${id}: ends with a colon or semicolon`);
        assert.ok(!/^\(.*\)$/.test(t[id]), `${language} ${id}: in parentheses`);
      }
    }
    assert.deepEqual([MESSAGE_TEXTS.en["plan.digest_label"], MESSAGE_TEXTS.ko["plan.digest_label"]], ["Digest", "다이제스트"]);
  });

  test("why a file's text is not shown: one lead, then the reason in words; the code is the renderer's", () => {
    for (const language of ["en", "ko"] as const) {
      const t = MESSAGE_TEXTS[language];
      const lead = t["changes.unavailable.masking_unverified"];
      for (const reason of CHANGED_FILE_UNAVAILABLE_REASONS) {
        const text = t[`changes.unavailable.${reason}`];
        assert.ok(text.startsWith(lead), `${language} ${reason}`);
        if (reason !== "masking_unverified") assert.ok(text.length > lead.length + 2, `${language} ${reason}: a reason in words`);
        assert.ok(!/[a-z]+_[a-z]+|\(/.test(text), `${language} ${reason}: no code`);
      }
    }
  });

  test("the unsafe-move question says the same in both languages", () => {
    const { en, ko } = MESSAGE_TEXTS;
    // The catalog's words for it (summary.unsafe_moves, plan.problem.unsafe_move); no promise words (UX 1.4).
    assert.match(en["apply.unsafe_move_question"], /^\{count\} move\(s\) of this plan could replace a file at the destination, since the drive has no hard links\. Nothing was moved\..*for this apply only\?$/);
    assert.match(ko["apply.unsafe_move_question"], /이동 \{count\}개는 이 드라이브에 하드 링크가 없어 대상 자리의 파일을 덮어쓸 수 있습니다\. 아무것도 옮기지 않았습니다\..*이번 적용에서만.*\?$/);
  });

  test("the Korean is in Korean, with no decision number", () => {
    const { ko } = MESSAGE_TEXTS;
    for (const id of [...FIXED, ...LISTED]) {
      assert.ok(HANGUL.test(ko[id]), `ko ${id}`);
      assert.ok(!/\b(DR|U|R|N|G)-\d/.test(ko[id]), `ko ${id}`);
    }
    assert.ok(ko["plan.discard_kept"].includes("폐기 보관함"));
  });
});
