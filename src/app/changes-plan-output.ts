/** U-328: the changes plan's pure output closure, moved from cli/human/changes-plan.ts. */
import { PLAN_EXIT_CODES, RESULT_SCHEMA_VERSION, maskedParts, sameMaskedParts } from "../contracts/index.js";
import type { ChangesPlanOutput, ContentHash, MaskedParts, MaskedPlannedFile, MaskedText, PlanAppliedRecord, PrivacyGateway, StoredChangesPlan } from "../contracts/index.js";
import type { KnownKeys } from "./input/security/index.js";
import { cleanText, hideKeys } from "./input/text-safety.js";

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
