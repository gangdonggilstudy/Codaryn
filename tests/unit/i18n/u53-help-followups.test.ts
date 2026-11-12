/**
 * U-53 (review R-64 L2, L3; R-58 L2): what help says about the terminal and about `changes` follows
 * the CLI as it is (docs/cli-contract.md, "터미널의 JSON 줄", U-45):
 * - The JSON line is left out only when stdout and stderr are both a terminal, without --json or
 *   --quiet; stderr sent to a file (2> log.txt) brings it back.
 * - help.output speaks of the result of run, revert and apply and of the errors, not of every
 *   output; the Korean second sentence is as wide as the English one (every command's errors).
 * - A file's text in `changes` is shown only when the run has no records-changed mark, the file is
 *   as the run left it, and the current secrets mask it as the run did (changes.no_text_note).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_TEXTS } from "../../../src/i18n/index.js";

describe("U-53: help follows the terminal rule and the conditions of changes", () => {
  test("help.output: both streams, the stderr case, and only run, revert, apply and the errors", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.match(en["help.output"], /^At a terminal \(stdout and stderr both\), the result of run, revert and apply, and any command's error, /);
    assert.match(ko["help.output"], /^터미널\(stdout과 stderr 모두\)에서는 run·revert·apply의 결과와 모든 명령의 오류가 /);
    for (const text of [en["help.output"], ko["help.output"]]) {
      // stderr not at a terminal brings the JSON line back, as stdout not at a terminal does.
      assert.ok(text.includes("2> log.txt"), text);
      assert.match(text, /stdout( or|이나) stderr/);
    }
    // The Korean second sentence speaks of what the first names: the results and every command's errors.
    const [, second] = ko["help.output"].split(". ");
    assert.ok(second?.startsWith("그 결과와 오류는 "), ko["help.output"]);
    assert.ok(en["help.output"].split(". ")[1]?.startsWith("They are also printed "), en["help.output"]);
  });

  test("apply: at a terminal means stdout and stderr both, as main's help said before U-35", () => {
    assert.match(MESSAGE_TEXTS.en["help.command.apply"], /At a terminal \(stdout and stderr both\) the result's JSON line is printed only with --json or --quiet\.$/);
    assert.match(MESSAGE_TEXTS.ko["help.command.apply"], /터미널\(stdout과 stderr 모두\)에서는 --json 또는 --quiet 옵션을 줄 때만 결과의 JSON 한 줄을 냅니다\.$/);
  });

  test("changes: the three conditions under which a file's lines are shown, as changes itself says", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.match(en["help.command.changes"], /only when the run has no records-changed mark, the file is as the run left it, and the current secrets mask it as the run did/);
    assert.match(ko["help.command.changes"], /실행에 기록 변경 표시가 없고, 파일이 실행이 남긴 그대로이며, 지금의 가릴 값이 실행 때와 같게 가릴 때만 보입니다/);
  });
});
