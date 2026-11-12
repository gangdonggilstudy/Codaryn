/**
 * createHumanOutput (N-5, N-7, N-14 to N-17). The catalog here is a strict stand-in for N-B's: it
 * throws unless every parameter is exactly the declared one with a value of the declared kind,
 * and it renders `[id k=v ...]`, so the tests read the layout the renderer chose. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_CONFIG_DISPLAY,
  INTEGRITY_PHASES,
  MESSAGE_IDS,
  MODEL_ERROR_KINDS,
  PERMISSION_KINDS,
  POLICY_DENIAL_CODES,
  RUN_REASONS,
  TERMINAL_RUN_STATUSES,
  TOOL_ERROR_CODES,
  messageParams,
  toRunId,
  toSchemaFieldPath,
} from "../../../../src/contracts/index.js";
import type {
  CatalogText,
  CliErrorOutput,
  EngineResult,
  JournalEvent,
  MaskedText,
  MessageCatalog,
  MessageId,
  RevertOutput,
  RunId,
  RunSummaryContext,
  RunsOutput,
  SchemaFieldPath,
} from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { displayWidth, formatLocalTime } from "../../../../src/cli/human/format.js";

const SECRET = "fake-secret-N14-VALUE-0001";
const KEY_SHAPED = ["sk", "ant", "FAKEfake0000FAKEfake0000"].join("-");
const masked = (text: string): MaskedText => text as MaskedText;
const runId = (text: string): RunId => toRunId(text) as RunId;
const field = (text: string): SchemaFieldPath => toSchemaFieldPath(text) as SchemaFieldPath;
const RUN = runId("20261112T030405Z-0a1b2c3d");

const KIND_CHECKS: Record<string, (value: unknown, produced: Set<string>) => boolean> = {
  count: (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  status: (value) => (TERMINAL_RUN_STATUSES as readonly unknown[]).includes(value),
  reason: (value) => (RUN_REASONS as readonly unknown[]).includes(value),
  permission: (value) => (PERMISSION_KINDS as readonly unknown[]).includes(value),
  denial: (value) => (POLICY_DENIAL_CODES as readonly unknown[]).includes(value) || (TOOL_ERROR_CODES as readonly unknown[]).includes(value),
  modelError: (value) => (MODEL_ERROR_KINDS as readonly unknown[]).includes(value),
  phase: (value) => (INTEGRITY_PHASES as readonly unknown[]).includes(value),
  provider: (value) => value === "scripted" || value === "anthropic",
  field: (value) => typeof value === "string" && toSchemaFieldPath(value) !== null,
  runId: (value) => typeof value === "string" && toRunId(value) !== null,
  text: (value, produced) => typeof value === "string" && produced.has(value),
  location: (value) => [...Object.values(DEFAULT_CONFIG_DISPLAY), "--config", "CODARYN_CONFIG"].includes(value as string),
  seconds: (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-6,
  language: (value) => value === "ko" || value === "en",
};

/** A catalog that checks every call against the contract and renders `[id k=v]`. `words` overrides some ids. */
function strictCatalog(words: Partial<Record<MessageId, string>> = {}): MessageCatalog & { calls: MessageId[] } {
  const produced = new Set<string>();
  const known = new Set<string>(MESSAGE_IDS);
  const calls: MessageId[] = [];
  return {
    language: "en",
    calls,
    format(id: MessageId, params?: Record<string, unknown>): CatalogText {
      if (!known.has(id)) throw new Error(`unknown message id ${id}`);
      const declared = messageParams(id);
      const given = params ?? {};
      assert.deepEqual(Object.keys(given).sort(), Object.keys(declared).sort(), `parameters of ${id}`);
      for (const [name, kind] of Object.entries(declared)) {
        assert.ok(KIND_CHECKS[kind]?.(given[name], produced), `${id}.${name} must be a ${kind}: ${String(given[name])}`);
      }
      calls.push(id);
      const word = words[id];
      const text = word ?? `[${id}${Object.entries(given).map(([k, v]) => ` ${k}=${String(v)}`).join("")}]`;
      produced.add(text);
      return text as CatalogText;
    },
  } as MessageCatalog & { calls: MessageId[] };
}

function error(code: CliErrorOutput["code"], extra: Partial<CliErrorOutput> = {}): CliErrorOutput {
  return { schemaVersion: 1, kind: "error", code, exitCode: 2, message: `english detail ${SECRET}`, ...extra };
}

function result(extra: Partial<EngineResult> = {}): EngineResult {
  return {
    schemaVersion: 1,
    kind: "run",
    runId: RUN,
    taskId: "doc-task",
    status: "done",
    reason: "verified",
    exitCode: 0,
    provider: "scripted",
    verifiers: [
      { id: `id-${SECRET}`, kind: "file_rules", outcome: "pass", evidence: masked(""), checked: [], limits: [] },
      { id: "second", kind: "command", outcome: "pass", evidence: masked(""), checked: [], limits: [] },
    ],
    changes: [
      { path: masked("README.md"), previousHash: "a".repeat(64), newHash: "b".repeat(64), created: false },
      { path: masked("docs/new.md"), previousHash: null, newHash: "c".repeat(64), created: true },
    ],
    usage: { modelTurns: 4, toolCalls: 2, inputTokens: null, outputTokens: null, durationMs: 78 },
    journalPath: ".codaryn/runs/x/journal.jsonl",
    notices: [masked(`notice ${SECRET}`)],
    ...extra,
  };
}

const CONTEXT: RunSummaryContext = { workspaceForm: "given", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, policySource: "config" };

describe("HumanOutput.error (N-5, N-15)", () => {
  test("what, the diagnostic, how to fix and the code; the English message is not shown", () => {
    const text = createHumanOutput(strictCatalog()).error(
      error("invalid_config", { diagnostic: { code: "json_syntax", file: "config", field: null, line: 3, column: 14 } }),
    );
    assert.equal(
      text,
      [
        "codaryn: [error.label] — [error.invalid_config.what] (invalid_config)",
        "  [diagnostic.file.config] — [diagnostic.json_syntax line=3 column=14]",
        "  [error.fix_label]: [error.invalid_config.fix]",
        "  [error.doctor_hint]",
        "",
      ].join("\n"),
    );
    assert.equal(text.includes(SECRET), false);
  });

  test("an unknown field is named by the object that holds it, with a suggestion when there is one", () => {
    const human = createHumanOutput(strictCatalog());
    const suggest = human.error(
      error("invalid_task", { diagnostic: { code: "unknown_field", file: "task", field: field("limits"), line: null, column: null, suggestion: field("maxModelTurns") } }),
    );
    assert.ok(suggest.includes("  [diagnostic.file.task] — [diagnostic.unknown_field_suggest field=limits suggestion=maxModelTurns]\n"));
    const plain = human.error(error("invalid_task", { diagnostic: { code: "missing_field", file: "task", field: field("policy.commands[2].executable"), line: null, column: null } }));
    assert.ok(plain.includes("[diagnostic.missing_field field=policy.commands[2].executable]"));
  });

  test("a diagnostic position that is not a schema path falls back to the file; bad numbers drop the line", () => {
    const human = createHumanOutput(strictCatalog());
    const bent = human.error(
      error("invalid_config", {
        diagnostic: { code: "invalid_value", file: "config", field: `profiles.${SECRET}` as SchemaFieldPath, line: null, column: null },
      }),
    );
    assert.ok(bent.includes("[diagnostic.invalid_value field=config]"));
    assert.equal(bent.includes(SECRET), false);
    const noLine = human.error(error("invalid_config", { diagnostic: { code: "json_syntax", file: "config", field: null, line: 0, column: null } }));
    assert.equal(noLine.includes("diagnostic"), false);
  });

  test("N-23(f): a position that falls back to the file root drops the suggestion made for the original position", () => {
    const text = createHumanOutput(strictCatalog()).error(
      error("invalid_config", {
        diagnostic: { code: "unknown_field", file: "config", field: "profiles.hunter2" as SchemaFieldPath, line: null, column: null, suggestion: field("limits") },
      }),
    );
    assert.ok(text.includes("  [diagnostic.file.config] — [diagnostic.unknown_field field=config]\n"), text);
    assert.equal(text.includes("suggestion"), false);
    assert.equal(text.includes("hunter2"), false);
  });

  test("doctor is suggested only where it can check the cause; an unknown code shows only the label", () => {
    const human = createHumanOutput(strictCatalog());
    assert.equal(human.error(error("run_not_found")).includes("error.doctor_hint"), false);
    assert.ok(human.error(error("provider_not_configured")).includes("error.doctor_hint"));
    assert.equal(human.error(error("not_a_code" as never)), "codaryn: [error.label] (not_a_code)\n");
  });
});

describe("HumanOutput.runSummary (N-5, N-17)", () => {
  test("status, checks, changes, usage, run id and next commands", () => {
    const text = createHumanOutput(strictCatalog()).runSummary(result(), CONTEXT);
    assert.equal(
      text,
      [
        "── [summary.result status=[status.done] reason=[reason.verified]] (done/verified) ──",
        "[summary.verifiers passed=2 total=2]",
        "[summary.changes count=2]",
        "  README.md ([progress.file_changed])",
        "  docs/new.md ([progress.file_created])",
        "[summary.usage turns=4 toolCalls=2 seconds=0.1]",
        "[advice.verified]",
        `[summary.run_id runId=${RUN}]`,
        `[summary.next_report runId=${RUN}]`,
        `[summary.next_revert runId=${RUN}]`,
        "",
      ].join("\n"),
    );
    assert.equal(text.includes(SECRET), false, "verifier ids and notices are not shown");
  });

  test("denied calls are counted with the hint once; default config, profile and the current directory change the lines", () => {
    const text = createHumanOutput(strictCatalog()).runSummary(result({ changes: [], verifiers: [] }), {
      workspaceForm: "current",
      configDefault: "%APPDATA%\\Codaryn\\config.json",
      profileApplied: true,
      deniedToolCalls: 3,
      deniedCommandCalls: 1,
      policySource: "config",
    });
    assert.ok(text.includes("[summary.no_verifiers]\n[summary.changes count=0]\n[summary.denied count=3]\n[summary.denied_hint]\n[summary.usage "));
    assert.equal(text.split("[summary.denied_hint]").length, 2, "the hint once");
    assert.ok(text.includes("[summary.config_default location=%APPDATA%\\Codaryn\\config.json]"));
    assert.ok(text.includes("[summary.profile_applied]"));
    assert.ok(text.includes(`[summary.next_report_here runId=${RUN}]`));
    assert.equal(text.includes("next_revert"), false, "nothing to revert without changes");
    const none = createHumanOutput(strictCatalog()).runSummary(result(), CONTEXT);
    assert.equal(none.includes("summary.denied"), false);
  });

  test("N-23(d): changed files are counted by distinct path, one line per path, as the first record says", () => {
    const changes = [
      { path: masked("summary.md"), previousHash: null, newHash: "c".repeat(64), created: true },
      { path: masked("summary.md"), previousHash: "c".repeat(64), newHash: "d".repeat(64), created: false },
      { path: masked("README.md"), previousHash: "a".repeat(64), newHash: "b".repeat(64), created: false },
      { path: masked("summary.md"), previousHash: "d".repeat(64), newHash: "e".repeat(64), created: false },
    ];
    const text = createHumanOutput(strictCatalog()).runSummary(result({ changes }), CONTEXT);
    assert.ok(text.includes("[summary.changes count=2]\n  summary.md ([progress.file_created])\n  README.md ([progress.file_changed])\n"), text);
    assert.equal(text.split("summary.md").length, 2, "one line for summary.md");
  });

  test("N-23(e): the hint to allow a command comes only with command denials, and points at the task file for a task run", () => {
    const human = createHumanOutput(strictCatalog());
    const pathOnly = human.runSummary(result(), { ...CONTEXT, deniedToolCalls: 2, deniedCommandCalls: 0 });
    assert.ok(pathOnly.includes("[summary.denied count=2]\n"));
    assert.equal(pathOnly.includes("denied_hint"), false, "no command was denied");
    const task = human.runSummary(result(), { ...CONTEXT, workspaceForm: "task", policySource: "task", deniedToolCalls: 2, deniedCommandCalls: 1 });
    assert.ok(task.includes("[summary.denied count=2]\n[summary.denied_hint_task]\n"), task);
    assert.equal(task.includes("[summary.denied_hint]"), false);
    const config = human.runSummary(result(), { ...CONTEXT, deniedToolCalls: 1, deniedCommandCalls: 1 });
    assert.ok(config.includes("[summary.denied count=1]\n[summary.denied_hint]\n"));
  });

  test("N-20: usage is given in seconds with one decimal, rounded from milliseconds", () => {
    const human = createHumanOutput(strictCatalog());
    const usage = (durationMs: number): string =>
      human.runSummary(result({ usage: { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs } }), CONTEXT).split("\n").find((line) => line.startsWith("[summary.usage")) ?? "";
    assert.equal(usage(0), "[summary.usage turns=1 toolCalls=0 seconds=0]");
    assert.equal(usage(4210), "[summary.usage turns=1 toolCalls=0 seconds=4.2]");
    assert.equal(usage(4250), "[summary.usage turns=1 toolCalls=0 seconds=4.3]");
    assert.equal(usage(700), "[summary.usage turns=1 toolCalls=0 seconds=0.7]");
    assert.equal(usage(123456), "[summary.usage turns=1 toolCalls=0 seconds=123.5]");
  });

  test("paths are cleaned and cut, long lists are counted, and a bad run id shows no command", () => {
    const changes = Array.from({ length: 7 }, (_, index) => ({
      path: masked(index === 0 ? `a\u001b[2J${KEY_SHAPED}` : `f${index}.md`),
      previousHash: null,
      newHash: "c".repeat(64),
      created: true,
    }));
    const text = createHumanOutput(strictCatalog()).runSummary(result({ changes, runId: "../x" }), CONTEXT);
    assert.ok(text.includes("  a?[2J[key] ([progress.file_created])"));
    assert.ok(text.includes("  … (+2)"));
    assert.equal(text.includes("summary.run_id"), false);
    assert.equal(/[\u0000-\u0008\u000b-\u001f]/.test(text), false);
  });
});

describe("HumanOutput.progressLine (N-5, N-14)", () => {
  test("words first, codes in parentheses; verifiers by number, never by id", () => {
    const human = createHumanOutput(strictCatalog());
    const verifier = (id: string, outcome: "pass" | "fail"): JournalEvent => ({
      type: "verifier_result",
      result: { id, kind: "command", outcome, evidence: masked(""), checked: [], limits: [] },
    });
    const events: [JournalEvent, string | null][] = [
      [{ type: "run_started", schemaVersion: 1, taskId: `t-${SECRET}`, workflow: masked("w"), provider: "scripted", limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1 } }, "[progress.run_started provider=scripted]"],
      [{ type: "model_request", turn: 2, system: null, newMessages: [] }, "[progress.turn turn=2]"],
      [{ type: "model_error", turn: 2, kind: "rate_limited", message: masked(SECRET) }, "[progress.model_error turn=2 kind=rate_limited]"],
      [{ type: "tool_decision", callId: "c", tool: "read_file", stage: "policy_effective", allowed: true, permission: null, code: null }, "[progress.tool_allowed tool=[tool.read_file]] (read_file)"],
      [
        { type: "tool_decision", callId: "c", tool: "run_command", stage: "policy_effective", allowed: false, permission: "command", code: "command_not_allowed" },
        "[progress.tool_denied tool=[tool.run_command] permission=command code=command_not_allowed]",
      ],
      [{ type: "tool_decision", callId: "c", tool: SECRET, stage: "validate", allowed: false, permission: null, code: "unknown_tool" }, "[progress.tool_rejected tool=[progress.unknown_tool] code=unknown_tool]"],
      [{ type: "tool_decision", callId: "c", tool: "write_file", stage: "validate", allowed: false, permission: null, code: "invalid_args" }, "[progress.tool_rejected tool=[tool.write_file] code=invalid_args]"],
      [{ type: "tool_decision", callId: "c", tool: "write_file", stage: "validate", allowed: false, permission: null, code: null }, "[tool.write_file] (check/none)"],
      [{ type: "file_changed", callId: "c", path: masked("notes.txt"), previousHash: null, newHash: "c".repeat(64), created: true }, "[progress.file_created] notes.txt"],
      [verifier(`v-${SECRET}`, "fail"), "[progress.verifier number=1 outcome=[outcome.fail]] (fail)"],
      [verifier("other", "pass"), "[progress.verifier number=2 outcome=[outcome.pass]] (pass)"],
      [verifier(`v-${SECRET}`, "pass"), "[progress.verifier number=1 outcome=[outcome.pass]] (pass)"],
      [{ type: "repair_started", attempt: 1, failedVerifiers: [`v-${SECRET}`], feedbackTruncated: false }, "[progress.repair attempt=1 count=1]"],
      [{ type: "integrity_checked", phase: "before_verify", changed: [] }, "[progress.integrity_unchanged phase=before_verify]"],
      [{ type: "integrity_checked", phase: "after_verify", changed: [masked("a"), masked("b")] }, "[progress.integrity_changed phase=after_verify count=2]"],
      [
        { type: "run_finished", status: "failed", reason: "verifier_failed", usage: { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 1 } },
        "[progress.finished status=[status.failed] reason=verifier_failed]",
      ],
      [{ type: "model_response", turn: 1, stop: "final", text: masked(SECRET), toolCalls: [], usage: null }, null],
      [{ type: "tool_result", result: { callId: "c", ok: true } as never }, null],
    ];
    for (const [event, expected] of events) assert.equal(human.progressLine(event), expected, event.type);
  });

  test("N-23(h): a key shape split by a control character in a recorded path is hidden", () => {
    const line = createHumanOutput(strictCatalog()).progressLine({
      type: "file_changed",
      callId: "c",
      path: masked(`sk-ant-AB\u0007CDEFGHIJKLMNOPQRSTUVWXYZ012345.md`),
      previousHash: null,
      newHash: "c".repeat(64),
      created: true,
    });
    assert.equal(line, "[progress.file_created] [key].md");
  });

  test("records with values outside their lists give no line instead of passing them on", () => {
    const human = createHumanOutput(strictCatalog());
    assert.equal(human.progressLine({ type: "model_error", turn: 1, kind: SECRET, message: masked("") }), null);
    assert.equal(human.progressLine({ type: "run_finished", status: "done", reason: "model_error", usage: {} as never }), null);
    assert.equal(human.progressLine({ type: "integrity_checked", phase: SECRET as never, changed: [] }), null);
  });
});

describe("HumanOutput.revertSummary (N-7)", () => {
  const output = (extra: Partial<RevertOutput>): RevertOutput => ({
    schemaVersion: 1,
    kind: "revert",
    runId: RUN,
    status: "partial",
    exitCode: 3,
    reverted: [{ path: "README.md", action: "restored" }],
    skipped: [
      { path: "notes.txt", reason: "changed_since_run" },
      { path: `raw-${SECRET}.txt`, reason: "missing_record" },
    ],
    ...extra,
  });

  test("a real revert: what was put back and why files were skipped; unmasked missing_record paths are hidden", () => {
    const text = createHumanOutput(strictCatalog()).revertSummary(output({}));
    assert.equal(
      text,
      [
        "codaryn: [revert.done_title count=1] (partial)",
        "  README.md — [revert.action.restored]",
        "[revert.skipped_title count=2]",
        "  notes.txt — [revert.skip.changed_since_run] (changed_since_run)",
        "  ? — [revert.skip.missing_record] (missing_record)",
        "",
      ].join("\n"),
    );
  });

  test("a dry run says so and how to go on; an earlier revert is shown with its status and local time", () => {
    const at = "2026-11-12T05:06:07.000Z";
    const text = createHumanOutput(strictCatalog()).revertSummary(
      output({ dryRun: true, status: "complete", exitCode: 0, skipped: [], revertedBefore: { at, status: "complete" } }),
    );
    assert.equal(
      text,
      [
        "codaryn: [revert.dry_run_title count=1] (complete)",
        "  README.md — [revert.action.restored]",
        `[revert.reverted_before] (complete, ${formatLocalTime(Date.parse(at))})`,
        "[revert.dry_run_next]",
        "",
      ].join("\n"),
    );
  });

  test("N-24(c): an impossible date such as 2026-02-30 shows no time", () => {
    const human = createHumanOutput(strictCatalog());
    const revertText = human.revertSummary(output({ revertedBefore: { at: "2026-02-30T00:00:00Z", status: "complete" } }));
    assert.ok(revertText.includes("[revert.reverted_before] (complete)\n"), revertText);
    const runs = human.runsText({
      schemaVersion: 1,
      kind: "runs",
      status: "listed",
      exitCode: 0,
      omitted: 0,
      runs: [{ state: "checked", runId: RUN, startedAt: "2026-02-30T00:00:00Z", taskId: "t", status: null, reason: null, changes: null, reverted: null }],
    });
    assert.equal(runs.includes("2026-03-02"), false, runs);
    assert.ok(runs.split("\n")[1]?.includes("  ?  "), runs);
  });

  test("G-A: moves and discards put back are named; original_path_taken and already_reverted are skip reasons", () => {
    const text = createHumanOutput(strictCatalog()).revertSummary(
      output({
        reverted: [
          { path: "a.md", action: "moved_back" },
          { path: "b.md", action: "restored_from_discard" },
        ],
        skipped: [
          { path: "c.md", reason: "original_path_taken" },
          { path: "d.md", reason: "already_reverted" },
        ],
      }),
    );
    assert.ok(text.includes("  a.md — [revert.action.moved_back]\n  b.md — [revert.action.restored_from_discard]\n"), text);
    assert.ok(text.includes("  c.md — [revert.skip.original_path_taken] (original_path_taken)\n  d.md — [revert.skip.already_reverted] (already_reverted)\n"), text);
  });

  test("an earlier revert with a time of another shape shows no time", () => {
    const text = createHumanOutput(strictCatalog()).revertSummary(output({ revertedBefore: { at: `${SECRET}`, status: "partial" } }));
    assert.ok(text.includes("[revert.reverted_before] (partial)\n"));
    assert.equal(text.includes(SECRET), false);
  });
});

describe("HumanOutput.latestChosen (N-23 b)", () => {
  test("names the chosen run and its start time in local time", () => {
    const startedAt = "2026-11-12T03:04:05.000Z";
    const text = createHumanOutput(strictCatalog()).latestChosen({ state: "checked", runId: RUN, startedAt, taskId: `t-${SECRET}`.slice(0, 40), status: "done", reason: "verified", changes: 1, reverted: null });
    assert.equal(text, `codaryn: [latest.chosen runId=${RUN}] ([runs.column.started] ${formatLocalTime(Date.parse(startedAt))})\n`);
    assert.equal(text.includes(SECRET), false);
  });

  test("an impossible start time is left out", () => {
    const text = createHumanOutput(strictCatalog()).latestChosen({ state: "checked", runId: RUN, startedAt: "2026-02-30T00:00:00Z", taskId: "t", status: "done", reason: "verified", changes: 1, reverted: null });
    assert.equal(text, `codaryn: [latest.chosen runId=${RUN}]\n`);
  });
});

describe("HumanOutput.runsText (N-7, N-16)", () => {
  const listed = (runs: RunsOutput["runs"], omitted = 0): RunsOutput => ({ schemaVersion: 1, kind: "runs", status: "listed", exitCode: 0, runs, omitted });

  test("an empty list says so", () => {
    assert.equal(createHumanOutput(strictCatalog()).runsText(listed([])), "[runs.empty]\n");
  });

  test("a table aligned in display columns; damaged runs show only their id; task ids are not shown", () => {
    const catalog = strictCatalog({ "runs.column.run_id": "실행 id", "runs.column.started": "시작", "status.done": "완료" });
    const startedAt = "2026-11-12T03:04:05.000Z";
    const text = createHumanOutput(catalog).runsText(
      listed(
        [
          { state: "checked", runId: RUN, startedAt, taskId: `task-${SECRET}`, status: "done", reason: "verified", changes: 2, reverted: { at: startedAt, status: "complete" } },
          { state: "checked", runId: runId("20261112T030400Z-00000000"), startedAt, taskId: "t", status: null, reason: null, changes: null, reverted: null },
          { state: "damaged", runId: runId("20261112T030300Z-ffffffff") },
        ],
        4,
      ),
    );
    const rows = text.trimEnd().split("\n");
    const time = formatLocalTime(Date.parse(startedAt));
    assert.equal(rows.length, 5);
    assert.ok(rows[1]?.startsWith(RUN));
    assert.ok(rows[1]?.includes(time));
    assert.ok(rows[1]?.endsWith("완료 (done/verified) · [runs.reverted] (complete)"));
    assert.ok(rows[2]?.endsWith("[runs.incomplete]"));
    assert.ok(rows[3]?.startsWith("20261112T030300Z-ffffffff"));
    assert.ok(rows[3]?.endsWith("[runs.damaged]"));
    assert.equal(rows[4], "[runs.omitted count=4]");
    assert.equal(text.includes(SECRET), false);

    // The last column starts at the same display column on every row, with Hangul counted as two.
    const statusCells = ["[runs.column.status]", "완료 (done/verified)", "[runs.incomplete]", "[runs.damaged]"];
    const starts = rows.slice(0, 4).map((row, index) => displayWidth(row.slice(0, row.indexOf(statusCells[index] as string))));
    assert.equal(new Set(starts).size, 1, `aligned: ${starts.join(",")}`);
    assert.ok(rows[0]?.startsWith("실행 id"), "the header has the catalog's words");
  });
});
