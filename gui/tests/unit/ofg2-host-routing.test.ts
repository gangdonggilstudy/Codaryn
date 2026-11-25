/** OFG-2: the GUI host feeds each record to one renderer entry point, even when it folds a line. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { MAX_RUN_ITEM_CHARS } from "../../src/shared/protocol.js";
import type { RunItemOf } from "../../src/engine-host/runs.js";

type RecordValue = { type: string; [key: string]: unknown };
interface Progress {
  progressLine(event: unknown): string | null;
  applyProgressLine?(event: unknown): string | null;
}
interface Renderer extends Progress {
  applyProgressLine(event: unknown): string | null;
  runSummary(result: unknown, context: unknown): string;
  applySummary(result: unknown, context: unknown): string;
}
interface Catalog { format(id: string, values?: Record<string, unknown>): string }
const load = async <T>(file: string): Promise<T> => await import(new URL(`../../../../dist/src/${file}`, import.meta.url).href) as T;
const { createHumanOutput } = await load<{ createHumanOutput(catalog: Catalog): Renderer }>("cli/human/output.js");
const { createMessageCatalog } = await load<{ createMessageCatalog(language: "ko" | "en"): Catalog }>("i18n/index.js");
const contracts = await load<{
  JOURNAL_EVENT_TYPES: readonly string[];
  APPLY_JOURNAL_EVENT_TYPES: readonly string[];
  APPLY_JOURNAL_ENTRY_TYPES: readonly string[];
}>("contracts/index.js");
const applyOnly = new Set(contracts.APPLY_JOURNAL_EVENT_TYPES.filter((type) => !contracts.JOURNAL_EVENT_TYPES.includes(type)));
const knownTypes = [...new Set([...contracts.JOURNAL_EVENT_TYPES, ...contracts.APPLY_JOURNAL_ENTRY_TYPES])];

// Execute the built runItems, not a copy. main's entry point redirects stdout, reads the host's
// environment and starts the app; extracting this pure factory avoids all those side effects.
const hostSource = readFileSync(new URL("../../src/engine-host/main.js", import.meta.url), "utf8");
const begin = hostSource.indexOf("function runItems(");
const end = hostSource.indexOf("\nfunction parseArgs(", begin);
assert.ok(begin >= 0 && end > begin, "the built runItems factory must be found");
const constants = ["RECORD_TYPE", "RECORD_TIME"].map((name) => {
  const declaration = hostSource.match(new RegExp(`^const ${name} = .+;$`, "m"));
  assert.ok(declaration, `${name} must be found`);
  return declaration[0];
}).join("\n");
const runItems = runInNewContext(`${constants}\n${hostSource.slice(begin, end)}\nrunItems;`, { MAX_RUN_ITEM_CHARS }) as
  (human: Progress, shown: (text: string) => string) => RunItemOf;
const shown = (text: string): string => text;
const feed = (items: RunItemOf, record: RecordValue) => items({ kind: "record", record });
const AT = "2026-11-26T01:02:03Z";
const RUN = "20261113T040506Z-0a1b2c3d";
const context = { workspaceForm: "task", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, policySource: "task" };
const result = {
  schemaVersion: 1, kind: "run", runId: RUN, taskId: "routing", status: "done", reason: "verified", exitCode: 0,
  provider: "scripted", verifiers: [], changes: [], usage: null, notices: [], protectedChanged: [], journalPath: "x",
};
const applyResult = { ...result, kind: "apply", planRunId: RUN, applied: [], noticeKinds: [], foldersLeftEmpty: 0 };
const check = (changed: string[] = []): RecordValue => ({ type: "integrity_checked", phase: "before_verify", changed });
const fixtures: Record<string, RecordValue> = {
  run_started: { type: "run_started", provider: "scripted" },
  model_request: { type: "model_request", turn: 1 },
  model_response: { type: "model_response", turn: 1, stop: "end_turn", text: "done", toolCalls: [], usage: null },
  model_error: { type: "model_error", turn: 1, kind: "api_error", message: "not connected" },
  tool_decision: { type: "tool_decision", callId: "call1", tool: "read_file", stage: "policy_effective", allowed: false, permission: "path", code: "outside_root" },
  tool_result: { type: "tool_result", result: { ok: true, tool: "run_command", content: JSON.stringify({ exitCode: 2, timedOut: false }) } },
  confirmation_requested: { type: "confirmation_requested", id: "q1", kind: "permission", callId: "call1", tool: "read_file", permission: "path", subject: "a.txt", argumentCount: 1 },
  confirmation_answered: { type: "confirmation_answered", id: "q1", decision: "allow_once", by: "user" },
  file_changed: { type: "file_changed", path: "a.txt", created: false },
  verifier_result: { type: "verifier_result", result: { kind: "command", id: "check", outcome: "pass" } },
  repair_started: { type: "repair_started", attempt: 1, failedVerifiers: ["check"] },
  integrity_checked: check(),
  state_checked: { type: "state_checked", phase: "before_verify", changed: [], limited: false },
  run_finished: { type: "run_finished", status: "done", reason: "verified" },
  apply_started: { type: "apply_started", actions: 2, approval: "adapter" },
  plan_checked: { type: "plan_checked", problems: [], unsafeMoves: [], inventoryLimitReached: false },
  file_moved: { type: "file_moved", index: 0, from: "a.txt", to: "b.txt" },
  file_discarded: { type: "file_discarded", index: 1, path: "c.txt" },
  plan_item_failed: { type: "plan_item_failed", index: 0, problem: "source_changed" },
  plan_item_started: { type: "plan_item_started", index: 0, action: { kind: "move", from: "a.txt", to: "b.txt" } },
};

test("OFG-2 GUI 호스트 분기: every contract type enters exactly one renderer method, including folded lines", () => {
  assert.deepEqual(Object.keys(fixtures).sort(), [...knownTypes].sort(), "add a fixture when a contract type is added");
  const observed = knownTypes.map((type) => {
    const calls: string[] = [];
    const items = runItems({ progressLine: () => { calls.push("run"); return null; }, applyProgressLine: () => { calls.push("apply"); return null; } }, shown);
    assert.equal(feed(items, fixtures[type]!), null);
    return [type, calls];
  });
  assert.deepEqual(observed, knownTypes.map((type) => [type, [applyOnly.has(type) ? "apply" : "run"]]));
});

test("OFG-2: the contract difference matches the real apply renderer's own branches; recovery stays hidden", () => {
  for (const type of contracts.APPLY_JOURNAL_ENTRY_TYPES) {
    const human = createHumanOutput(createMessageCatalog("en"));
    let delegated = 0;
    human.progressLine = () => { delegated += 1; return "delegated"; };
    const line = human.applyProgressLine(fixtures[type]);
    if (applyOnly.has(type)) {
      assert.equal(delegated, 0, type);
      assert.ok(typeof line === "string" && line !== "delegated", type);
    } else if (contracts.JOURNAL_EVENT_TYPES.includes(type)) {
      assert.equal(delegated, 1, type);
      assert.equal(line, "delegated", type);
    } else {
      assert.equal(delegated, 0, type);
      assert.equal(line, null, type);
    }
  }
});

for (const language of ["ko", "en"] as const) {
  test(`OFG-2 GUI 호스트 분기 ${language}: run then apply summaries count each integrity check once, as the CLI does`, () => {
    const catalog = createMessageCatalog(language);
    const cli = createHumanOutput(catalog);
    const gui = createHumanOutput(catalog);
    const items = runItems(gui, shown);
    const run = [fixtures.run_started!, check(), check(), fixtures.run_finished!];
    const apply = [fixtures.apply_started!, check(), check(), fixtures.run_finished!];
    for (const record of run) { cli.progressLine(record); feed(items, record); }
    const runSummaries = [cli.runSummary(result, context), gui.runSummary(result, context)];
    for (const record of apply) { cli.applyProgressLine(record); feed(items, record); }
    const applySummaries = [cli.applySummary(applyResult, context), gui.applySummary(applyResult, context)];
    const count = catalog.format("summary.integrity_unchanged", { count: 2 });
    assert.ok(runSummaries[0]!.includes(count) && applySummaries[0]!.includes(count), "CLI reference counts two checks in each command");
    assert.deepEqual({ run: runSummaries[1], apply: applySummaries[1] }, { run: runSummaries[0], apply: applySummaries[0] });
  });

  test(`OFG-2 ${language}: all normal progress kinds keep the pre-fix lines, including folded and changed checks`, () => {
    const before = createHumanOutput(createMessageCatalog(language));
    const after = runItems(createHumanOutput(createMessageCatalog(language)), shown);
    // Historical fallback is the text-only oracle, deliberately retaining the old bug's state.
    // Summaries are checked against the CLI above, never against this historical behavior.
    const records = [...knownTypes.map((type) => fixtures[type]!), check(), check(), check(["changed.txt"]),
      { ...fixtures.state_checked!, changed: ["state.txt"] }, { ...fixtures.state_checked!, limited: true }];
    for (const record of records) {
      let expected = before.progressLine(record);
      if (expected === null) expected = before.applyProgressLine(record);
      if (!["model_response", "confirmation_requested", "integrity_checked", "state_checked", "plan_item_started"].includes(record.type)) assert.notEqual(expected, null, record.type);
      const item = feed(after, { ...record, at: AT });
      assert.equal(item?.text ?? null, expected === null ? null : expected.replace(/\r?\n+$/, "").replace(/\r?\n/g, " ").slice(0, MAX_RUN_ITEM_CHARS), record.type);
      if (item !== null) {
        assert.equal(item.at, AT);
        assert.equal(item.kind, record.type === "tool_decision" && record.allowed === false ? "tool_denied" : record.type);
      }
    }
  });
}

test("OFG-2: null and exceptions never try another renderer, for run and apply records", () => {
  for (const type of ["integrity_checked", "apply_started", "future_record"]) {
    for (const throws of [false, true]) {
      const calls: string[] = [];
      const method = (name: string) => () => { calls.push(name); if (throws) throw new Error("synthetic renderer failure"); return null; };
      assert.equal(feed(runItems({ progressLine: method("run"), applyProgressLine: method("apply") }, shown), { type }), null);
      assert.deepEqual(calls, [applyOnly.has(type) ? "apply" : "run"], `${type}, throws=${throws}`);
    }
  }
});

test("OFG-2: renderers without apply support keep their progress method; notices and malformed events stay bounded", () => {
  const seen: unknown[] = [];
  const items = runItems({ progressLine: (record) => { seen.push(record); return "one\r\ntwo\n"; } }, (text) => `[${text}]`);
  assert.equal(feed(items, fixtures.apply_started!)?.text, "[one two]");
  assert.equal(seen.length, 1);
  assert.equal(items({ kind: "notice", text: "line\n" })?.text, "[line]");
  assert.equal(items({ kind: "notice", text: "x".repeat(MAX_RUN_ITEM_CHARS + 1) })?.text.length, MAX_RUN_ITEM_CHARS);
  for (const invalid of [null, 1, {}, { kind: "record", record: null }, { kind: "record", record: { type: "bad-type" } }, { kind: "notice", text: 7 }]) assert.equal(items(invalid), null);
  assert.equal(feed(items, { type: "tool_decision", allowed: false, at: "invalid" })?.at, null);
});
