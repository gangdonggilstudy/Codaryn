/**
 * U-99a (d): an apply runs its built-in inventory check (kind "inventory", id "inventory") and the
 * task's verifiers. A task verifier with the id "inventory" got the same number as the built-in check,
 * because the renderer numbered verifiers by id: the real CLI printed "check #1 — passed (pass)" twice
 * for two different checks (main 92c75b4, U-99 survey). A verifier is now told apart by its kind and
 * its id: the two get #1 and #2. In a model run the same verifier keeps its number from round to round,
 * as before. Real catalogs, both languages; fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES } from "../../../../src/contracts/index.js";
import type { ApplyJournalEvent, JournalEvent } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const verifier = (id: string, kind: string, outcome: "pass" | "fail"): JournalEvent =>
  ({ type: "verifier_result", result: { id, kind, outcome, evidence: "", checked: [], limits: [] } }) as unknown as JournalEvent;
const applyStarted = { type: "apply_started", schemaVersion: 1, planRunId: "20261113T010203Z-0a1b2c3d", taskId: "t", digest: "a".repeat(64), approval: "cli-flag", actions: 1, maxDurationMs: 60_000 } as unknown as ApplyJournalEvent;
const repair = { type: "repair_started", attempt: 1, failedVerifiers: ["notes"], feedbackTruncated: false } as unknown as JournalEvent;

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const line = (number: number, outcome: "pass" | "fail") => `${catalog.format("progress.verifier", { number, outcome: catalog.format(`outcome.${outcome}`) })} (${outcome})`;

  describe(`U-99a (d), ${language}: a verifier is numbered by its kind and id`, () => {
    test("an apply whose task verifier is named inventory: the built-in check #1, the task's #2", () => {
      const out = createHumanOutput(catalog);
      out.applyProgressLine?.(applyStarted);
      const lines = [verifier("inventory", "inventory", "pass"), verifier("inventory", "command", "pass")].map((event) => out.applyProgressLine?.(event as unknown as ApplyJournalEvent));
      assert.deepEqual(lines, [line(1, "pass"), line(2, "pass")]);
    });

    test("a model run: the same verifier keeps its number after a repair; another verifier has its own", () => {
      const out = createHumanOutput(catalog);
      const lines = [verifier("notes", "file_rules", "fail"), verifier("tests", "command", "pass"), repair, verifier("notes", "file_rules", "pass"), verifier("tests", "command", "pass")]
        .map((event) => out.progressLine(event))
        .filter((entry) => entry !== null && !entry.startsWith(catalog.format("progress.repair", { attempt: 1, count: 1 })));
      assert.deepEqual(lines, [line(1, "fail"), line(2, "pass"), line(1, "pass"), line(2, "pass")]);
    });

    test("the same id with two kinds in a model run is two verifiers too; the numbers start again at the next run", () => {
      const out = createHumanOutput(catalog);
      assert.deepEqual([verifier("x", "command", "pass"), verifier("x", "file_rules", "fail")].map((event) => out.progressLine(event)), [line(1, "pass"), line(2, "fail")]);
      out.progressLine({ type: "run_started", schemaVersion: 1, taskId: "t", workflow: "w", provider: "scripted", limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1 } } as unknown as JournalEvent);
      assert.equal(out.progressLine(verifier("x", "file_rules", "pass")), line(1, "pass"));
    });
  });
}
