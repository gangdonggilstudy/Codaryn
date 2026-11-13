/**
 * U-211 (after U-176 and U-193; ne-verify: a lock left blocks the workspace until the app closes):
 * a lock release that failed is tried once more a few seconds later.
 *
 * - U-176: the store's releaseLock tries again for under a second when the lock file is held (EBUSY,
 *   EPERM), then throws, and the lock stays, held while this process lives. The app is a long-lived
 *   process, so a file held a little longer (a scanner, an indexer) blocked the workspace until the
 *   app closed. Now the app tries again after LOCK_RELEASE_RETRY_DELAYS_MS.
 * - Only that lock: each try is the store's releaseLock for the same workspace and id, which removes
 *   the lock only while this process and that id hold it (an id is a run's, a check's or a save's,
 *   never reused). A lock another run took meanwhile answers false, and so does one already gone:
 *   either ends the tries at once. Only a try that throws leads to the next.
 * - Few, short waits on timers that do not keep the process alive (`unref`): an app that closes
 *   meanwhile closes, and the next run of another process finds the lock stale (U-176).
 * - Nothing more is told: the caller has said lockLeft already (what was true then). `onEnd` (tests)
 *   learns how the tries ended.
 */

import { releaseLock } from "../store/index.js";

/** U-211: the waits before each later try, counted from the failed release before it: two tries, 10 s in all. */
export const LOCK_RELEASE_RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000];

/** The lock a release failed to remove: its workspace and the id that holds it. */
export interface LockToRelease {
  readonly workspaceRoot: string;
  readonly runId: string;
}

/** How the later tries ended: removed, not this id's lock (another's, or gone), or still left. */
export type LockRetryEnd = "released" | "not_held" | "left";

/** Tests only: shorter waits, a release that fails, and how the tries ended. */
export interface LockRetryOptions {
  /** The waits before each try (LOCK_RELEASE_RETRY_DELAYS_MS when absent). */
  readonly delaysMs?: readonly number[];
  /** The release to try (the store's releaseLock when absent). */
  readonly release?: (lock: LockToRelease) => Promise<boolean>;
  /** Told once, when the tries end. */
  readonly onEnd?: (end: LockRetryEnd, lock: LockToRelease) => void;
}

/** A wait on a timer that does not keep the process alive. */
function quietWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Tries to release `lock` after each wait, until a try answers (true: removed; false: not this id's
 * lock) or the waits run out. Never rejects; callers need not wait for it.
 */
export async function retryLockRelease(lock: LockToRelease, options: LockRetryOptions = {}): Promise<LockRetryEnd> {
  const release = options.release ?? releaseLock;
  const target: LockToRelease = { workspaceRoot: lock.workspaceRoot, runId: lock.runId };
  let end: LockRetryEnd = "left";
  for (const delay of options.delaysMs ?? LOCK_RELEASE_RETRY_DELAYS_MS) {
    await quietWait(delay);
    let answer: boolean;
    try {
      answer = (await release(target)) === true;
    } catch {
      continue;
    }
    end = answer ? "released" : "not_held";
    break;
  }
  try {
    options.onEnd?.(end, target);
  } catch {
    // A hook that throws changes nothing here.
  }
  return end;
}
