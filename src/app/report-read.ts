/**
 * U-311 (CLI migration C-8; plan docs/reviews/2026-11-13-cli-migration-plan.md): the report's reading
 * and checks, the app layer's now: a run's journal summary and its failed calls (summarizeJournal,
 * failedCallsIn), its result read and checked field by field (readResult), an apply run's journal
 * summary and result (summarizeApplyJournal, readApplyResult), the first record's type, and the run
 * files' state and reading under MAX_REPORT_FILE_BYTES. A record that fails a check is a RecordError,
 * whose message is fixed text. The text below is as it was in src/cli/report.ts, but for: the names
 * the CLI's report command and rendering use are exported. ReportReadEnvironment holds the fields of
 * the CLI's ReportEnvironment the report's rules read (their comments as they were); the CLI's widens
 * it with argv and env. The CLI keeps the rendering and the fixed texts; its old place re-exports what
 * the tests and the app layer take (plan A).
 */

import { realpath as realpathCallback } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  APPLY_NOTICE_KINDS,
  MODEL_ERROR_KINDS,
  PLAN_RECORDS_UNCHECKED_CAUSES,
  APPROVAL_CHANNELS,
  CONTENT_HASH_PATTERN_SOURCE,
  INTEGRITY_PHASES,
  MAX_EVIDENCE_BYTES,
  MAX_REPORT_FILE_BYTES,
  MODEL_PROVIDER_NAMES,
  PLAN_ITEM_PROBLEMS,
  toRunId,
  RESULT_SCHEMA_VERSION,
  TERMINAL_RUN_STATUSES,
  VERIFIER_KINDS,
  isReasonOfStatus,
} from "../contracts/index.js";
import type {
  AppliedActionRecord,
  ApplyReportJournalSummary,
  ApplyNoticeKind,
  PlanRecordsUncheckedCause,
  ApplyResult,
  ListRuns,
  ContentHash,
  EngineResult,
  FileChangeRecord,
  IntegrityPhase,
  Limits,
  MaskedPlanAction,
  MaskedText,
  ModelProviderName,
  PlanItemProblem,
  ReportJournalSummary,
  RunReason,
  RunUsage,
  TerminalRunStatus,
  VerifierOutcome,
  VerifierResult,
} from "../contracts/index.js";
import { createFailedCalls } from "./failed-calls.js";
import type { CheckedRun } from "./input/run-ref.js";
import { hasRecordsChangedMark, inspectRun } from "../store/index.js";
import type { RunInspection } from "../store/index.js";

/** U-311: what the report's rules read of a command's environment (ReportEnvironment's, but for argv and env). */
export interface ReportReadEnvironment {
  readonly cwd: string;
  readonly platform?: NodeJS.Platform;
  /** N-7: the store's `listRuns`, for `--run latest`. Absent: `latest` is not available. */
  readonly listRuns?: ListRuns;
  /** N-23: told which run `--run latest` chose, before anything is read. */
  readonly announceLatest?: (entry: CheckedRun) => void;
  /**
   * N-27 (b): whether the run list judges the run damaged (the store's `inspectRun` when absent).
   * A damaged run is refused as revert refuses it (N-26).
   */
  readonly isDamaged?: (workspaceRoot: string, runId: string) => Promise<boolean>;
  /** N-27 (a): the store's `inspectRun` (the default); injected by tests. */
  readonly inspectRun?: (workspaceRoot: string, runId: string) => Promise<RunInspection>;
  /** DR-38: the store's `hasRecordsChangedMark` (the default); injected by tests. A rejection counts as a mark. */
  readonly hasRecordsChangedMark?: (workspaceRoot: string, runId: string) => Promise<boolean>;
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

export const realpathNative = promisify(realpathCallback.native);

/** Every reason, per status. The type keeps each entry a valid reason for its status. */
// DR-16: the reasons of each status come from the contract (RUN_REASONS_BY_STATUS through
// isReasonOfStatus); the report keeps no list of its own.

// G-G (integration case n07), as DR-16: the report keeps no list of its own where the contract has
// one. Verifier kinds are the contract's VERIFIER_KINDS (data_checks and inventory included) and
// providers its MODEL_PROVIDER_NAMES (SP-1). The contract has a type only for outcomes, so that list
// is checked against it at compile time: a value added to the type breaks the build here.
const PROVIDERS = MODEL_PROVIDER_NAMES;
const VERIFIER_OUTCOMES = ["pass", "fail", "inconclusive"] as const satisfies readonly VerifierOutcome[];
type Missing<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : false;
const listsComplete: [Missing<VerifierOutcome, (typeof VERIFIER_OUTCOMES)[number]>] = [true];
void listsComplete;
const HASH = new RegExp(CONTENT_HASH_PATTERN_SOURCE);

/** A record failed a check. Its message is fixed text, never record content. */
export class RecordError extends Error {}


function bad(message: string): never {
  throw new RecordError(message);
}

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : bad("a record is not an object");
}

function str(value: unknown): string {
  return typeof value === "string" ? value : bad("a record has a field of the wrong type");
}

/** Text read back from the run's own masked records. Not new masking: the run masked it when recording. */
export function recorded(value: unknown): MaskedText {
  return str(value) as MaskedText;
}

function recordedList(value: unknown): MaskedText[] {
  return Array.isArray(value) ? value.map(recorded) : bad("a record has a field of the wrong type");
}

function int(value: unknown, min = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min ? value : bad("a record has a number out of range");
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : bad("a record has an unknown value");
}

function statusAndReason(statusValue: unknown, reasonValue: unknown): { status: TerminalRunStatus; reason: RunReason } {
  const status = oneOf(statusValue, TERMINAL_RUN_STATUSES);
  if (typeof reasonValue !== "string" || !isReasonOfStatus(status, reasonValue)) bad("a record has an unknown value");
  return { status, reason: reasonValue };
}

function limitsOf(value: unknown): Limits {
  const rec = obj(value);
  const tokens = rec["maxTotalTokens"];
  return {
    maxModelTurns: int(rec["maxModelTurns"], 1),
    maxToolCalls: int(rec["maxToolCalls"], 1),
    maxTotalTokens: tokens === null ? null : int(tokens, 1),
    maxDurationMs: int(rec["maxDurationMs"], 1),
    ...(rec["maxRepairAttempts"] === undefined ? {} : { maxRepairAttempts: int(rec["maxRepairAttempts"]) }),
    ...(rec["maxSameFailures"] === undefined ? {} : { maxSameFailures: int(rec["maxSameFailures"], 1) }),
  };
}

function verifierOf(value: unknown): VerifierResult {
  const rec = obj(value);
  const evidence = recorded(rec["evidence"]);
  // X-2: a run never records more evidence than MAX_EVIDENCE_BYTES (T-6). More was changed later.
  if (Buffer.byteLength(evidence, "utf8") > MAX_EVIDENCE_BYTES) bad("a verifier result has more evidence than a run records");
  return {
    id: str(rec["id"]),
    kind: oneOf(rec["kind"], VERIFIER_KINDS),
    outcome: oneOf(rec["outcome"], VERIFIER_OUTCOMES),
    evidence,
    checked: recordedList(rec["checked"]),
    limits: recordedList(rec["limits"]),
  };
}

function hashOf(value: unknown): string {
  return typeof value === "string" && HASH.test(value) ? value : bad("a record has an invalid hash");
}

function changeOf(rec: Obj): FileChangeRecord {
  const created = rec["created"];
  if (typeof created !== "boolean") bad("a record has a field of the wrong type");
  return {
    path: recorded(rec["path"]),
    previousHash: rec["previousHash"] === null ? null : hashOf(rec["previousHash"]),
    newHash: hashOf(rec["newHash"]),
    created,
  };
}

function usageOf(value: unknown): RunUsage {
  const rec = obj(value);
  const tokens = (item: unknown): number | null => (item === null ? null : int(item));
  return {
    modelTurns: int(rec["modelTurns"]),
    toolCalls: int(rec["toolCalls"]),
    inputTokens: tokens(rec["inputTokens"]),
    outputTokens: tokens(rec["outputTokens"]),
    durationMs: int(rec["durationMs"]),
    ...(rec["repairAttempts"] === undefined ? {} : { repairAttempts: int(rec["repairAttempts"]) }),
  };
}

/**
 * The journal summary. Records must be JSON objects of this run with `seq` 1, 2, 3, ... and the
 * first must be `run_started`. A last line without its line feed is ignored when the run has no
 * result.json (still being written) and is an error otherwise.
 */
/**
 * U-18 (AXM-4): the calls allowed and then failed in a run's journal (failed-calls.ts), for the
 * report's text only: ReportJournalSummary and `report --json` do not carry them (PM Q-3).
 * summarizeJournal has judged the lines already; one that does not parse is not counted.
 */
export function failedCallsIn(journalText: string): number {
  const failed = createFailedCalls();
  for (const line of journalText.split("\n")) {
    if (line.length === 0) continue;
    try {
      failed.observe(JSON.parse(line));
    } catch {
      // Not a record; summarizeJournal decides about it.
    }
  }
  return failed.count;
}

export function summarizeJournal(text: string, runId: string, hasResult: boolean): ReportJournalSummary {
  const lines = text.split("\n");
  const tail = lines.pop();
  if (tail !== undefined && tail.length > 0 && hasResult) bad("the journal ends inside a record");
  if (lines.length === 0) bad("the journal has no records");

  let started: { taskId: string; workflow: MaskedText; provider: ModelProviderName; limits: Limits } | null = null;
  let modelRequests = 0;
  let deniedToolCalls = 0;
  let repairs = 0;
  let lastRound: VerifierResult[] = [];
  const changes: FileChangeRecord[] = [];
  const integrityChecks: { phase: IntegrityPhase; changed: MaskedText[] }[] = [];
  let finished: { status: TerminalRunStatus; reason: RunReason } | null = null;

  lines.forEach((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      bad("a journal line is not JSON");
    }
    const rec = obj(value);
    if (rec["runId"] !== runId) bad("a journal record belongs to another run");
    if (rec["seq"] !== index + 1) bad("journal records are out of order");
    const type = rec["type"];
    if (index === 0) {
      if (type === "apply_started") bad("the journal is an apply run's (summarizeApplyJournal reads it)");
      if (type !== "run_started") bad("the journal does not start with run_started");
      started = {
        taskId: str(rec["taskId"]),
        workflow: recorded(rec["workflow"]),
        provider: oneOf(rec["provider"], PROVIDERS),
        limits: limitsOf(rec["limits"]),
      };
      return;
    }
    switch (type) {
      case "model_request":
        modelRequests += 1;
        break;
      case "tool_decision":
        if (rec["allowed"] === false) deniedToolCalls += 1;
        break;
      case "repair_started":
        repairs += 1;
        lastRound = [];
        break;
      case "verifier_result":
        lastRound.push(verifierOf(rec["result"]));
        break;
      case "file_changed":
        changes.push(changeOf(rec));
        break;
      case "integrity_checked":
        integrityChecks.push({ phase: oneOf(rec["phase"], INTEGRITY_PHASES), changed: recordedList(rec["changed"]) });
        break;
      case "run_finished":
        finished = statusAndReason(rec["status"], rec["reason"]);
        break;
      default:
        // Other records, including types added later, are not part of the summary.
        break;
    }
  });

  const start = started as { taskId: string; workflow: MaskedText; provider: ModelProviderName; limits: Limits } | null;
  if (start === null) return bad("the journal does not start with run_started");
  return {
    taskId: start.taskId,
    workflow: start.workflow,
    provider: start.provider,
    limits: start.limits,
    records: lines.length,
    modelRequests,
    deniedToolCalls,
    repairs,
    lastRound,
    changes,
    integrityChecks,
    finished,
  };
}

/** result.json, rebuilt from the checked fields only. */
/** DR-38 (PM after bf04750): a recorded stateChanged when it names a change; an empty list is left out. */
function stateChangedOf(value: unknown): { readonly stateChanged?: readonly MaskedText[] } {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return {};
  return { stateChanged: recordedList(value) as readonly MaskedText[] };
}

/** U-8: an apply result's recorded notice kinds (APPLY_NOTICE_KINDS, each once); an absent or empty list is left out. */
function noticeKindsOf(value: unknown): { readonly noticeKinds?: readonly ApplyNoticeKind[] } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) bad("result.json has a field of the wrong type");
  const kinds = value.map((kind) => oneOf(kind, APPLY_NOTICE_KINDS));
  if (new Set(kinds).size !== kinds.length) bad("result.json names a notice kind twice");
  return kinds.length === 0 ? {} : { noticeKinds: kinds };
}

/**
 * U-46 (R-56b R56b-L1): an apply result's recorded cause of plan_records_unchecked
 * (PLAN_RECORDS_UNCHECKED_CAUSES); absent is left out. Any other value is a damaged field.
 */
function planRecordsUncheckedCauseOf(value: unknown): { readonly planRecordsUncheckedCause?: PlanRecordsUncheckedCause } {
  return value === undefined ? {} : { planRecordsUncheckedCause: oneOf(value, PLAN_RECORDS_UNCHECKED_CAUSES) };
}

export function readResult(text: string, runId: string, taskId: string): EngineResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    bad("result.json is not JSON");
  }
  const rec = obj(value);
  if (rec["schemaVersion"] !== RESULT_SCHEMA_VERSION || rec["kind"] !== "run") bad("result.json is not a run result");
  if (rec["runId"] !== runId) bad("result.json belongs to another run");
  if (rec["taskId"] !== taskId) bad("result.json names another task than the journal");
  const { status, reason } = statusAndReason(rec["status"], rec["reason"]);
  const verifiers = rec["verifiers"];
  const changes = rec["changes"];
  if (!Array.isArray(verifiers) || !Array.isArray(changes)) bad("result.json has a field of the wrong type");
  const protectedChanged = rec["protectedChanged"];
  // G-A: a plan run names its plan; a run awaiting review carries the workflow's checklist.
  const plan = rec["plan"];
  const review = rec["review"];
  if (plan !== undefined && reason !== "plan_pending") bad("result.json has a plan for another reason");
  if (review !== undefined && reason !== "awaiting_review") bad("result.json has a review for another reason");
  const usage = usageOf(rec["usage"]);
  return {
    schemaVersion: 1,
    kind: "run",
    runId,
    taskId,
    status,
    reason,
    exitCode: int(rec["exitCode"]),
    provider: oneOf(rec["provider"], PROVIDERS),
    verifiers: verifiers.map(verifierOf),
    changes: changes.map((item) => changeOf(obj(item))),
    usage,
    journalPath: str(rec["journalPath"]),
    notices: recordedList(rec["notices"]),
    ...(protectedChanged === undefined ? {} : { protectedChanged: recordedList(protectedChanged) }),
    // DR-38: the state checks' last recorded list (masked), only when it names a change (PM after bf04750).
    ...stateChangedOf(rec["stateChanged"]),
    ...(plan === undefined ? {} : { plan: planOf(plan) }),
    ...(review === undefined ? {} : { review: { checklist: recordedList(obj(review)["checklist"]) } }),
    // DR-47 (U-21): the agent's last message as recorded; never for a plan run.
    ...finalMessageOf(rec["finalMessage"], reason),
    // DR-52 (U-25): whether masking worked, the two counts as recorded.
    ...maskingOf(rec["masking"]),
    // U-55 (AXM-9): the model error that ended the run, in its known form.
    ...modelErrorOf(rec["modelError"], reason, usage.modelTurns),
    // U-195 (DR-69 B-3): the plan run this run carried out and the approved digest, as recorded.
    ...carriedPlanOf(rec["planRunId"], rec["planDigest"]),
  };
}

/**
 * U-195 (DR-69 B-3): EngineResult.planRunId and planDigest, present together in a run that carried out
 * an approved run plan and absent in every other run. A run id and a digest; one without the other,
 * or another form, is a damaged field.
 */
function carriedPlanOf(planRunId: unknown, planDigest: unknown): { planRunId?: string; planDigest?: ContentHash } {
  if (planRunId === undefined && planDigest === undefined) return {};
  if (typeof planRunId !== "string" || toRunId(planRunId) === null) bad("result.json has a field of the wrong type");
  return { planRunId, planDigest: hashOf(planDigest) as ContentHash };
}

/**
 * U-55 (AXM-9): EngineResult.modelError {kind, turn, retryable?}, absent when the result has none (a
 * run no model error ended, or a result written before U-55). Rebuilt from those three fields;
 * another form is a damaged field. A missing retryable stays missing (unknown, never false).
 */
function modelErrorOf(
  value: unknown,
  reason: RunReason,
  modelTurns: number,
): { modelError?: { kind: (typeof MODEL_ERROR_KINDS)[number]; turn: number; retryable?: boolean } } {
  if (value === undefined) return {};
  // U-88 (R-71 L2): only with reason model_error (the contract), as finalMessageOf checks its own.
  if (reason !== "model_error") bad("result.json has a model error on a run that did not end with one");
  const rec = obj(value);
  const retryable = rec["retryable"];
  if (retryable !== undefined && typeof retryable !== "boolean") bad("result.json has a field of the wrong type");
  const turn = int(rec["turn"], 1);
  // U-88: a turn the run made (usage.modelTurns counts the failed request too).
  if (turn > modelTurns) bad("result.json names a model turn the run did not make");
  return { modelError: { kind: oneOf(rec["kind"], MODEL_ERROR_KINDS), turn, ...(retryable === undefined ? {} : { retryable }) } };
}

/**
 * DR-52 (U-25): EngineResult.masking, absent when the result has none (nothing registered, or a
 * result written before DR-52). Two counts only, rebuilt from those fields: anything else the field
 * holds is not carried. Present only with at least one registered value.
 */
function maskingOf(value: unknown): { masking?: { registeredValues: number; maskedPlaces: number } } {
  if (value === undefined) return {};
  const rec = obj(value);
  return { masking: { registeredValues: int(rec["registeredValues"], 1), maskedPlaces: int(rec["maskedPlaces"]) } };
}

/** DR-47: EngineResult.finalMessage, absent when the result has none. A plan run has none. */
function finalMessageOf(value: unknown, reason: RunReason): { finalMessage?: { text: MaskedText; truncated: boolean } } {
  if (value === undefined) return {};
  if (reason === "plan_pending") bad("result.json has the agent's last message for a plan run");
  const rec = obj(value);
  const truncated = rec["truncated"];
  if (typeof truncated !== "boolean") bad("result.json has a field of the wrong type");
  return { finalMessage: { text: recorded(rec["text"]), truncated } };
}

function planOf(value: unknown): { digest: ContentHash; actions: number; kind?: "changes" } {
  const rec = obj(value);
  // U-195 (U-180): a run plan's result says kind "changes" (its files are `actions`); nothing else is a kind.
  const kind = rec["kind"];
  if (kind !== undefined && kind !== "changes") bad("result.json has a field of the wrong type");
  return { digest: hashOf(rec["digest"]) as ContentHash, actions: int(rec["actions"], 1), ...(kind === undefined ? {} : { kind }) };
}

/** The `type` of the journal's first record, or null when the first line is not a JSON object. */
export function firstRecordType(text: string): unknown {
  const end = text.indexOf("\n");
  try {
    const first = JSON.parse(end === -1 ? text : text.slice(0, end)) as unknown;
    return typeof first === "object" && first !== null ? (first as { type?: unknown }).type : null;
  } catch {
    return null;
  }
}

type ApplyStart = Pick<ApplyReportJournalSummary, "planRunId" | "taskId" | "digest" | "approval" | "unsafeMoveConsent" | "actions" | "maxDurationMs">;

/**
 * An apply run's journal summary: records of this run with `seq` 1, 2, 3, ..., the first
 * `apply_started`, action indexes within the plan. A last line without its line feed is ignored
 * when the run has no result.json and is an error otherwise, as for a run.
 */
export function summarizeApplyJournal(text: string, runId: string, hasResult: boolean): ApplyReportJournalSummary {
  const lines = text.split("\n");
  const tail = lines.pop();
  if (tail !== undefined && tail.length > 0 && hasResult) bad("the journal ends inside a record");
  if (lines.length === 0) bad("the journal has no records");

  let start: ApplyStart | null = null;
  let checked: ApplyReportJournalSummary["checked"] = null;
  let started = 0;
  const moved: { index: number; from: MaskedText; to: MaskedText; unsafe: boolean }[] = [];
  const discarded: { index: number; path: MaskedText; stored: string }[] = [];
  const failed: { index: number; problem: PlanItemProblem }[] = [];
  const lastRound: VerifierResult[] = [];
  const integrityChecks: { phase: IntegrityPhase; changed: MaskedText[] }[] = [];
  let finished: { status: TerminalRunStatus; reason: RunReason } | null = null;

  lines.forEach((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      bad("a journal line is not JSON");
    }
    const rec = obj(value);
    if (rec["runId"] !== runId) bad("a journal record belongs to another run");
    if (rec["seq"] !== index + 1) bad("journal records are out of order");
    const type = rec["type"];
    if (index === 0) {
      if (type !== "apply_started" || rec["schemaVersion"] !== 1) bad("the journal does not start with apply_started");
      const consent = rec["unsafeMoveConsent"];
      start = {
        planRunId: str(rec["planRunId"]),
        taskId: str(rec["taskId"]),
        digest: hashOf(rec["digest"]) as ContentHash,
        approval: oneOf(rec["approval"], APPROVAL_CHANNELS),
        unsafeMoveConsent: consent === undefined || consent === null ? null : oneOf(consent, APPROVAL_CHANNELS),
        actions: int(rec["actions"]),
        maxDurationMs: int(rec["maxDurationMs"], 1),
      };
      return;
    }
    const total = (start as ApplyStart | null)?.actions ?? 0;
    const actionIndex = (item: unknown): number => {
      const at = int(item);
      return at < total ? at : bad("a record names an action the plan does not have");
    };
    switch (type) {
      case "plan_checked": {
        const problems = rec["problems"];
        const unsafe = rec["unsafeMoves"] ?? [];
        const limit = rec["inventoryLimitReached"];
        if (!Array.isArray(problems) || !Array.isArray(unsafe) || typeof limit !== "boolean") bad("a record has a field of the wrong type");
        for (const problem of problems) {
          const item = obj(problem);
          actionIndex(item["index"]);
          oneOf(item["problem"], PLAN_ITEM_PROBLEMS);
        }
        unsafe.forEach(actionIndex);
        checked = { problems: problems.length, inventoryLimitReached: limit, unsafeMoves: unsafe.length };
        break;
      }
      case "plan_item_started":
        actionIndex(rec["index"]);
        started += 1;
        break;
      case "file_moved":
        hashOf(rec["sha256"]);
        moved.push({ index: actionIndex(rec["index"]), from: recorded(rec["from"]), to: recorded(rec["to"]), unsafe: rec["unsafe"] === true });
        break;
      case "file_discarded":
        hashOf(rec["sha256"]);
        discarded.push({ index: actionIndex(rec["index"]), path: recorded(rec["path"]), stored: str(rec["stored"]) });
        break;
      case "plan_item_failed":
        failed.push({ index: actionIndex(rec["index"]), problem: oneOf(rec["problem"], PLAN_ITEM_PROBLEMS) });
        break;
      case "verifier_result":
        lastRound.push(verifierOf(rec["result"]));
        break;
      case "integrity_checked":
        integrityChecks.push({ phase: oneOf(rec["phase"], INTEGRITY_PHASES), changed: recordedList(rec["changed"]) });
        break;
      case "run_finished":
        finished = statusAndReason(rec["status"], rec["reason"]);
        break;
      default:
        // Other records, including types added later, are not part of the summary.
        break;
    }
  });

  const first = start as ApplyStart | null;
  if (first === null) return bad("the journal does not start with apply_started");
  return { ...first, records: lines.length, checked, started, moved, discarded, failed, lastRound, integrityChecks, finished };
}

function appliedOf(value: unknown): AppliedActionRecord {
  const rec = obj(value);
  const action = obj(rec["action"]);
  const sha256 = hashOf(action["sha256"]) as ContentHash;
  const masked: MaskedPlanAction =
    action["kind"] === "move"
      ? { kind: "move", from: recorded(action["from"]), to: recorded(action["to"]), sha256 }
      : action["kind"] === "discard"
        ? { kind: "discard", path: recorded(action["path"]), sha256 }
        : bad("a record has an unknown value");
  const stored = rec["stored"];
  return {
    index: int(rec["index"]),
    action: masked,
    stored: stored === null ? null : str(stored),
    ...(rec["unsafe"] === true ? { unsafe: true as const } : {}),
  };
}

/** An apply run's result.json, rebuilt from the checked fields and checked against its journal. */
export function readApplyResult(text: string, runId: string, journal: ApplyReportJournalSummary): ApplyResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    bad("result.json is not JSON");
  }
  const rec = obj(value);
  if (rec["schemaVersion"] !== RESULT_SCHEMA_VERSION || rec["kind"] !== "apply") bad("result.json is not an apply result");
  if (rec["runId"] !== runId) bad("result.json belongs to another run");
  if (rec["planRunId"] !== journal.planRunId || rec["taskId"] !== journal.taskId || rec["digest"] !== journal.digest) {
    bad("result.json names another plan or task than the journal");
  }
  const { status, reason } = statusAndReason(rec["status"], rec["reason"]);
  const applied = rec["applied"];
  const verifiers = rec["verifiers"];
  if (!Array.isArray(applied) || !Array.isArray(verifiers)) bad("result.json has a field of the wrong type");
  const protectedChanged = rec["protectedChanged"];
  return {
    schemaVersion: 1,
    kind: "apply",
    runId,
    planRunId: journal.planRunId,
    taskId: journal.taskId,
    digest: journal.digest,
    status,
    reason,
    exitCode: int(rec["exitCode"]),
    applied: applied.map(appliedOf),
    verifiers: verifiers.map(verifierOf),
    usage: usageOf(rec["usage"]),
    journalPath: str(rec["journalPath"]),
    notices: recordedList(rec["notices"]),
    ...(protectedChanged === undefined ? {} : { protectedChanged: recordedList(protectedChanged) }),
    // DR-38: the state checks' last recorded list (masked), only when it names a change (PM after bf04750).
    ...stateChangedOf(rec["stateChanged"]),
    // U-8: what the apply told besides its status, as recorded; absent when none.
    ...noticeKindsOf(rec["noticeKinds"]),
    // U-46 (R56b-L1): why plan_records_unchecked was told, when it was not the apply's own check (U-33).
    ...planRecordsUncheckedCauseOf(rec["planRecordsUncheckedCause"]),
  };
}

type FileState = "file" | "missing" | "other" | "too_large";

export async function fileState(file: string): Promise<FileState> {
  try {
    const info = await lstat(file);
    if (!info.isFile()) return "other";
    return info.size > MAX_REPORT_FILE_BYTES ? "too_large" : "file";
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "other";
  }
}

export async function readRecordFile(file: string): Promise<string> {
  const bytes = await readFile(file);
  if (bytes.length > MAX_REPORT_FILE_BYTES) bad("a run file is too large");
  return bytes.toString("utf8");
}
