/**
 * U-105 (app layer U-91, gap survey GUI 3.9): the apply preflight's judgement of each action
 * (contract plan.ts `PreflightPlan`). `applyPlan` calls it for its preflight (ApplyDeps step 2,
 * after the inventory), and it is given out so a caller that checks a plan before applying it (the
 * app layer's checkApply) does not judge again: the same function, not a copy.
 *
 * It moves, records and claims nothing. The executor's `check` makes its hard link probe and takes
 * it back as in the apply.
 */

import { PLAN_ACTION_DESCRIPTORS } from "../contracts/index.js";
import type { JsonObject, PlanItemProblem, PreflightPlan, ResolvedPlanAction } from "../contracts/index.js";

function pathArgs(action: ResolvedPlanAction): JsonObject {
  return action.kind === "move" ? { from: action.from, to: action.to } : { path: action.path };
}

export const preflightPlan: PreflightPlan = async ({ actions, planActions, policy, executor, stop }) => {
  /** The apply task's planActions and the policy gate, before and after (the paths are effective). */
  const permitted = async (action: ResolvedPlanAction, index: number): Promise<boolean> => {
    if (!planActions.includes(action.kind)) return false;
    const descriptor = PLAN_ACTION_DESCRIPTORS[action.kind];
    const call = { id: `action-${index}`, name: descriptor.name, args: pathArgs(action) };
    try {
      if (!policy.checkRequested(call, descriptor).allowed) return false;
      return (await policy.checkEffective(call, descriptor)).allowed;
    } catch {
      return false;
    }
  };

  const problems: { index: number; problem: PlanItemProblem }[] = [];
  /**
   * DR-21: actions the check found possible only unsafely (a discard moves the file too). They
   * are not problems; they need consent.
   */
  const unsafeMoves: number[] = [];
  for (const [index, action] of actions.entries()) {
    if (stop?.() === true) return { stopped: true };
    if (!(await permitted(action, index))) {
      problems.push({ index, problem: "denied" });
      continue;
    }
    let problem: PlanItemProblem | null;
    try {
      problem = await executor.check(action);
    } catch {
      problem = "io_error";
    }
    if (problem === "unsafe_move") unsafeMoves.push(index);
    else if (problem !== null) problems.push({ index, problem });
  }
  return { stopped: false, problems, unsafeMoves };
};
