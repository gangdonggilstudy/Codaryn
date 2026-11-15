/**
 * U-52 (review R-65 L-1, I-1; PM decision (a)): one renderer can draw several runs and applies, as
 * the GUI engine host does (one createHumanOutput per language for the host's life). Its per-run
 * memory did not start again: the calls a run denied (U-18) hid the next run's failure of a call with
 * the same id (call ids are only unique within a run: the engine's replacements start again at
 * codaryn-call-1, and a model's own ids may repeat), and verifier numbers went on from the run before.
 * Now `progressLine` starts both again at `run_started` and `apply_started` (the GUI host gives every
 * record to progressLine first), and `applyProgressLine` at `apply_started` (the CLI's apply). A
 * record of a run drawn by a renderer that drew other runs before reads as from a new renderer.
 * Real catalogs, both languages; fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES } from "../../../../src/contracts/index.js";
import type { ApplyJournalEvent, HumanOutput, JournalEvent } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const started = (): JournalEvent =>
  ({ type: "run_started", schemaVersion: 1, taskId: "t", workflow: "test", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 } }) as unknown as JournalEvent;
const applyStarted = (): JournalEvent =>
  ({ type: "apply_started", schemaVersion: 1, planRunId: "20261113T010203Z-0a1b2c3d", taskId: "t", digest: "a".repeat(64), approval: "cli-flag", actions: 1, maxDurationMs: 60_000 }) as unknown as JournalEvent;
const denied = (callId: string): JournalEvent[] => [
  { type: "tool_decision", callId, tool: "run_command", stage: "policy_requested", allowed: false, permission: "command", code: "command_not_allowed" } as unknown as JournalEvent,
  { type: "tool_result", result: { callId, tool: "run_command", ok: false, content: "error (policy_denied): x", errorCode: "policy_denied" } } as unknown as JournalEvent,
];
const failed = (callId: string): JournalEvent[] => [
  { type: "tool_decision", callId, tool: "read_file", stage: "policy_effective", allowed: true, permission: null, code: null } as unknown as JournalEvent,
  { type: "tool_result", result: { callId, tool: "read_file", ok: false, content: "error (not_found): x", errorCode: "not_found" } } as unknown as JournalEvent,
];
const verifier = (id: string): JournalEvent =>
  ({ type: "verifier_result", result: { id, kind: "command", outcome: "pass", evidence: "", checked: [], limits: [] } }) as unknown as JournalEvent;

/** The lines one renderer gives for the records, as the GUI host draws them: progressLine, then applyProgressLine. */
const gui = (out: HumanOutput, events: readonly JournalEvent[]): string[] =>
  events.flatMap((event) => {
    const line = out.progressLine(event) ?? out.applyProgressLine?.(event as unknown as ApplyJournalEvent) ?? null;
    return line === null ? [] : [line];
  });
/** The lines as the CLI's run draws them: progressLine only. */
const cli = (out: HumanOutput, events: readonly JournalEvent[]): string[] => events.flatMap((event) => out.progressLine(event) ?? []);

for (const language of MESSAGE_LANGUAGES) {
  const fresh = (): HumanOutput => createHumanOutput(createMessageCatalog(language));
  const catalog = createMessageCatalog(language);
  const failedLine = catalog.format("progress.tool_failed", { tool: catalog.format("tool.read_file"), code: "not_found" });

  describe(`U-52 (R-65 L-1), ${language}: a renderer that drew a run before draws the next one as a new renderer`, () => {
    test("a run that denied call codaryn-call-1, then a run whose codaryn-call-1 failed: the failure is told", () => {
      const out = fresh();
      cli(out, [started(), ...denied("codaryn-call-1")]);
      const second = cli(out, [started(), ...failed("codaryn-call-1")]);
      assert.ok(second.includes(failedLine), second.join("\n"));
      assert.deepEqual(second, cli(fresh(), [started(), ...failed("codaryn-call-1")]));
    });

    test("within one run a denied call stays denied (U-18), and a new run of the same renderer starts again", () => {
      const out = fresh();
      const one = cli(out, [started(), ...denied("call_0"), { type: "tool_result", result: { callId: "call_0", tool: "read_file", ok: false, content: "error (not_found): x", errorCode: "not_found" } } as unknown as JournalEvent]);
      assert.equal(one.includes(failedLine), false, one.join("\n"));
      const two = cli(out, [started(), ...failed("call_0")]);
      assert.ok(two.includes(failedLine), two.join("\n"));
    });

    test("verifier numbers start again at each run (I-1)", () => {
      const out = fresh();
      cli(out, [started(), verifier("a"), verifier("b")]);
      const second = cli(out, [started(), verifier("c")]);
      assert.deepEqual(second, cli(fresh(), [started(), verifier("c")]));
      assert.ok(second.some((line) => line.startsWith(catalog.format("progress.verifier", { number: 1, outcome: catalog.format("outcome.pass") }))), second.join("\n"));
    });

    test("as the GUI host draws: a run, then an apply, then a run, each as from a new renderer", () => {
      const out = fresh();
      gui(out, [started(), ...denied("codaryn-call-1"), verifier("a")]);
      const apply = gui(out, [applyStarted(), verifier("b")]);
      assert.deepEqual(apply, gui(fresh(), [applyStarted(), verifier("b")]));
      const run = gui(out, [started(), ...failed("codaryn-call-1"), verifier("c")]);
      assert.deepEqual(run, gui(fresh(), [started(), ...failed("codaryn-call-1"), verifier("c")]));
      assert.ok(run.includes(failedLine), run.join("\n"));
    });

    test("as the CLI's apply draws (applyProgressLine only): verifier numbers start again at apply_started", () => {
      const out = fresh();
      cli(out, [started(), verifier("a"), verifier("b")]);
      const drawn = [applyStarted(), verifier("c")].flatMap((event) => out.applyProgressLine?.(event as unknown as ApplyJournalEvent) ?? []);
      const alone = [applyStarted(), verifier("c")].flatMap((event) => fresh().applyProgressLine?.(event as unknown as ApplyJournalEvent) ?? []);
      assert.equal(drawn.at(-1), alone.at(-1));
    });

    test("a start record that is not well formed still starts again (it is the start of another run)", () => {
      const out = fresh();
      cli(out, [started(), ...denied("codaryn-call-1"), verifier("a")]);
      const odd = { type: "run_started", provider: "made-up" } as unknown as JournalEvent;
      assert.equal(out.progressLine(odd), null);
      const next = cli(out, [...failed("codaryn-call-1"), verifier("b")]);
      assert.deepEqual(next, cli(fresh(), [...failed("codaryn-call-1"), verifier("b")]));
    });
  });
}
