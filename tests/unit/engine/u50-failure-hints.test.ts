/**
 * U-50 (AXM-6, the rest of AXM-5; review R-53 I-2): a tool that ran and failed told the model its
 * code only, so the model did not know what to do next. On main 9934a9a, with a scripted run:
 * `error (protected_span_violation): change rejected: protected_span_violation`,
 * `error (not_found): cannot read file: not_found`, `error (not_text): cannot read file: not_text`.
 * The refusals before a call runs already carry a hint (REFUSAL_HINTS, U-15); these did not.
 *
 * Now the engine adds one fixed sentence per code (TOOL_FAILURE_HINTS) to such a result. Codes whose
 * messages already say what to do (conflict, no_match, ambiguous_match, the tool's own invalid_args,
 * invalid_plan with its action and problem, spawn_failed with its reason: review R-68 M-1) and those
 * with nothing to add (cancelled, io_error, unknown_tool, unresolved_token) get none. No value is repeated: the sentence is fixed text, and
 * the tool's message stays as it was.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { REFUSAL_HINTS, TOOL_ERROR_CODES, TOOL_FAILURE_HINTS, asRawText, toolFailureMessage } from "../../../src/contracts/index.js";
import type { EffectiveWorkflowToolCall, RawWorkflowToolOutcome, ToolCall, ToolErrorCode } from "../../../src/contracts/index.js";
import { FIXED_MODEL_TEXTS, runTask } from "../../../src/engine/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { FakeTools, finalAnswer, harness, response } from "./fakes.js";

const HINTED: readonly ToolErrorCode[] = [
  "policy_denied",
  "not_found",
  "not_text",
  "too_large",
  "protected_span_violation",
  "invalid_token",
  "masking_failed",
];

/** Runs one read call whose tool fails with `code` and `message`; returns what was recorded. */
async function failedRead(code: ToolErrorCode, message: string): Promise<string | undefined> {
  const tools = new FakeTools(() => ({ ok: false, code, message: asRawText(message) }));
  const h = harness({ steps: [() => response([{ id: "r1", name: "read_file", args: { path: "a.txt" } }]), () => finalAnswer()], tools });
  await runTask(h.deps);
  return h.journal.ofType("tool_result")[0]?.result.content;
}

class FailingWorkflowTools extends FakeTools {
  constructor(private readonly outcome: RawWorkflowToolOutcome) {
    super();
  }
  async executeWorkflowTool(_call: EffectiveWorkflowToolCall): Promise<RawWorkflowToolOutcome> {
    return this.outcome;
  }
}

describe("U-50: a tool that ran and failed says what to do next", () => {
  test("reproduction (main 9934a9a): the three code-only texts of the scripted run now end with a hint", async () => {
    assert.equal(
      await failedRead("protected_span_violation", "change rejected: protected_span_violation"),
      "error (protected_span_violation): change rejected: protected_span_violation. A line that holds a protected placeholder must stay exactly as it is; change other lines only.",
    );
    assert.equal(await failedRead("not_found", "cannot read file: not_found"), `error (not_found): cannot read file: not_found. ${TOOL_FAILURE_HINTS.not_found}`);
    assert.equal(await failedRead("not_text", "cannot read file: not_text"), `error (not_text): cannot read file: not_text. ${TOOL_FAILURE_HINTS.not_text}`);
  });

  test("the hinted codes, and the ones whose message already says what to do or has nothing to add", () => {
    assert.deepEqual(Object.keys(TOOL_FAILURE_HINTS).sort(), [...HINTED].sort());
    for (const code of TOOL_ERROR_CODES) {
      const hint = TOOL_FAILURE_HINTS[code];
      if (HINTED.includes(code)) assert.ok(typeof hint === "string" && hint.endsWith("."), code);
      else assert.equal(toolFailureMessage(code, "m"), "m", code);
    }
    assert.equal(TOOL_FAILURE_HINTS.invalid_token, REFUSAL_HINTS.invalid_token, "the same words as the refusal before a call runs");
  });

  test("a message that already ends with its hint is left as it is; an empty one gets the hint alone", () => {
    const hint = TOOL_FAILURE_HINTS.not_found as string;
    assert.equal(toolFailureMessage("not_found", `cannot read file. ${hint}`), `cannot read file. ${hint}`);
    assert.equal(toolFailureMessage("not_found", ""), hint);
    assert.equal(toolFailureMessage("not_found", "x."), `x. ${hint}`);
  });

  test("codes without a hint keep the tool's words exactly", async () => {
    assert.equal(await failedRead("conflict", "file state differs from expectedHash; read the file again"), "error (conflict): file state differs from expectedHash; read the file again");
    assert.equal(await failedRead("no_match", "oldText was not found in the file"), "error (no_match): oldText was not found in the file");
    assert.equal(await failedRead("io_error", "writing the file failed"), "error (io_error): writing the file failed");
    // The organize test (tests/integration/n06-organize.test.ts) reads the problem at the end.
    assert.equal(await failedRead("invalid_plan", "plan rejected: action 0: destination_exists"), "error (invalid_plan): plan rejected: action 0: destination_exists");
  });

  test("a task type tool's failure gets its hint too (inspect_files)", async () => {
    const tools = new FailingWorkflowTools({ ok: false, code: "policy_denied", message: asRawText("path rejected by workspace: outside_root") });
    const inspect: ToolCall = { id: "i1", name: "inspect_files", args: { path: "photos" } };
    const h = harness({
      steps: [() => response([inspect]), () => finalAnswer()],
      tools,
      task: {
        tools: ["read_file", "search_files", "write_file", "run_command", "inspect_files", "propose_plan"],
        plan: "apply",
        policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: true, planActions: ["move", "discard"] },
      },
    });
    await runTask(h.deps);
    assert.equal(h.journal.ofType("tool_result")[0]?.result.content, `error (policy_denied): path rejected by workspace: outside_root. ${TOOL_FAILURE_HINTS.policy_denied}`);
  });

  test("the hints are fixed model texts and masking leaves them as they are", () => {
    const gateway = createPrivacyGateway({ secrets: [] });
    for (const hint of Object.values(TOOL_FAILURE_HINTS)) {
      assert.ok(FIXED_MODEL_TEXTS.includes(hint as string), hint);
      const masked = gateway.mask(hint as string);
      assert.ok(masked.ok && masked.text === hint, hint);
    }
  });
});
