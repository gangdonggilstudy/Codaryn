/**
 * DR-17: the plan, apply and review types the app layer uses are the G-A contract's own.
 *
 * Until the contract base (`claude/general-tasks` b89ee16) was merged, this file repeated them.
 * It now only passes the contract's types on under the same names, so nothing else in `src/app`
 * changed with the switch. Only types are here: no behaviour, no constants.
 */

export type {
  AppliedActionRecord,
  ApplyJournalEntry,
  ApplyJournalEvent,
  ApplyJournalRecord,
  ApplyResult,
  ApprovalChannel,
  MaskedPlanAction,
  PlanItemProblem,
  PlanItemStartedEvent,
  PlanOutput,
  PlanStatus,
  ReviewOutput,
  ReviewVerdict,
  UnsafeMoveConsent,
} from "../contracts/index.js";

import type { ApplyResult } from "../contracts/index.js";

/** The reasons an apply run ends with (G-A APPLY_REASONS_BY_STATUS). */
export type ApplyReason = ApplyResult["reason"];
