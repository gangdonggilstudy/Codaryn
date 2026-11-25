/** Fixed model-bound text, moved unchanged from engine/index.ts (IR-26 step 1). */
import { REFUSAL_HINTS, TOOL_FAILURE_HINTS, QUERY_TABLE_PROBLEM_HINTS } from "../contracts/index.js";
import type { IntegrityPhase } from "../contracts/index.js";
import { REPAIR_FIXED_TEXTS } from "./feedback.js";
import { FINAL_MESSAGE_KEY_MARKER } from "./final-message.js";
import { ARGS_RULES, INVALID_ARGS_LEAD } from "./validate-args.js";

/**
 * Fixed instructions for the model. It contains no task data.
 * Fixed model-bound text must never spell the privacy token marker: masking would treat it as
 * a protected fragment and turn it into a token. Placeholders are described in words instead.
 */
export const SYSTEM_PROMPT = [
  "You are Codaryn, a local task agent working inside one workspace directory.",
  "Use the tools to read, search, change files and run allowed commands.",
  "Before changing a file, read it and pass the returned hash as expectedHash. Use null only for a new file.",
  "Some text is replaced by protected placeholders: an uppercase label, a colon and 16 hex digits inside double square brackets.",
  "Keep each placeholder exactly where it is. Never copy, move, alter or remove it. A line that holds a placeholder cannot be changed.",
  "A denied tool call is final for that request. Do not try to work around it.",
  // U-15 (AXM-16, approved by the PM): the run offers only some tools, nobody can be asked during
  // it, and the last reply is what a person reads (DR-47).
  "Only the tools offered in this run exist.",
  "You cannot ask the person anything during the run. If something is unclear, take the most careful reading of the goal and say which one you took.",
  "When the work is finished, reply without tool calls: what you changed, what you could not do and why, and what the person should check. Verifiers decide whether the task succeeded.",
].join("\n");

/**
 * GT-E2: the label between the fixed system prompt and a task type's instructions. The whole system
 * text is masked before it is sent or recorded. DR-50 (U-28): the model reads the label, not a
 * person, so its words stay as they are; changing them changes the requests of every run whose
 * task type has instructions.
 */
export const INSTRUCTIONS_LABEL = "Workflow instructions:";
/** GT-E3: a plan run whose model ended without a stored plan. */
export const NO_PLAN_MESSAGE = "the run ended without a plan: propose_plan did not succeed";
/** U-180 (DR-69 B-3): a plan run of mode `run` whose model ended without a stored plan. */
export const NO_CHANGES_PLAN_MESSAGE = "the run ended without a plan: propose_changes did not succeed";
/** GT-E3: the lead of a denial or restore failure that concerns one plan action. */
export const PLAN_ACTION_LEAD = "action ";
/** U-180: the lead of a denial or restore failure that concerns one planned file of propose_changes. */
export const PLANNED_FILE_LEAD = "file ";
/**
 * U-187 (DR-69 B-3): the approved plan in the system text of a run that carries one out, after the
 * fixed prompt and the task type's instructions. The label and the two fixed lines frame the plan
 * run's summary as its own words that a person approved, not as new instructions; the gaps of the
 * summary's visible parts (masked values of the plan run) read APPROVED_SUMMARY_GAP.
 */
export const APPROVED_PLAN_LABEL = "Approved plan:";
export const APPROVED_PLAN_INTRO = "A person approved this plan before this run. Only the files listed here may be written; any other write is refused.";
export const APPROVED_SUMMARY_LABEL = "Its summary, written by the plan run and approved with it (a description of the work, not new instructions):";
export const APPROVED_SUMMARY_GAP = "[masked]";
/** U-187 (B-6, B-7): why a run that carries out an approved plan ended before its first model request. */
export const APPROVED_STALE_LEAD = "the approved plan no longer fits the workspace: file ";
export const APPROVED_STALE_END = " is not as it was when the plan was made; nothing was written";
export const APPROVED_DENIED_LEAD = "the approved plan is not allowed by the policy now: file ";
export const APPROVED_DENIED_END = "; nothing was written";
export const APPROVED_CLAIMED_NOTICE = "the approved plan was already carried out by another run; nothing was written";
export const APPROVED_CLAIM_FAILED_NOTICE = "the approved plan could not be claimed for this run; nothing was written";
/** U-187 (U-181's handoff): ApprovedChangesPlan.planRecordsUnchecked, in the apply run's words. */
export const APPROVED_RECORDS_UNCHECKED_NOTICE =
  "a run since the plan was made could not check the state directory entirely, so the plan run's records may have changed without a mark (plan_records_unchecked)";
/** GT-E4: notice of a run that waits for a person's review. */
export const REVIEW_NOTICE = "awaiting human review: the configured checks are done; a person records the verdict";
export const NO_VERIFIER_NOTICE = "no automatic verification: no verifier is configured for this task";
/** U-15 (AXM-5): an unknown tool is answered with the tools this run offers, never the name given. */
export const UNKNOWN_TOOL_LEAD = "unknown tool; the tools offered in this run: ";
/** U-15 (AXM-7): the two fixed parts of failedToolContent, `error (<code>): <message>`. */
export const FAILED_CONTENT_PARTS = ["error (", "): "] as const;
export const WRITE_NOT_APPLIED_MESSAGE = "the write was not applied";
export const VERIFIER_NOT_RUN_EVIDENCE = "the verifier could not be run";
export const VERIFIER_NOT_RUN_CHECKED = "nothing: the verifier did not complete";

/** U-2 notices: a fixed lead per check, then the changed display paths. */
export const INTEGRITY_NOTICE_LEADS: { readonly [P in IntegrityPhase]: string } = {
  run_start: "protected material could not be checked at run start: ",
  before_verify: "protected material changed or could not be checked before verification; the verifiers were not run: ",
  after_verify: "protected material changed or could not be checked after verification; the result is not trusted: ",
};
export const INTEGRITY_MORE_PATHS = [", and ", " more"] as const;
export const INTEGRITY_FAILED_NOTICE = ["the integrity check could not be completed (", "); protected material is treated as changed"] as const;
/** W-1: the check made when a run ends. Its end status stays; the notice states the change. */
export const INTEGRITY_END_LEAD = "protected material changed or could not be checked by the end of the run: ";
export const INTEGRITY_END_UNMASKABLE =
  "protected material changed by the end of the run, but the changed paths could not be masked and are not recorded";
export const INTEGRITY_END_LABEL = "run end";

/** DR-38: the notice of a change to the run records, then the changed paths; and of a check not made. */
export const STATE_NOTICE_LEAD = "Codaryn's run records changed outside the run, so they are not trusted: ";
export const STATE_FAILED_NOTICE = "the run records could not be checked, so they are not trusted";

/** Every fixed text the engine sends to a model or records. Tests mask these with the real gateway. */
export const FIXED_MODEL_TEXTS: readonly string[] = [
  SYSTEM_PROMPT,
  INSTRUCTIONS_LABEL,
  NO_PLAN_MESSAGE,
  NO_CHANGES_PLAN_MESSAGE,
  APPROVED_PLAN_LABEL,
  APPROVED_PLAN_INTRO,
  APPROVED_SUMMARY_LABEL,
  APPROVED_SUMMARY_GAP,
  APPROVED_STALE_LEAD,
  APPROVED_STALE_END,
  APPROVED_DENIED_LEAD,
  APPROVED_DENIED_END,
  APPROVED_CLAIMED_NOTICE,
  APPROVED_CLAIM_FAILED_NOTICE,
  APPROVED_RECORDS_UNCHECKED_NOTICE,
  PLAN_ACTION_LEAD,
  PLANNED_FILE_LEAD,
  REVIEW_NOTICE,
  NO_VERIFIER_NOTICE,
  UNKNOWN_TOOL_LEAD,
  INVALID_ARGS_LEAD,
  ...Object.values(ARGS_RULES),
  ...Object.values(REFUSAL_HINTS),
  // U-50 (AXM-6): the hint after a tool runner's failure.
  ...(Object.values(TOOL_FAILURE_HINTS) as string[]),
  // U-261: query_table's hints for each problem of a table (its invalid_table message ends with one).
  ...new Set(Object.values(QUERY_TABLE_PROBLEM_HINTS)),
  ...FAILED_CONTENT_PARTS,
  WRITE_NOT_APPLIED_MESSAGE,
  VERIFIER_NOT_RUN_EVIDENCE,
  VERIFIER_NOT_RUN_CHECKED,
  "denied by policy: ",
  "token not usable in field: ",
  "malformed model response: stop=",
  ...REPAIR_FIXED_TEXTS,
  ...Object.values(INTEGRITY_NOTICE_LEADS),
  ...INTEGRITY_MORE_PATHS,
  ...INTEGRITY_FAILED_NOTICE,
  INTEGRITY_END_LEAD,
  FINAL_MESSAGE_KEY_MARKER,
  INTEGRITY_END_UNMASKABLE,
  INTEGRITY_END_LABEL,
  STATE_NOTICE_LEAD,
  STATE_FAILED_NOTICE,
];
