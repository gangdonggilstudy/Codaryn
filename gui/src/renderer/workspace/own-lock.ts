/**
 * R-111b M-1 (U-247): what of this window's own work may hold a workspace's lock. The app layer takes the
 * lock for a run or an apply (for as long as it goes on), and for a plan check before an apply, a review, a
 * revert, a text save and a cleanup (for as long as the call goes on). A check of the lock that overlapped
 * any of these may have seen the window's own lock, so it does not say that another process holds it.
 */

import type { CodarynApi } from "../api.js";

/** The window's calls whose work takes the workspace lock in the app layer. */
export const LOCKING_CALLS = ["startRun", "startTaskRun", "applyPlan", "checkPlan", "review", "revert", "revertConsent", "saveText", "applyCleanup"] as const satisfies readonly (keyof CodarynApi)[];

/** What the open check asks of the window's own work (OpenCheck). */
export interface OwnLock {
  /** Whether the window's own work may hold the workspace `handle`'s lock now. */
  readonly busy: (handle: string) => boolean;
  /** How many locking calls have started so far: one that started and ended during a check shows here. */
  readonly started: () => number;
}

/** No own work (a window without runs or locking calls). */
export const NO_OWN_LOCK: OwnLock = { busy: () => false, started: () => 0 };

/** Counts the window's locking calls while they go on. */
export class OwnLockCalls {
  private going = 0;
  private count = 0;

  /** Locking calls going on now. */
  get inFlight(): number {
    return this.going;
  }

  /** Locking calls started so far. */
  get started(): number {
    return this.count;
  }

  /**
   * `api` with each locking call counted from its start until it answers or rejects; every other call is
   * `api`'s own. The page's `window.codaryn` stays as it is.
   */
  track(api: CodarynApi): CodarynApi {
    const tracked = Object.create(api) as Record<string, unknown>;
    for (const name of LOCKING_CALLS) {
      const call = api[name] as (...args: unknown[]) => Promise<unknown>;
      Object.defineProperty(tracked, name, {
        value: async (...args: unknown[]): Promise<unknown> => {
          this.going += 1;
          this.count += 1;
          try {
            return await call(...args);
          } finally {
            this.going -= 1;
          }
        },
      });
    }
    return tracked as unknown as CodarynApi;
  }
}
