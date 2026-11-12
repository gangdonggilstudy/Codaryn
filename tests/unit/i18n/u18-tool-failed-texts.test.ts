/**
 * U-18 (AXM-4): an allowed call that then failed is told, a command that ran and exited with a code
 * other than 0 or timed out is told (not a failed call, PM Q-2 (a)), and the end summary counts the
 * failed calls.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMessageCatalog, MESSAGE_TEXTS } from "../../../src/i18n/index.js";
import { loose } from "./support.js";

const LANGUAGES = ["en", "ko"] as const;

describe("U-18: allowed, failed, and what a command did", () => {
  test("a failed call: the tool, then failed and its code, as a denied call's line is made", () => {
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      const lead = t["progress.tool_denied"].slice(0, t["progress.tool_denied"].indexOf(" — ") + 3);
      assert.ok(t["progress.tool_failed"].startsWith(lead), language);
      assert.ok(t["progress.tool_failed"].endsWith(" ({code})"), language);
      assert.match(t["progress.tool_failed"], language === "en" ? /— failed \(/ : /— 실패 \(/);
    }
    const catalog = createMessageCatalog("en");
    const format = loose(catalog);
    const tool = catalog.format("tool.read_file");
    assert.equal(format("progress.tool_failed", { tool, code: "not_found" }), "read file — failed (not_found)");
  });

  test("a command that ran: its exit code or its time limit, not a failure", () => {
    for (const language of LANGUAGES) {
      const t = MESSAGE_TEXTS[language];
      for (const id of ["progress.command_exited", "progress.command_timed_out"] as const) {
        assert.ok(!(language === "en" ? /fail|error/i : /실패|오류/).test(t[id]), `${language} ${id}`);
        assert.ok(t[id].startsWith(language === "en" ? "command ran — " : "명령 실행됨 — "), `${language} ${id}`);
      }
      // No Korean particle after the number (it would change with how the number reads).
      assert.match(t["progress.command_exited"], /\{exitCode\}$/);
    }
    assert.equal(loose(createMessageCatalog("ko"))("progress.command_exited", { exitCode: 3 }), "명령 실행됨 — 종료 코드 3");
  });

  test("the summary counts the failed calls as it counts the denied ones", () => {
    const { en, ko } = MESSAGE_TEXTS;
    assert.equal(en["summary.failed"], "Failed calls: {count}");
    assert.equal(ko["summary.failed"], "실패한 호출: {count}건");
    assert.equal(en["summary.denied"].replace("Denied", "Failed"), en["summary.failed"]);
    assert.equal(ko["summary.denied"].replace("거부된", "실패한"), ko["summary.failed"]);
  });
});
