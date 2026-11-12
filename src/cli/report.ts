/**
 * `codaryn report --workspace <dir> --run <runId> [--json]` (U-5): a summary of one run for a
 * person, built from `<root>/.codaryn/runs/<runId>/result.json` and `journal.jsonl` only.
 * Those files hold masked text; nothing else is read and nothing is changed. The run directory
 * must be the workspace's own (not a link), every record must belong to the run, and every field
 * the report uses is checked. Printed text has control characters replaced and key-shaped text
 * hidden (`./text-safety.ts`), because commands allowed during the run could have written into
 * the records.
 */

import { realpath as realpathCallback } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  ANTHROPIC_API_KEY_ENV,
  CONTENT_HASH_PATTERN_SOURCE,
  INTEGRITY_PHASES,
  JOURNAL_FILE_NAME,
  MAX_EVIDENCE_BYTES,
  MAX_REPORT_FILE_BYTES,
  REPORT_EXIT_CODES,
  RESULT_FILE_NAME,
  RESULT_SCHEMA_VERSION,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  TERMINAL_RUN_STATUSES,
  isReasonOfStatus,
} from "../contracts/index.js";
import type {
  ListRuns,
  ContentHash,
  EngineResult,
  FileChangeRecord,
  IntegrityPhase,
  Limits,
  MaskedText,
  ModelProviderName,
  ReportJournalSummary,
  ReportOutput,
  ReportStatus,
  RunReason,
  RunUsage,
  TerminalRunStatus,
  VerifierResult,
} from "../contracts/index.js";
import { parseReportArgs } from "./args.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { resolveRunReference } from "./run-ref.js";
import type { CheckedRun } from "./run-ref.js";
import { cliError } from "./run.js";
import { envValue } from "./settings.js";
import type { SettingsEnvironment } from "./settings.js";
import { localPathProblem } from "./task.js";
import { cleanText, hideKeys, hideKeysInStrings } from "./text-safety.js";
import { inspectRun } from "../store/index.js";

export interface ReportEnvironment {
  readonly argv: readonly string[];
  readonly cwd: string;
  /** Read only to keep the current key out of the printed report. */
  readonly env: SettingsEnvironment;
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
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

const realpathNative = promisify(realpathCallback.native);

/** Every reason, per status. The type keeps each entry a valid reason for its status. */
// DR-16: the reasons of each status come from the contract (RUN_REASONS_BY_STATUS through
// isReasonOfStatus); the report keeps no list of its own.

const PROVIDERS: readonly ModelProviderName[] = ["scripted", "anthropic"];
const VERIFIER_KINDS = ["command", "file_rules"] as const;
const VERIFIER_OUTCOMES = ["pass", "fail", "inconclusive"] as const;
const HASH = new RegExp(CONTENT_HASH_PATTERN_SOURCE);

/** A record failed a check. Its message is fixed text, never record content. */
class RecordError extends Error {}

/**
 * DR-12: the journal starts with `apply_started`: an apply run. ReportOutput has no form for
 * apply runs yet (its `result` and `journal` are a run's), so the report says so and shows nothing.
 */
class ApplyRunError extends Error {}

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
function recorded(value: unknown): MaskedText {
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
      if (type === "apply_started") throw new ApplyRunError();
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
    usage: usageOf(rec["usage"]),
    journalPath: str(rec["journalPath"]),
    notices: recordedList(rec["notices"]),
    ...(protectedChanged === undefined ? {} : { protectedChanged: recordedList(protectedChanged) }),
    ...(plan === undefined ? {} : { plan: planOf(plan) }),
    ...(review === undefined ? {} : { review: { checklist: recordedList(obj(review)["checklist"]) } }),
  };
}

function planOf(value: unknown): { digest: ContentHash; actions: number } {
  const rec = obj(value);
  return { digest: hashOf(rec["digest"]) as ContentHash, actions: int(rec["actions"], 1) };
}

// ---------------------------------------------------------------------------------------------
// Markdown

/**
 * Length of the longest run of backticks. A loop, not `Math.max(...runs)`: recorded text can hold
 * any number of runs, and spreading them as arguments overflows the stack (X-2).
 */
function longestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (let index = 0; index < text.length; index += 1) {
    current = text.charCodeAt(index) === 0x60 ? current + 1 : 0;
    if (current > longest) longest = current;
  }
  return longest;
}

/**
 * N-23 (review R-2 h): key shapes and the current key are hidden before control characters are
 * replaced, so a control character cannot break a key into pieces the check misses. Set by
 * `renderReport` for the duration of one (synchronous) rendering.
 */
let renderingKey: string | null = null;

function safe(text: string, keepLineBreaks = false): string {
  return cleanText(hideKeys(text, renderingKey), keepLineBreaks);
}

/** Inline code that cannot be closed early by the text it shows. */
function code(text: string): string {
  const clean = safe(text);
  const longest = longestBacktickRun(clean);
  const fence = "`".repeat(longest + 1);
  const pad = clean.startsWith("`") || clean.endsWith("`") || clean.length === 0 ? " " : "";
  return `${fence}${pad}${clean}${pad}${fence}`;
}

/** A fenced block that the text inside cannot close. */
function block(text: string): string[] {
  const clean = safe(text, true);
  const fence = "`".repeat(Math.max(3, longestBacktickRun(clean) + 1));
  return [fence].concat(clean.split(String.fromCharCode(10)), [fence]);
}

function short(hash: string | null): string {
  return hash === null ? "none" : hash.slice(0, 12);
}

const PHASE_LABEL: { readonly [P in IntegrityPhase]: string } = {
  run_start: "at run start",
  before_verify: "before verification",
  after_verify: "after verification",
};

/** What a run report never covers. Each verifier's own limits are listed with it. */
export const REPORT_FIXED_LIMITS: readonly string[] = [
  "A pass means the configured verifiers passed. It is not a review of the change.",
  "The change list holds file tool writes only. Commands allowed by the policy may have changed other files.",
  "There is no OS isolation: allowed commands ran with the user's rights and could reach the network.",
  "This report reads the run's own records. Commands allowed during the run could have changed them.",
];

export function renderReport(report: ReportOutput, currentKey: string | null = null): string {
  renderingKey = currentKey;
  try {
    return renderReportText(report);
  } finally {
    renderingKey = null;
  }
}

function renderReportText(report: ReportOutput): string {
  const { result, journal } = report;
  const out: string[] = ["# Codaryn run report", ""];
  out.push(`- Run: ${code(report.runId)}`);
  out.push(`- Task: ${code(journal.taskId)} (workflow ${code(journal.workflow)})`);
  out.push(
    `- Provider: ${code(journal.provider)}${journal.provider === "scripted" ? " (scripted model; no API was called)" : ""}`,
  );
  if (result !== null) {
    out.push(`- Result: ${code(result.status)} / ${code(result.reason)}, exit code ${result.exitCode}`);
    if (result.plan !== undefined) {
      out.push(`- Plan: ${result.plan.actions} action(s) waiting for approval, digest ${code(result.plan.digest)}. See it with ${code("codaryn plan --run " + report.runId)}.`);
    }
  } else {
    out.push("- Result: none. The run has no result.json: it is still running, or it stopped without writing one.");
    out.push(
      journal.finished === null
        ? "- The journal has no end record."
        : `- The journal's end record: ${code(journal.finished.status)} / ${code(journal.finished.reason)}`,
    );
  }
  out.push(`- Report: ${report.status} (${journal.records} journal records)`);

  const verifiers = result?.verifiers ?? journal.lastRound;
  out.push("", "## Verification", "");
  if (verifiers.length === 0) {
    out.push("No verifier result was recorded for the last round.");
  } else {
    // N-24 (a): a verifier is shown by its number in the run's verifier order; the id is in --json only.
    for (const [index, verifier] of verifiers.entries()) {
      out.push(`- verifier ${index + 1} (${verifier.kind}): **${verifier.outcome}**`);
      for (const item of verifier.checked) out.push(`  - checked: ${code(item)}`);
      if (verifier.outcome !== "pass" && verifier.evidence.length > 0) {
        out.push("");
        for (const line of block(verifier.evidence)) out.push(`  ${line}`);
      }
    }
  }
  if (journal.repairs > 0) out.push("", `Repairs started: ${journal.repairs}.`);
  if (result?.review !== undefined) {
    out.push("", "## Review checklist", "");
    out.push(`The run waits for a person's verdict (${code("codaryn review --run " + report.runId + " --accept | --reject")}).`);
    for (const item of result.review.checklist) out.push(`- ${code(item)}`);
  }

  out.push("", "## Protected material", "");
  const lastCheck = journal.integrityChecks[journal.integrityChecks.length - 1];
  const changedNow = result?.protectedChanged ?? lastCheck?.changed;
  if (journal.integrityChecks.length === 0 && changedNow === undefined) {
    out.push("Not checked: the run had no integrity check (nothing was protected, or it ran without the check).");
  } else {
    const phases = journal.integrityChecks.map((check) => PHASE_LABEL[check.phase]);
    out.push(`Checked ${journal.integrityChecks.length} time(s)${phases.length > 0 ? `: ${phases.join(", ")}` : ""}.`);
    if (changedNow === undefined || changedNow.length === 0) {
      out.push("No protected path changed since the run started.");
    } else {
      out.push("Changed since the run started, or not checkable:");
      for (const item of changedNow) out.push(`- ${code(item)}`);
    }
  }

  const changes = result?.changes ?? journal.changes;
  out.push("", `## Changes (${changes.length})`, "");
  if (changes.length === 0) out.push("No file tool write was recorded.");
  for (const change of changes) {
    out.push(
      change.created
        ? `- ${code(change.path)} created (${short(change.newHash)})`
        : `- ${code(change.path)} changed (${short(change.previousHash)} -> ${short(change.newHash)})`,
    );
  }

  out.push("", "## Usage", "");
  const limits = journal.limits;
  if (result !== null) {
    const usage = result.usage;
    out.push(`- Model turns: ${usage.modelTurns} of ${limits.maxModelTurns}`);
    out.push(`- Tool calls: ${usage.toolCalls} of ${limits.maxToolCalls} (denied: ${journal.deniedToolCalls})`);
    const tokens =
      usage.inputTokens === null || usage.outputTokens === null
        ? "not reported by every response"
        : `input ${usage.inputTokens}, output ${usage.outputTokens}`;
    out.push(`- Tokens: ${tokens} (limit: ${limits.maxTotalTokens === null ? "none" : limits.maxTotalTokens})`);
    out.push(`- Duration: ${usage.durationMs} ms of ${limits.maxDurationMs} ms`);
  } else {
    out.push(`- Model requests recorded: ${journal.modelRequests} (limit ${limits.maxModelTurns})`);
    out.push(`- Denied tool calls: ${journal.deniedToolCalls}`);
  }
  out.push(`- Repairs: ${journal.repairs}${limits.maxRepairAttempts === undefined ? "" : ` of ${limits.maxRepairAttempts}`}`);

  out.push("", "## Not checked", "");
  for (const [index, verifier] of verifiers.entries()) {
    for (const item of verifier.limits) out.push(`- verifier ${index + 1}: ${code(item)}`);
  }
  for (const item of REPORT_FIXED_LIMITS) out.push(`- ${item}`);

  const notices = result?.notices ?? [];
  if (notices.length > 0) {
    out.push("", "## Notices", "");
    for (const notice of notices) out.push(`- ${code(notice)}`);
  }
  return `${out.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------
// Files

type FileState = "file" | "missing" | "other" | "too_large";

async function fileState(file: string): Promise<FileState> {
  try {
    const info = await lstat(file);
    if (!info.isFile()) return "other";
    return info.size > MAX_REPORT_FILE_BYTES ? "too_large" : "file";
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "other";
  }
}

async function readRecordFile(file: string): Promise<string> {
  const bytes = await readFile(file);
  if (bytes.length > MAX_REPORT_FILE_BYTES) bad("a run file is too large");
  return bytes.toString("utf8");
}

export async function runReport(io: ReportEnvironment): Promise<CommandOutcome> {
  const parsed = parseReportArgs(io.argv);
  if (!parsed.ok) return cliError("invalid_arguments", parsed.message);
  const { json } = parsed.args;

  // S-5: a network or device path is refused before the file system is touched.
  const problem = localPathProblem(parsed.args.workspace, io.cwd);
  if (problem !== null) return cliError("invalid_arguments", `the path given by --workspace ${problem}`);

  let root: string;
  try {
    root = await realpathNative(path.resolve(io.cwd, parsed.args.workspace));
    if (!(await lstat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    return cliError("workspace_not_found", "the workspace is not an existing directory");
  }
  // N-7, N-18: `latest` is the newest checked run; ambiguous when a directory has that name.
  const reference = await resolveRunReference(root, parsed.args.runId, {
    exists: pathExists,
    ...(io.listRuns === undefined ? {} : { listRuns: io.listRuns }),
  });
  if (!reference.ok) return cliError(reference.code, reference.message);
  const runId = reference.runId;
  // N-27 (b), review R-7 I-2: the run list's judgment (record ownership, schema, times, and the
  // id's exact form, N-27 a) applies to the report too; its records are not shown as a report.
  let damaged: boolean;
  try {
    damaged = await (io.isDamaged ?? (async (workspaceRoot: string, id: string) => (await inspectRun(workspaceRoot, id)) === "damaged"))(root, runId);
  } catch {
    damaged = true;
  }
  if (damaged) {
    return cliError("invalid_run_record", "the run's records do not pass the checks (`codaryn runs` shows it as damaged); no report is shown");
  }
  if (reference.latest !== null) {
    try {
      io.announceLatest?.(reference.latest);
    } catch {
      // The notice is best effort.
    }
  }

  const runDir = path.join(root, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
  const fold = (value: string): string => ((io.platform ?? process.platform) === "win32" ? value.toLowerCase() : value);
  let realRunDir: string;
  try {
    realRunDir = await realpathNative(runDir);
  } catch {
    return cliError("run_not_found", "the workspace has no records for that run id");
  }
  if (fold(realRunDir) !== fold(runDir)) {
    return cliError("invalid_run_record", "the run directory is a link; the report reads only the workspace's own records");
  }

  const journalFile = path.join(runDir, JOURNAL_FILE_NAME);
  const resultFile = path.join(runDir, RESULT_FILE_NAME);
  const journalState = await fileState(journalFile);
  if (journalState === "missing") return cliError("run_not_found", "the workspace has no journal for that run id");
  const resultState = await fileState(resultFile);
  for (const state of [journalState, resultState]) {
    if (state === "too_large") return cliError("invalid_run_record", `a run file is larger than ${MAX_REPORT_FILE_BYTES} bytes`);
    if (state === "other") return cliError("invalid_run_record", "a run file is not a regular file or cannot be read");
  }

  let report: ReportOutput;
  try {
    const hasResult = resultState === "file";
    const journal = summarizeJournal(await readRecordFile(journalFile), runId, hasResult);
    const result = hasResult ? readResult(await readRecordFile(resultFile), runId, journal.taskId) : null;
    const status: ReportStatus = result === null ? "incomplete" : "complete";
    report = { schemaVersion: 1, kind: "report", runId, status, exitCode: REPORT_EXIT_CODES[status], result, journal };
  } catch (error) {
    if (error instanceof ApplyRunError) {
      return cliError(
        "invalid_arguments",
        "the run is an apply run; report does not read apply runs yet. `codaryn runs` lists it, and `codaryn revert --run <id>` undoes it",
      );
    }
    if (error instanceof RecordError) return cliError("invalid_run_record", `the run's records cannot be used: ${error.message}`);
    return cliError("invalid_run_record", "the run's records cannot be read");
  }

  const currentKey = envValue(io.env, ANTHROPIC_API_KEY_ENV);
  let text: string;
  try {
    // N-27 (c): keys are hidden in the strings before the JSON is written, as in the text.
    text = json ? jsonLine(hideKeysInStrings(report, currentKey)) : renderReport(report, currentKey);
  } catch {
    // X-2: everything printed comes from the records, so a failure here means records a run
    // would not write (changed or broken after the run), not an internal error.
    return cliError("invalid_run_record", "the run's records cannot be shown");
  }
  return { text: hideKeys(text, currentKey), exitCode: report.exitCode };
}
