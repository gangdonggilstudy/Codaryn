/** Output family runtime boundaries; the static import graph has a separate guard. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIVATE_REVIEW_ITEM, toRunId } from "../../../src/contracts/index.js";
import type { ApplyJournalEvent, CatalogText, CliErrorOutput, EngineResult, HumanOutput, JournalEvent, MessageCatalog, MessageId, RevertOutput, RunListEntry, RunSummaryContext, RunsOutput } from "../../../src/contracts/index.js";
import * as output from "../../../src/cli/human/output.js";
import * as human from "../../../src/cli/human/index.js";
import * as layout from "../../../src/cli/human/output-layout.js";
import { createErrorOutput } from "../../../src/cli/human/output-errors.js";
import { createHistoryOutput } from "../../../src/cli/human/output-history.js";
import { createSummaryOutput } from "../../../src/cli/human/output-summary.js";
import { FINAL_MESSAGE_MAX_LINES } from "../../../src/app/model-text.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const RUN = "20261113T040506Z-0a1b2c3d";
const OTHER_RUN = "20261113T030405Z-00000001";
const DIGEST = "a".repeat(64);
const CONTEXT: RunSummaryContext = {
  workspaceForm: "task", configDefault: null, profileApplied: false,
  deniedToolCalls: 0, deniedCommandCalls: 0, policySource: "task",
};
// Malformed fields in individual cases deliberately exercise the renderer's untrusted boundary.
const result = (extra: Record<string, unknown> = {}): EngineResult => ({
  schemaVersion: 1, kind: "run", runId: RUN, taskId: "family", status: "done", reason: "verified", exitCode: 0,
  provider: "scripted", verifiers: [], changes: [], usage: null, notices: [], protectedChanged: [], journalPath: "x", ...extra,
}) as unknown as EngineResult;
const revert = (extra: Record<string, unknown> = {}): RevertOutput => ({
  schemaVersion: 1, kind: "revert", runId: RUN, status: "complete", exitCode: 0, reverted: [], skipped: [], ...extra,
}) as RevertOutput;
const runStart = { type: "run_started", provider: "scripted" } as JournalEvent;
const check = (changed: readonly string[] = []): JournalEvent => ({ type: "integrity_checked", phase: "before_verify", changed }) as JournalEvent;
const rows = (text: string): string[] => text.trimEnd().split("\n");
const methods = (value: object): [string, string, number][] => Object.entries(value).map(([key, fn]) => {
  assert.equal(typeof fn, "function", key);
  return [key, fn.name, fn.length];
});
const RENDERER_METHODS: [string, string, number][] = [
  ["error", "error", 1], ["runSummary", "runSummary", 2], ["progressLine", "progressLine", 1],
  ["revertSummary", "revertSummary", 2], ["latestChosen", "latestChosen", 1], ["runsText", "runsText", 1],
  ["applyProgressLine", "applyProgressLine", 1], ["applySummary", "applySummary", 2],
];

test("output family: factories are inert and keep method names and arities", t => {
  const traps: string[] = [];
  const reject = (name: string): never => { traps.push(name); throw new Error(`eager catalog ${name}`); };
  const catalog = new Proxy({} as MessageCatalog, {
    get: () => reject("get"), set: () => reject("set"), has: () => reject("has"),
    deleteProperty: () => reject("deleteProperty"), ownKeys: () => reject("ownKeys"),
    getOwnPropertyDescriptor: () => reject("getOwnPropertyDescriptor"), defineProperty: () => reject("defineProperty"),
    getPrototypeOf: () => reject("getPrototypeOf"), setPrototypeOf: () => reject("setPrototypeOf"),
    isExtensible: () => reject("isExtensible"), preventExtensions: () => reject("preventExtensions"),
    apply: () => reject("apply"), construct: () => reject("construct"),
  });
  const lockLines = t.mock.fn((_left: unknown): string[] => []);
  const integritySummary = t.mock.fn((): string[] => []);
  assert.deepEqual(methods(createErrorOutput(catalog)), [["error", "error", 1]]);
  assert.deepEqual(methods(createHistoryOutput(catalog, lockLines)), [
    ["revertSummary", "revertSummary", 2], ["latestChosen", "latestChosen", 1], ["runsText", "runsText", 1],
  ]);
  assert.deepEqual(methods(createSummaryOutput(catalog, integritySummary, lockLines)), [
    ["heading", "heading", 3], ["givenWorkspace", "givenWorkspace", 1], ["formText", "formText", 2],
    ["nextCommands", "nextCommands", 4], ["narrowingTexts", "narrowingTexts", 1], ["runSummary", "runSummary", 2],
  ]);
  assert.deepEqual(methods(output.createHumanOutput(catalog)), RENDERER_METHODS);
  assert.deepEqual(traps, []);
  assert.equal(lockLines.mock.callCount(), 0);
  assert.equal(integritySummary.mock.callCount(), 0);
});

test("output family: public names, references and renderer order stay stable", () => {
  const names = ["FINAL_MESSAGE_MAX_LINES", "HIDDEN_PATH", "HUMAN_PREFIX", "REVERT_MAX_LISTED", "SUMMARY_MAX_PATHS", "builtinReviewItemText", "createHumanOutput", "lockReleaseFailedLine"] as const;
  assert.deepEqual(Object.keys(output), [...names].sort());
  assert.deepEqual(Object.keys(human), [
    ...names, "MODEL_TEXT_COLUMNS", "MODEL_TEXT_FALLBACK_COLUMNS", "MODEL_TEXT_PREFIX", "SUMMARY_HIDDEN_MARKER",
    "TOP_LEVEL_POSITION", "changesApplyQuestion", "changesApprovalText", "changesPlanOutput", "changesPlanSummaryText",
    "closestKnownName", "createHumanWriter", "displayWidth", "fieldPath", "formatLocalTime", "isFieldName",
    "jsonSyntaxErrorOffset", "jsonSyntaxErrorPosition", "padEnd", "padStart", "positionOf", "queryTableFacts",
    "quoteModelText", "renderChangesPlan", "shellArg", "terminalColumns",
  ].sort());
  for (const name of names) {
    assert.strictEqual(output[name], human[name], name);
    if (name !== "createHumanOutput") assert.strictEqual(output[name], layout[name], name);
  }
  assert.strictEqual(output.FINAL_MESSAGE_MAX_LINES, FINAL_MESSAGE_MAX_LINES);
  assert.deepEqual(methods(output.createHumanOutput(createMessageCatalog("en"))), RENDERER_METHODS);
});

interface Call { readonly id: MessageId; readonly args: readonly unknown[] }
function traced(language: "ko" | "en") {
  const real = createMessageCatalog(language), calls: Call[] = [];
  const catalog: MessageCatalog = {
    language,
    format: function (this: MessageCatalog, id: MessageId, ...args: unknown[]): CatalogText {
      assert.strictEqual(this, catalog, `receiver of ${id}`);
      calls.push({ id, args });
      return Reflect.apply(real.format, real, [id, ...args]) as CatalogText;
    } as MessageCatalog["format"],
  };
  return { catalog, calls };
}

test("output family: catalog receiver and call order cross all three factories", () => {
  const { catalog, calls } = traced("en"), renderer = output.createHumanOutput(catalog);
  assert.deepEqual(calls, []);
  renderer.error({ schemaVersion: 1, kind: "error", code: "not_a_code", exitCode: 2, message: "unshown" } as unknown as CliErrorOutput);
  renderer.latestChosen({ state: "checked", runId: RUN, startedAt: "invalid" } as RunListEntry & { readonly state: "checked" });
  renderer.revertSummary(revert(), { lockLeft: true });
  renderer.runSummary(result({ runId: "not/a/run", status: "invalid", reason: "invalid" }), CONTEXT);
  assert.deepEqual(calls, [
    { id: "error.label", args: [] }, { id: "latest.chosen", args: [{ runId: RUN }] },
    { id: "revert.done_title", args: [{ count: 0 }] }, { id: "lock.release_failed", args: [] },
    { id: "summary.no_verifiers", args: [] }, { id: "summary.changes", args: [{ count: 0 }] },
    { id: "summary.form.task", args: [] },
  ]);
});

test("output family: injected summary and lock callbacks are read anew in their original order", () => {
  const { catalog, calls } = traced("en"), effects: string[] = [];
  let generation = 0;
  const lockLines = (left: unknown): string[] => { effects.push(`lock ${String(left)}`); return []; };
  const summary = createSummaryOutput(catalog, () => { effects.push("integrity"); return [`integrity ${++generation}`]; }, lockLines);
  const history = createHistoryOutput(catalog, lockLines);
  assert.deepEqual([calls, effects], [[], []]);
  for (const expected of [1, 2]) {
    const text = summary.runSummary(result(), { ...CONTEXT, lockLeft: true });
    assert.ok(rows(text).includes(`integrity ${expected}`));
    assert.ok(!rows(text).includes(`integrity ${3 - expected}`));
  }
  history.revertSummary(revert(), { lockLeft: false });
  assert.deepEqual(effects, ["integrity", "lock true", "integrity", "lock true", "lock false"]);
});

test("output family: apply delegates to the current progressLine, not a captured method", t => {
  const renderer = output.createHumanOutput(createMessageCatalog("en"));
  assert.ok(renderer.applyProgressLine);
  const first = t.mock.fn((_event: JournalEvent) => "first delegate");
  renderer.progressLine = first;
  assert.equal(renderer.applyProgressLine(check() as ApplyJournalEvent), "first delegate");
  const second = t.mock.fn((_event: JournalEvent) => "second delegate");
  renderer.progressLine = second;
  const event = { type: "state_checked", phase: "before_verify", changed: [], limited: false } as JournalEvent;
  assert.equal(renderer.applyProgressLine(event as ApplyJournalEvent), "second delegate");
  assert.equal(first.mock.callCount(), 1);
  assert.equal(second.mock.callCount(), 1);
  assert.strictEqual(second.mock.calls[0]?.arguments[0], event);
});

for (const language of ["ko", "en"] as const) {
  test(`output family ${language}: summaries observe 2 then 4 checks, a change, and another renderer independently`, () => {
    const catalog = createMessageCatalog(language), a = output.createHumanOutput(catalog), b = output.createHumanOutput(catalog);
    a.progressLine(runStart); b.progressLine(runStart);
    a.progressLine(check()); a.progressLine(check()); b.progressLine(check());
    const count = (n: number): string => catalog.format("summary.integrity_unchanged", { count: n });
    const summary = (renderer: HumanOutput) => rows(renderer.runSummary(result(), CONTEXT));
    assert.ok(summary(a).includes(count(2)));
    a.progressLine(check()); a.progressLine(check());
    assert.ok(summary(a).includes(count(4)));
    assert.ok(!summary(a).includes(count(2)));
    assert.ok(summary(b).includes(count(1)));
    a.progressLine(check(["changed.txt"]));
    assert.ok(!summary(a).some(line => [1, 2, 4, 5].some(n => line === count(n))));
    assert.ok(summary(b).includes(count(1)), "one renderer's changed flag must not suppress another's summary");
  });

  // OFG-2 ko/en coverage moved to gui/tests/unit/ofg2-host-routing.test.ts: it executes the real GUI host factory.

  test(`output family ${language}: revert groups keep the exact 20/21 boundary and hide unavailable paths`, () => {
    const renderer = output.createHumanOutput(createMessageCatalog(language));
    for (const size of [20, 21]) {
      const reverted = Array.from({ length: size }, (_, i) => ({ path: `restored-${i}.txt`, action: "restored" }));
      const skipped = Array.from({ length: size }, (_, i) => ({ path: `RAW-NOT-SHOWN-${i}.txt`, reason: "missing_record" }));
      const text = renderer.revertSummary(revert({ reverted, skipped })), lines = rows(text);
      assert.equal(lines.filter(line => line === "  … (+1)").length, size === 21 ? 2 : 0);
      assert.equal(lines.filter(line => line.includes("  ? — ")).length, 20);
      assert.ok(!text.includes("RAW-NOT-SHOWN-"));
      const shown = lines.filter(line => line.startsWith("  restored-"));
      assert.equal(shown.length, 20);
      for (let i = 0; i < 20; i++) assert.ok(shown[i]?.startsWith(`  restored-${i}.txt — `));
      assert.ok(!text.includes("restored-20.txt"));
    }
  });

  test(`output family ${language}: mixed-width catalog headers align without sorting input rows`, () => {
    const real = createMessageCatalog(language);
    const catalog: MessageCatalog = {
      language,
      format: ((id: MessageId, ...args: unknown[]): CatalogText => {
        if (id === "runs.column.run_id") return `${"가".repeat(13)}e\u0301` as CatalogText; // 27 columns
        if (id === "runs.column.started_local") return `${"시".repeat(10)}e\u0301` as CatalogText; // 21 columns
        if (id === "runs.column.changes") return "수e\u0301" as CatalogText; // 3 columns
        return Reflect.apply(real.format, real, [id, ...args]) as CatalogText;
      }) as MessageCatalog["format"],
    };
    const ids = [RUN, OTHER_RUN, "20261113T035506Z-00000002"];
    const listing = {
      schemaVersion: 1, kind: "runs", status: "listed", exitCode: 0, omitted: 0,
      runs: ids.map(runId => ({ state: "checked", runId, startedAt: "2026-11-13T04:05:06.000Z", taskId: "unshown", status: "done", reason: "verified", changes: 7, reverted: null, revertRecordDamaged: false })),
    } as unknown as RunsOutput;
    const lines = rows(output.createHumanOutput(catalog).runsText(listing));
    assert.equal(lines.length, 4);
    for (const [i, id] of ids.entries()) {
      const line = lines[i + 1]; assert.ok(line);
      assert.ok(line.startsWith(id), "the renderer must retain the supplied order");
      assert.equal(line.indexOf("2026-"), 29, "27 display columns, then two separators");
      assert.equal(line[52], "7", "21 date columns, then two separators");
      assert.ok(line.startsWith(real.format("status.done"), 57), "3 count columns, then two separators");
    }
  });

  test(`output family ${language}: plan, review and malformed summaries reuse helpers without stale output`, () => {
    const { catalog, calls } = traced(language), renderer = output.createHumanOutput(catalog);
    const plan = renderer.runSummary(result({ status: "needs-input", reason: "plan_pending", plan: { kind: "moves", actions: 2, digest: DIGEST }, planSummary: "PLAN-FAMILY" }), CONTEXT);
    assert.ok(rows(plan).some(line => line.startsWith("  | ") && line.includes("PLAN-FAMILY")));
    assert.ok(plan.includes(DIGEST));
    assert.ok(calls.some(call => call.id === "summary.plan_ready"));
    calls.length = 0;
    const review = renderer.runSummary(result({ status: "needs-input", reason: "awaiting_review", review: { checklist: [PRIVATE_REVIEW_ITEM, "REVIEW-FAMILY\u0007"] } }), CONTEXT);
    assert.ok(calls.some(call => call.id === "review.item.no_identifying_values"));
    assert.ok(calls.some(call => call.id === "summary.review_checklist"));
    assert.ok(!review.includes("\u0007") && review.includes("REVIEW-FAMILY"));
    assert.ok(!review.includes("PLAN-FAMILY") && !review.includes(DIGEST));
    calls.length = 0;
    const malformed = renderer.runSummary(result({ status: "invalid", reason: "invalid", runId: "invalid", changes: null, verifiers: null, plan: { actions: -1, digest: "UNTRUSTED-DIGEST" }, review: { checklist: {} } }), CONTEXT);
    assert.ok(!malformed.includes("UNTRUSTED-DIGEST"));
    assert.ok(!calls.some(call => call.id === "summary.plan_ready" || call.id === "summary.review_checklist" || call.id.startsWith("advice.")));
    const clean = rows(renderer.runSummary(result(), { ...CONTEXT, lockLeft: true }));
    const at = clean.indexOf(catalog.format("lock.release_failed"));
    assert.ok(at > 0);
    assert.equal(clean[at - 1], catalog.format("advice.verified"));
    assert.equal(clean[at + 1], catalog.format("summary.run_id", { runId: toRunId(RUN)! }));
    assert.ok(!clean.some(line => line.includes("PLAN-FAMILY") || line.includes("REVIEW-FAMILY")));
  });
}
