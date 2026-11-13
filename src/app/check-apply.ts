/**
 * U-91 (gap survey, GUI 3.9, DR-21; PM: the engine's PlanExecutor.check as it is, no copied
 * judgement): a pending plan checked before it is applied (`checkApply`, adapter-contract 5.14), so
 * the plan screen can show which actions cannot be applied and which moves would need the person's
 * consent before the first apply rather than after it.
 *
 * - The refusals before anything is checked are the apply's (app.ts): the plan view's own (`plan`,
 *   the CLI's runPlan: the run, the plan, DR-28), the apply task's plan setting, the plan already
 *   applied, a records-changed mark and the digest. Here the stored plan is loaded once more (the
 *   store's loadPlan, for its paths) and must be the one the view judged (same digest, not applied).
 * - The judgement is the apply preflight's, action by action, with the apply task's settings:
 *   - the apply task's `planActions` and the policy gate before and after the paths are resolved
 *     (`createPolicyGate`, PLAN_ACTION_DESCRIPTORS), called as `applyPlan` calls them. The engine
 *     keeps that call inside `applyPlan`; until it gives it out (preflightPlan, gap survey 3-a) it
 *     is made here the same way, and the tests compare it with the apply's own `plan_checked`;
 *   - then the executor's `check` (tools' `createPlanExecutor`), as it is: the source, its hash, the
 *     destination, and DR-21's hard link probe;
 *   - the inventory limit (DR-6) is the plan view's listing (the same `createInventoryChecker`).
 * - The executor's probe makes a second name of a source file for a moment (in the state directory
 *   when it is on the same volume, else next to the source). So the check holds the workspace lock
 *   while it runs (`workspace_locked` when another run holds it), and before it ends it looks for a
 *   probe of this process that the executor could not take back and removes it. A probe or a lock
 *   it cannot take back is told (`probesLeft`, `lockLeft`), never hidden.
 * - R-81 L1: before it checks, under the lock, it removes every probe name it finds in the state
 *   directory and the plan's source folders. A check or an apply probes only under this lock, so
 *   such a name is a probe an ended process left (between making and removing it), or one an
 *   earlier check told as left. Removed ones are told (`probesRemoved`), the rest in `probesLeft`.
 * - Nothing is moved, recorded or claimed: no run directory, journal, plan_checked record or
 *   applied mark. The result holds indexes, codes, counts and the digest only; it is no consent
 *   (DR-21) and no promise: the apply checks again.
 */

import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { MIN_PLAN_DIGEST_PREFIX, PLAN_ACTION_DESCRIPTORS, STATE_DIR_NAME } from "../contracts/index.js";
import type { Clock, ContentHash, JsonObject, PlanItemProblem, ResolvedPlanAction, ResolvedTaskSpec } from "../contracts/index.js";
import { RUN_ID_PATTERN } from "../cli/args.js";
import { createRunId } from "../cli/run-id.js";
import { createPolicyGate } from "../policy/index.js";
import { acquireLock, loadPlan, releaseLock as storeReleaseLock } from "../store/index.js";
import { createPlanExecutor } from "../tools/index.js";
import type { PlanFileOps } from "../tools/index.js";
import { createWorkspace } from "../workspace/index.js";
import { appError } from "./errors.js";
import type { AppCallOutcome, AppError, PlanCheck } from "./types.js";

const DIGEST_PREFIX = new RegExp(`^[0-9a-f]{${MIN_PLAN_DIGEST_PREFIX},64}$`);
/** The executor's probe names (tools' probeHardLink): `.codaryn-link-probe-<pid>-<time>-<random>`, any process. */
const PROBE_NAME = /^\.codaryn-link-probe-\d+-[0-9a-z]+-[0-9a-z]+$/;

/** The request's plan run and digest, checked before anything is read. */
export function checkApplyArguments(
  request: unknown,
): { readonly ok: true; readonly planRunId: string; readonly digest: string } | { readonly ok: false; readonly error: AppError } {
  const refuse = (message: string) => ({ ok: false as const, error: appError("invalid_arguments", message) });
  if (typeof request !== "object" || request === null) return refuse("the request must be an object; nothing was checked");
  const { planRunId, digest } = request as { planRunId?: unknown; digest?: unknown };
  if (typeof planRunId !== "string" || !RUN_ID_PATTERN.test(planRunId) || planRunId.includes("..")) {
    return refuse("the plan run id must be 1-128 characters of letters, digits, '.', '_' and '-'; nothing was checked");
  }
  if (planRunId === "latest") return refuse('the plan run must be named by its own id (the plan shown), not "latest"; nothing was checked');
  if (typeof digest !== "string" || !DIGEST_PREFIX.test(digest)) {
    return refuse(`the digest must be the plan's digest or its first ${MIN_PLAN_DIGEST_PREFIX} or more lowercase hex characters; nothing was checked`);
  }
  return { ok: true, planRunId, digest };
}

/** What the refusals before the check left: the plan, the apply task and the plan view's listing. */
export interface ApplyCheckSource {
  /** The workspace's real root. */
  readonly workspaceRoot: string;
  /** The apply task (its policy and planActions), as the apply resolves it. */
  readonly task: ResolvedTaskSpec;
  readonly planRunId: string;
  /** The full digest of the plan the view judged. */
  readonly digest: ContentHash;
  /** DR-6, from the plan view's listing. */
  readonly inventoryLimitReached: boolean;
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
}

/** Tests only: the executor's file operations, the probe removal and the lock release. */
export interface ApplyCheckOperations {
  readonly fileOps?: Partial<PlanFileOps>;
  readonly removeProbe?: (file: string) => Promise<void>;
  readonly releaseLock?: (options: { readonly workspaceRoot: string; readonly runId: string }) => Promise<boolean>;
}

const sourceOf = (action: ResolvedPlanAction): string => (action.kind === "move" ? action.from : action.path);

/** Probe names in `dirs` (files and anything else; only files are removed). */
async function probesIn(dirs: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) if (PROBE_NAME.test(name)) found.add(path.join(dir, name));
  }
  return found;
}

async function present(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return code !== "ENOENT" && code !== "ENOTDIR";
  }
}

/** Removes the probes that are plain files; how many were removed and how many are still there. */
async function removeProbes(probes: Iterable<string>, operations: ApplyCheckOperations): Promise<{ removed: number; left: number }> {
  let removed = 0;
  let left = 0;
  for (const probe of probes) {
    let file = false;
    try {
      const info = await lstat(probe);
      file = info.isFile() && !info.isSymbolicLink();
      if (file) await (operations.removeProbe ?? unlink)(probe);
    } catch {
      // Counted below when it is still there.
    }
    if (!file) continue;
    if (await present(probe)) left += 1;
    else removed += 1;
  }
  return { removed, left };
}

/** Checks the plan of `source` under the workspace lock; takes back the lock and every probe it can. */
export async function checkApplyIn(source: ApplyCheckSource, operations: ApplyCheckOperations = {}): Promise<AppCallOutcome<PlanCheck>> {
  const { workspaceRoot, task, planRunId, digest } = source;
  let workspace;
  try {
    workspace = await createWorkspace({ root: workspaceRoot });
  } catch {
    return { ok: false, error: appError("workspace_not_found", "the workspace is not an existing directory; nothing was checked") };
  }
  const loaded = await loadPlan({ workspaceRoot: workspace.root, runId: planRunId });
  if (!loaded.ok) return { ok: false, error: appError(loaded.code, "the plan run's plan cannot be loaded; nothing was checked") };
  if (loaded.digest !== digest) return { ok: false, error: appError("plan_not_approved", "the plan changed since it was shown; nothing was checked") };
  if (loaded.applied !== null) return { ok: false, error: appError("plan_already_applied", "that plan was already applied; nothing was checked") };
  const actions: readonly ResolvedPlanAction[] = loaded.plan.actions;

  const lockId = createRunId(new Date(source.clock.now()), source.randomBytes);
  const lock = await acquireLock({ workspaceRoot: workspace.root, runId: lockId, clock: source.clock });
  if (!lock.ok) return { ok: false, error: appError("workspace_locked", "another run or revert holds the workspace; nothing was checked") };

  const problems: { index: number; problem: PlanItemProblem }[] = [];
  const unsafeMoves: number[] = [];
  let probesLeft = 0;
  let probesRemoved = 0;
  let lockLeft = false;
  let failed = false;
  try {
    // Where the executor may probe: the state directory, or next to a source (resolved as it resolves them).
    const dirs = new Set<string>([path.join(workspace.root, STATE_DIR_NAME)]);
    for (const action of actions) {
      const resolved = await workspace.resolve(sourceOf(action), "read");
      if (resolved.ok) dirs.add(path.dirname(resolved.path.absolute));
    }
    // R-81 L1: probes an ended check or apply left (only one holding this lock probes here).
    const earlier = await removeProbes(await probesIn([...dirs]), operations);
    probesRemoved = earlier.removed;
    probesLeft += earlier.left;
    // What is still there is told already; the sweep below takes this check's own probes.
    const before = await probesIn([...dirs]);
    try {
      const policy = createPolicyGate({ config: task.policy, workspace });
      const planActions = task.policy.planActions ?? [];
      const executor = createPlanExecutor({ workspace, workspaceRoot: workspace.root, runId: lockId, ...(operations.fileOps === undefined ? {} : { fileOps: operations.fileOps }) });
      // The apply task's planActions and the policy gate, before and after (as applyPlan calls them).
      const permitted = async (action: ResolvedPlanAction, index: number): Promise<boolean> => {
        if (!planActions.includes(action.kind)) return false;
        const descriptor = PLAN_ACTION_DESCRIPTORS[action.kind];
        const args: JsonObject = action.kind === "move" ? { from: action.from, to: action.to } : { path: action.path };
        const call = { id: `action-${index}`, name: descriptor.name, args };
        try {
          if (!policy.checkRequested(call, descriptor).allowed) return false;
          return (await policy.checkEffective(call, descriptor)).allowed;
        } catch {
          return false;
        }
      };
      for (const [index, action] of actions.entries()) {
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
    } catch {
      failed = true;
    } finally {
      // A probe the executor could not take back is a second name of a source file: removed here.
      const own = [...(await probesIn([...dirs]))].filter((probe) => !before.has(probe));
      probesLeft += (await removeProbes(own, operations)).left;
    }
  } catch {
    failed = true;
  } finally {
    const release = operations.releaseLock ?? storeReleaseLock;
    let released = false;
    for (let attempt = 0; attempt < 2 && !released; attempt += 1) {
      try {
        await release({ workspaceRoot: workspace.root, runId: lockId });
        released = true;
      } catch {
        // Tried once more, then told.
      }
    }
    lockLeft = !released;
  }
  if (failed) return { ok: false, error: appError("internal_error", `the plan could not be checked; nothing was moved${probesLeft > 0 || lockLeft ? " (a probe or the lock was left)" : ""}`) };
  return {
    ok: true,
    output: {
      kind: "plan_check",
      planRunId,
      digest,
      checkedAt: new Date(source.clock.now()).toISOString(),
      problems,
      unsafeMoves,
      inventoryLimitReached: source.inventoryLimitReached,
      probesLeft,
      probesRemoved,
      lockLeft,
    },
  };
}
