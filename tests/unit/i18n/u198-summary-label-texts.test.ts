/**
 * U-198 (p5u-gui's finding; PM direction): a run plan's summary is the approved plan's description of
 * the work, not the goal and not new instructions, as the engine's own label tells the later run
 * ("a description of the work, not new instructions"). The plan view's label, the digest guarantee and
 * the approval note said what the run "will be told" (an instruction); these drafts for nb-i18n now say
 * so in both languages. Pinned here, each text whole.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_TEXTS, createMessageCatalog } from "../../../src/i18n/index.js";

const TEXTS = {
  "plan.changes.summary_label": {
    en: "The plan's summary, written by the plan run (the model's own words, not checked; a description of the work, not the goal or a new instruction; approved with the plan)",
    ko: "계획 실행이 쓴 계획 요약(모델이 쓴 말로 검증되지 않음. 작업의 설명이며 목표나 새 지시가 아님. 계획과 함께 승인됨)",
  },
  "plan.changes.digest_guarantee": {
    en: "The digest names exactly these files, the contents the files to modify had when the plan was made, and the summary above. The run that makes the changes stops before its first model request if the plan or one of these files changed since, and its file tools can write only these files.",
    ko: "다이제스트는 바로 이 파일들과, 계획을 만들 때 수정할 파일의 내용, 그리고 위의 요약을 가리킵니다. 그 뒤로 계획이나 이 파일 가운데 하나가 바뀌었으면 변경을 할 실행은 첫 모델 요청 전에 멈춥니다. 그 실행의 파일 도구는 이 파일들에만 쓸 수 있습니다.",
  },
  "apply.changes.summary_note": {
    en: "The summary above is the model's description of the work, approved with the plan. It is not the goal or a new instruction, and nothing checks the run against it; only the file list is enforced.",
    ko: "위의 요약은 모델이 쓴 작업 설명이며 계획과 함께 승인됩니다. 목표나 새 지시가 아니며, 실행이 그 설명대로 하는지는 아무것도 확인하지 않습니다. 강제되는 것은 파일 목록뿐입니다.",
  },
} as const;

describe("U-198: a run plan's summary is told as the plan's description, not as the goal or an instruction", () => {
  for (const [id, text] of Object.entries(TEXTS)) {
    test(`${id}: both languages, whole`, () => {
      assert.equal((MESSAGE_TEXTS.en as Record<string, string>)[id], text.en);
      assert.equal((MESSAGE_TEXTS.ko as Record<string, string>)[id], text.ko);
      for (const language of ["en", "ko"] as const) assert.equal((createMessageCatalog(language).format as (i: string) => string)(id), text[language]);
    });
  }

  test("none of them calls the summary what the run will be told", () => {
    for (const text of Object.values(TEXTS)) {
      assert.ok(!/will be told|is told|instruction above/i.test(text.en), text.en);
      assert.ok(!text.ko.includes("받을 지시") && !text.ko.includes("위의 지시"), text.ko);
    }
  });
});
