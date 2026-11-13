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
 * - Codex V-17 H-1: the store's release reads the lock, checks this process and the id, then removes
 *   the file; the two steps are not one. Two releases of one lock at once could therefore remove a
 *   next owner's lock: the first checks, the second removes and a next owner takes the workspace, the
 *   first removes. So every release the app makes of a lock it holds goes through `releaseOwnLock`,
 *   one queue per lock (workspace and id): a release asked while another of that lock is under way
 *   waits for it and shares its answer; the later tries ask the store only while no release of that
 *   lock is under way and none has answered yet; and a lock has one set of later tries at a time.
 * - Other processes never remove this process's lock while it lives: their release checks the pid,
 *   and a reclaim takes only a lock whose holder has ended (store lock.ts). What is left is the store's
 *   own window between its check and its removal for a lock.json removed by hand (or by another
 *   program) and taken by a next run within it; every first release has that window too.
 */

import path from "node:path";
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

/** V-17 H-1: what the app is doing with one lock it holds. */
interface LockQueue {
  /** The release under way, or null. Every request made meanwhile waits for it and shares it. */
  running: Promise<boolean> | null;
  /** The store's answer once a release answered (true: removed; false: not this id's lock); null while none did. */
  answered: boolean | null;
  /** The later tries, while they are pending. */
  retry: Promise<LockRetryEnd> | null;
}

/** One queue per lock this process holds and is releasing; dropped once nothing is pending. */
const queues = new Map<string, LockQueue>();

function queueKey(lock: LockToRelease): string {
  const root = path.resolve(lock.workspaceRoot);
  return `${process.platform === "win32" ? root.toLowerCase() : root}\u0000${lock.runId}`;
}

function queueOf(lock: LockToRelease): LockQueue {
  const key = queueKey(lock);
  let queue = queues.get(key);
  if (queue === undefined) {
    queue = { running: null, answered: null, retry: null };
    queues.set(key, queue);
  }
  return queue;
}

/** Drops the queue of `lock` once no release and no later try of it is pending. */
function settle(lock: LockToRelease, queue: LockQueue): void {
  if (queue.running === null && queue.retry === null && queues.get(queueKey(lock)) === queue) queues.delete(queueKey(lock));
}

/**
 * V-17 H-1: the app's release of a lock it holds (its run's, check's or save's), never two of one lock
 * at once. A request made while a release of that lock is under way waits for it and shares its answer
 * (or its error). After a release answered, a request made while the lock's later tries are pending
 * gets that answer without asking the store again. `release` is the store's releaseLock unless a test
 * gives one.
 */
export function releaseOwnLock(lock: LockToRelease, release: (lock: LockToRelease) => Promise<boolean> = releaseLock): Promise<boolean> {
  const target: LockToRelease = { workspaceRoot: lock.workspaceRoot, runId: lock.runId };
  const queue = queueOf(target);
  if (queue.running !== null) return queue.running;
  if (queue.answered !== null) return Promise.resolve(queue.answered);
  // The release starts on the next microtask, so `running` is set before anything of it can end.
  const running = Promise.resolve()
    .then(() => release(target))
    .then((value) => {
      queue.answered = value === true;
      return queue.answered;
    })
    .finally(() => {
      queue.running = null;
      settle(target, queue);
    });
  queue.running = running;
  return running;
}

/**
 * Tries to release `lock` after each wait, until a try answers (true: removed; false: not this id's
 * lock) or the waits run out. Never rejects; callers need not wait for it.
 * V-17 H-1: a try starts only after a release of that lock under way has ended, and goes through
 * releaseOwnLock; once any release of the lock answered, the tries end with that answer without
 * asking the store. A second request while the tries are pending gets the same tries (its options
 * are not used).
 */
export function retryLockRelease(lock: LockToRelease, options: LockRetryOptions = {}): Promise<LockRetryEnd> {
  const target: LockToRelease = { workspaceRoot: lock.workspaceRoot, runId: lock.runId };
  const queue = queueOf(target);
  if (queue.retry !== null) return queue.retry;
  const release = options.release ?? releaseLock;
  // Started on the next microtask, so `retry` is set before anything of it can end.
  const retry = Promise.resolve().then(async (): Promise<LockRetryEnd> => {
    let end: LockRetryEnd = "left";
    try {
      for (const delay of options.delaysMs ?? LOCK_RELEASE_RETRY_DELAYS_MS) {
        await quietWait(delay);
        // Only once a release of this lock under way has ended, whatever it answered.
        while (queue.running !== null) await queue.running.catch(() => false);
        let answer: boolean;
        try {
          // After a release that answered, this is its answer; the store is not asked again.
          answer = await releaseOwnLock(target, release);
        } catch {
          // This try threw: the next wait.
          continue;
        }
        end = answer ? "released" : "not_held";
        break;
      }
    } finally {
      queue.retry = null;
      settle(target, queue);
    }
    try {
      options.onEnd?.(end, target);
    } catch {
      // A hook that throws changes nothing here.
    }
    return end;
  });
  queue.retry = retry;
  return retry;
}
