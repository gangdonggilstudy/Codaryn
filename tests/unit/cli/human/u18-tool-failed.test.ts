/**
 * U-18 (AXM-4, docs/design/ax-midpoint-review.md: "허용" is read as "done"), the human renderer's
 * part. Reproduced on main 0ad28bc (1d6a568): a tool call the policy allowed and that then failed
 * (`tool_result` with `ok: false`: not_found, conflict, no_match, spawn_failed, ...) got no progress
 * line, and the end summary counted only the denied calls, so "read file — allowed" read as done.
 * Contract 8024a8a (PM Q-1 (a), Q-2 (a)):
 * - progress: a failed call is one line, `progress.tool_failed` with the tool and the error code.
 *   The failed-call rule (RunSummaryContext.failedToolCalls): a `tool_result` with `ok: false` whose
 *   call has no `tool_decision` with `allowed: false` in the run. A denied or rejected call is told
 *   once, by its decision. A result that succeeded adds nothing.
 * - progress: a `run_command` result with `ok: true` that timed out (`progress.command_timed_out`),
 *   or else exited with an integer other than 0 (`progress.command_exited`, the code). Content that
 *   does not parse, or a null exit code without a timeout, gives no line. Not failed calls.
 * - summary: failedToolCalls above 0 is one line, `summary.failed` with the count, right after the
 *   denied calls; the hint lines come after both.
 * The texts are the catalog owner's; a stand-in shows which ids and values the renderer asks for.
 * Where the catalog has the texts, the real lines are checked in both languages. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES, toRunId, TOOL_ERROR_CODES } from "../../../../src/contracts/index.js";
import type { CatalogText, EngineResult, JournalEvent, MessageCatalog, RunId, RunSummaryContext } from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";
import { MESSAGE_TEXTS } from "../../../../src/i18n/catalog.js";

const U18 = ["progress.tool_failed", "progress.command_exited", "progress.command_timed_out", "summary.failed"];

const real = createMessageCatalog("en");
const asReal = (catalog: MessageCatalog) => catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
const standIn: MessageCatalog = {
  language: "en",
  format: ((id: string, ...params: unknown[]) =>
    U18.includes(id) ? (`<${id}${params[0] === undefined ? "" : ` ${JSON.stringify(params[0])}`}>` as CatalogText) : asReal(real)(id, ...params)) as MessageCatalog["format"],
};
const failedLine = (tool: string, code: string): string => `<progress.tool_failed ${JSON.stringify({ tool: asReal(real)(`tool.${tool}`), code })}>`;

const decision = (callId: string, tool: string, allowed: boolean, extra: Record<string, unknown> = {}): JournalEvent =>
  ({ type: "tool_decision", callId, tool, stage: "policy_effective", allowed, permission: null, code: null, ...extra }) as unknown as JournalEvent;
const result = (callId: string, tool: string, errorCode: string | null, content?: string): JournalEvent =>
  ({ type: "tool_result", result: { callId, tool, ok: errorCode === null, content: content ?? (errorCode === null ? "{}" : `error (${errorCode}): x`), errorCode } }) as unknown as JournalEvent;
const command = (callId: string, payload: unknown): JournalEvent => result(callId, "run_command", null, typeof payload === "string" ? payload : JSON.stringify(payload));
/** The lines a run's records give, in order, from one renderer. */
const progress = (events: readonly JournalEvent[], catalog: MessageCatalog = standIn): string[] => {
  const out = createHumanOutput(catalog);
  return events.map((event) => out.progressLine(event)).filter((line): line is string => line !== null);
};
const allowedLine = (tool: string): string => `${real.format("progress.tool_allowed", { tool: asReal(real)(`tool.${tool}`) })} (${tool})`;

describe("U-18 (AXM-4): a call that was allowed and then failed", () => {
  test("the reproduction's call: the allowed line, then the failure with its code", () => {
    const lines = progress([decision("c1", "read_file", true), result("c1", "read_file", "not_found")]);
    assert.deepEqual(lines, [allowedLine("read_file"), failedLine("read_file", "not_found")]);
  });

  test("an allowed call that failed: one line with the tool and the code, after the allowed line", () => {
    for (const [tool, code] of [["read_file", "not_found"], ["write_file", "conflict"], ["write_file", "no_match"], ["write_file", "protected_span_violation"], ["run_command", "spawn_failed"], ["search_files", "io_error"]]) {
      const lines = progress([decision("c1", tool ?? "", true), result("c1", tool ?? "", code ?? "")]);
      assert.equal(lines.length, 2, lines.join("\n"));
      assert.equal(lines[1], failedLine(tool ?? "", code ?? ""));
    }
  });

  test("every error code an executed call can end with is told", () => {
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
    // A denied call stays denied later in the run: its id is not told as failed after other calls.
    const later = progress([decision("c4", "write_file", false, { stage: "validate", code: "invalid_args" }), decision("c5", "read_file", true), result("c5", "read_file", null), result("c4", "write_file", "invalid_args")]);
    assert.equal(later.some((line) => line.startsWith("<progress.tool_failed")), false, later.join("\n"));
  });

  test("a result that succeeded adds no line; a failed result is a failed call by the contract's rule, its allowed line seen or not", () => {
    assert.deepEqual(progress([decision("c1", "read_file", true), result("c1", "read_file", null)]), [allowedLine("read_file")]);
    assert.deepEqual(progress([decision("c1", "read_file", true), result("c9", "read_file", "not_found")]), [allowedLine("read_file"), failedLine("read_file", "not_found")]);
  });

  test("a failed result with a code that is not a tool error code, or a record that is not well formed: no line, no exception", () => {
    assert.deepEqual(progress([result("c1", "read_file", "made_up")]), []);
    for (const odd of [{ type: "tool_result" }, { type: "tool_result", result: null }, { type: "tool_result", result: { callId: 7, tool: "read_file", ok: "no", errorCode: "not_found" } }]) {
      assert.deepEqual(progress([odd as unknown as JournalEvent]), [], JSON.stringify(odd));
    }
  });

  test("in a run: each failed call once, the denied one as before (the shape of the AXM-4 run)", () => {
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

describe("U-18 (AXM-4, PM Q-2 (a)): a command that ran and did not end well", () => {
  const payload = (exitCode: unknown, timedOut: unknown) => ({ exitCode, stdout: "", stderr: "", timedOut, truncated: false });

  test("an exit code other than 0: one line with the code; timed out: one line", () => {
    assert.deepEqual(progress([decision("c1", "run_command", true), command("c1", payload(3, false))]), [allowedLine("run_command"), `<progress.command_exited ${JSON.stringify({ exitCode: 3 })}>`]);
    assert.deepEqual(progress([command("c1", payload(null, true))]), ["<progress.command_timed_out>"]);
    assert.deepEqual(progress([command("c1", payload(1, true))]), ["<progress.command_timed_out>"], "a timeout is told as such");
    assert.deepEqual(progress([command("c1", payload(3221225477, false))]), [`<progress.command_exited ${JSON.stringify({ exitCode: 3221225477 })}>`]);
    // Only timedOut: true is a timeout; otherwise the exit code says it.
    assert.deepEqual(progress([command("c1", payload(3, "yes"))]), [`<progress.command_exited ${JSON.stringify({ exitCode: 3 })}>`]);
  });

  test("exit 0, a stopped command (null without a timeout), content that does not parse, an exit code that is not a count: no line", () => {
    for (const content of [payload(0, false), payload(null, false), "not json", "[]", "null", payload(1.5, false), payload("3", false), payload(-1, false), { timedOut: false }]) {
      assert.deepEqual(progress([command("c1", content)]), [], JSON.stringify(content));
    }
  });

  test("only run_command: another tool's ok content with an exit code gives no line", () => {
    assert.deepEqual(progress([result("c1", "read_file", null, JSON.stringify(payload(3, true)))]), []);
  });

  test("a command that failed to start is a failed call, not an exit line", () => {
    assert.deepEqual(progress([decision("c1", "run_command", true), result("c1", "run_command", "spawn_failed")]), [allowedLine("run_command"), failedLine("run_command", "spawn_failed")]);
  });
});

describe("U-18 (AXM-4): the end summary counts the failed calls", () => {
  const RUN = toRunId("20261113T030405Z-0a1b2c3d") as RunId;
  const context = (extra: Record<string, unknown>): RunSummaryContext =>
    ({ configLanguage: null, configDefault: null, deniedToolCalls: 1, deniedCommandCalls: 0, failedToolCalls: 0, workspaceForm: "given", policySource: "config", profileApplied: false, ...extra }) as unknown as RunSummaryContext;
  const engine = {
    schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "needs-input", reason: "no_verifier", exitCode: 3, provider: "scripted", verifiers: [], changes: [],
    usage: { modelTurns: 8, toolCalls: 6, inputTokens: null, outputTokens: null, durationMs: 100 }, journalPath: "x", notices: [],
  } as unknown as EngineResult;
  const summary = (extra: Record<string, unknown>, catalog: MessageCatalog = standIn): string[] => createHumanOutput(catalog).runSummary(engine, context(extra)).trimEnd().split("\n");

  test("failedToolCalls above 0: one line with the count, right after the denied calls", () => {
    const lines = summary({ failedToolCalls: 4 });
    const at = lines.indexOf(`<summary.failed ${JSON.stringify({ count: 4 })}>`);
    assert.ok(at > 0, lines.join("\n"));
    assert.equal(lines[at - 1], real.format("summary.denied", { count: 1 }));
    assert.deepEqual([...lines.slice(0, at), ...lines.slice(at + 1)], summary({}), "the other lines are the same");
  });

  test("with a denied command: denied, failed, then the hint", () => {
    const lines = summary({ failedToolCalls: 2, deniedCommandCalls: 1, policySource: "task" });
    const at = lines.indexOf(real.format("summary.denied", { count: 1 }));
    assert.deepEqual(lines.slice(at, at + 3), [real.format("summary.denied", { count: 1 }), `<summary.failed ${JSON.stringify({ count: 2 })}>`, real.format("summary.denied_hint_task")]);
  });

  test("failed calls without denied ones: the line still comes, where the denied line would be", () => {
    const lines = summary({ failedToolCalls: 1, deniedToolCalls: 0 });
    const at = lines.indexOf(`<summary.failed ${JSON.stringify({ count: 1 })}>`);
    assert.ok(at > 0, lines.join("\n"));
    assert.ok(lines[at + 1]?.startsWith(real.format("summary.usage", { turns: 8, toolCalls: 6, seconds: 0.1 }).split(":")[0] ?? "?"), lines.join("\n"));
  });

  test("a context without failedToolCalls (optional; absent is 0): no line, the summary as with 0", () => {
    const without: Record<string, unknown> = { ...context({}) };
    delete without["failedToolCalls"];
    assert.equal(Object.hasOwn(without, "failedToolCalls"), false);
    assert.deepEqual(createHumanOutput(standIn).runSummary(engine, without as unknown as RunSummaryContext).trimEnd().split("\n"), summary({ failedToolCalls: 0 }));
  });

  test("none failed, or a value that is not a count: no line", () => {
    for (const failedToolCalls of [0, undefined, -1, 1.5, "4", null]) {
      assert.equal(summary({ failedToolCalls }).some((line) => line.startsWith("<summary.failed")), false, String(failedToolCalls));
    }
  });
});

describe("U-18 with the real catalog", () => {
  const ready = MESSAGE_LANGUAGES.every((language) => U18.every((id) => Object.hasOwn(MESSAGE_TEXTS[language], id)));
  const skip = ready ? false : "the U-18 texts are not in the catalog yet (nb-i18n)";
  for (const language of MESSAGE_LANGUAGES) {
    test(`${language}: the failure, the exit code, the timeout and the count are the catalog's lines`, { skip }, () => {
      const catalog = createMessageCatalog(language);
      const tool = asReal(catalog)("tool.write_file");
      const lines = progress([decision("c1", "write_file", true), result("c1", "write_file", "conflict"), command("c2", { exitCode: 3, stdout: "", stderr: "", timedOut: false, truncated: false }), command("c3", { exitCode: null, stdout: "", stderr: "", timedOut: true, truncated: false })], catalog);
      assert.deepEqual(lines.slice(1), [asReal(catalog)("progress.tool_failed", { tool, code: "conflict" }), asReal(catalog)("progress.command_exited", { exitCode: 3 }), asReal(catalog)("progress.command_timed_out")]);
      assert.ok(createHumanOutput(catalog).runSummary(engine(), { workspaceForm: "given", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 4, policySource: "config" }).includes(asReal(catalog)("summary.failed", { count: 4 })));
    });
  }

  test("the two languages say it in their own words", { skip }, () => {
    const [enLines, koLines] = MESSAGE_LANGUAGES.map((language) => progress([result("c1", "read_file", "not_found"), command("c2", { exitCode: 3, stdout: "", stderr: "", timedOut: false, truncated: false })], createMessageCatalog(language)).join("\n"));
    assert.notEqual(enLines, koLines);
  });
});

function engine(): EngineResult {
  return {
    schemaVersion: 1, kind: "run", runId: "20261113T030405Z-0a1b2c3d", taskId: "t", status: "needs-input", reason: "no_verifier", exitCode: 3, provider: "scripted", verifiers: [], changes: [],
    usage: { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 100 }, journalPath: "x", notices: [],
  } as unknown as EngineResult;
}
