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
  APPLY_NOTICE_KINDS,
  MODEL_ERROR_KINDS,
  PLAN_RECORDS_UNCHECKED_CAUSES,
  APPROVAL_CHANNELS,
  CONTENT_HASH_PATTERN_SOURCE,
  INTEGRITY_PHASES,
  JOURNAL_FILE_NAME,
  MAX_EVIDENCE_BYTES,
  MAX_FINAL_MESSAGE_CHARS,
  MAX_REPORT_FILE_BYTES,
  MODEL_PROVIDER_NAMES,
  PLAN_ITEM_PROBLEMS,
  planApplyStateOf,
  toRunId,
  REPORT_EXIT_CODES,
  RESULT_FILE_NAME,
  RESULT_SCHEMA_VERSION,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  TERMINAL_RUN_STATUSES,
  VERIFIER_KINDS,
  isReasonOfStatus,
} from "../contracts/index.js";
import type {
  AppliedActionRecord,
  ApplyReportJournalSummary,
  ApplyReportOutput,
  ApplyNoticeKind,
  PlanRecordsUncheckedCause,
  ApplyResult,
  ApprovalChannel,
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
  ReportOutput,
  ReportStatus,
  ReviewRecord,
  RunReportOutput,
  RunReason,
  RunUsage,
  TerminalRunStatus,
  VerifierOutcome,
  VerifierResult,
} from "../contracts/index.js";
import { parseReportArgs } from "./args.js";
import { createFailedCalls } from "./failed-calls.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { resolveRunReference } from "../app/input/run-ref.js";
import type { CheckedRun } from "../app/input/run-ref.js";
import { argumentsError, cliError } from "../app/prepare.js";
import { knownKeyValues } from "../app/input/settings.js";
import type { KnownKeys } from "../app/input/security/index.js";
import type { SettingsEnvironment } from "../app/input/settings.js";
import { localPathProblem } from "../app/input/task.js";
import { cleanText, hideKeys, hideKeysInStrings } from "../app/input/text-safety.js";
import { FINAL_MESSAGE_MAX_LINES, quoteModelText } from "./human/index.js";
import { hasRecordsChangedMark, inspectRun, readReviewRecord } from "../store/index.js";
import type { RunInspection } from "../store/index.js";
import { pathExists, realpathNative, RecordError, recorded, failedCallsIn, summarizeJournal, readResult, firstRecordType, summarizeApplyJournal, readApplyResult, fileState, readRecordFile } from "../app/report-read.js";
import type { ReportReadEnvironment } from "../app/report-read.js";

// U-311 (CLI migration C-8): the report's reading and checks are the app layer's (src/app/report-read.ts);
// these names stay for the tests and the app layer's app.ts and run-events.ts (plan A).
export { failedCallsIn, readApplyResult, readResult, summarizeApplyJournal, summarizeJournal } from "../app/report-read.js";
export type { ReportReadEnvironment } from "../app/report-read.js";

export interface ReportEnvironment extends ReportReadEnvironment {
  readonly argv: readonly string[];
  /** Read only to keep the current key out of the printed report. */
  readonly env: SettingsEnvironment;
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
let renderingKey: KnownKeys = null;

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

/**
 * What a run report never covers. Each verifier's own limits are listed with it. U-166 (AXM-17):
 * what masking leaves out, as privacy.md 13 says; no count (DR-52 keeps the counts out of the text).
 * An apply run sends nothing to a model, so its list (APPLY_REPORT_FIXED_LIMITS) has no such line.
 */
export const REPORT_FIXED_LIMITS: readonly string[] = [
  "A pass means the configured verifiers passed. It is not a review of the change.",
  "The change list holds file tool writes only. Commands allowed by the policy may have changed other files.",
  "There is no OS isolation: allowed commands ran with the user's rights and could reach the network.",
  "This report reads the run's own records. Commands allowed during the run could have changed them.",
  "Masking hides only the values registered for this run and the forms of them it looks for. A secret that was not registered, another form of a value or text in another encoding (such as UTF-16) is not masked.",
];

/** `failedToolCalls` (U-18): the journal's failed calls (failedCallsIn), told in the text only. */
/** U-131 (N2): what became of a plan run's apply, by the run list's rule (planApplyStateOf); text only. */
export type ReportPlanApply = ReturnType<typeof planApplyStateOf>;

export function renderReport(report: RunReportOutput, currentKey: KnownKeys = null, failedToolCalls = 0, planApply: ReportPlanApply = null): string {
  renderingKey = currentKey;
  try {
    return renderReportText(report, failedToolCalls, planApply);
  } finally {
    renderingKey = null;
  }
}

/**
 * U-131 (N2, UXM-5): a plan run's line. Without an apply of it, the plan waits for approval as
 * before; with one, what became of that apply, in the words `runs` uses (runs.plan_*).
 */
function planLine(actions: number, digest: string, runId: string, apply: ReportPlanApply, kind?: "changes"): string {
  if (kind === "changes") return changesPlanLine(actions, digest, runId, apply);
  if (apply === null) return `- Plan: ${actions} action(s) waiting for approval, digest ${code(digest)}. See it with ${code("codaryn plan --run " + runId)}.`;
  const id = code(apply.applyRunId);
  const itsReport = `(its report: ${code("codaryn report --run " + apply.applyRunId)})`;
  switch (apply.state) {
    case "applied":
      return `- Plan: ${actions} action(s), applied by run ${id} ${itsReport}.`;
    case "unfinished":
      return `- Plan: ${actions} action(s); its apply by run ${id} did not finish${apply.reason === undefined ? "" : ` (${code(apply.reason)})`} ${itsReport}.`;
    case "applying":
      return `- Plan: ${actions} action(s); being applied by run ${id}, or that apply stopped without a result.`;
    case "reverted":
      return `- Plan: ${actions} action(s), applied by run ${id}, then reverted ${itsReport}.`;
    case "record_missing":
      return `- Plan: ${actions} action(s); taken up by run ${id}, whose records cannot be read (removed, or they cannot be checked).`;
  }
}

/**
 * U-195 (DR-69 B-3): a run plan's line. Its files are written by a later run that carries the plan
 * out, which ends as a run does (a run without checks ends needs-input/no_verifier, its work done),
 * so the line names that run's end instead of an apply that did not finish.
 */
function changesPlanLine(files: number, digest: string, runId: string, apply: ReportPlanApply): string {
  if (apply === null) return `- Plan: ${files} file(s) to write, waiting for approval, digest ${code(digest)}. See it with ${code("codaryn plan --run " + runId)}.`;
  const id = code(apply.applyRunId);
  const itsReport = `(its report: ${code("codaryn report --run " + apply.applyRunId)})`;
  switch (apply.state) {
    case "applied":
      return `- Plan: ${files} file(s) to write, carried out by run ${id} ${itsReport}.`;
    case "unfinished":
      return `- Plan: ${files} file(s) to write; carried out by run ${id}, which ended as ${apply.reason === undefined ? "other than done" : code(apply.reason)} ${itsReport}.`;
    case "applying":
      return `- Plan: ${files} file(s) to write; being carried out by run ${id}, or that run stopped without a result.`;
    case "reverted":
      return `- Plan: ${files} file(s) to write, carried out by run ${id}, then reverted ${itsReport}.`;
    case "record_missing":
      return `- Plan: ${files} file(s) to write; taken up by run ${id}, whose records cannot be read (removed, or they cannot be checked).`;
  }
}

function renderReportText(report: RunReportOutput, failedToolCalls: number, planApply: ReportPlanApply = null): string {
  const { result, journal } = report;
  const out: string[] = ["# Codaryn run report", ""];
  out.push(`- Run: ${code(report.runId)}`);
  // DR-50 (U-58): the words for people; the JSON keeps its field `workflow`.
  out.push(`- Task: ${code(journal.taskId)} (task type ${code(journal.workflow)})`);
  out.push(
    `- Provider: ${code(journal.provider)}${journal.provider === "scripted" ? " (scripted model; no API was called)" : ""}`,
  );
  if (result !== null) {
    out.push(`- Result: ${code(result.status)} / ${code(result.reason)}, exit code ${result.exitCode}`);
    if (result.plan !== undefined) out.push(planLine(result.plan.actions, result.plan.digest, report.runId, planApply, result.plan.kind));
    // U-195 (DR-69 B-3): the run that carried out an approved run plan names it.
    if (result.planRunId !== undefined && result.planDigest !== undefined) {
      out.push(`- Plan run: ${code(result.planRunId)}, digest ${code(result.planDigest)} (this run carried out its approved plan)`);
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
  // DR-38: in the words of the catalog's English (report.records_changed).
  if (report.recordsChanged === true) {
    out.push("", "This run has a records-changed mark: something other than the run changed its records, so this report may not match what happened.");
  }

  const verifiers = result?.verifiers ?? journal.lastRound;
  // N-24 (a): a verifier is shown by its number in the run's verifier order; the id is in --json only.
  verificationSection(out, verifiers);
  if (journal.repairs > 0) out.push("", `Repairs started: ${journal.repairs}.`);
  if (result?.review !== undefined) {
    out.push("", "## Review checklist", "");
    const verdict = report.verdict ?? null;
    const reviewCommand = code("codaryn review --run " + report.runId + " --accept | --reject");
    // U-131 (N1, AXM-21): the run waits for a verdict only while it has none.
    if (verdict === null) out.push(`The run waits for a person's verdict (${reviewCommand}).`);
    for (const item of result.review.checklist) out.push(`- ${code(item)}`);
    out.push("");
    if (verdict === null) {
      out.push("No verdict yet.");
    } else {
      out.push(`Verdict: **${verdict.verdict}** (${code(verdict.at)})${verdict.note === null ? "" : `, note: ${code(verdict.note)}`}`);
      out.push(`A later review replaces it: ${reviewCommand}.`);
    }
  }

  protectedSection(out, journal.integrityChecks, result?.protectedChanged, "the run");

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

  // DR-47 (U-21): the agent's last message, in the words of the catalog's English
  // (report.final_message, summary.final_message_truncated), quoted as the end summary quotes it.
  const final = result?.reason === "plan_pending" ? undefined : result?.finalMessage;
  const quoted = final === undefined ? [] : quoteModelText(final.text, FINAL_MESSAGE_MAX_LINES);
  if (final !== undefined && quoted.length > 0) {
    out.push("", "## The agent's last message", "");
    out.push("The agent's last message. These are the agent's own words, not a verified fact.", "");
    out.push(...block(quoted.join("\n")));
    if (final.truncated) out.push("", `(cut: only the first ${MAX_FINAL_MESSAGE_CHARS} characters are shown)`);
  }

  out.push("", "## Usage", "");
  const limits = journal.limits;
  if (result !== null) {
    const usage = result.usage;
    out.push(`- Model turns: ${usage.modelTurns} of ${limits.maxModelTurns}`);
    // U-18: the failed calls only when there are any, so a report without them reads as before.
    const failed = failedToolCalls > 0 ? `, failed: ${failedToolCalls}` : "";
    out.push(`- Tool calls: ${usage.toolCalls} of ${limits.maxToolCalls} (denied: ${journal.deniedToolCalls}${failed})`);
    const tokens =
      usage.inputTokens === null || usage.outputTokens === null
        ? "not reported by every response"
        : `input ${usage.inputTokens}, output ${usage.outputTokens}`;
    out.push(`- Tokens: ${tokens} (limit: ${limits.maxTotalTokens === null ? "none" : limits.maxTotalTokens})`);
    out.push(`- Duration: ${usage.durationMs} ms of ${limits.maxDurationMs} ms`);
  } else {
    out.push(`- Model requests recorded: ${journal.modelRequests} (limit ${limits.maxModelTurns})`);
    out.push(`- Denied tool calls: ${journal.deniedToolCalls}`);
    if (failedToolCalls > 0) out.push(`- Failed tool calls: ${failedToolCalls}`);
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
// Apply runs (DR-12). The report forms (RunReportOutput with its verdict, ApplyReportOutput,
// ApplyReportJournalSummary) are the contract's (src/contracts/commands.ts, eab970f).

/** What an apply run report never covers. Each verifier's own limits are listed with it. */
export const APPLY_REPORT_FIXED_LIMITS: readonly string[] = [
  "A pass means the inventory check and the configured verifiers passed. It is not a review of the plan.",
  "There is no OS isolation: command verifiers ran with the user's rights and could reach the network.",
  "This report reads the apply run's own records. Commands allowed in other runs could have changed them.",
];

export function renderApplyReport(report: ApplyReportOutput, currentKey: KnownKeys = null): string {
  renderingKey = currentKey;
  try {
    return renderApplyReportText(report);
  } finally {
    renderingKey = null;
  }
}

function renderApplyReportText(report: ApplyReportOutput): string {
  const { result, journal } = report;
  const out: string[] = ["# Codaryn apply run report", ""];
  out.push(`- Run: ${code(report.runId)} (an apply run: no model takes part)`);
  out.push(`- Plan run: ${code(journal.planRunId)}, digest ${code(journal.digest)}`);
  out.push(`- Task: ${code(journal.taskId)}`);
  out.push(
    `- Approval: ${code(journal.approval)}; consent to unsafe moves: ${journal.unsafeMoveConsent === null ? "none" : code(journal.unsafeMoveConsent)}`,
  );
  if (result !== null) {
    out.push(`- Result: ${code(result.status)} / ${code(result.reason)}, exit code ${result.exitCode}`);
  } else {
    out.push("- Result: none. The apply run has no result.json: it is still running, or it stopped without writing one.");
    out.push(
      journal.finished === null
        ? "- The journal has no end record."
        : `- The journal's end record: ${code(journal.finished.status)} / ${code(journal.finished.reason)}`,
    );
  }
  out.push(`- Report: ${report.status} (${journal.records} journal records)`);

  out.push("", "## Preflight", "");
  if (journal.checked === null) {
    out.push("The journal has no preflight record: nothing was checked or moved.");
  } else {
    out.push(`- Actions that could not be applied: ${journal.checked.problems}`);
    out.push(`- Workspace too large to check: ${journal.checked.inventoryLimitReached ? "yes" : "no"}`);
    out.push(`- Moves that could only be made without the guarantee (no hard links): ${journal.checked.unsafeMoves}`);
  }

  const done = [
    ...journal.moved.map((item) => ({
      index: item.index,
      line: `move ${code(item.from)} -> ${code(item.to)}${item.unsafe ? " (moved without the guarantee, with consent)" : ""}`,
    })),
    ...journal.discarded.map((item) => ({
      index: item.index,
      line: `discard ${code(item.path)} (kept as ${code(`.codaryn/discarded/${report.runId}/${item.stored}`)})`,
    })),
  ].sort((a, b) => a.index - b.index);
  out.push("", `## Actions (${done.length} of ${journal.actions} done)`, "");
  if (done.length === 0 && journal.failed.length === 0) out.push("No action was applied.");
  for (const item of done) out.push(`- action ${item.index + 1}: ${item.line}`);
  for (const item of journal.failed) out.push(`- action ${item.index + 1} failed: ${code(item.problem)}`);
  const open = journal.started - done.length - journal.failed.length;
  if (open > 0) {
    out.push(`- ${open} action(s) were started with no record that they were done or failed; the revert handles them.`);
  }

  const verifiers = result?.verifiers ?? journal.lastRound;
  verificationSection(out, verifiers);
  protectedSection(out, journal.integrityChecks, result?.protectedChanged, "the apply");

  out.push("", "## Usage", "");
  if (result !== null) out.push(`- Duration: ${result.usage.durationMs} ms of ${journal.maxDurationMs} ms`);
  else out.push(`- Duration limit: ${journal.maxDurationMs} ms`);

  out.push("", "## Undo", "");
  out.push(`Revert this apply with ${code(`codaryn revert --workspace <workspace> --run ${report.runId}`)}.`);

  out.push("", "## Not checked", "");
  for (const [index, verifier] of verifiers.entries()) {
    for (const item of verifier.limits) out.push(`- verifier ${index + 1}: ${code(item)}`);
  }
  for (const item of APPLY_REPORT_FIXED_LIMITS) out.push(`- ${item}`);

  const notices = result?.notices ?? [];
  if (notices.length > 0) {
    out.push("", "## Notices", "");
    for (const notice of notices) out.push(`- ${code(notice)}`);
  }
  return `${out.join("\n")}\n`;
}

/** The verification section, shared by run and apply reports (N-24 a: verifiers by number). */
function verificationSection(out: string[], verifiers: readonly VerifierResult[]): void {
  out.push("", "## Verification", "");
  if (verifiers.length === 0) {
    out.push("No verifier result was recorded for the last round.");
    return;
  }
  for (const [index, verifier] of verifiers.entries()) {
    out.push(`- verifier ${index + 1} (${verifier.kind}): **${verifier.outcome}**`);
    for (const item of verifier.checked) out.push(`  - checked: ${code(item)}`);
    if (verifier.outcome !== "pass" && verifier.evidence.length > 0) {
      out.push("");
      for (const line of block(verifier.evidence)) out.push(`  ${line}`);
    }
  }
}

/** The protected material section, shared by run and apply reports. */
function protectedSection(
  out: string[],
  checks: readonly { readonly phase: IntegrityPhase; readonly changed: readonly MaskedText[] }[],
  resultChanged: readonly MaskedText[] | undefined,
  subject: string,
): void {
  out.push("", "## Protected material", "");
  const changedNow = resultChanged ?? checks[checks.length - 1]?.changed;
  if (checks.length === 0 && changedNow === undefined) {
    out.push(`Not checked: ${subject} had no integrity check (nothing was protected, or it ran without the check).`);
    return;
  }
  const phases = checks.map((check) => PHASE_LABEL[check.phase]);
  out.push(`Checked ${checks.length} time(s)${phases.length > 0 ? `: ${phases.join(", ")}` : ""}.`);
  if (changedNow === undefined || changedNow.length === 0) {
    out.push(`No protected path changed since ${subject} started.`);
  } else {
    out.push(`Changed since ${subject} started, or not checkable:`);
    for (const item of changedNow) out.push(`- ${code(item)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Files

export async function runReport(io: ReportEnvironment): Promise<CommandOutcome> {
  const parsed = parseReportArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
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
    inspect: io.inspectRun ?? inspectRun,
  });
  if (!reference.ok) return cliError(reference.code, reference.message);
  const runId = reference.runId;
  // N-27 (b), review R-7 I-2: the run list's judgment (record ownership, schema, times, and the
  // id's exact form, N-27 a) applies to the report too; its records are not shown as a report.
  let damaged: boolean;
  try {
    damaged = await (io.isDamaged ?? (async (workspaceRoot: string, id: string) => (await (io.inspectRun ?? inspectRun)(workspaceRoot, id)) === "damaged"))(root, runId);
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

  // DR-38: the run's records were changed by something else; the report is shown and says so.
  // A mark that cannot be read counts as one (fail closed).
  let recordsChanged: boolean;
  try {
    recordsChanged = await (io.hasRecordsChangedMark ?? hasRecordsChangedMark)(root, runId);
  } catch {
    recordsChanged = true;
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

  let report: RunReportOutput | ApplyReportOutput;
  let failedToolCalls = 0;
  try {
    const hasResult = resultState === "file";
    const journalText = await readRecordFile(journalFile);
    // DR-12: readers tell the two journals apart by the first record.
    if (firstRecordType(journalText) === "apply_started") {
      const journal = summarizeApplyJournal(journalText, runId, hasResult);
      const result = hasResult ? readApplyResult(await readRecordFile(resultFile), runId, journal) : null;
      const status: ReportStatus = result === null ? "incomplete" : "complete";
      report = { schemaVersion: 1, kind: "report", runKind: "apply", runId, status, exitCode: REPORT_EXIT_CODES[status], result, journal };
    } else {
      const journal = summarizeJournal(journalText, runId, hasResult);
      failedToolCalls = failedCallsIn(journalText);
      const result = hasResult ? readResult(await readRecordFile(resultFile), runId, journal.taskId) : null;
      const status: ReportStatus = result === null ? "incomplete" : "complete";
      // N-D 5th round: a run waiting for review shows the person's verdict (review.json) when there is one.
      let verdict: ReviewRecord | null | undefined;
      if (result?.reason === "awaiting_review") {
        try {
          verdict = await readReviewRecord(root, runId);
        } catch {
          verdict = null;
        }
      }
      report = {
        schemaVersion: 1,
        kind: "report",
        runId,
        status,
        exitCode: REPORT_EXIT_CODES[status],
        ...(recordsChanged ? { recordsChanged: true as const } : {}),
        result,
        journal,
        ...(verdict === undefined ? {} : { verdict }),
      };
    }
  } catch (error) {
    if (error instanceof RecordError) return cliError("invalid_run_record", `the run's records cannot be used: ${error.message}`);
    return cliError("invalid_run_record", "the run's records cannot be read");
  }

  // U-131 (N2, UXM-5): for the text only, what became of a plan run's apply, by the run list's rule
  // (planApplyStateOf, as `runs` and the plan view say). Best effort; the JSON does not carry it.
  let planApply: ReportPlanApply = null;
  if (!json && !("runKind" in report) && report.result?.plan !== undefined && io.listRuns !== undefined) {
    try {
      const entries = (await io.listRuns({ workspaceRoot: root })).runs;
      const entry = entries.find((other): other is CheckedRun => other.state === "checked" && other.runId === runId);
      planApply = entry === undefined ? null : planApplyStateOf(entry, entries);
    } catch {
      planApply = null;
    }
  }

  const currentKey = knownKeyValues(io.env);
  let text: string;
  try {
    // N-27 (c): keys are hidden in the strings before the JSON is written, as in the text.
    text = json
      ? jsonLine(hideKeysInStrings(report, currentKey))
      : "runKind" in report
        ? renderApplyReport(report, currentKey)
        : renderReport(report, currentKey, failedToolCalls, planApply);
  } catch {
    // X-2: everything printed comes from the records, so a failure here means records a run
    // would not write (changed or broken after the run), not an internal error.
    return cliError("invalid_run_record", "the run's records cannot be shown");
  }
  return { text: hideKeys(text, currentKey), exitCode: report.exitCode };
}
