/**
 * G-A: plan, apply, review, data checks and inventory contracts, with the R-1 decisions
 * (DR-1, DR-5, DR-6, DR-9). Mostly fixed lists and their consistency with the existing contract
 * lists (reasons, error codes, message ids, state file names); a few shape rules are checked at
 * compile time.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AGGREGATE_OPS,
  APPROVAL_CHANNELS,
  BUILTIN_WORKFLOW_IDS,
  CLI_ERROR_EXIT_CODES,
  COMPLETION_MODES,
  CONFIGURABLE_VERIFIER_KINDS,
  DEFAULT_DATA_TOLERANCE,
  DISCARDED_DIR_NAME,
  FIXED_MESSAGES,
  INVENTORY_VERIFIER_ID,
  JOURNAL_FILE_NAME,
  LOCK_FILE_NAME,
  MAX_DATA_TABLE_BYTES,
  MAX_INTEGRITY_FILES,
  MAX_INVENTORY_FILES,
  MAX_PLAN_ACTIONS,
  MAX_PLAN_SOURCE_BYTES,
  MAX_REVIEW_NOTE_CHARS,
  MAX_WORKFLOWS,
  MESSAGE_IDS,
  MIN_PLAN_DIGEST_PREFIX,
  PLAN_ACTION_KINDS,
  PLAN_APPLIED_FILE_NAME,
  PLAN_EXIT_CODES,
  PLAN_FILE_NAME,
  PLAN_ITEM_PROBLEMS,
  PLAN_MODES,
  PLAN_PROBLEMS,
  PLAN_STATUSES,
  POLICY_DENIAL_CODES,
  QUICK_TASK_WORKFLOW,
  QUICK_WORKFLOW_ARGUMENT,
  RESULT_FILE_NAME,
  REVERT_ACTIONS,
  REVERT_RECORD_FILE_NAME,
  REVERT_SKIP_REASONS,
  REVIEW_EXIT_CODES,
  REVIEW_FILE_NAME,
  REVIEW_VERDICTS,
  RUN_EXIT_CODES,
  RUN_REASONS,
  RUN_REASONS_BY_STATUS,
  APPLY_REASONS_BY_STATUS,
  UNSAFE_MOVE_CONSENT_ARGUMENT,
  DISCARDED_STORED_NAME_PATTERN_SOURCE,
  discardedStoredName,
  isReasonOfStatus,
  RUNS_DIR_NAME,
  SNAPSHOTS_DIR_NAME,
  STATE_DIR_NAME,
  TABLE_FORMATS,
  TERMINAL_RUN_STATUSES,
  TOOL_ERROR_CODES,
  VERIFIER_KINDS,
  WORKFLOW_ID_PATTERN_SOURCE,
  WORKFLOW_PROBLEMS,
} from "../../../src/contracts/index.js";
import type {
  RevertOutcome,
  RevertOutput,
  RevertRecord,
  RevertRequest,
  RevertedFile,
  ApplyJournalEntry,
  ApplyJournalEvent,
  ContentHash,
  MaskedText,
  ApplyResult,
  ApplySummaryContext,
  CodarynConfig,
  ConfigProfile,
  CreatePlanExecutor,
  HumanOutput,
  PolicyConfig,
  RunId,
  RunListEntry,
  TaskSpec,
  WorkflowDefinition,
  EngineResult,
  JournalEvent,
  ModelRequest,
  ReviewRecord,
  RunReasonByStatus,
  StoredPlan,
  VerifierConfig,
} from "../../../src/contracts/index.js";
import { isKeyFieldName } from "../../../src/cli/security/keys.js";

// Compile-time checks. A failing one breaks the build, so each line documents a rule.
/** DR-5: plan.json holds actions and source hashes only. */
type StoredPlanKeys = keyof StoredPlan;
const storedPlanKeys: Record<StoredPlanKeys, true> = { schemaVersion: true, kind: true, runId: true, actions: true };
/** The new reasons belong to these statuses. */
const pending: RunReasonByStatus["needs-input"] = "plan_pending";
const review: RunReasonByStatus["needs-input"] = "awaiting_review";
const stale: RunReasonByStatus["failed"] = "plan_stale";
const incomplete: RunReasonByStatus["failed"] = "apply_incomplete";
/** A run journal has no apply record; JournalEvent's types are unchanged (cli/progress.ts switches over them). */
type ApplyOnly = Extract<JournalEvent["type"], "apply_started" | "plan_checked" | "file_moved" | "file_discarded" | "plan_item_failed">;
const noApplyRecordInRunJournal: [ApplyOnly] extends [never] ? true : false = true;
/** An apply journal shares the end record with runs. */
const sharedEnd: Extract<ApplyJournalEvent, { type: "run_finished" }>["type"] = "run_finished";
/** `inventory` cannot be configured in a task. */
type ConfiguredInventory = Extract<VerifierConfig["kind"], "inventory">;
const inventoryNotConfigurable: [ConfiguredInventory] extends [never] ? true : false = true;
/** A model request without workflow tools is still a valid request (legacy shape). */
const legacyRequest: ModelRequest = { system: "" as ModelRequest["system"], messages: [], tools: ["read_file"] };
/** The renderer's apply methods take the apply records and result; optional until N-C adds them. */
const renderer: Pick<HumanOutput, "applyProgressLine" | "applySummary"> = {
  applyProgressLine: (event: ApplyJournalEvent) => (event.type === "file_moved" ? "moved\n" : null),
  applySummary: (_result: ApplyResult, context: ApplySummaryContext) => `${context.workspaceForm}\n`,
};
const noRenderer: Pick<HumanOutput, "applyProgressLine" | "applySummary"> = {};
void [renderer, noRenderer];
/** G-C's factory shape: an executor is made from the workspace, its real root and the apply run id. */
const makeExecutor: CreatePlanExecutor = ({ workspace, workspaceRoot, runId }) => {
  void [workspace, workspaceRoot, runId];
  return { check: async () => null, apply: async () => ({ ok: false, problem: "io_error" }) };
};
void makeExecutor;
/** DR-21: consent comes only from a person; no file or definition can carry it. */
type HasConsentField<T> = "unsafeMoveConsent" extends keyof T ? true : "allowUnsafeMove" extends keyof T ? true : false;
const noConsentInFiles: [
  HasConsentField<TaskSpec>,
  HasConsentField<CodarynConfig>,
  HasConsentField<ConfigProfile>,
  HasConsentField<WorkflowDefinition>,
  HasConsentField<PolicyConfig>,
  HasConsentField<StoredPlan>,
] = [false, false, false, false, false, false];
/**
 * The run list tells apply runs apart; an entry written before G-A (no kind) still type-checks.
 * Only the fields this check is about are picked, so fields other owners add to the entry (for
 * example N-23 g) do not make it fail.
 */
type ListEntryFields = Pick<
  Extract<RunListEntry, { state: "checked" }>,
  "state" | "runId" | "kind" | "planRunId" | "startedAt" | "taskId" | "status" | "reason" | "changes" | "reverted"
>;
const applyEntry: ListEntryFields = {
  state: "checked",
  runId: "20261112T120500Z-0000bbbb" as RunId,
  kind: "apply",
  planRunId: "20261112T120000Z-0000aaaa" as RunId,
  startedAt: "2026-11-12T12:05:00Z",
  taskId: "tidy",
  status: "needs-input",
  reason: "consent_required",
  changes: 0,
  reverted: null,
};
const legacyEntry: ListEntryFields = {
  state: "checked",
  runId: "20261112T120000Z-0000aaaa" as RunId,
  startedAt: "2026-11-12T12:00:00Z",
  taskId: "t",
  status: "done",
  reason: "verified",
  changes: 1,
  reverted: null,
};
/** R-9 I-4: the start record is an apply journal entry, not a shown record (progress stays as it is). */
type StartIsShown = Extract<ApplyJournalEvent, { type: "plan_item_started" }> extends never ? false : true;
const startNotShown: StartIsShown = false;
const startEntry: ApplyJournalEntry = {
  type: "plan_item_started",
  index: 0,
  action: { kind: "discard", path: "b.tmp" as MaskedText, sha256: "a".repeat(64) as ContentHash },
};
/** DR-25: a revert request carries the person's consent for that run; the outcome and record say what was unsafe. */
const revertWithConsent: RevertRequest = {
  workspaceRoot: "/work",
  runId: "20261112T120500Z-0000bbbb",
  unsafeMoveConsent: { channel: "cli-flag", runId: "20261112T120500Z-0000bbbb" },
};
const revertWithout: RevertRequest = { workspaceRoot: "/work", runId: "20261112T120500Z-0000bbbb" };
const unsafeBack: RevertedFile = { path: "a.jpg", action: "moved_back", from: "2026/a.jpg", unsafe: true };
/** DR-25: a dry run judges no drive and says so; its outcome and output carry the notice. */
const dryRunOutcome: RevertOutcome = {
  reverted: [{ path: "a.jpg", action: "moved_back", from: "2026/a.jpg" }],
  skipped: [],
  moveSafetyUnchecked: true,
};
const dryRunOutput: Pick<RevertOutput, "dryRun" | "moveSafetyUnchecked"> = { dryRun: true, moveSafetyUnchecked: true };
const revertRecord: RevertRecord = {
  schemaVersion: 1,
  kind: "revert_record",
  runId: "20261112T120500Z-0000bbbb",
  at: "2026-11-12T12:10:00Z",
  status: "complete",
  reverted: 1,
  skipped: 0,
  unsafeMoveConsent: "cli-flag",
  unsafeMoves: 1,
};
void [
  noConsentInFiles,
  applyEntry,
  legacyEntry,
  startNotShown,
  startEntry,
  revertWithConsent,
  revertWithout,
  unsafeBack,
  revertRecord,
  dryRunOutcome,
  dryRunOutput,
];
/** R-4 L-4: a review note is masked text; a plain string does not type-check as one. */
// @ts-expect-error a raw note cannot be stored
const rawNote: ReviewRecord["note"] = "typed by a person" as string;
void rawNote;
/** A result as phase 3 wrote it still type-checks: `plan` and `review` are optional. */
const legacyResult: EngineResult = {
  schemaVersion: 1,
  kind: "run",
  runId: "20261112T000000Z-0000abcd",
  taskId: "t",
  status: "done",
  reason: "verified",
  exitCode: 0,
  provider: "scripted",
  verifiers: [],
  changes: [],
  usage: { modelTurns: 1, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 1, repairAttempts: 0 },
  journalPath: ".codaryn/runs/20261112T000000Z-0000abcd/journal.jsonl",
  notices: [],
};
void [storedPlanKeys, pending, review, stale, incomplete, noApplyRecordInRunJournal, sharedEnd, inventoryNotConfigurable, legacyRequest];

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

describe("G-A run reasons and exit codes", () => {
  test("the four new reasons are listed once, and no status is added", () => {
    for (const reason of ["plan_pending", "awaiting_review", "plan_stale", "apply_incomplete"]) {
      assert.equal(RUN_REASONS.filter((listed) => listed === reason).length, 1, reason);
    }
    assert.ok(unique(RUN_REASONS));
    assert.deepEqual([...TERMINAL_RUN_STATUSES], ["done", "failed", "needs-input", "cancelled", "budget-exhausted"]);
    assert.deepEqual(RUN_EXIT_CODES, { done: 0, failed: 1, "needs-input": 3, "budget-exhausted": 4, cancelled: 5 });
  });

  test("DR-16: one table lists every reason under exactly one status, the same reasons as RUN_REASONS", () => {
    assert.deepEqual(Object.keys(RUN_REASONS_BY_STATUS).sort(), [...TERMINAL_RUN_STATUSES].sort());
    const listed = Object.values(RUN_REASONS_BY_STATUS).flat() as string[];
    assert.ok(unique(listed), "no reason under two statuses");
    assert.deepEqual([...listed].sort(), [...RUN_REASONS].sort());
    assert.deepEqual(RUN_REASONS_BY_STATUS["needs-input"].filter((reason) => reason === "plan_pending" || reason === "awaiting_review"), [
      "plan_pending",
      "awaiting_review",
    ]);
    assert.ok(RUN_REASONS_BY_STATUS.failed.includes("plan_stale") && RUN_REASONS_BY_STATUS.failed.includes("apply_incomplete"));
  });

  test("DR-16: isReasonOfStatus answers from the table", () => {
    assert.equal(isReasonOfStatus("needs-input", "plan_pending"), true);
    assert.equal(isReasonOfStatus("done", "plan_pending"), false);
    assert.equal(isReasonOfStatus("failed", "verified"), false);
    assert.equal(isReasonOfStatus("done", "verified"), true);
    assert.equal(isReasonOfStatus("cancelled", "toString"), false);
  });

  test("the new CLI errors are input errors (exit code 2)", () => {
    for (const code of ["run_not_plan", "plan_not_approved", "plan_already_applied", "run_not_awaiting_review"] as const) {
      assert.equal(CLI_ERROR_EXIT_CODES[code], 2, code);
    }
  });

  test("plan and review commands exit 0 for every status they report", () => {
    assert.deepEqual(PLAN_EXIT_CODES, { pending: 0, applied: 0 });
    assert.deepEqual([...PLAN_STATUSES], ["pending", "applied"]);
    assert.deepEqual(REVIEW_EXIT_CODES, { accepted: 0, rejected: 0 });
    assert.deepEqual([...REVIEW_VERDICTS], ["accepted", "rejected"]);
  });

  test("a legacy EngineResult needs neither plan nor review", () => {
    assert.equal(Object.hasOwn(legacyResult, "plan") || Object.hasOwn(legacyResult, "review"), false);
  });
});

describe("G-A codes and the message catalog", () => {
  test("a refused plan is a tool error and a denied plan action a policy denial", () => {
    assert.ok((TOOL_ERROR_CODES as readonly string[]).includes("invalid_plan"));
    assert.ok((POLICY_DENIAL_CODES as readonly string[]).includes("plan_action_not_allowed"));
    assert.ok(unique(TOOL_ERROR_CODES));
    assert.ok(unique(POLICY_DENIAL_CODES));
  });

  test("message ids cover the new reasons, error codes and revert skip reason", () => {
    const ids = new Set<string>(MESSAGE_IDS);
    for (const reason of ["plan_pending", "awaiting_review", "plan_stale", "apply_incomplete"]) {
      assert.ok(ids.has(`reason.${reason}`) && ids.has(`advice.${reason}`), reason);
    }
    for (const code of ["run_not_plan", "plan_not_approved", "plan_already_applied", "run_not_awaiting_review"]) {
      assert.ok(ids.has(`error.${code}.what`) && ids.has(`error.${code}.fix`), code);
    }
    assert.ok(ids.has("revert.skip.original_path_taken"));
    assert.ok(unique(MESSAGE_IDS));
  });

  test("apply runs, plan runs and review have their messages; approval channels and item problems are listed ids", () => {
    const ids = new Set<string>(MESSAGE_IDS);
    for (const channel of APPROVAL_CHANNELS) assert.ok(ids.has(`approval.${channel}`), channel);
    for (const problem of PLAN_ITEM_PROBLEMS) assert.ok(ids.has(`plan.problem.${problem}`), problem);
    const expected: Record<string, Record<string, string>> = {
      "summary.form.task": {},
      "summary.form.given": {},
      "summary.form.current": {},
      "summary.plan_ready": { actions: "count" },
      "summary.next_plan": { form: "text", runId: "runId" },
      "summary.next_apply": { form: "text", runId: "runId" },
      "summary.review_checklist": { count: "count" },
      "summary.next_review": { form: "text", runId: "runId" },
      "summary.apply_actions": { applied: "count", total: "count" },
      "summary.apply_plan_run": { runId: "runId" },
      "progress.apply_started": { actions: "count", approval: "text" },
      "progress.plan_checked": { count: "count" },
      "progress.plan_item_problem": { number: "count", problem: "text" },
      "progress.inventory_limit": {},
      "progress.file_moved": { number: "count" },
      "progress.file_discarded": { number: "count" },
      "progress.plan_item_failed": { number: "count", problem: "text" },
    };
    for (const [id, params] of Object.entries(expected)) {
      assert.ok(ids.has(id), id);
      assert.deepEqual(FIXED_MESSAGES[id as keyof typeof FIXED_MESSAGES], params, id);
    }
  });

  test("every revert action has its fixed message without parameters", () => {
    assert.deepEqual([...REVERT_ACTIONS], ["restored", "deleted", "moved_back", "restored_from_discard"]);
    for (const action of REVERT_ACTIONS) {
      const id = `revert.action.${action}`;
      assert.ok(Object.hasOwn(FIXED_MESSAGES, id), id);
      assert.deepEqual(FIXED_MESSAGES[id as keyof typeof FIXED_MESSAGES], {}, id);
    }
    assert.ok((REVERT_SKIP_REASONS as readonly string[]).includes("original_path_taken"));
    assert.ok(unique(REVERT_SKIP_REASONS));
  });
});

describe("G-A plan contract", () => {
  test("plan modes are P0 only; P1's run mode is not part of the contract", () => {
    assert.deepEqual([...PLAN_MODES], ["none", "apply"]);
    assert.deepEqual([...PLAN_ACTION_KINDS], ["move", "discard"]);
  });

  test("DR-21: unsafe moves need consent; the apply reasons are a subset of the run reasons", () => {
    assert.ok((RUN_REASONS as readonly string[]).includes("consent_required"));
    assert.ok((RUN_REASONS_BY_STATUS["needs-input"] as readonly string[]).includes("consent_required"));
    for (const [status, reasons] of Object.entries(APPLY_REASONS_BY_STATUS)) {
      const all = RUN_REASONS_BY_STATUS[status as keyof typeof RUN_REASONS_BY_STATUS] as readonly string[];
      for (const reason of reasons) assert.ok(all.includes(reason), `${status}/${reason}`);
    }
    assert.deepEqual(Object.keys(APPLY_REASONS_BY_STATUS).sort(), Object.keys(RUN_REASONS_BY_STATUS).sort());
    assert.equal(UNSAFE_MOVE_CONSENT_ARGUMENT, "--allow-unsafe-move");
    const params: Record<string, Record<string, string>> = {
      "progress.unsafe_moves": { count: "count" },
      "progress.unsafe_move_consent": { approval: "text" },
      "summary.unsafe_moves": { count: "count" },
      "summary.next_apply_unsafe": { form: "text", runId: "runId" },
      "progress.plan_checked": { count: "count" },
    };
    for (const [id, expected] of Object.entries(params)) {
      assert.deepEqual(FIXED_MESSAGES[id as keyof typeof FIXED_MESSAGES], expected, id);
    }
  });

  test("DR-24 (a): a discarded file's stored name is its action index in decimal, one segment", () => {
    const pattern = new RegExp(DISCARDED_STORED_NAME_PATTERN_SOURCE);
    for (const index of [0, 1, 9, 10, 999]) {
      assert.equal(discardedStoredName(index), String(index));
      assert.ok(pattern.test(discardedStoredName(index)), String(index));
    }
    for (const bad of ["", "0001", "01", "-1", "1.5", "sub/1", "1/2", "..", "a", " 1", "1\\2"]) {
      assert.equal(pattern.test(bad), false, JSON.stringify(bad));
    }
  });

  test("DR-24 (b): a revert that could move a file back only unsafely skips it with its own reason", () => {
    assert.ok((REVERT_SKIP_REASONS as readonly string[]).includes("unsafe_move"));
    assert.ok((MESSAGE_IDS as readonly string[]).includes("revert.skip.unsafe_move"));
  });

  test("DR-25: a revert has the same consent path; its messages say what was moved unsafely and how to consent", () => {
    assert.deepEqual(FIXED_MESSAGES["revert.unsafe_moved"], { count: "count" });
    assert.deepEqual(FIXED_MESSAGES["summary.next_revert_unsafe"], { runId: "runId" });
    assert.deepEqual(FIXED_MESSAGES["revert.dry_run_move_unchecked"], {});
    for (const id of ["revert.unsafe_moved", "summary.next_revert_unsafe", "revert.skip.unsafe_move", "revert.dry_run_move_unchecked"]) {
      assert.ok((MESSAGE_IDS as readonly string[]).includes(id), id);
    }
  });

  test("DR-18 (b): a move the file system cannot make without risk of replacing a file has its own problem code", () => {
    assert.ok((PLAN_ITEM_PROBLEMS as readonly string[]).includes("unsafe_move"));
    assert.ok((MESSAGE_IDS as readonly string[]).includes("plan.problem.unsafe_move"));
  });

  test("problem and channel lists have no duplicates", () => {
    for (const list of [PLAN_PROBLEMS, PLAN_ITEM_PROBLEMS, APPROVAL_CHANNELS, WORKFLOW_PROBLEMS]) {
      assert.ok(unique(list), list.join(","));
    }
    assert.deepEqual([...APPROVAL_CHANNELS], ["cli-tty", "cli-flag", "adapter"]);
  });

  test("limits are positive and the digest prefix fits a SHA-256", () => {
    for (const value of [MAX_PLAN_ACTIONS, MAX_PLAN_SOURCE_BYTES, MAX_WORKFLOWS, MAX_REVIEW_NOTE_CHARS]) {
      assert.ok(Number.isSafeInteger(value) && value > 0, String(value));
    }
    assert.ok(MIN_PLAN_DIGEST_PREFIX >= 12 && MIN_PLAN_DIGEST_PREFIX <= 64);
  });

  test("state file names do not collide with the existing ones", () => {
    const names = [
      PLAN_FILE_NAME,
      PLAN_APPLIED_FILE_NAME,
      REVIEW_FILE_NAME,
      REVERT_RECORD_FILE_NAME,
      RESULT_FILE_NAME,
      JOURNAL_FILE_NAME,
      LOCK_FILE_NAME,
      SNAPSHOTS_DIR_NAME,
    ];
    assert.ok(unique(names), names.join(","));
  });

  test("DR-9: the discarded files live beside the runs directory, not inside a run", () => {
    assert.notEqual(DISCARDED_DIR_NAME, RUNS_DIR_NAME);
    assert.notEqual(DISCARDED_DIR_NAME, SNAPSHOTS_DIR_NAME);
    assert.notEqual(DISCARDED_DIR_NAME, STATE_DIR_NAME);
  });
});

describe("G-A workflow ids", () => {
  test("built-in ids match the id pattern, are unique and include the quick form's label", () => {
    const pattern = new RegExp(WORKFLOW_ID_PATTERN_SOURCE);
    for (const id of BUILTIN_WORKFLOW_IDS) assert.ok(pattern.test(id), id);
    assert.ok(unique(BUILTIN_WORKFLOW_IDS));
    assert.ok((BUILTIN_WORKFLOW_IDS as readonly string[]).includes(QUICK_TASK_WORKFLOW));
    assert.deepEqual([...COMPLETION_MODES], ["verifiers", "human_review"]);
  });

  test("DR-2: the quick form names a definition with --workflow", () => {
    assert.equal(QUICK_WORKFLOW_ARGUMENT, "--workflow");
  });

  test("no new task or config field name reads as a key field (S-6)", () => {
    const fields = [
      "workflowRef", "tools", "instructions", "plan", "completion", "humanReview", "checklist",
      "allowCommands", "label", "workflows", "planActions", "summary", "actions", "from", "to",
      "after", "hash", "rules", "table", "columns", "columnsMatch", "rows", "equals", "min", "max",
      "sameAs", "source", "column", "op", "groupBy", "target", "targetColumn", "targetKeyColumn",
      "tolerance", "absolute", "relative", "format",
    ];
    for (const field of fields) assert.equal(isKeyFieldName(field), false, field);
  });
});

describe("G-A verifier contract", () => {
  test("inventory is a verifier kind but not a configurable one", () => {
    assert.deepEqual([...VERIFIER_KINDS], ["command", "file_rules", "data_checks", "inventory"]);
    assert.deepEqual([...CONFIGURABLE_VERIFIER_KINDS], ["command", "file_rules", "data_checks"]);
    assert.equal(INVENTORY_VERIFIER_ID, "inventory");
  });

  test("DR-6: the inventory has its own limit, above the integrity list's", () => {
    assert.ok(Number.isSafeInteger(MAX_INVENTORY_FILES) && MAX_INVENTORY_FILES > MAX_INTEGRITY_FILES);
  });

  test("data checks: formats, operations, tolerance and size limit", () => {
    assert.deepEqual([...TABLE_FORMATS], ["csv", "tsv", "jsonl"]);
    assert.deepEqual([...AGGREGATE_OPS], ["sum", "count", "min", "max", "mean"]);
    assert.ok(DEFAULT_DATA_TOLERANCE.absolute >= 0 && DEFAULT_DATA_TOLERANCE.relative >= 0);
    assert.ok(Number.isSafeInteger(MAX_DATA_TABLE_BYTES) && MAX_DATA_TABLE_BYTES > 0);
  });
});
