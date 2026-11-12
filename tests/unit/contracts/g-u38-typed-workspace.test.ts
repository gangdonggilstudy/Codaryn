/**
 * U-38 (DR-51, UXM-8): the next-command hints of the end summaries show the workspace path the person
 * typed, so the command can be copied; the JSON and the records still never carry it. PM: the path is
 * shown only after the registered values and key shapes are masked; a path masking changes or cannot
 * mask, one with a character that cannot stand in double quotes (control characters, line breaks,
 * characters that end, expand or escape there), or a long one gives the `<workspace>` hint of today.
 * One form only: double quotes. The task form (`--task`, no typed path) is as today. Only the end
 * summaries' hints. Revert knows no registered values: key shapes only.
 *
 * Fake values only; the key shape is built at run time.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FIXED_MESSAGES,
  MAX_SHOWN_WORKSPACE_CHARS,
  MESSAGE_IDS,
  isShownWorkspace,
  messageParams,
  toShownWorkspace,
} from "../../../src/contracts/index.js";
import type {
  ApplySummaryContext,
  HumanOutput,
  MessageId,
  MessageParamTypeByKind,
  RevertSummaryContext,
  RunSummaryContext,
  ShownWorkspace,
} from "../../../src/contracts/index.js";

const KEY_SHAPED = ["sk", "ant", "Q".repeat(24)].join("-");
const shown = (typed: string): ShownWorkspace | null => toShownWorkspace(typed, typed);

describe("U-38: the typed workspace in the next-command hints", () => {
  test("a plain path, with spaces, Hangul or backslashes, is shown in double quotes", () => {
    for (const typed of ["examples/demo", "C:\\My Projects\\demo", "D:\\작업\\데모", "../ws (copy)", "/home/user/proj-1.2_x", "."]) {
      assert.equal(shown(typed), `"${typed}"`, typed);
    }
  });

  test("a path masking changed, or could not mask, gives the placeholder hint (null)", () => {
    assert.equal(toShownWorkspace("D:\\work\\customer-a", "D:\\work\\[[CODARYN_SECRET:0123456789abcdef]]"), null);
    assert.equal(toShownWorkspace("D:\\work", null), null);
  });

  test("characters that cannot stand in double quotes in every shell give null", () => {
    for (const typed of ['a"b', "a$b", "a`b", "a%PATH%b", "a!b", "a\nb", "a\rb", "a\tb", "a\u0007b", "a\u2028b", "a\u2029b", "a\u202eb", "a\u200bb", "a\u0085b", "a\ud800b", "C:\\dir\\"]) {
      assert.equal(shown(typed), null, JSON.stringify(typed));
    }
  });

  test("key shapes and privacy-token fragments give null, whoever masked", () => {
    assert.equal(shown(`D:\\${KEY_SHAPED}`), null);
    assert.equal(shown("D:\\x\\[[CODARYN_SECRET:0123456789abcdef]]"), null);
    assert.equal(shown("D:\\codaryn_Secret_notes"), null);
  });

  test("empty, blank and long paths give null; the limit counts code points", () => {
    assert.equal(shown(""), null);
    assert.equal(shown("   "), null);
    assert.equal(MAX_SHOWN_WORKSPACE_CHARS, 80);
    assert.equal(shown("가".repeat(MAX_SHOWN_WORKSPACE_CHARS)), `"${"가".repeat(MAX_SHOWN_WORKSPACE_CHARS)}"`);
    assert.equal(shown("a".repeat(MAX_SHOWN_WORKSPACE_CHARS + 1)), null);
  });

  test("isShownWorkspace accepts only what toShownWorkspace makes", () => {
    const value = shown("examples/demo");
    assert.ok(value !== null && isShownWorkspace(value));
    for (const other of ["examples/demo", '"a"b"', '"a$b"', '""', '"', 7, null, `"${KEY_SHAPED}"`, '"C:\\dir\\"']) {
      assert.equal(isShownWorkspace(other), false, JSON.stringify(other));
    }
  });

  test("the hints that take it, and the hints of today stay for the placeholder", () => {
    const wanted = {
      "summary.next_report_typed": { runId: "runId", workspace: "workspace" },
      "summary.next_revert_typed": { runId: "runId", workspace: "workspace" },
      "summary.next_revert_unsafe_typed": { runId: "runId", workspace: "workspace" },
      "summary.form.typed": { workspace: "workspace" },
    };
    const ids = MESSAGE_IDS as readonly string[];
    for (const [id, params] of Object.entries(wanted)) {
      assert.equal(ids.filter((entry) => entry === id).length, 1, id);
      assert.deepEqual(messageParams(id as MessageId), params, id);
    }
    for (const id of ["summary.next_report", "summary.next_revert", "summary.next_revert_unsafe"] as const) assert.deepEqual(FIXED_MESSAGES[id], { runId: "runId" });
    assert.deepEqual(FIXED_MESSAGES["summary.form.given"], {});
    const kind: MessageParamTypeByKind["workspace"] = shown("ws") as ShownWorkspace;
    assert.equal(kind, '"ws"');
  });

  test("the contexts carry it only as a ShownWorkspace, and revert's summary gets a context", () => {
    const workspaceShown = shown("examples/demo") as ShownWorkspace;
    const apply: ApplySummaryContext = { workspaceForm: "given", workspaceShown };
    const revert: RevertSummaryContext = { workspaceShown };
    const run: Pick<RunSummaryContext, "workspaceForm" | "workspaceShown"> = { workspaceForm: "given", workspaceShown };
    assert.ok(apply && revert && run);
    // @ts-expect-error a typed path never reaches a context without the checks
    const raw: RevertSummaryContext = { workspaceShown: "examples/demo" };
    assert.ok(raw);
    const takesContext: Parameters<HumanOutput["revertSummary"]>["length"] = 2;
    assert.equal(takesContext, 2);
  });
});
