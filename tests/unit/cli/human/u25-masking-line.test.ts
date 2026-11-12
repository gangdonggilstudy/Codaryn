/**
 * U-25 (DR-52, AXM-17), the human renderer's part: the end summary shows EngineResult.masking as one
 * line, `summary.masking` (the values registered, the places masked in what was sent to the model),
 * right after the usage line. Counts only: nothing else the result might carry about masking is
 * shown. No line without it, or when either count is not a count. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId } from "../../../../src/contracts/index.js";
import type { EngineResult, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const RUN = toRunId("20261113T030405Z-0a1b2c3d") as RunId;
const CONTEXT = { configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, workspaceForm: "given", policySource: "config", profileApplied: false } as unknown as RunSummaryContext;
const result = (extra: Record<string, unknown>): EngineResult =>
  ({
    schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
    verifiers: [{ id: "v", kind: "command", outcome: "pass", evidence: "", checked: [], limits: [] }], changes: [],
    usage: { modelTurns: 2, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 900 }, journalPath: "x", notices: [], ...extra,
  }) as unknown as EngineResult;
const masking = (registeredValues: unknown, maskedPlaces: unknown) => ({ masking: { registeredValues, maskedPlaces } });

describe("U-25: the end summary's masking line, counts only", () => {
  for (const language of MESSAGE_LANGUAGES) {
    const catalog = createMessageCatalog(language);
    const summary = (extra: Record<string, unknown>): string[] => createHumanOutput(catalog).runSummary(result(extra), CONTEXT).trimEnd().split("\n");
    const usageLine = catalog.format("summary.usage", { turns: 2, toolCalls: 1, seconds: 0.9 });
    // The words before the first count, the same for any counts.
    const label = catalog.format("summary.masking", { registered: 0, masked: 0 }).split("0")[0] ?? "";

    test(`${language}: the two counts on one line right after the usage line; nothing else changes`, () => {
      const plain = summary({});
      const shown = summary(masking(2, 5));
      const at = shown.indexOf(catalog.format("summary.masking", { registered: 2, masked: 5 }));
      assert.ok(at > 0, shown.join("\n"));
      assert.equal(shown[at - 1], usageLine);
      assert.deepEqual([...shown.slice(0, at), ...shown.slice(at + 1)], plain, "the other lines are the same");
      assert.deepEqual(shown[at]?.match(/[0-9]+/g), ["2", "5"], "only the two counts");
    });

    test(`${language}: values registered but none masked in what was sent: the line says 0`, () => {
      const shown = summary(masking(1, 0));
      assert.ok(shown.includes(catalog.format("summary.masking", { registered: 1, masked: 0 })), shown.join("\n"));
    });

    test(`${language}: no masking in the result, or counts that are not counts: no line`, () => {
      const plain = summary({});
      assert.ok(label.length > 0);
      assert.equal(plain.some((line) => line.startsWith(label)), false, plain.join("\n"));
      const odd: unknown[] = [null, "x", 3, [], {}, { registeredValues: 2 }, { maskedPlaces: 5 }];
      for (const value of odd) assert.deepEqual(summary({ masking: value }), plain, JSON.stringify(value));
      for (const [registered, masked] of [[-1, 0], [1.5, 2], ["2", 5], [2, "5"], [Number.NaN, 1], [1, Number.POSITIVE_INFINITY], [2 ** 60, 1], [null, 1]]) {
        assert.deepEqual(summary(masking(registered, masked)), plain, `${String(registered)} ${String(masked)}`);
      }
    });

    test(`${language}: a plan run's summary has the line too`, () => {
      const plan = { status: "needs-input", reason: "plan_pending", exitCode: 3, verifiers: [], plan: { digest: "a".repeat(64), actions: 1 } };
      const shown = summary({ ...plan, ...masking(1, 3) });
      assert.ok(shown.includes(catalog.format("summary.masking", { registered: 1, masked: 3 })), shown.join("\n"));
      assert.deepEqual(shown.filter((line) => !line.startsWith(label)), summary(plan));
    });
  }

  test("counts only: whatever else masking might carry (values, places, lengths) is never shown", () => {
    const en = createMessageCatalog("en");
    const summary = (extra: Record<string, unknown>): string => createHumanOutput(en).runSummary(result(extra), CONTEXT);
    const secret = ["fake", "secret", "value", "42"].join("-");
    const carried = { masking: { registeredValues: 1, maskedPlaces: 2, values: [secret], places: [{ text: "task", offset: 17 }], lengths: [secret.length], value: secret } };
    const text = summary(carried);
    assert.equal(text, summary(masking(1, 2)));
    assert.equal(text.includes(secret), false);
    // Its line holds the two counts and no other number (no length, no place).
    const line = text.split(String.fromCharCode(10)).find((row) => row.startsWith("Masking"));
    assert.deepEqual(line?.match(/[0-9]+/g), ["1", "2"], String(line));
  });
});
