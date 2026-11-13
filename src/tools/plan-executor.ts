/**
 * The deterministic plan executor (G-C). Contract: PlanExecutor (src/contracts/plan.ts).
 * Design: docs/design/general-tasks.md 6.4, decisions GT-D4, GT-D5, DR-5, DR-9.
 *
 * It carries out stored plan actions in the workspace and judges no policy (the engine does).
 * - Every workspace path goes through `Workspace.resolve`. The only place written outside it is
 *   the apply run's own `.codaryn/discarded/<runId>/` (DR-9).
 * - A move never replaces an existing file and never copies (`moveNoReplace`). Where hard links
 *   cannot be used it does not move (DR-18 b, HARD_LINK_UNAVAILABLE_PROBLEM): `check` finds that
 *   ahead of the apply, and the engine ends the apply as `consent_required` (DR-21). Only with the
 *   person's consent for this apply (`allowUnsafeMove`) does `apply` look once more that the
 *   destination is absent and rename (`renameIfAbsent`), marking the outcome `unsafe`.
 * - A discard moves the file the same way into the discarded directory, under a name built from
 *   the action index only, never from the file name.
 * - The source must still be the file the plan hashed: `check` hashes it, and `apply` hashes it
 *   again unless the file's identity (device, inode, size, modification time) is still what
 *   `check` hashed.
 * - Cancelling is the engine's job between actions. `apply` does not stop an item half way: a
 *   signal that is already aborted, or aborts during a hash, ends the item before anything changed,
 *   as `io_error` because PLAN_ITEM_PROBLEMS has no cancel. The engine looks at the signal before
 *   each action and after a failed one and ends the apply as cancelled (PQ-2, DR-18 d, R-5 L-3).
 */

import path from "node:path";

import { DISCARDED_DIR_NAME, STATE_DIR_NAME, discardedStoredName } from "../contracts/index.js";
import type {
  CreatePlanExecutor,
  PlanExecutor,
  PlanExecutorOptions,
  PlanItemOutcome,
  PlanItemProblem,
  ResolvedPlanAction,
} from "../contracts/index.js";

import {
  HARD_LINK_UNAVAILABLE_PROBLEM,
  createParents,
  errorCode,
  hashFile,
  hashProblem,
  identityOf,
  inspectDestination,
  inspectSource,
  isMissing,
  moveNoReplace,
  nodePlanFileOps,
  probeHardLink,
  renameIfAbsent,
  sameIdentity,
} from "./plan-files.js";
import type { FileIdentity, PlanFileOps } from "./plan-files.js";

/** Same rule as the CLI's run ids: starts with a letter or digit, at most 128 characters, no "..". */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * The contract's options (`workspace`, `workspaceRoot`, `runId`; `workspaceRoot` must equal
 * `workspace.root`) and, for tests only, replacements for parts of the file system.
 */
export interface PlanExecutorDeps extends PlanExecutorOptions {
  readonly fileOps?: Partial<PlanFileOps>;
}

/** The real absolute path of an apply run's discarded files (DR-9), as ApplyDeps.discardedRoot names it. */
export function discardedRootOf(workspaceRoot: string, runId: string): string {
  return path.join(workspaceRoot, STATE_DIR_NAME, DISCARDED_DIR_NAME, runId);
}

function sourceOf(action: ResolvedPlanAction): string {
  return action.kind === "move" ? action.from : action.path;
}

function itemFailure(problem: PlanItemProblem): PlanItemOutcome {
  return { ok: false, problem };
}

/** U-105: tools' executor always tells the probes it left (PlanExecutor.probesLeft). */
export type CountingPlanExecutor = PlanExecutor & { probesLeft(): number };

export function createPlanExecutor(deps: PlanExecutorDeps): CountingPlanExecutor {
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

  /** PQ-6: hard link support, probed once per volume (device id) of the sources. */
  const linkSupport = new Map<bigint, "supported" | "unsupported">();
  /** U-105: probes made and not taken back (probeHardLink's `onLeft`). */
  let probesLeft = 0;

  /**
   * PQ-6, DR-18 (b): tells the preflight before any action whether moves are possible on the
   * source's volume. The probe goes into the state directory when it is on the same volume (no
   * name appears among the person's files), else next to the source, and is taken back at once.
   * A definite answer is kept for the volume; "unknown" is not, so the apply decides per move.
   * U-105: a probe that cannot be taken back is counted (`probesLeft`); the answer is unchanged.
   */
  async function hardLinkProblem(sourceAbsolute: string, identity: FileIdentity): Promise<PlanItemProblem | null> {
    const known = linkSupport.get(identity.dev);
    if (known !== undefined) return known === "unsupported" ? HARD_LINK_UNAVAILABLE_PROBLEM : null;
    let dir = path.dirname(sourceAbsolute);
    try {
      const state = await ops.lstat(path.join(root, STATE_DIR_NAME));
      if (state.isDirectory() && !state.isSymbolicLink() && state.dev === identity.dev) dir = path.join(root, STATE_DIR_NAME);
    } catch {
      // No state directory: probe next to the source.
    }
    const probed = await probeHardLink(sourceAbsolute, dir, ops, () => {
      probesLeft += 1;
    });
    if (probed === "unknown") return null;
    linkSupport.set(identity.dev, probed);
    return probed === "unsupported" ? HARD_LINK_UNAVAILABLE_PROBLEM : null;
  }

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
      // Same path as discardedRootOf(root, runId) once the loop ends.
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
        // DR-21: a move that could only be made unsafely is reported here, before any action, so
        // the engine can list it (plan_checked.unsafeMoves) and ask for the person's consent.
        return await hardLinkProblem(source.absolute, source.identity);
      } catch {
        return "io_error";
      }
    },

    async apply(action, index, signal, options) {
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
          stored = discardedStoredName(index);
          target = path.join(discarded.dir, stored);
        }

        // Last look before the move: the source must still be the checked file, with the size and
        // modification time it had when it was hashed (R-5 I-5). An edit in place between this
        // look and the link is not seen here; the inventory check compares the hash afterwards.
        try {
          const now = await ops.lstat(source.absolute);
          if (now.isSymbolicLink() || !now.isFile()) return itemFailure("source_changed");
          if (!sameIdentity(identityOf(now), source.identity)) return itemFailure("source_changed");
        } catch (error) {
          return itemFailure(isMissing(error) ? "source_missing" : "io_error");
        }

        let moved = await moveNoReplace(source.absolute, target, ops);
        let unsafe = false;
        if (moved === "no_hard_link") {
          // DR-18 (b): no move that could replace a file, unless the person consented to that for
          // this apply (DR-21). The engine passes the consent only for the actions the preflight
          // listed as unsafe. The source is still the checked file: moveNoReplace changed nothing.
          if (options?.allowUnsafeMove !== true) return itemFailure(HARD_LINK_UNAVAILABLE_PROBLEM);
          moved = await renameIfAbsent(source.absolute, target, ops);
          unsafe = moved === "moved";
        }
        if (moved !== "moved") {
          // A discard target is new and named by index only: "exists" there is not the plan's fault.
          if (moved === "destination_exists" && action.kind === "discard") return itemFailure("io_error");
          return itemFailure(moved);
        }
        return { ok: true, applied: { index, action, stored, ...(unsafe ? { unsafe: true as const } : {}) } };
      } catch {
        return itemFailure("io_error");
      }
    },

    probesLeft() {
      return probesLeft;
    },
  };
}

// The function takes the contract's options (plus test-only `fileOps`), so it is a CreatePlanExecutor.
createPlanExecutor satisfies CreatePlanExecutor;
