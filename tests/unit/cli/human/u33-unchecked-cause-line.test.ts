/**
 * U-33 (review R-56 R56-L3, PM Q-1 (a), contract 1362e4b), the human renderer's part: the apply
 * summary's line for the notice kind `plan_records_unchecked` follows its cause.
 * - ApplyResult.planRecordsUncheckedCause "run_since_plan" (every check of this apply was complete,
 *   a run since the plan could not check): `apply.notice.plan_records_unchecked.run_since_plan`,
 *   in place of U-8's line, which advises a cleanup.
 * - No cause (this apply's own check was limited, U-8): U-8's `apply.notice.plan_records_unchecked`,
 *   as on main a191a50. So is a cause that is not one of PLAN_RECORDS_UNCHECKED_CAUSES.
 * - A cause without the kind: no line of either.
 * The texts are the catalog owner's; a stand-in shows which ids the renderer asks for. Where the
 * catalog has the new text, the real lines are checked in both languages. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, PLAN_RECORDS_UNCHECKED_CAUSES } from "../../../../src/contracts/index.js";
import type { ApplyResult, CatalogText, MessageCatalog } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";
import { MESSAGE_TEXTS } from "../../../../src/i18n/catalog.js";

const U8 = "apply.notice.plan_records_unchecked";
const SINCE = "apply.notice.plan_records_unchecked.run_since_plan";
const TASK = "apply.notice.plan_task_differs";

const real = createMessageCatalog("en");
const asked: string[] = [];
const standIn: MessageCatalog = {
  language: "en",
  format: ((id: string, ...params: unknown[]) => {
    asked.push(id);
    return id.startsWith("apply.notice.") ? (`<${id}>` as CatalogText) : (real.format as (id: string, ...rest: unknown[]) => CatalogText)(id, ...params);
  }) as MessageCatalog["format"],
};
const result = (extra: Record<string, unknown>): ApplyResult =>
  ({
    schemaVersion: 1, kind: "apply", runId: "20261112T000100Z-00000001", planRunId: "20261112T000000Z-00000000", taskId: "t", digest: "d".repeat(64),
    status: "done", reason: "verified", exitCode: 0, applied: [], verifiers: [],
    usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 5 }, journalPath: "x", notices: [], ...extra,
  }) as unknown as ApplyResult;
const linesOf = (out: ReturnType<typeof createHumanOutput>, extra: Record<string, unknown>): string[] =>
  (out.applySummary?.(result(extra), { workspaceForm: "given" }) ?? "").split("\n");
const count = (lines: readonly string[], line: string): number => lines.filter((entry) => entry === line).length;

describe("U-33 R56-L3: the line of plan_records_unchecked follows its cause", () => {
  const out = createHumanOutput(standIn);

  test("cause run_since_plan: one line of apply.notice.plan_records_unchecked.run_since_plan, and not U-8's", () => {
    asked.length = 0;
    const lines = linesOf(out, { noticeKinds: ["plan_records_unchecked"], planRecordsUncheckedCause: "run_since_plan" });
    assert.equal(count(lines, `<${SINCE}>`), 1, lines.join("\n"));
    assert.equal(count(lines, `<${U8}>`), 0, lines.join("\n"));
    assert.deepEqual(asked.filter((id) => id.startsWith("apply.notice.")), [SINCE]);
  });

  test("no cause (the apply's own check was limited): U-8's line, as before", () => {
    asked.length = 0;
    const lines = linesOf(out, { noticeKinds: ["plan_records_unchecked"] });
    assert.equal(count(lines, `<${U8}>`), 1, lines.join("\n"));
    assert.equal(count(lines, `<${SINCE}>`), 0, lines.join("\n"));
    assert.deepEqual(asked.filter((id) => id.startsWith("apply.notice.")), [U8]);
  });

  test("a cause that is not one of the contract's: U-8's line, and no other id is asked", () => {
    for (const cause of ["made_up", 7, null, "", ["run_since_plan"], { cause: "run_since_plan" }]) {
      asked.length = 0;
      const lines = linesOf(out, { noticeKinds: ["plan_records_unchecked"], planRecordsUncheckedCause: cause });
      assert.equal(count(lines, `<${U8}>`), 1, JSON.stringify(cause));
      assert.deepEqual(asked.filter((id) => id.startsWith("apply.notice.")), [U8], JSON.stringify(cause));
    }
  });

  test("a cause without the kind: no line of either; the other kind is told as before", () => {
    asked.length = 0;
    const none = linesOf(out, { planRecordsUncheckedCause: "run_since_plan" });
    assert.equal(asked.some((id) => id.startsWith("apply.notice.")), false, none.join("\n"));
    const other = linesOf(out, { noticeKinds: ["plan_task_differs"], planRecordsUncheckedCause: "run_since_plan" });
    assert.equal(count(other, `<${TASK}>`), 1, other.join("\n"));
    assert.equal(other.some((line) => line.startsWith(`<${U8}`)), false, other.join("\n"));
  });

  test("with plan_task_differs: the cause's line keeps the contract's order (before plan_task_differs)", () => {
    const lines = linesOf(out, { noticeKinds: ["plan_task_differs", "plan_records_unchecked"], planRecordsUncheckedCause: "run_since_plan" });
    assert.ok(lines.indexOf(`<${SINCE}>`) >= 0 && lines.indexOf(`<${SINCE}>`) < lines.indexOf(`<${TASK}>`), lines.join("\n"));
  });

  test("whatever the status: an apply stopped as plan_stale tells the cause's line too", () => {
    const lines = linesOf(out, { status: "failed", reason: "plan_stale", exitCode: 1, noticeKinds: ["plan_records_unchecked"], planRecordsUncheckedCause: "run_since_plan" });
    assert.equal(count(lines, `<${SINCE}>`), 1, lines.join("\n"));
  });

  test("every cause of the contract has its own line", () => {
    for (const cause of PLAN_RECORDS_UNCHECKED_CAUSES) {
      asked.length = 0;
      linesOf(out, { noticeKinds: ["plan_records_unchecked"], planRecordsUncheckedCause: cause });
      assert.deepEqual(asked.filter((id) => id.startsWith("apply.notice.")), [`apply.notice.plan_records_unchecked.${cause}`]);
    }
  });
});

describe("U-33 R56-L3 with the real catalog", () => {
  const ready = MESSAGE_LANGUAGES.every((language) => Object.hasOwn(MESSAGE_TEXTS[language], SINCE));
  for (const language of MESSAGE_LANGUAGES) {
    test(`${language}: the cause's line is the catalog's text, not U-8's, and advises no cleanup`, { skip: ready ? false : `${SINCE} is not in the catalog yet (nb-i18n)` }, () => {
      const catalog = createMessageCatalog(language);
      const lines = linesOf(createHumanOutput(catalog), { noticeKinds: ["plan_records_unchecked"], planRecordsUncheckedCause: "run_since_plan" });
      const line = catalog.format(SINCE);
      assert.equal(count(lines, line), 1, lines.join("\n"));
      assert.equal(count(lines, catalog.format(U8)), 0, lines.join("\n"));
      assert.equal(line.includes("cleanup"), false, line);
      assert.equal(count(linesOf(createHumanOutput(catalog), { noticeKinds: ["plan_records_unchecked"] }), catalog.format(U8)), 1);
    });
  }
});
