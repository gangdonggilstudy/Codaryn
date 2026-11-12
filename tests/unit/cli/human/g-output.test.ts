/**
 * G-A renderer parts (8723c10): plan runs and human review in runSummary, applyProgressLine and
 * applySummary. A strict stand-in catalog checks every parameter against the contract; the real
 * catalogs check that every text is accepted (no "?") in both languages. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_IDS, MESSAGE_LANGUAGES, messageParams, toRunId } from "../../../../src/contracts/index.js";
import type {
  ApplyJournalEvent,
  ApplyResult,
  CatalogText,
  ContentHash,
  EngineResult,
  HumanOutput,
  MaskedText,
  MessageCatalog,
  MessageId,
  RunId,
  RunSummaryContext,
} from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";

const SECRET = "fake-secret-GA-VALUE-0001";
const RUN = toRunId("20260102T030405Z-0a1b2c3d") as RunId;
const PLAN_RUN = toRunId("20260102T030300Z-00000000") as RunId;
const DIGEST = "d".repeat(64) as ContentHash;
const HASH = "a".repeat(64) as ContentHash;
const masked = (text: string): MaskedText => text as MaskedText;

/** Renders `[id k=v]`; throws unless the parameters are exactly the declared names. */
function stand_in(): MessageCatalog {
  const known = new Set<string>(MESSAGE_IDS);
  return {
    language: "en",
    format(id: MessageId, params?: Record<string, unknown>): CatalogText {
      if (!known.has(id)) throw new Error(`unknown id ${id}`);
      assert.deepEqual(Object.keys(params ?? {}).sort(), Object.keys(messageParams(id)).sort(), id);
      return `[${id}${Object.entries(params ?? {}).map(([k, v]) => ` ${k}=${String(v)}`).join("")}]` as CatalogText;
    },
  } as MessageCatalog;
}

const CONTEXT: RunSummaryContext = { workspaceForm: "given", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, policySource: "task" };

function engineResult(extra: Partial<EngineResult>): EngineResult {
  return {
    schemaVersion: 1,
    kind: "run",
    runId: RUN,
    taskId: "organize-task",
    status: "needs-input",
    reason: "plan_pending",
    exitCode: 3,
    provider: "scripted",
    verifiers: [],
    changes: [],
    usage: { modelTurns: 2, toolCalls: 3, inputTokens: null, outputTokens: null, durationMs: 1200 },
    journalPath: "x",
    notices: [masked(SECRET)],
    ...extra,
  };
}

function applyResult(extra: Partial<ApplyResult> = {}): ApplyResult {
  return {
    schemaVersion: 1,
    kind: "apply",
    runId: RUN,
    planRunId: PLAN_RUN,
    taskId: "organize-task",
    digest: DIGEST,
    status: "done",
    reason: "verified",
    exitCode: 0,
    applied: [
      { index: 0, action: { kind: "move", from: masked("inbox/a.pdf"), to: masked("docs/a.pdf"), sha256: HASH }, stored: null },
      { index: 1, action: { kind: "discard", path: masked("inbox/old.log"), sha256: HASH }, stored: "1" },
    ],
    verifiers: [{ id: `inv-${SECRET}`, kind: "inventory", outcome: "pass", evidence: masked(""), checked: [], limits: [] }] as never,
    usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 300 },
    journalPath: "x",
    notices: [],
    ...extra,
  };
}

const APPLY_EVENTS: [ApplyJournalEvent, string | null][] = [
  [
    { type: "apply_started", schemaVersion: 1, planRunId: PLAN_RUN, taskId: "t", digest: DIGEST, approval: "cli-flag", actions: 2, maxDurationMs: 1000 },
    "[progress.apply_started actions=2 approval=[approval.cli-flag]]",
  ],
  [{ type: "plan_checked", problems: [], inventoryLimitReached: false }, "[progress.plan_checked count=0]"],
  [
    { type: "plan_checked", problems: [{ index: 0, problem: "source_changed" }, { index: 3, problem: "destination_exists" }], inventoryLimitReached: true },
    "[progress.plan_checked count=2] · [progress.plan_item_problem number=1 problem=[plan.problem.source_changed]] (source_changed) · [progress.plan_item_problem number=4 problem=[plan.problem.destination_exists]] (destination_exists) · [progress.inventory_limit]",
  ],
  [{ type: "file_moved", index: 0, from: masked("inbox/a.pdf"), to: masked("docs/a.pdf"), sha256: HASH }, "[progress.file_moved number=1] inbox/a.pdf → docs/a.pdf"],
  [{ type: "file_discarded", index: 1, path: masked("inbox/old.log"), stored: "1", sha256: HASH }, "[progress.file_discarded number=2] inbox/old.log"],
  [{ type: "plan_item_failed", index: 1, problem: "io_error" }, "[progress.plan_item_failed number=2 problem=[plan.problem.io_error]] (io_error)"],
  [{ type: "integrity_checked", phase: "before_verify", changed: [] }, "[progress.integrity_unchanged phase=before_verify]"],
  [
    { type: "run_finished", status: "failed", reason: "apply_incomplete", usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 1 } },
    "[progress.finished status=[status.failed] reason=apply_incomplete]",
  ],
];

describe("runSummary for plan runs and human review (G-A)", () => {
  test("a plan run says how many actions wait, how to see and apply them, with the digest to copy", () => {
    const text = createHumanOutput(stand_in()).runSummary(engineResult({ plan: { digest: DIGEST, actions: 3 } }), CONTEXT);
    const lines = text.trimEnd().split("\n");
    assert.equal(lines[1], "[summary.plan_ready actions=3]", "said right after the heading");
    const apply = lines.indexOf(`[summary.next_apply form=[summary.form.given] runId=${RUN}]`);
    assert.ok(lines.includes(`[summary.next_plan form=[summary.form.given] runId=${RUN}]`), text);
    assert.ok(apply > 0, text);
    assert.equal(lines[apply + 1], `  ${DIGEST}`, "the digest follows as an item");
    assert.equal(text.includes("next_revert"), false, "a plan run changed no file");
    assert.equal(text.includes(SECRET), false);
  });

  test("a run awaiting review lists the checklist as items and says how to record a verdict", () => {
    const checklist = [masked("The summary names every source"), masked(`no \u001b control ${"sk-ant-"}FAKEfake0000FAKEfake0000`)];
    const text = createHumanOutput(stand_in()).runSummary(engineResult({ reason: "awaiting_review", review: { checklist } }), { ...CONTEXT, workspaceForm: "current" });
    const lines = text.trimEnd().split("\n");
    const head = lines.indexOf("[summary.review_checklist count=2]");
    assert.ok(head > 0, text);
    assert.equal(lines[head + 1], "  - The summary names every source");
    assert.equal(lines[head + 2], "  - no ? control [key]");
    assert.ok(lines.includes(`[summary.next_review form=[summary.form.current] runId=${RUN}]`), text);
  });

  test("a digest that is not 64 lowercase hex characters is not printed", () => {
    const text = createHumanOutput(stand_in()).runSummary(engineResult({ plan: { digest: SECRET as ContentHash, actions: 1 } }), CONTEXT);
    assert.equal(text.includes(SECRET), false);
  });
});

describe("applyProgressLine (G-A)", () => {
  test("words first, codes in parentheses, actions by number, masked paths as items", () => {
    const human = createHumanOutput(stand_in());
    for (const [event, expected] of APPLY_EVENTS) assert.equal(human.applyProgressLine?.(event), expected, event.type);
  });

  test("values outside their lists give no line", () => {
    const human = createHumanOutput(stand_in());
    assert.equal(human.applyProgressLine?.({ type: "apply_started", schemaVersion: 1, planRunId: PLAN_RUN, taskId: "t", digest: DIGEST, approval: SECRET as never, actions: 2, maxDurationMs: 1 }), null);
    assert.equal(human.applyProgressLine?.({ type: "plan_item_failed", index: 1, problem: SECRET as never }), null);
  });
});

describe("applySummary (G-A)", () => {
  test("a complete apply: status, actions applied of the total, the plan run, checks, run id, report and revert", () => {
    const text = createHumanOutput(stand_in()).applySummary?.(applyResult(), { workspaceForm: "task" }) ?? "";
    const lines = text.trimEnd().split("\n");
    assert.equal(lines[0], "── [summary.result status=[status.done] reason=[reason.verified]] (done/verified) ──");
    assert.ok(lines.includes("[summary.apply_actions applied=2 total=2]"), text);
    assert.ok(lines.includes(`[summary.apply_plan_run runId=${PLAN_RUN}]`));
    assert.ok(lines.includes("  [progress.file_moved number=1] inbox/a.pdf → docs/a.pdf"), text);
    assert.ok(lines.includes("  [progress.file_discarded number=2] inbox/old.log"), text);
    assert.ok(lines.includes("[summary.verifiers passed=1 total=1]"));
    assert.ok(lines.includes(`[summary.next_revert runId=${RUN}]`), text);
    assert.equal(text.includes(SECRET), false, "verifier ids are not shown");
  });

  test("a partial apply lists what was done and says how to revert it, without claiming a total", () => {
    const text = createHumanOutput(stand_in()).applySummary?.(applyResult({ status: "failed", reason: "apply_incomplete", exitCode: 1, verifiers: [], applied: applyResult().applied.slice(0, 1) }), { workspaceForm: "current" }) ?? "";
    assert.equal(text.includes("summary.apply_actions"), false, text);
    assert.ok(text.includes("  [progress.file_moved number=1] inbox/a.pdf → docs/a.pdf\n"));
    assert.ok(text.includes(`[summary.next_revert_here runId=${RUN}]`), text);
    const stale = createHumanOutput(stand_in()).applySummary?.(applyResult({ status: "failed", reason: "plan_stale", exitCode: 1, verifiers: [], applied: [] }), { workspaceForm: "given" }) ?? "";
    assert.equal(stale.includes("next_revert"), false, "nothing was moved");
  });
});

describe("plan, review and apply output with the real catalogs", () => {
  for (const language of MESSAGE_LANGUAGES) {
    test(`${language}: every new text is accepted, so no ? stands in for a value`, () => {
      const human: HumanOutput = createHumanOutput(createMessageCatalog(language));
      const texts = [
        human.runSummary(engineResult({ plan: { digest: DIGEST, actions: 3 } }), CONTEXT),
        human.runSummary(engineResult({ reason: "awaiting_review", review: { checklist: [masked("check one")] } }), CONTEXT),
        ...APPLY_EVENTS.map(([event]) => `${human.applyProgressLine?.(event) ?? ""}\n`),
        human.applySummary?.(applyResult(), { workspaceForm: "task" }) ?? "",
        human.applySummary?.(applyResult({ status: "failed", reason: "apply_incomplete", exitCode: 1, verifiers: [] }), { workspaceForm: "given" }) ?? "",
      ].join("");
      assert.equal(/(^|[\s(—:])\?([\s)—:,]|$)/m.test(texts), false, texts);
      assert.equal(texts.includes(SECRET), false);
    });
  }
});
