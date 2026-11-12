/**
 * DR-17: the plan, apply and review types the app layer uses are the G-A contract's own.
 *
 * G-A (`claude/general-tasks`, contracts `f53fb16` and `720aa5a`; DR-21 consent `d32aae2`) is not in
 * main yet: it enters
 * main together with its N-B texts (DR-12). Until then this file repeats those types under the
 * same names and shapes, as `src/contracts/plan.ts` and `workflow.ts` define them. When G-A is
 * merged, this file becomes `export type { … } from "../contracts/index.js"` and nothing else in
 * `src/app` changes.
 *
 * Only types are here: no behaviour, no constants the app layer decides on.
 */

import type {
  ContentHash,
  JournalEvent,
  MaskedText,
  RunReason,
  RunUsage,
  TerminalRunStatus,
  VerifierResult,
} from "../contracts/index.js";

/** G-A plan.ts MaskedPlanAction. */
export type MaskedPlanAction =
  | { readonly kind: "move"; readonly from: MaskedText; readonly to: MaskedText; readonly sha256: ContentHash }
  | { readonly kind: "discard"; readonly path: MaskedText; readonly sha256: ContentHash };

/** G-A plan.ts PlanStatus. */
export type PlanStatus = "pending" | "applied";

/** G-A plan.ts PlanOutput: `codaryn plan --json`, plan.json masked again with the run's secrets (DR-5, DR-17). */
export interface PlanOutput {
  readonly schemaVersion: 1;
  readonly kind: "plan";
  readonly runId: string;
  readonly status: PlanStatus;
  readonly exitCode: number;
  readonly digest: ContentHash;
  readonly actions: readonly MaskedPlanAction[];
  /** DR-6: the workspace has more files than the inventory limit; an apply would stop as `plan_stale`. */
  readonly inventoryLimitReached: boolean;
  readonly appliedBy: { readonly runId: string; readonly at: string } | null;
}

/** G-A plan.ts ApprovalChannel. */
export type ApprovalChannel = "cli-tty" | "cli-flag" | "adapter";

/** G-A plan.ts PlanItemProblem. */
export type PlanItemProblem =
  | "source_missing"
  | "source_changed"
  | "source_not_file"
  | "destination_exists"
  | "destination_parent_not_dir"
  | "denied"
  | "cross_device"
  /** DR-21: the move could only be made unsafely (no hard links on that drive). */
  | "unsafe_move"
  | "io_error";

/** G-A plan.ts AppliedActionRecord. */
export interface AppliedActionRecord {
  readonly index: number;
  readonly action: MaskedPlanAction;
  readonly stored: string | null;
  /** DR-21: present and true for an action made unsafely, with the person's consent. */
  readonly unsafe?: true;
}

/** G-A engine.ts adds these reasons; main's RunReason does not have them yet. consent_required: DR-21. */
export type ApplyReason = RunReason | "plan_stale" | "apply_incomplete" | "consent_required";

/**
 * G-A plan.ts UnsafeMoveConsent (DR-21): a person's consent to the unsafe moves of one apply, for the
 * plan with this digest only. The app layer makes it only from ApplyPlanRequest.unsafeMoveConsent,
 * with channel `adapter` (consent.ts).
 */
export interface UnsafeMoveConsent {
  readonly channel: ApprovalChannel;
  readonly digest: ContentHash;
}

/** G-A plan.ts ApplyResult: `codaryn apply`'s output and the apply run's result.json. */
export interface ApplyResult {
  readonly schemaVersion: 1;
  readonly kind: "apply";
  readonly runId: string;
  readonly planRunId: string;
  readonly taskId: string;
  readonly digest: ContentHash;
  readonly status: TerminalRunStatus;
  readonly reason: ApplyReason;
  readonly exitCode: number;
  readonly applied: readonly AppliedActionRecord[];
  readonly verifiers: readonly VerifierResult[];
  readonly usage: RunUsage;
  readonly journalPath: string;
  readonly notices: readonly MaskedText[];
  readonly protectedChanged?: readonly MaskedText[];
}

/** G-A plan.ts ApplyJournalEvent: an apply run's records (it starts with `apply_started`). */
export type ApplyJournalEvent =
  | {
      readonly type: "apply_started";
      readonly schemaVersion: 1;
      readonly planRunId: string;
      readonly taskId: string;
      readonly digest: ContentHash;
      readonly approval: ApprovalChannel;
      readonly actions: number;
      readonly maxDurationMs: number;
      /** DR-21: the consent's channel, or null for none. Absent before DR-21. */
      readonly unsafeMoveConsent?: ApprovalChannel | null;
    }
  | {
      readonly type: "plan_checked";
      readonly problems: readonly { readonly index: number; readonly problem: PlanItemProblem }[];
      readonly inventoryLimitReached: boolean;
      /** DR-21: indexes of the actions that could only be made unsafely, in plan order. Absent before DR-21. */
      readonly unsafeMoves?: readonly number[];
    }
  | {
      readonly type: "file_moved";
      readonly index: number;
      readonly from: MaskedText;
      readonly to: MaskedText;
      readonly sha256: ContentHash;
      readonly unsafe?: true;
    }
  | {
      readonly type: "file_discarded";
      readonly index: number;
      readonly path: MaskedText;
      readonly stored: string;
      readonly sha256: ContentHash;
      readonly unsafe?: true;
    }
  | { readonly type: "plan_item_failed"; readonly index: number; readonly problem: PlanItemProblem }
  | Extract<JournalEvent, { readonly type: "verifier_result" | "integrity_checked" | "run_finished" }>;

/** G-A plan.ts ApplyJournalRecord. */
export type ApplyJournalRecord = ApplyJournalEvent & {
  readonly seq: number;
  readonly at: string;
  readonly runId: string;
};

/** G-A workflow.ts ReviewVerdict. */
export type ReviewVerdict = "accepted" | "rejected";

/** G-A workflow.ts ReviewOutput: `codaryn review --json`. */
export interface ReviewOutput {
  readonly schemaVersion: 1;
  readonly kind: "review";
  readonly runId: string;
  readonly verdict: ReviewVerdict;
  readonly exitCode: number;
  readonly checklist: readonly MaskedText[];
  readonly replaced: boolean;
}
