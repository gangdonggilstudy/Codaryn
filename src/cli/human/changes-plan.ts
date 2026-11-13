/**
 * U-191 (DR-69 B-1, B-3): the plan view of a `run` plan (StoredChangesPlan, `kind: "changes"`), on the
 * store's loadAnyPlan. changesPlanOutput makes ChangesPlanOutput from the loaded plan: each path masked
 * again with the secrets registered now (DR-28, as a plan of mode apply), and the summary, the plan
 * run's description of the work (not the goal or new instructions), from its visible parts.
 * renderChangesPlan is its text for people. A plan of
 * mode apply keeps its own view (renderPlan, src/cli/plan-commands.ts), unchanged. Nothing here reads
 * or writes a file: `codaryn plan` and the approval screen choose a view by the plan's kind with B-4.
 */

import { MIN_PLAN_DIGEST_PREFIX, PLAN_EXIT_CODES, PLANNED_FILE_CHANGES, RESULT_SCHEMA_VERSION, maskedParts, sameMaskedParts, toRunId } from "../../contracts/index.js";
import type {
  ChangesPlanOutput,
  ContentHash,
  MaskedParts,
  MaskedPlannedFile,
  MaskedText,
  MessageCatalog,
  PlanAppliedRecord,
  PlannedFileChange,
  PrivacyGateway,
  RunId,
  StoredChangesPlan,
} from "../../contracts/index.js";
import { createMessageCatalog } from "../../i18n/index.js";
import { isRunTimestamp } from "../../store/index.js";
import type { KnownKeys } from "../security/index.js";
import { cleanText, hideKeys } from "../text-safety.js";
import { displayWidth, formatLocalTime, quoteModelText } from "./format.js";

/**
 * Where the plan run's masking took a value out of the summary. The stored summary holds only the
 * visible parts (MaskedParts: no token, no secret value), so the view joins them at this mark. PM: the
 * engine's own mark for these gaps (APPROVED_SUMMARY_GAP), so that the summary a person sees and the
 * text the run that carries the plan out is given are the same to the letter.
 */
export const SUMMARY_HIDDEN_MARKER = "[masked]";

/** The summary's visible parts as one text, SUMMARY_HIDDEN_MARKER where the plan run took a value out. */
export function changesPlanSummaryText(parts: MaskedParts): string {
  return parts.join(SUMMARY_HIDDEN_MARKER);
}

/** loadAnyPlan's outcome for a `run` plan: the plan, its digest and applied.json (null while pending). */
export interface LoadedChangesPlan {
  readonly plan: StoredChangesPlan;
  readonly digest: ContentHash;
  readonly applied: PlanAppliedRecord | null;
}

export type ChangesPlanViewOutcome =
  | { readonly ok: true; readonly output: ChangesPlanOutput }
  | { readonly ok: false; readonly code: "plan_secrets_differ" | "internal_error" };

/**
 * ChangesPlanOutput for a loaded `run` plan.
 * - Each path is masked with `privacy` (the secrets registered now) and must leave exactly the visible
 *   parts the plan run stored (`shown`, DR-28); otherwise nothing is shown (`plan_secrets_differ`), as
 *   for a plan of mode apply. The files keep the plan's order.
 * - summary: the visible parts joined at SUMMARY_HIDDEN_MARKER, masked with `privacy` too. R-103 M-1:
 *   then made safe in the output itself, as the move plan's summary is (R-49 R49-M1, planSummary),
 *   so every output that carries it (--json, the app layer, the approval screen) has it: key shapes
 *   and `options.currentKey` hidden, control characters replaced, trimmed. Line feeds and tabs stay
 *   (cleanText's keepLineBreaks): it is stored with them (safeModelText) and shown with them to the
 *   later run as the approved plan's description.
 * - A masking that fails: `internal_error`.
 * - status: `applied` once applied.json names the run that carried the plan out (appliedBy), else
 *   `pending`. recordsChanged: when the caller found a records-changed mark on the plan run.
 */
export function changesPlanOutput(
  loaded: LoadedChangesPlan,
  privacy: Pick<PrivacyGateway, "mask">,
  options: { readonly recordsChanged?: boolean; readonly currentKey?: KnownKeys } = {},
): ChangesPlanViewOutcome {
  const files: MaskedPlannedFile[] = [];
  for (const file of loaded.plan.files) {
    const masked = privacy.mask(file.path);
    if (!masked.ok) return { ok: false, code: "internal_error" };
    if (!sameMaskedParts(maskedParts(masked.text), file.shown)) return { ok: false, code: "plan_secrets_differ" };
    files.push(file.change === "create" ? { path: masked.text, change: "create", sha256: null } : { path: masked.text, change: "modify", sha256: file.sha256 });
  }
  const summary = privacy.mask(changesPlanSummaryText(loaded.plan.summary));
  if (!summary.ok) return { ok: false, code: "internal_error" };
  // R-103 M-1: the same hiding as the move plan's summary (planSummary), line feeds and tabs kept.
  const shownSummary = cleanText(hideKeys(summary.text, options.currentKey ?? null), true).trim() as MaskedText;
  const status = loaded.applied === null ? "pending" : "applied";
  return {
    ok: true,
    output: {
      schemaVersion: RESULT_SCHEMA_VERSION,
      kind: "plan",
      planKind: "changes",
      runId: loaded.plan.runId,
      status,
      exitCode: PLAN_EXIT_CODES[status],
      digest: loaded.digest,
      files,
      summary: shownSummary,
      appliedBy: loaded.applied === null ? null : { runId: loaded.applied.applyRunId, at: loaded.applied.at },
      ...(options.recordsChanged === true ? { recordsChanged: true as const } : {}),
    },
  };
}

function runIdOf(value: string): RunId {
  const runId = toRunId(value);
  if (runId === null) throw new TypeError("a plan view needs run ids");
  return runId;
}

/**
 * The text of a `run` plan's view, in the shape of renderPlan's:
 * - plan.records_changed first when the plan run has a records-changed mark;
 * - plan.changes.heading (the number of files, plan.status.<status>), plan.digest_label and the digest;
 * - one line per file: its number, plan.change.<change> padded to the widest change word in terminal
 *   columns and two more, and its masked path, cleaned and with key shapes hidden;
 * - plan.changes.summary_label and the summary as the model's words (quoteModelText). Every row is
 *   shown: the summary is part of what a person approves (R-99 L-1);
 * - plan.applied_by with the local time once carried out; else plan.cannot_apply when marked; else
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
    messages.format("plan.changes.heading", { runId, count: output.files.length, status: messages.format(`plan.status.${output.status}`) }),
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
    lines.push(`${messages.format("plan.applied_by", { runId: runIdOf(appliedBy.runId) })}${time}`);
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
