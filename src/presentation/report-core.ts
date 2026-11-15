import type { ReportPlanApply } from "./report.js";
import type { ReportWords } from "./report-words.js";
import { MAX_FINAL_MESSAGE_CHARS } from "../contracts/index.js";
import type {
  ApplyReportOutput,
  IntegrityPhase,
  MaskedText,
  RunReportOutput,
  VerifierResult,
} from "../contracts/index.js";
import type { KnownKeys } from "../app/input/security/index.js";
import { cleanText, hideKeys } from "../app/input/text-safety.js";
import { FINAL_MESSAGE_MAX_LINES } from "../app/model-text.js";
import { quoteModelText } from "../app/input/format.js";

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

function short(text: ReportWords, hash: string | null): string {
  return hash === null ? text`none` : hash.slice(0, 12);
}

/**
 * What a run report never covers. Each verifier's own limits are listed with it. U-166 (AXM-17):
 * what masking leaves out, as privacy.md 13 says; no count (DR-52 keeps the counts out of the text).
 * An apply run sends nothing to a model, so its list (APPLY_REPORT_FIXED_LIMITS) has no such line.
 */


/** `failedToolCalls` (U-18): the journal's failed calls (failedCallsIn), told in the text only. */
/** U-131 (N2): what became of a plan run's apply, by the run list's rule (planApplyStateOf); text only. */


export function renderRunReportCore(text: ReportWords, fixedLimits: readonly string[], report: RunReportOutput, currentKey: KnownKeys = null, failedToolCalls = 0, planApply: ReportPlanApply = null): string {
  renderingKey = currentKey;
  try {
    return renderReportText(text, fixedLimits, report, failedToolCalls, planApply);
  } finally {
    renderingKey = null;
  }
}

/**
 * U-131 (N2, UXM-5): a plan run's line. Without an apply of it, the plan waits for approval as
 * before; with one, what became of that apply, in the words `runs` uses (runs.plan_*).
 */
function planLine(text: ReportWords, actions: number, digest: string, runId: string, apply: ReportPlanApply, kind?: "changes"): string {
  if (kind === "changes") return changesPlanLine(text, actions, digest, runId, apply);
  if (apply === null) return text`- Plan: ${`${actions}`} action(s) waiting for approval, digest ${`${code(digest)}`}. See it with ${`${code("codaryn plan --run " + runId)}`}.`;
  const id = code(apply.applyRunId);
  const itsReport = text`(its report: ${`${code("codaryn report --run " + apply.applyRunId)}`})`;
  switch (apply.state) {
    case "applied":
      return text`- Plan: ${`${actions}`} action(s), applied by run ${`${id}`} ${`${itsReport}`}.`;
    case "unfinished":
      return text`- Plan: ${`${actions}`} action(s); its apply by run ${`${id}`} did not finish${`${apply.reason === undefined ? "" : ` (${code(apply.reason)})`}`} ${`${itsReport}`}.`;
    case "applying":
      return text`- Plan: ${`${actions}`} action(s); being applied by run ${`${id}`}, or that apply stopped without a result.`;
    case "reverted":
      return text`- Plan: ${`${actions}`} action(s), applied by run ${`${id}`}, then reverted ${`${itsReport}`}.`;
    case "record_missing":
      return text`- Plan: ${`${actions}`} action(s); taken up by run ${`${id}`}, whose records cannot be read (removed, or they cannot be checked).`;
  }
}

/**
 * U-195 (DR-69 B-3): a run plan's line. Its files are written by a later run that carries the plan
 * out, which ends as a run does (a run without checks ends needs-input/no_verifier, its work done),
 * so the line names that run's end instead of an apply that did not finish.
 */
function changesPlanLine(text: ReportWords, files: number, digest: string, runId: string, apply: ReportPlanApply): string {
  if (apply === null) return text`- Plan: ${`${files}`} file(s) to write, waiting for approval, digest ${`${code(digest)}`}. See it with ${`${code("codaryn plan --run " + runId)}`}.`;
  const id = code(apply.applyRunId);
  const itsReport = text`(its report: ${`${code("codaryn report --run " + apply.applyRunId)}`})`;
  switch (apply.state) {
    case "applied":
      return text`- Plan: ${`${files}`} file(s) to write, carried out by run ${`${id}`} ${`${itsReport}`}.`;
    case "unfinished":
      return text`- Plan: ${`${files}`} file(s) to write; carried out by run ${`${id}`}, which ended as ${`${apply.reason === undefined ? text`other than done` : code(apply.reason)}`} ${`${itsReport}`}.`;
    case "applying":
      return text`- Plan: ${`${files}`} file(s) to write; being carried out by run ${`${id}`}, or that run stopped without a result.`;
    case "reverted":
      return text`- Plan: ${`${files}`} file(s) to write, carried out by run ${`${id}`}, then reverted ${`${itsReport}`}.`;
    case "record_missing":
      return text`- Plan: ${`${files}`} file(s) to write; taken up by run ${`${id}`}, whose records cannot be read (removed, or they cannot be checked).`;
  }
}

function renderReportText(text: ReportWords, fixedLimits: readonly string[], report: RunReportOutput, failedToolCalls: number, planApply: ReportPlanApply = null): string {
  const { result, journal } = report;
  const out: string[] = [text`# Codaryn run report`, ""];
  out.push(text`- Run: ${`${code(report.runId)}`}`);
  // DR-50 (U-58): the words for people; the JSON keeps its field `workflow`.
  out.push(text`- Task: ${`${code(journal.taskId)}`} (task type ${`${code(journal.workflow)}`})`);
  out.push(
    text`- Provider: ${`${code(journal.provider)}`}${`${journal.provider === "scripted" ? text` (scripted model; no API was called)` : ""}`}`,
  );
  if (result !== null) {
    out.push(text`- Result: ${`${code(result.status)}`} / ${`${code(result.reason)}`}, exit code ${`${result.exitCode}`}`);
    if (result.plan !== undefined) out.push(planLine(text, result.plan.actions, result.plan.digest, report.runId, planApply, result.plan.kind));
    // U-195 (DR-69 B-3): the run that carried out an approved run plan names it.
    if (result.planRunId !== undefined && result.planDigest !== undefined) {
      out.push(text`- Plan run: ${`${code(result.planRunId)}`}, digest ${`${code(result.planDigest)}`} (this run carried out its approved plan)`);
    }
  } else {
    out.push(text`- Result: none. The run has no result.json: it is still running, or it stopped without writing one.`);
    out.push(
      journal.finished === null
        ? text`- The journal has no end record.`
        : text`- The journal's end record: ${`${code(journal.finished.status)}`} / ${`${code(journal.finished.reason)}`}`,
    );
  }
  out.push(text`- Report: ${`${report.status}`} (${`${journal.records}`} journal records)`);
  // DR-38: in the words of the catalog's English (report.records_changed).
  if (report.recordsChanged === true) {
    out.push("", text`This run has a records-changed mark: something other than the run changed its records, so this report may not match what happened.`);
  }

  const verifiers = result?.verifiers ?? journal.lastRound;
  // N-24 (a): a verifier is shown by its number in the run's verifier order; the id is in --json only.
  verificationSection(text, out, verifiers);
  if (journal.repairs > 0) out.push("", text`Repairs started: ${`${journal.repairs}`}.`);
  if (result?.review !== undefined) {
    out.push("", text`## Review checklist`, "");
    const verdict = report.verdict ?? null;
    const reviewCommand = code("codaryn review --run " + report.runId + " --accept | --reject");
    // U-131 (N1, AXM-21): the run waits for a verdict only while it has none.
    if (verdict === null) out.push(text`The run waits for a person's verdict (${`${reviewCommand}`}).`);
    for (const item of result.review.checklist) out.push(`- ${code(item)}`);
    out.push("");
    if (verdict === null) {
      out.push(text`No verdict yet.`);
    } else {
      out.push(text`Verdict: **${`${verdict.verdict}`}** (${`${code(verdict.at)}`})${`${verdict.note === null ? "" : text`, note: ${`${code(verdict.note)}`}`}`}`);
      out.push(text`A later review replaces it: ${`${reviewCommand}`}.`);
    }
  }

  protectedSection(text, out, journal.integrityChecks, result?.protectedChanged, text`the run`);

  const changes = result?.changes ?? journal.changes;
  out.push("", text`## Changes (${`${changes.length}`})`, "");
  if (changes.length === 0) out.push(text`No file tool write was recorded.`);
  for (const change of changes) {
    out.push(
      change.created
        ? text`- ${`${code(change.path)}`} created (${`${short(text, change.newHash)}`})`
        : text`- ${`${code(change.path)}`} changed (${`${short(text, change.previousHash)}`} -> ${`${short(text, change.newHash)}`})`,
    );
  }

  // DR-47 (U-21): the agent's last message, in the words of the catalog's English
  // (report.final_message, summary.final_message_truncated), quoted as the end summary quotes it.
  const final = result?.reason === "plan_pending" ? undefined : result?.finalMessage;
  const quoted = final === undefined ? [] : quoteModelText(final.text, FINAL_MESSAGE_MAX_LINES);
  if (final !== undefined && quoted.length > 0) {
    out.push("", text`## The agent's last message`, "");
    out.push(text`The agent's last message. These are the agent's own words, not a verified fact.`, "");
    out.push(...block(quoted.join("\n")));
    if (final.truncated) out.push("", text`(cut: only the first ${`${MAX_FINAL_MESSAGE_CHARS}`} characters are shown)`);
  }

  out.push("", text`## Usage`, "");
  const limits = journal.limits;
  if (result !== null) {
    const usage = result.usage;
    out.push(text`- Model turns: ${`${usage.modelTurns}`} of ${`${limits.maxModelTurns}`}`);
    // U-18: the failed calls only when there are any, so a report without them reads as before.
    const failed = failedToolCalls > 0 ? text`, failed: ${`${failedToolCalls}`}` : "";
    out.push(text`- Tool calls: ${`${usage.toolCalls}`} of ${`${limits.maxToolCalls}`} (denied: ${`${journal.deniedToolCalls}`}${`${failed}`})`);
    const tokens =
      usage.inputTokens === null || usage.outputTokens === null
        ? text`not reported by every response`
        : text`input ${`${usage.inputTokens}`}, output ${`${usage.outputTokens}`}`;
    out.push(text`- Tokens: ${`${tokens}`} (limit: ${`${limits.maxTotalTokens === null ? text`none` : limits.maxTotalTokens}`})`);
    out.push(text`- Duration: ${`${usage.durationMs}`} ms of ${`${limits.maxDurationMs}`} ms`);
  } else {
    out.push(text`- Model requests recorded: ${`${journal.modelRequests}`} (limit ${`${limits.maxModelTurns}`})`);
    out.push(text`- Denied tool calls: ${`${journal.deniedToolCalls}`}`);
    if (failedToolCalls > 0) out.push(text`- Failed tool calls: ${`${failedToolCalls}`}`);
  }
  out.push(text`- Repairs: ${`${journal.repairs}`}${`${limits.maxRepairAttempts === undefined ? "" : text` of ${`${limits.maxRepairAttempts}`}`}`}`);

  out.push("", text`## Not checked`, "");
  for (const [index, verifier] of verifiers.entries()) {
    for (const item of verifier.limits) out.push(text`- verifier ${`${index + 1}`}: ${`${code(item)}`}`);
  }
  for (const item of fixedLimits) out.push(`- ${text.limit(item)}`);

  const notices = result?.notices ?? [];
  if (notices.length > 0) {
    out.push("", text`## Notices`, "");
    for (const notice of notices) out.push(`- ${code(notice)}`);
  }
  return `${out.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------
// Apply runs (DR-12). The report forms (RunReportOutput with its verdict, ApplyReportOutput,
// ApplyReportJournalSummary) are the contract's (src/contracts/commands.ts, eab970f).

/** What an apply run report never covers. Each verifier's own limits are listed with it. */


export function renderApplyReportCore(text: ReportWords, fixedLimits: readonly string[], report: ApplyReportOutput, currentKey: KnownKeys = null): string {
  renderingKey = currentKey;
  try {
    return renderApplyReportText(text, fixedLimits, report);
  } finally {
    renderingKey = null;
  }
}

function renderApplyReportText(text: ReportWords, fixedLimits: readonly string[], report: ApplyReportOutput): string {
  const { result, journal } = report;
  const out: string[] = [text`# Codaryn apply run report`, ""];
  out.push(text`- Run: ${`${code(report.runId)}`} (an apply run: no model takes part)`);
  out.push(text`- Plan run: ${`${code(journal.planRunId)}`}, digest ${`${code(journal.digest)}`}`);
  out.push(text`- Task: ${`${code(journal.taskId)}`}`);
  out.push(
    text`- Approval: ${`${code(journal.approval)}`}; consent to unsafe moves: ${`${journal.unsafeMoveConsent === null ? text`none` : code(journal.unsafeMoveConsent)}`}`,
  );
  if (result !== null) {
    out.push(text`- Result: ${`${code(result.status)}`} / ${`${code(result.reason)}`}, exit code ${`${result.exitCode}`}`);
  } else {
    out.push(text`- Result: none. The apply run has no result.json: it is still running, or it stopped without writing one.`);
    out.push(
      journal.finished === null
        ? text`- The journal has no end record.`
        : text`- The journal's end record: ${`${code(journal.finished.status)}`} / ${`${code(journal.finished.reason)}`}`,
    );
  }
  out.push(text`- Report: ${`${report.status}`} (${`${journal.records}`} journal records)`);

  out.push("", text`## Preflight`, "");
  if (journal.checked === null) {
    out.push(text`The journal has no preflight record: nothing was checked or moved.`);
  } else {
    out.push(text`- Actions that could not be applied: ${`${journal.checked.problems}`}`);
    out.push(text`- Workspace too large to check: ${`${journal.checked.inventoryLimitReached ? text`yes` : text`no`}`}`);
    out.push(text`- Moves that could only be made without the guarantee (no hard links): ${`${journal.checked.unsafeMoves}`}`);
  }

  const done = [
    ...journal.moved.map((item) => ({
      index: item.index,
      line: text`move ${`${code(item.from)}`} -> ${`${code(item.to)}`}${`${item.unsafe ? text` (moved without the guarantee, with consent)` : ""}`}`,
    })),
    ...journal.discarded.map((item) => ({
      index: item.index,
      line: text`discard ${`${code(item.path)}`} (kept as ${`${code(`.codaryn/discarded/${report.runId}/${item.stored}`)}`})`,
    })),
  ].sort((a, b) => a.index - b.index);
  out.push("", text`## Actions (${`${done.length}`} of ${`${journal.actions}`} done)`, "");
  if (done.length === 0 && journal.failed.length === 0) out.push(text`No action was applied.`);
  for (const item of done) out.push(text`- action ${`${item.index + 1}`}: ${`${item.line}`}`);
  for (const item of journal.failed) out.push(text`- action ${`${item.index + 1}`} failed: ${`${code(item.problem)}`}`);
  const open = journal.started - done.length - journal.failed.length;
  if (open > 0) {
    out.push(text`- ${`${open}`} action(s) were started with no record that they were done or failed; the revert handles them.`);
  }

  const verifiers = result?.verifiers ?? journal.lastRound;
  verificationSection(text, out, verifiers);
  protectedSection(text, out, journal.integrityChecks, result?.protectedChanged, text`the apply`);

  out.push("", text`## Usage`, "");
  if (result !== null) out.push(text`- Duration: ${`${result.usage.durationMs}`} ms of ${`${journal.maxDurationMs}`} ms`);
  else out.push(text`- Duration limit: ${`${journal.maxDurationMs}`} ms`);

  out.push("", text`## Undo`, "");
  out.push(text`Revert this apply with ${`${code(`codaryn revert --workspace <workspace> --run ${report.runId}`)}`}.`);

  out.push("", text`## Not checked`, "");
  for (const [index, verifier] of verifiers.entries()) {
    for (const item of verifier.limits) out.push(text`- verifier ${`${index + 1}`}: ${`${code(item)}`}`);
  }
  for (const item of fixedLimits) out.push(`- ${text.limit(item)}`);

  const notices = result?.notices ?? [];
  if (notices.length > 0) {
    out.push("", text`## Notices`, "");
    for (const notice of notices) out.push(`- ${code(notice)}`);
  }
  return `${out.join("\n")}\n`;
}

/** The verification section, shared by run and apply reports (N-24 a: verifiers by number). */
function verificationSection(text: ReportWords, out: string[], verifiers: readonly VerifierResult[]): void {
  out.push("", text`## Verification`, "");
  if (verifiers.length === 0) {
    out.push(text`No verifier result was recorded for the last round.`);
    return;
  }
  for (const [index, verifier] of verifiers.entries()) {
    out.push(text`- verifier ${`${index + 1}`} (${`${verifier.kind}`}): **${`${verifier.outcome}`}**`);
    for (const item of verifier.checked) out.push(text`  - checked: ${`${code(item)}`}`);
    if (verifier.outcome !== "pass" && verifier.evidence.length > 0) {
      out.push("");
      for (const line of block(verifier.evidence)) out.push(`  ${line}`);
    }
  }
}

/** The protected material section, shared by run and apply reports. */
function protectedSection(
  text: ReportWords,
  out: string[],
  checks: readonly { readonly phase: IntegrityPhase; readonly changed: readonly MaskedText[] }[],
  resultChanged: readonly MaskedText[] | undefined,
  subject: string,
): void {
  out.push("", text`## Protected material`, "");
  const changedNow = resultChanged ?? checks[checks.length - 1]?.changed;
  if (checks.length === 0 && changedNow === undefined) {
    out.push(text`Not checked: ${`${subject}`} had no integrity check (nothing was protected, or it ran without the check).`);
    return;
  }
  const PHASE_LABEL: { readonly [P in IntegrityPhase]: string } = {
    run_start: text`at run start`,
    before_verify: text`before verification`,
    after_verify: text`after verification`,
  };
  const phases = checks.map((check) => PHASE_LABEL[check.phase]);
  out.push(text`Checked ${`${checks.length}`} time(s)${`${phases.length > 0 ? `: ${phases.join(", ")}` : ""}`}.`);
  if (changedNow === undefined || changedNow.length === 0) {
    out.push(text`No protected path changed since ${`${subject}`} started.`);
  } else {
    out.push(text`Changed since ${`${subject}`} started, or not checkable:`);
    for (const item of changedNow) out.push(`- ${code(item)}`);
  }
}
