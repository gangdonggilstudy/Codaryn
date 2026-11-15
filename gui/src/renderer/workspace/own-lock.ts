/**
 * R-111b M-1 (U-247): what of this window's own work may hold a workspace's lock. The app layer takes the
 * lock for a run or an apply (for as long as it goes on), and for a plan check before an apply, a review, a
 * revert, a text save and a cleanup (for as long as the call goes on). A check of the lock that overlapped
 * any of these may have seen the window's own lock, so it does not say that another process holds it.
 *
 * U-271 (ne-verify's R-111c L-1): only such work in the workspace checked counts, and a call that ended
 * refused for the lock (`workspace_locked`) does not: that answer says the window did not hold it. Before,
 * a text save in another workspace, or a review refused because of the very lock another process held,
 * made that lock look like the window's own.
 *
 * U-294 (R-113 L-1): a call says it was refused for the lock in one of two shapes. Most give
 * `{ ok: false, code: "workspace_locked" }`; a text save gives SaveTextReply's
 * `{ ok: true, saved: false, status: "workspace_locked" }`. U-271 knew only the first, so a text save
 * refused for the lock still counted as the window's own work.
 */

import type { CodarynApi } from "../api.js";

/** The window's calls whose work takes the workspace lock in the app layer. */
export const LOCKING_CALLS = ["startRun", "startTaskRun", "applyPlan", "checkPlan", "review", "revert", "revertConsent", "saveText", "applyCleanup"] as const satisfies readonly (keyof CodarynApi)[];

/**
 * U-271: the calls whose first argument is the workspace handle they act on. The others carry a token of
 * a screen of the open workspace (a plan, a revert preview, a text, a cleanup), so they act on the
 * workspace open when they are made.
 */
const BY_HANDLE: ReadonlySet<string> = new Set(["startRun", "startTaskRun", "review"]);

/** At most this many ended calls are kept to answer `overlapped` (a check asks about the last moments only). */
const MAX_KEPT_CALLS = 64;

/** What the open check asks of the window's own work (OpenCheck). */
export interface OwnLock {
  /** Whether the window's own run holds the workspace `handle`'s lock now (its start answered). */
  readonly busy: (handle: string) => boolean;
  /** A mark of now, to ask `overlapped` about the calls since. */
  readonly mark: () => number;
  /**
   * Whether a locking call of the window for the workspace `handle` went on at some time after the mark
   * `since` or goes on now, but for one that ended refused for the lock (`workspace_locked`).
   */
  readonly overlapped: (handle: string, since: number) => boolean;
}

/** No own work (a window without runs or locking calls). */
export const NO_OWN_LOCK: OwnLock = { busy: () => false, mark: () => 0, overlapped: () => false };

interface CallMark {
  readonly workspace: string | null;
  /** The mark when it ended; null while it goes on. */
  end: number | null;
  refusedForLock: boolean;
}

/**
 * A reply that says the call was refused because the workspace's lock is held (by someone else): an
 * error with that code, or a text save not saved with that status (SaveTextReply).
 */
function refusedForLock(reply: unknown): boolean {
  if (typeof reply !== "object" || reply === null) return false;
  const { ok, code, saved, status } = reply as { ok?: unknown; code?: unknown; saved?: unknown; status?: unknown };
  return (ok === false && code === "workspace_locked") || (ok === true && saved === false && status === "workspace_locked");
}

/** Keeps the window's locking calls: the workspace each acts on, and when and how it ended. */
export class OwnLockCalls {
  private clock = 0;
  private readonly calls: CallMark[] = [];

  /** `openWorkspace`: the handle of the workspace open now (the one a token's call acts on). */
  constructor(private readonly openWorkspace: () => string | null = () => null) {}

  /** Locking calls going on now. */
  get inFlight(): number {
    return this.calls.filter((call) => call.end === null).length;
  }

  mark(): number {
    return this.clock;
  }

  overlapped(handle: string, since: number): boolean {
    return this.calls.some((call) => call.workspace === handle && !call.refusedForLock && (call.end === null || call.end > since));
  }

  /**
   * `api` with each locking call kept from its start until it answers or rejects; every other call is
   * `api`'s own. The page's `window.codaryn` stays as it is.
   */
  track(api: CodarynApi): CodarynApi {
    const tracked = Object.create(api) as Record<string, unknown>;
    for (const name of LOCKING_CALLS) {
      const call = api[name] as (...args: unknown[]) => Promise<unknown>;
      Object.defineProperty(tracked, name, {
        value: async (...args: unknown[]): Promise<unknown> => {
          const first = args[0];
          const entry: CallMark = { workspace: BY_HANDLE.has(name) ? (typeof first === "string" ? first : null) : this.openWorkspace(), end: null, refusedForLock: false };
          this.clock += 1;
          this.calls.push(entry);
          try {
            const reply = await call(...args);
            entry.refusedForLock = refusedForLock(reply);
            return reply;
          } finally {
            this.clock += 1;
            entry.end = this.clock;
            this.forgetOld();
          }
        },
      });
    }
    return tracked as unknown as CodarynApi;
  }

  /** Drops the oldest ended calls beyond MAX_KEPT_CALLS; calls going on are always kept. */
  private forgetOld(): void {
    let ended = this.calls.filter((call) => call.end !== null).length;
    for (let index = 0; index < this.calls.length && ended > MAX_KEPT_CALLS; ) {
      if (this.calls[index]?.end !== null) {
        this.calls.splice(index, 1);
        ended -= 1;
      } else index += 1;
    }
  }
}
