/**
 * U-8 (R-39 L-1), the human renderer's part: a `state_checked` record gets a progress line when the
 * state check was limited (`progress.state_unchecked`) or found a change (`progress.state_changed`
 * with the count), and no line when it was complete and found nothing; the same in an apply run.
 * The apply summary adds `apply.notice.<kind>` for each of ApplyResult.noticeKinds. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES } from "../../../../src/contracts/index.js";
import type { ApplyJournalEvent, ApplyResult, CatalogText, JournalEvent, MaskedText, MessageCatalog } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const checked = (changed: readonly string[], limited: boolean, phase = "after_verify"): JournalEvent =>
  ({ type: "state_checked", phase, changed: changed as readonly MaskedText[], limited }) as JournalEvent;

describe("U-8: the progress line of a state check", () => {
  for (const language of MESSAGE_LANGUAGES) {
    const catalog = createMessageCatalog(language);
    test(`${language}: limited says the state directory could not be checked entirely; complete and unchanged says nothing`, () => {
      const out = createHumanOutput(catalog);
      assert.equal(out.progressLine(checked([], false)), null);
      assert.equal(out.progressLine(checked([], false, "run_start")), null);
      assert.equal(out.progressLine(checked([], true)), catalog.format("progress.state_unchecked"));
      assert.equal(out.applyProgressLine?.(checked([], true) as ApplyJournalEvent), catalog.format("progress.state_unchecked"));
      assert.equal(out.applyProgressLine?.(checked([], false) as ApplyJournalEvent), null);
    });

    test(`${language}: a change says how many paths, never which; with limited too it is the change that is told`, () => {
      const out = createHumanOutput(catalog);
      const line = out.progressLine(checked(["runs/20261112T000000Z-00000000/secret-name.txt", "extra.txt"], false));
      assert.equal(line, catalog.format("progress.state_changed", { count: 2 }));
      assert.equal(line?.includes("secret-name"), false);
      assert.equal(out.progressLine(checked(["extra.txt"], true)), catalog.format("progress.state_changed", { count: 1 }));
    });
  }

  test("a record that is not well formed gets no line and no exception", () => {
    const out = createHumanOutput(createMessageCatalog("en"));
    assert.equal(out.progressLine({ type: "state_checked", phase: "x", changed: "no", limited: "yes" } as unknown as JournalEvent), null);
    assert.equal(out.progressLine({ type: "state_checked", phase: "run_end", changed: [], limited: "yes" } as unknown as JournalEvent), null);
  });
});

describe("U-8: the apply summary tells each notice kind once", () => {
  // The texts apply.notice.* are the catalog owner's; a stand-in shows which ids the renderer asks for.
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

  test("noticeKinds plan_records_unchecked adds apply.notice.plan_records_unchecked; none adds nothing; unknown kinds are left out", () => {
    const out = createHumanOutput(standIn);
    const withNotice = out.applySummary?.(result({ noticeKinds: ["plan_records_unchecked"] }), { workspaceForm: "given" }) ?? "";
    assert.ok(withNotice.includes("<apply.notice.plan_records_unchecked>"), withNotice);
    asked.length = 0;
    const plain = out.applySummary?.(result({}), { workspaceForm: "given" }) ?? "";
    assert.equal(asked.some((id) => id.startsWith("apply.notice.")), false);
    assert.equal(plain.includes("apply.notice"), false);
    const odd = out.applySummary?.(result({ noticeKinds: ["made_up", 7] }), { workspaceForm: "given" }) ?? "";
    assert.equal(odd.includes("made_up"), false);
  });
});
