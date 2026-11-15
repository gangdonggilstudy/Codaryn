/**
 * U-219 (p5a's request; contract plan.ts `JudgePlannedFile`): the gate's decision on one planned file
 * of an approved `run` plan, as the run that carries it out judges it before its first model request
 * (checkApprovedPlan). Given out, as preflightPlan is, so the app layer's check before the approval
 * can call the same function instead of its own lines; Codex V-21: it does not yet (p5a, U-229).
 */

import { PLANNED_FILE_DESCRIPTOR } from "../contracts/index.js";
import type { JudgePlannedFile } from "../contracts/index.js";

export const judgePlannedFile: JudgePlannedFile = async (policy, path) => {
  const call = { id: "approved-plan", name: PLANNED_FILE_DESCRIPTOR.name, args: { path } };
  const requested = policy.checkRequested(call, PLANNED_FILE_DESCRIPTOR);
  return requested.allowed ? policy.checkEffective(call, PLANNED_FILE_DESCRIPTOR) : requested;
};
