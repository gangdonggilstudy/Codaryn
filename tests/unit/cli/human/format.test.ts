/**
 * N-5 layout helpers and the --quiet writer.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { displayWidth, finalLine, formatLocalTime, padEnd, shellArg, shownPath } from "../../../../src/cli/human/format.js";
import { createHumanWriter } from "../../../../src/cli/human/writer.js";

const KEY_SHAPED = ["sk", "ant", "FAKEfake0000FAKEfake0000"].join("-");

describe("format", () => {
  test("shellArg keeps plain arguments, quotes spaces and refuses what a shell would expand", () => {
    assert.equal(shellArg("D:\\work\\notes"), "D:\\work\\notes");
    assert.equal(shellArg("./work"), "./work");
    assert.equal(shellArg("D:\\my work\\노트"), '"D:\\my work\\노트"');
    for (const unsafe of ["", "a$b c", "a`b", 'a"b', "100% c", "a!b c", "a\nb", "a\u001bb", "C:\\dir with space\\"]) {
      assert.equal(shellArg(unsafe), null, JSON.stringify(unsafe));
    }
  });

  test("finalLine replaces control characters and hides key-shaped text", () => {
    assert.equal(finalLine(`a\u001b[2Jb\rc ${KEY_SHAPED}`), "a?[2Jb?c [key]");
  });

  test("shownPath cuts long paths", () => {
    assert.equal(shownPath("a".repeat(250)), `${"a".repeat(200)}...`);
    assert.equal(shownPath("x\u202ey"), "x?y");
  });

  test("displayWidth counts Hangul and CJK as two columns", () => {
    assert.equal(displayWidth("abc"), 3);
    assert.equal(displayWidth("완료"), 4);
    assert.equal(displayWidth("確認"), 4);
    assert.equal(padEnd("완료", 6), "완료  ");
    assert.equal(padEnd("toolong", 3), "toolong");
  });

  test("formatLocalTime writes local wall time", () => {
    const at = new Date(2026, 10, 12, 9, 5, 7).getTime();
    assert.equal(formatLocalTime(at), "2026-11-12 09:05:07");
    assert.equal(formatLocalTime(Number.NaN), "?");
  });
});

describe("createHumanWriter (--quiet)", () => {
  test("writes lines to its sink, nothing with quiet, and survives a failing sink", () => {
    const written: string[] = [];
    const loud = createHumanWriter({ write: (text) => written.push(text), quiet: false });
    loud.lines(["a", "b"]);
    loud.text("c\n");
    loud.lines([]);
    assert.deepEqual(written, ["a\nb\n", "c\n"]);

    const quiet = createHumanWriter({ write: (text) => written.push(text), quiet: true });
    quiet.lines(["x"]);
    quiet.text("y\n");
    assert.deepEqual(written, ["a\nb\n", "c\n"], "--quiet writes nothing");

    const broken = createHumanWriter({
      write: () => {
        throw new Error("EPIPE");
      },
      quiet: false,
    });
    assert.doesNotThrow(() => broken.lines(["z"]));
  });
});
