/**
 * U-255 (review R-110b L-a and I-1; PM): two of bundle A's refusal hints in Korean.
 * - unreadable_paths_required: the folder goes into policy.unreadablePaths of one of those files, not
 *   into the file itself ("…가운데 한 곳의 policy.unreadablePaths에 넣으세요"), as the English says.
 * - unreadable_with_commands: a command "can read" the hidden files ("읽을 수 있습니다"), as the
 *   English and doctor's Korean say.
 * The window keeps copies of these hints (gui/src/renderer/i18n/ko.ts); a GUI test holds them equal
 * to the CLI's, so the copies changed in the same unit. This test checks that they still match.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { MESSAGE_TEXTS } from "../../../src/i18n/index.js";

const IDS = ["error.hint.unreadable_paths_required", "error.hint.unreadable_with_commands"] as const;

describe("U-255: the unreadable paths' hints in Korean", () => {
  test("the folder goes into policy.unreadablePaths; a command can read the hidden files", () => {
    const { ko } = MESSAGE_TEXTS;
    assert.ok(ko["error.hint.unreadable_paths_required"].endsWith("개인정보가 든 표의 폴더를 task 파일, 설정 파일, 프로필 가운데 한 곳의 policy.unreadablePaths에 넣으세요."));
    assert.match(ko["error.hint.unreadable_with_commands"], /에이전트에게서 감춘 파일도 읽을 수 있습니다\./);
    assert.ok(!ko["error.hint.unreadable_with_commands"].includes("감춘 파일도 읽습니다"));
  });

  test("the window's copies are the CLI's words", () => {
    const gui = readFileSync(new URL("../../../../gui/src/renderer/i18n/ko.ts", import.meta.url), "utf8");
    for (const id of IDS) assert.ok(gui.includes(`"${id}": ${JSON.stringify(MESSAGE_TEXTS.ko[id])}`), id);
  });
});
