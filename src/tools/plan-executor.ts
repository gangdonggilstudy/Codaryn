/**
 * The deterministic plan executor (G-C). Contract: PlanExecutor (src/contracts/plan.ts).
 * Design: docs/design/general-tasks.md 6.4, decisions GT-D4, GT-D5, DR-5, DR-9.
 *
 * It carries out stored plan actions in the workspace and judges no policy (the engine does).
 * - Every workspace path goes through `Workspace.resolve`. The only place written outside it is
 *   the apply run's own `.codaryn/discarded/<runId>/` (DR-9).
 * - A move never replaces an existing file and never copies (`moveNoReplace`).
 * - A discard renames the file into the discarded directory under a name built from the action
 *   index only, never from the file name.
 * - The source must still be the file the plan hashed: `check` hashes it, and `apply` hashes it
 *   again unless the file's identity (device, inode, size, modification time) is still what
 *   `check` hashed.
 * - Cancelling is the engine's job between actions. `apply` does not stop an item half way: a
 *   signal that is already aborted, or aborts during a hash, ends the item before anything changed.
 */

import path from "node:path";

import { DISCARDED_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import type {
  PlanExecutor,
  PlanExecutorOptions,
  PlanItemOutcome,
  PlanItemProblem,
  ResolvedPlanAction,
  Workspace,
} from "../contracts/index.js";

import {
  createParents,
  errorCode,
  hashFile,
  hashProblem,
  inspectDestination,
  inspectSource,
  isMissing,
  moveNoReplace,
  nodePlanFileOps,
  sameIdentity,
} from "./plan-files.js";
import type { FileIdentity, PlanFileOps } from "./plan-files.js";

/** Same rule as the CLI's run ids: starts with a letter or digit, at most 128 characters, no "..". */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface PlanExecutorDeps extends PlanExecutorOptions {
  /** The apply run's workspace. Its `root` must equal `workspaceRoot`. */
  readonly workspace: Workspace;
  /** For tests: replaces parts of the file system to simulate failures. */
  readonly fileOps?: Partial<PlanFileOps>;
}

function sourceOf(action: ResolvedPlanAction): string {
  return action.kind === "move" ? action.from : action.path;
}

function itemFailure(problem: PlanItemProblem): PlanItemOutcome {
  return { ok: false, problem };
}

export function createPlanExecutor(deps: PlanExecutorDeps): PlanExecutor {
  const { workspace, runId } = deps;
  if (deps.workspaceRoot !== workspace.root) {
    throw new Error("plan executor: workspaceRoot must be the workspace's real root");
  }
  if (!RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    throw new Error("plan executor: invalid run id");
  }
  const ops: PlanFileOps = { ...nodePlanFileOps, ...deps.fileOps };
  const root = workspace.root;

  /** What `check` hashed, by action (kind, source, planned hash). Lets `apply` skip a second hash. */
  const verified = new Map<string, { readonly identity: FileIdentity; readonly sha256: string }>();
  const verifiedKey = (action: ResolvedPlanAction): string => `${action.kind}\u0000${sourceOf(action)}\u0000${action.sha256}`;

  /** Checks the source as it is now. On success, its identity matches the plan's hash. */
  async function checkSource(
    action: ResolvedPlanAction,
    signal: AbortSignal | undefined,
  ): Promise<{ ok: true; absolute: string; identity: FileIdentity } | { ok: false; problem: PlanItemProblem }> {
    const source = await inspectSource(workspace, sourceOf(action), ops);
    if (!source.ok) return { ok: false, problem: source.problem };
    const known = verified.get(verifiedKey(action));
    if (known !== undefined && sameIdentity(known.identity, source.identity)) {
      return { ok: true, absolute: source.path.absolute, identity: source.identity };
    }
    const hashed = await hashFile(source.path.absolute, {
      expected: source.identity,
      ...(signal === undefined ? {} : { signal }),
    });
    if (!hashed.ok) return { ok: false, problem: hashProblem(hashed.reason) };
    if (hashed.hash !== action.sha256) return { ok: false, problem: "source_changed" };
    verified.set(verifiedKey(action), { identity: source.identity, sha256: hashed.hash });
    return { ok: true, absolute: source.path.absolute, identity: source.identity };
  }

  /**
   * Makes `<root>/.codaryn/discarded/<runId>/` and checks that each level is a real directory, not
   * a link, so the discarded file stays inside the workspace's state directory.
   */
  async function discardedDir(): Promise<{ ok: true; dir: string } | { ok: false }> {
    let current = root;
    for (const segment of [STATE_DIR_NAME, DISCARDED_DIR_NAME, runId]) {
      current = path.join(current, segment);
      try {
        await ops.mkdir(current);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") return { ok: false };
      }
      try {
        const stat = await ops.lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return { ok: false };
      } catch {
        return { ok: false };
      }
    }
    return { ok: true, dir: current };
  }

  return {
    async check(action) {
      try {
        const source = await checkSource(action, undefined);
        if (!source.ok) return source.problem;
        if (action.kind === "move") {
          const destination = await inspectDestination(workspace, action.to, ops);
          if (!destination.ok) return destination.problem;
        }
        return null;
      } catch {
        return "io_error";
      }
    },

    async apply(action, index, signal) {
      try {
        if (signal.aborted) return itemFailure("io_error");
        if (!Number.isInteger(index) || index < 0) return itemFailure("io_error");
        const source = await checkSource(action, signal);
        if (!source.ok) return itemFailure(source.problem);

        let target: string;
        let stored: string | null = null;
        if (action.kind === "move") {
          const destination = await inspectDestination(workspace, action.to, ops);
          if (!destination.ok) return itemFailure(destination.problem);
          const parents = await createParents(root, destination.path.absolute, ops);
          if (parents !== null) return itemFailure(parents);
          target = destination.path.absolute;
        } else {
          const discarded = await discardedDir();
          if (!discarded.ok) return itemFailure("io_error");
          stored = String(index);
          target = path.join(discarded.dir, stored);
        }

        // Last look before the rename: the source must still be the checked file.
        try {
          const now = await ops.lstat(source.absolute);
          if (now.isSymbolicLink() || !now.isFile()) return itemFailure("source_changed");
          if (now.dev !== source.identity.dev || now.ino !== source.identity.ino) return itemFailure("source_changed");
        } catch (error) {
          return itemFailure(isMissing(error) ? "source_missing" : "io_error");
        }

        const moved = await moveNoReplace(source.absolute, target, ops);
        if (moved !== "moved") {
          // A discard target is new and named by index only: "exists" there is not the plan's fault.
          if (moved === "destination_exists" && action.kind === "discard") return itemFailure("io_error");
          return itemFailure(moved);
        }
        return { ok: true, applied: { index, action, stored } };
      } catch {
        return itemFailure("io_error");
      }
    },
  };
}
