/** U-336: public renderer regressions, pinned through the legacy path on the actual parent. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApplyReportOutput, EngineResult, RunReportOutput } from "../../../src/contracts/index.js";
import { asRawText } from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import * as legacy from "../../../src/cli/report.js";

const gateway = createPrivacyGateway({ secrets: [] });
function masked(text: string) {
  const out = gateway.mask(asRawText(text));
  assert.ok(out.ok);
  return out.text;
}
function run(): RunReportOutput {
  return {
    schemaVersion: 1, kind: "report", runId: "r", status: "incomplete", exitCode: 3, result: null,
    journal: {
      taskId: "task", workflow: masked("coding"), provider: "scripted", records: 1,
      limits: { maxModelTurns: 2, maxToolCalls: 3, maxTotalTokens: null, maxDurationMs: 10 },
      modelRequests: 0, deniedToolCalls: 0, repairs: 0, lastRound: [], changes: [], integrityChecks: [], finished: null,
    },
  };
}
function apply(): ApplyReportOutput {
  return {
    schemaVersion: 1, kind: "report", runKind: "apply", runId: "a", status: "incomplete", exitCode: 3, result: null,
    journal: {
      planRunId: "p", taskId: "task", digest: "abc", approval: "cli-flag", unsafeMoveConsent: null,
      actions: 0, maxDurationMs: 10, records: 1, checked: null, started: 0, moved: [], discarded: [], failed: [],
      lastRound: [], integrityChecks: [], finished: null,
    },
  };
}
function result(text: string): EngineResult {
  return {
    schemaVersion: 1, kind: "run", runId: "r", taskId: "task", status: "done", reason: "verified", exitCode: 0,
    provider: "scripted", verifiers: [], changes: [], notices: [], journalPath: "journal.jsonl",
    usage: { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 1 },
    finalMessage: { text: masked(text), truncated: false },
  };
}

test("minimal run: exact Markdown, defaults, incomplete fields and final LF", () => {
  const expected = [
    "# Codaryn run report", "", "- Run: `r`", "- Task: `task` (task type `coding`)",
    "- Provider: `scripted` (scripted model; no API was called)",
    "- Result: none. The run has no result.json: it is still running, or it stopped without writing one.",
    "- The journal has no end record.", "- Report: incomplete (1 journal records)",
    "", "## Verification", "", "No verifier result was recorded for the last round.",
    "", "## Protected material", "",
    "Not checked: the run had no integrity check (nothing was protected, or it ran without the check).",
    "", "## Changes (0)", "", "No file tool write was recorded.",
    "", "## Usage", "", "- Model requests recorded: 0 (limit 2)", "- Denied tool calls: 0", "- Repairs: 0",
    "", "## Not checked", "",
    "- A pass means the configured verifiers passed. It is not a review of the change.",
    "- The change list holds file tool writes only. Commands allowed by the policy may have changed other files.",
    "- There is no OS isolation: allowed commands ran with the user's rights and could reach the network.",
    "- This report reads the run's own records. Commands allowed during the run could have changed them.",
    "- Masking hides only the values registered for this run and the forms of them it looks for. A secret that was not registered, another form of a value or text in another encoding (such as UTF-16) is not masked.",
    "",
  ].join("\n");
  assert.equal(legacy.renderReport(run()), expected);
  assert.equal(legacy.renderReport(run(), null, 0, null), expected);
});

test("minimal apply: exact Markdown, missing preflight, no model and final LF", () => {
  const expected = [
    "# Codaryn apply run report", "", "- Run: `a` (an apply run: no model takes part)",
    "- Plan run: `p`, digest `abc`", "- Task: `task`", "- Approval: `cli-flag`; consent to unsafe moves: none",
    "- Result: none. The apply run has no result.json: it is still running, or it stopped without writing one.",
    "- The journal has no end record.", "- Report: incomplete (1 journal records)",
    "", "## Preflight", "", "The journal has no preflight record: nothing was checked or moved.",
    "", "## Actions (0 of 0 done)", "", "No action was applied.",
    "", "## Verification", "", "No verifier result was recorded for the last round.",
    "", "## Protected material", "",
    "Not checked: the apply had no integrity check (nothing was protected, or it ran without the check).",
    "", "## Usage", "", "- Duration limit: 10 ms", "", "## Undo", "",
    "Revert this apply with `codaryn revert --workspace <workspace> --run a`.",
    "", "## Not checked", "",
    "- A pass means the inventory check and the configured verifiers passed. It is not a review of the plan.",
    "- There is no OS isolation: command verifiers ran with the user's rights and could reach the network.",
    "- This report reads the apply run's own records. Commands allowed in other runs could have changed them.", "",
  ].join("\n");
  assert.equal(legacy.renderApplyReport(apply()), expected);
  assert.equal(legacy.renderApplyReport(apply(), null), expected);
});

test("mask before controls; backtick padding, evidence fences, short hashes and section order", () => {
  const f = run();
  const report: RunReportOutput = { ...f, runId: "`x``\u001b", journal: { ...f.journal,
    taskId: "synthetic-\tu336-value", workflow: masked(""),
    changes: [{ path: masked("`file`"), created: false, previousHash: null, newHash: "1234567890abcdef" }],
    lastRound: [{ id: "hidden-id", kind: "command", outcome: "fail", evidence: masked("a\n```\tend\r"), checked: [masked("c")], limits: [masked("l")] }],
    integrityChecks: [{ phase: "before_verify", changed: [masked("p")] }],
  } };
  const text = legacy.renderReport(report, ["synthetic-u336-value"], 2);
  assert.ok(text.includes("- Run: ``` `x``? ```\n- Task: `[key]` (task type `  `)\n"));
  assert.ok(text.includes("  ````\n  a\n  ```\tend?\n  ````"));
  assert.ok(text.includes("- `` `file` `` changed (none -> 1234567890ab)"));
  assert.ok(text.includes("Checked 1 time(s): before verification.\nChanged since the run started, or not checkable:\n- `p`"));
  assert.ok(text.includes("- Failed tool calls: 2"));
  assert.ok(text.indexOf("## Verification") < text.indexOf("## Protected material"));
  assert.ok(text.indexOf("## Protected material") < text.indexOf("## Changes"));
  assert.equal(text.includes("hidden-id"), false);
});

test("apply actions retain repeated getter order and sort by index across action kinds", () => {
  const f = apply();
  const trace: string[] = [];
  const report: ApplyReportOutput = { ...f, journal: { ...f.journal, actions: 3, started: 3,
    get moved() { trace.push("moved"); return [{ index: 2, from: masked("src"), to: masked("dst"), unsafe: true }]; },
    get discarded() { trace.push("discarded"); return [{ index: 0, path: masked("old"), stored: "saved" }]; },
    get failed() { trace.push("failed"); return [{ index: 1, problem: "source_missing" as const }]; },
  } };
  const text = legacy.renderApplyReport(report);
  assert.deepEqual(trace, ["moved", "discarded", "failed", "failed"]);
  assert.ok(text.includes("- action 1: discard `old` (kept as `.codaryn/discarded/a/saved`)\n- action 3: move `src` -> `dst` (moved without the guarantee, with consent)\n- action 2 failed: `source_missing`"));
});

test("sentinel exceptions escape unchanged and both renderers clear state for later calls", () => {
  const sentinel = { tag: "u336-sentinel" };
  for (const invoke of [
    () => legacy.renderReport({ ...run(), get runId(): string { throw sentinel; } }, "synthetic-u336-value"),
    () => legacy.renderApplyReport({ ...apply(), get runId(): string { throw sentinel; } }, "synthetic-u336-value"),
  ]) {
    assert.throws(invoke, error => error === sentinel);
    assert.ok(legacy.renderReport({ ...run(), runId: "synthetic-u336-value" }).includes("`synthetic-u336-value`"));
    assert.ok(legacy.renderApplyReport({ ...apply(), runId: "synthetic-u336-value" }).includes("`synthetic-u336-value`"));
  }
});

test("cross-renderer nested getters share one key and clear to null, without restoring the outer key", () => {
  const trace: string[] = [];
  const sentinel = Symbol("nested sentinel");
  const r = run();
  const a = apply();
  const outer: RunReportOutput = { ...r, get runId() {
    trace.push("outer run");
    const inner = legacy.renderApplyReport({ ...a, runId: "synthetic-inner-value" }, "synthetic-inner-value");
    assert.ok(inner.includes("- Run: `[key]`"));
    return "synthetic-outer-value";
  } };
  assert.ok(legacy.renderReport(outer, "synthetic-outer-value").includes("- Run: `synthetic-outer-value`"));
  const reverse: ApplyReportOutput = { ...a, get runId() {
    trace.push("outer apply");
    assert.throws(() => legacy.renderReport({ ...r, get runId(): string { trace.push("inner throw"); throw sentinel; } }, "synthetic-inner-value"), error => error === sentinel);
    return "synthetic-outer-value";
  } };
  assert.ok(legacy.renderApplyReport(reverse, "synthetic-outer-value").includes("- Run: `synthetic-outer-value`"));
  assert.deepEqual(trace, ["outer run", "outer apply", "inner throw", "outer apply", "inner throw"]);
  assert.ok(legacy.renderReport({ ...r, runId: "synthetic-outer-value" }).includes("`synthetic-outer-value`"));
});

test("ordinary synchronous named functions retain arity, prototype and constructibility; arrays stay mutable", () => {
  for (const [fn, name, fixture] of [
    [legacy.renderReport, "renderReport", run()], [legacy.renderApplyReport, "renderApplyReport", apply()],
  ] as const) {
    assert.equal(fn.name, name);
    assert.equal(fn.length, 1);
    assert.equal(Object.getPrototypeOf(fn), Function.prototype);
    assert.equal(fn.prototype.constructor, fn);
    assert.equal(Object.getOwnPropertyDescriptor(fn, "prototype")?.writable, true);
    assert.equal(Object.getPrototypeOf(Reflect.construct(fn, [fixture])), fn.prototype);
  }
  for (const limits of [legacy.REPORT_FIXED_LIMITS, legacy.APPLY_REPORT_FIXED_LIMITS]) {
    assert.ok(Array.isArray(limits));
    assert.equal(Object.isFrozen(limits), false);
    assert.equal(Object.getOwnPropertyDescriptor(limits, "0")?.writable, true);
  }
});

test("terminal width is read at final-message formatting time, stdout then stderr, with both defaults", () => {
  const trace: string[] = [];
  const descriptors = [process.stdout, process.stderr].map(stream => ({
    stream, tty: Object.getOwnPropertyDescriptor(stream, "isTTY"), columns: Object.getOwnPropertyDescriptor(stream, "columns"),
  }));
  let tty = true;
  try {
    for (const [index, { stream }] of descriptors.entries()) {
      Object.defineProperty(stream, "isTTY", { configurable: true, get: () => { trace.push(`${index}:tty`); return tty; } });
      Object.defineProperty(stream, "columns", { configurable: true, get: () => { trace.push(`${index}:columns`); return index === 0 ? 40 : 24; } });
    }
    const f = run();
    const report = { ...f, get result() { trace.push("result"); return result("abcdefghijklmnopqrstuvwxyz0123456789"); } };
    const narrow = legacy.renderReport(report);
    assert.deepEqual(trace, ["result", "0:tty", "0:columns", "1:tty", "1:columns"]);
    assert.ok(narrow.includes("  | abcdefghijklmnopqrs\n  | tuvwxyz0123456789\n"));
    tty = false; trace.length = 0;
    const plain = legacy.renderReport(report);
    assert.deepEqual(trace, ["result", "0:tty", "1:tty"]);
    assert.ok(plain.includes("  | abcdefghijklmnopqrstuvwxyz0123456789\n"));
    trace.length = 0;
    legacy.renderReport(run());
    assert.deepEqual(trace, []);
  } finally {
    for (const { stream, tty, columns } of descriptors) {
      if (tty) Object.defineProperty(stream, "isTTY", tty); else Reflect.deleteProperty(stream, "isTTY");
      if (columns) Object.defineProperty(stream, "columns", columns); else Reflect.deleteProperty(stream, "columns");
    }
  }
});

// Appended after the OLD behavior tests were pinned; those eight bodies/expectations stay intact.
import * as canonical from "../../../src/presentation/report.js";
import * as readers from "../../../src/app/report-read.js";
import type { KnownKeys } from "../../../src/app/input/security/index.js";
import type { ReportPlanApply } from "../../../src/presentation/report.js";
import type { ReportPlanApply as LegacyPlanApply } from "../../../src/cli/report.js";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

test("canonical four and legacy ten exports retain exact bindings and public types", () => {
  const values = ["APPLY_REPORT_FIXED_LIMITS", "REPORT_FIXED_LIMITS", "renderApplyReport", "renderReport"] as const;
  const readerNames = ["failedCallsIn", "readApplyResult", "readResult", "summarizeApplyJournal", "summarizeJournal"] as const;
  assert.deepEqual(Object.keys(canonical).sort(), [...values].sort());
  assert.deepEqual(Object.keys(legacy).sort(), [...values, ...readerNames, "runReport"].sort());
  for (const name of values) assert.equal(canonical[name], legacy[name]);
  for (const name of readerNames) assert.equal(legacy[name], readers[name]);
  const types: [
    Equal<typeof canonical.renderReport, typeof legacy.renderReport>,
    Equal<typeof canonical.renderApplyReport, typeof legacy.renderApplyReport>,
    Equal<typeof canonical.REPORT_FIXED_LIMITS, readonly string[]>,
    Equal<typeof canonical.APPLY_REPORT_FIXED_LIMITS, readonly string[]>,
    Equal<Parameters<typeof canonical.renderReport>[1], KnownKeys | undefined>,
    Equal<Parameters<typeof canonical.renderApplyReport>[1], KnownKeys | undefined>,
    Equal<ReportPlanApply, LegacyPlanApply>,
  ] = [true, true, true, true, true, true, true];
  assert.ok(types.every(value => value));
  const f = run();
  const crossPath = { ...f, get runId() {
    canonical.renderApplyReport(apply(), "synthetic-inner-value");
    return "synthetic-outer-value";
  } };
  assert.ok(legacy.renderReport(crossPath, "synthetic-outer-value").includes("`synthetic-outer-value`"));
  assert.equal(canonical.renderReport(f), legacy.renderReport(f));
});

// A typed namespace value must retain readonly const bindings as well as readonly array elements.
type Assert<T extends true> = T;
type FixedLimitNames = "REPORT_FIXED_LIMITS" | "APPLY_REPORT_FIXED_LIMITS";
type SameFixedLimitBindings = Assert<Equal<Pick<typeof canonical, FixedLimitNames>, Pick<typeof legacy, FixedLimitNames>>>;
type LegacyFixedLimitBindings = Assert<Equal<Pick<typeof legacy, FixedLimitNames>, {
  readonly REPORT_FIXED_LIMITS: readonly string[];
  readonly APPLY_REPORT_FIXED_LIMITS: readonly string[];
}>>;
