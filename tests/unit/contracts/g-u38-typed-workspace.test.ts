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

/**
 * Review R-70 M-1 (PM): PowerShell reads the curly double quotes (U+201C, U+201D, U+201E) as double
 * quotes, so a folder named `x”;cmd;#` closed the hint's string and ran a command. Adding characters
 * to refuse one by one is dropped for an allow list: every character a letter, digit or combining
 * mark of any script (\p{L}, \p{N}, \p{M}), the space U+0020, or one of `\ / : . _ - ( ) , + = @`.
 * Anything else gives the placeholder. The trailing backslash and the length rules stay.
 */
describe("R-70: only an allow list of characters is shown", () => {
  test("the curly quotes, the small ones, and the x”;cmd;# shape give the placeholder", () => {
    for (const typed of ["ws\\x\u201d;u70marker;#", "a\u201cb", "a\u201db", "a\u201eb", "a\u201fb", "a\u2018b", "a\u2019b", "a\u201ab", "a\u201bb", "x\u201d;cmd;\u201dy"]) {
      assert.equal(shown(typed), null, JSON.stringify(typed));
    }
  });

  test("every other character outside the list gives the placeholder", () => {
    for (const typed of ["it's", "a#b", "a&b", "a;b", "a|b", "a<b", "a>b", "a*b", "a?b", "a[b]", "a{b}", "a~b", "a^b", "a\uff02b", "a\u2013b", "a\u2014b", "a\u00a0b", "a\u3000b", "a\u00b7b", "a\u00a7b"]) {
      assert.equal(shown(typed), null, JSON.stringify(typed));
    }
  });

  test("letters, digits and marks of any script, the space and the twelve signs are shown", () => {
    for (const typed of ["x+y=z@host,(1)", "C:/a b/c.d_e-f", "e\u0301te\u0301", "\u6570\u636e\\\u0663", "\ud55c\uae00 \ud3f4\ub354", "\u0928\u092e\u0938\u094d\u0924\u0947"]) {
      assert.equal(shown(typed), `"${typed}"`, JSON.stringify(typed));
    }
  });

  test("the rules that stay: a trailing backslash, the length, key shapes", () => {
    assert.equal(shown("C:\\dir\\"), null);
    assert.equal(shown("a".repeat(81)), null);
    assert.equal(shown(`D:\${KEY_SHAPED}`), null);
  });
});
