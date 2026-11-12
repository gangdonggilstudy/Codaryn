/**
 * N-19: the one JSON line on stdout writes every non-ASCII character as \uXXXX, so a Windows
 * PowerShell 5.1 console with its default code page cannot garble it. Parsed, the value is the same.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderOutcome } from "../../../src/cli/guard.js";
import type { CliErrorOutput } from "../../../src/contracts/index.js";

test("N-19: stdout JSON is pure ASCII and parses to the same value", () => {
  const output: CliErrorOutput = {
    schemaVersion: 1,
    kind: "error",
    code: "invalid_config",
    exitCode: 2,
    message: "설정 파일 — 🙂 é   \u007f",
  };
  const line = renderOutcome({ output, exitCode: 2 });
  assert.ok(line.endsWith("\n"));
  assert.equal(line.indexOf("\n"), line.length - 1, "one line only");
  assert.match(line, /^[\x00-\x7f]*$/, "every byte is ASCII");
  assert.deepEqual(JSON.parse(line), output);
  assert.ok(line.includes("\\uc124"), "Hangul is escaped");
  assert.ok(line.includes("\\ud83d\\ude42"), "an astral character is escaped as its surrogate pair");
  assert.ok(line.includes("\\u2028"), "a line separator is escaped");
});

test("N-19: text outputs (help, report) are left as they are", () => {
  assert.equal(renderOutcome({ text: "한글", exitCode: 0 }), "한글\n");
});
