/**
 * U-18 (AXM-4, docs/design/ax-midpoint-review.md: "허용" is read as "done"), the human renderer's
 * part, reproduced on main 0ad28bc. A tool call the policy allowed and that then failed
 * (`tool_result` with `ok: false`: not_found, conflict, no_match, spawn_failed, ...) gets no
 * progress line, and the end summary counts only the denied calls. So "read file — allowed" reads
 * as done.
 * What it should say (proposed text ids, not in the contract yet; the cases are todo until then):
 * - progress: after a call's allowed decision, a failed result of that call is one line,
 *   `progress.tool_failed` with the tool and the error code. A denied or rejected call is told once,
 *   by its decision; its failed result adds nothing. A result that succeeded adds nothing.
 * - summary: RunSummaryContext.failedToolCalls above 0 is one line, `summary.failed` with the count,
 *   right after the denied calls.
 * The texts are the catalog owner's; a stand-in shows which ids and values the renderer asks for.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toRunId, TOOL_ERROR_CODES } from "../../../../src/contracts/index.js";
import type { CatalogText, EngineResult, JournalEvent, MessageCatalog, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const TODO = { todo: "U-18: waits for the contract's progress.tool_failed, summary.failed and RunSummaryContext.failedToolCalls" };
const PROPOSED = ["progress.tool_failed", "summary.failed"];

const real = createMessageCatalog("en");
const standIn: MessageCatalog = {
  language: "en",
  format: ((id: string, ...params: unknown[]) =>
    PROPOSED.includes(id)
      ? (`<${id} ${JSON.stringify(params[0] ?? {})}>` as CatalogText)
      : (real.format as (id: string, ...rest: unknown[]) => CatalogText)(id, ...params)) as MessageCatalog["format"],
};
const failedLine = (tool: string, code: string): string => `<progress.tool_failed ${JSON.stringify({ tool: (real.format as (id: string) => CatalogText)(`tool.${tool}`), code })}>`;

const decision = (callId: string, tool: string, allowed: boolean, extra: Record<string, unknown> = {}): JournalEvent =>
  ({ type: "tool_decision", callId, tool, stage: "policy_effective", allowed, permission: null, code: null, ...extra }) as unknown as JournalEvent;
const result = (callId: string, tool: string, errorCode: string | null): JournalEvent =>
  ({ type: "tool_result", result: { callId, tool, ok: errorCode === null, content: errorCode === null ? "{}" : `error (${errorCode}): x`, errorCode } }) as unknown as JournalEvent;
/** The lines a run's records give, in order, from one renderer. */
const progress = (events: readonly JournalEvent[]): string[] => {
  const out = createHumanOutput(standIn);
  return events.map((event) => out.progressLine(event)).filter((line): line is string => line !== null);
};

describe("U-18 (AXM-4) on main: a call that was allowed and then failed", () => {
  test("reproduction: today the failed result has no line, so only 'allowed' is told", () => {
    const lines = progress([decision("c1", "read_file", true), result("c1", "read_file", "not_found")]);
    assert.deepEqual(lines, [`${real.format("progress.tool_allowed", { tool: real.format("tool.read_file") })} (read_file)`]);
  });

  test("an allowed call that failed: one line with the tool and the code, after the allowed line", TODO, () => {
    for (const [tool, code] of [["read_file", "not_found"], ["write_file", "conflict"], ["write_file", "no_match"], ["write_file", "protected_span_violation"], ["run_command", "spawn_failed"], ["search_files", "io_error"]]) {
      const lines = progress([decision("c1", tool ?? "", true), result("c1", tool ?? "", code ?? "")]);
      assert.equal(lines.length, 2, lines.join("\n"));
      assert.equal(lines[1], failedLine(tool ?? "", code ?? ""));
    }
  });

  test("every error code an executed call can end with is told", TODO, () => {
    for (const code of TOOL_ERROR_CODES) {
      const lines = progress([decision("c1", "read_file", true), result("c1", "read_file", code)]);
      assert.equal(lines[1], failedLine("read_file", code), code);
    }
  });

  test("a denied or rejected call is told once, by its decision: its failed result adds no line", () => {
    const denied = progress([decision("c1", "run_command", false, { stage: "policy_requested", permission: "command", code: "command_not_allowed" }), result("c1", "run_command", "policy_denied")]);
    assert.equal(denied.length, 1, denied.join("\n"));
    const rejected = progress([decision("c2", "write_file", false, { stage: "validate", code: "invalid_args" }), result("c2", "write_file", "invalid_args")]);
    assert.equal(rejected.length, 1, rejected.join("\n"));
    const restore = progress([decision("c3", "write_file", false, { stage: "restore", permission: "restore", code: "unresolved_token" }), result("c3", "write_file", "unresolved_token")]);
    assert.equal(restore.length, 1, restore.join("\n"));
  });

  test("a result that succeeded adds no line; a failed result of another call than the allowed one adds none", () => {
    assert.equal(progress([decision("c1", "read_file", true), result("c1", "read_file", null)]).length, 1);
    assert.equal(progress([decision("c1", "read_file", true), result("c9", "read_file", "not_found")]).length, 1);
  });

  test("in a run: each failed call once, the denied one as before (the shape of the AXM-4 run)", TODO, () => {
    const lines = progress([
      decision("c1", "write_file", true), result("c1", "write_file", "protected_span_violation"),
      decision("c2", "write_file", true), result("c2", "write_file", "conflict"),
      decision("c3", "write_file", true), result("c3", "write_file", "no_match"),
      decision("c4", "write_file", false, { stage: "restore", permission: "restore", code: "restore_denied" }), result("c4", "write_file", "policy_denied"),
      decision("c5", "write_file", true), result("c5", "write_file", null),
    ]);
    assert.deepEqual(lines.filter((line) => line.startsWith("<progress.tool_failed")), [
      failedLine("write_file", "protected_span_violation"), failedLine("write_file", "conflict"), failedLine("write_file", "no_match"),
    ]);
    assert.equal(lines.length, 8, lines.join("\n"));
  });
});

describe("U-18 (AXM-4) on main: the end summary counts the failed calls", () => {
  const RUN = toRunId("20261113T030405Z-0a1b2c3d") as RunId;
  const context = (extra: Record<string, unknown>): RunSummaryContext =>
    ({ configLanguage: null, configDefault: null, deniedToolCalls: 1, deniedCommandCalls: 0, workspaceForm: "given", policySource: "config", profileApplied: false, ...extra }) as unknown as RunSummaryContext;
  const engine = {
    schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "needs-input", reason: "no_verifier", exitCode: 3, provider: "scripted", verifiers: [], changes: [],
    usage: { modelTurns: 8, toolCalls: 6, inputTokens: null, outputTokens: null, durationMs: 100 }, journalPath: "x", notices: [],
  } as unknown as EngineResult;
  const summary = (extra: Record<string, unknown>): string[] => createHumanOutput(standIn).runSummary(engine, context(extra)).trimEnd().split("\n");

  test("failedToolCalls above 0: one line with the count, right after the denied calls", TODO, () => {
    const lines = summary({ failedToolCalls: 4 });
    const at = lines.indexOf(`<summary.failed ${JSON.stringify({ count: 4 })}>`);
    assert.ok(at > 0, lines.join("\n"));
    assert.equal(lines[at - 1], real.format("summary.denied", { count: 1 }));
    assert.deepEqual([...lines.slice(0, at), ...lines.slice(at + 1)], summary({}), "the other lines are the same");
  });

  test("none failed, or a value that is not a count: no line", () => {
    for (const failedToolCalls of [0, undefined, -1, 1.5, "4", null]) {
      assert.equal(summary({ failedToolCalls }).some((line) => line.startsWith("<summary.failed")), false, String(failedToolCalls));
    }
  });
});
