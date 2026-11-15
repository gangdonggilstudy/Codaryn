/**
 * U-191 (DR-69 B-1, B-3): the plan view of a `run` plan (StoredChangesPlan, `kind: "changes"`), on the
 * store's loadAnyPlan. changesPlanOutput makes ChangesPlanOutput from the loaded plan: each path masked
 * again with the secrets registered now (DR-28, as a plan of mode apply), and the summary, the plan
 * run's description of the work (not the goal or new instructions), from its visible parts.
 * renderChangesPlan is its text for people. A plan of
 * mode apply keeps its own view (renderPlan, src/cli/plan-commands.ts), unchanged. Nothing here reads
 * or writes a file: `codaryn plan` and the approval screen choose a view by the plan's kind with B-4.
 */

import { MIN_PLAN_DIGEST_PREFIX, PLANNED_FILE_CHANGES, toRunId } from "../../contracts/index.js";
import type {
  ChangesPlanOutput,
  MessageCatalog,
  PlannedFileChange,
  RunId,
} from "../../contracts/index.js";
import { createMessageCatalog } from "../../i18n/index.js";
import { isRunTimestamp } from "../../store/index.js";
import type { KnownKeys } from "../../app/input/security/index.js";
import { cleanText, hideKeys } from "../../app/input/text-safety.js";
import { displayWidth, formatLocalTime, quoteModelText } from "../../app/input/format.js";

import { SUMMARY_HIDDEN_MARKER, changesPlanSummaryText, changesPlanOutput } from "../../app/changes-plan-output.js";
import type { LoadedChangesPlan, ChangesPlanViewOutcome } from "../../app/changes-plan-output.js";
export { SUMMARY_HIDDEN_MARKER, changesPlanSummaryText, changesPlanOutput };
export type { LoadedChangesPlan, ChangesPlanViewOutcome };

function runIdOf(value: string): RunId {
  const runId = toRunId(value);
  if (runId === null) throw new TypeError("a plan view needs run ids");
  return runId;
}

/**
 * The text of a `run` plan's view, in the shape of renderPlan's:
 * - plan.records_changed first when the plan run has a records-changed mark;
 * - plan.changes.heading (the number of files, plan.status.<status>; U-221: plan.changes.status_carried_out
 *   once carried out, as the report and the run list name it), plan.digest_label and the digest;
 * - one line per file: its number, plan.change.<change> padded to the widest change word in terminal
 *   columns and two more, and its masked path, cleaned and with key shapes hidden;
 * - plan.changes.summary_label and the summary as the model's words (quoteModelText). Every row is
 *   shown: the summary is part of what a person approves (R-99 L-1);
 * - plan.changes.carried_by (U-221) with the local time once carried out; else plan.cannot_apply when marked; else
 *   plan.changes.next_apply and the digest's first MIN_PLAN_DIGEST_PREFIX characters;
 * - plan.changes.digest_guarantee last.
 * `messages`: English when not given.
 */
export function renderChangesPlan(output: ChangesPlanOutput, currentKey: KnownKeys, messages: MessageCatalog = createMessageCatalog("en")): string {
  const shown = (text: string): string => cleanText(hideKeys(text, currentKey));
  const runId = runIdOf(output.runId);
  const marked = output.recordsChanged === true;
  const words: { readonly [C in PlannedFileChange]: string } = {
    create: messages.format("plan.change.create"),
    modify: messages.format("plan.change.modify"),
  };
  const width = Math.max(...PLANNED_FILE_CHANGES.map((change) => displayWidth(words[change]))) + 2;
  const lines: string[] = [
    ...(marked ? [messages.format("plan.records_changed")] : []),
    messages.format("plan.changes.heading", {
      runId,
      count: output.files.length,
      status: output.status === "applied" ? messages.format("plan.changes.status_carried_out") : messages.format(`plan.status.${output.status}`),
    }),
    // The digest is an item after its label (G-A: no message takes a digest).
    `${messages.format("plan.digest_label")}: ${output.digest}`,
    ...output.files.map((file, index) => `  ${index + 1}. ${words[file.change]}${" ".repeat(width - displayWidth(words[file.change]))}${shown(file.path)}`),
  ];
  const summaryRows = quoteModelText(hideKeys(output.summary, currentKey), Number.POSITIVE_INFINITY);
  if (summaryRows.length > 0) lines.push(`${messages.format("plan.changes.summary_label")}:`, ...summaryRows);
  const appliedBy = output.appliedBy;
  if (appliedBy !== null) {
    // UXM-23, as renderPlan: the local wall time, left out when it is not a run timestamp.
    const time = isRunTimestamp(appliedBy.at) ? ` (${formatLocalTime(Date.parse(appliedBy.at))})` : "";
    lines.push(`${messages.format("plan.changes.carried_by", { runId: runIdOf(appliedBy.runId) })}${time}`);
  } else if (marked) {
    lines.push(messages.format("plan.cannot_apply"));
  } else {
    lines.push(`${messages.format("plan.changes.next_apply", { runId })} ${output.digest.slice(0, MIN_PLAN_DIGEST_PREFIX)}`);
  }
  lines.push(messages.format("plan.changes.digest_guarantee"));
  return `${lines.join("\n")}\n`;
}

/**
 * U-198 (DR-69 B-3, B-8): what the CLI knows of the run that would carry a `run` plan out, for the lines
 * before a person approves it. Draft for na-core (U-195), which fills it from the task it prepared.
 * - commandsAllowed: the run may run commands (its tools include `run_command` and its policy has a
 *   command rule). Such a command is not bound to the plan's files (B-8), and the approval says so.
 */
export interface ChangesApprovalContext {
  readonly commandsAllowed: boolean;
}

/**
 * U-198: the lines between a `run` plan's view (renderChangesPlan) and changesApplyQuestion at a
 * terminal: apply.changes.what (a run whose file tools write only these {count} files),
 * apply.changes.summary_note when the view shows the summary (the model's description of the work,
 * approved with the plan, not the goal or a new instruction; only the files are enforced), and
 * apply.changes.commands_note when commands are allowed.
 */
export function changesApprovalText(output: ChangesPlanOutput, context: ChangesApprovalContext, messages: MessageCatalog = createMessageCatalog("en")): string {
  const lines: string[] = [messages.format("apply.changes.what", { count: output.files.length })];
  if (quoteModelText(output.summary, Number.POSITIVE_INFINITY).length > 0) lines.push(messages.format("apply.changes.summary_note"));
  if (context.commandsAllowed === true) lines.push(messages.format("apply.changes.commands_note"));
  return `${lines.join("\n")}\n`;
}

/** U-198: apply's question for a `run` plan (apply.changes_question, then the [y/N] text), as applyQuestion. */
export function changesApplyQuestion(messages: MessageCatalog = createMessageCatalog("en")): string {
  return `${messages.format("apply.changes_question")} ${messages.format("prompt.yes_no_default_no")} `;
}
