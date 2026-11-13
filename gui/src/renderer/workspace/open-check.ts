/**
 * U-68 (docs/design/standalone-gui.md 3.2): the checks when a workspace opens. The app layer's
 * `doctor` for the open workspace runs when it opens, again when a run ends and on F5. The window
 * shows the checks about the workspace that are not ok (the folder itself, where the settings files
 * are, the install folder, the lock), and whether another process holds the workspace's lock
 * (`doctor.lock.held`): then a new task cannot start until it is gone. Blocking checks are made again
 * by the app layer when a run starts; this only tells the person first.
 */

import type { Texts } from "../i18n/catalog.js";
import { errorText } from "../i18n/catalog.js";
import { asDoctor } from "../api.js";
import type { CodarynApi, Workspace } from "../api.js";
import type { DoctorCheckView, DoctorReply } from "../../shared/ipc.js";
import { button, el } from "../shell/dom.js";
import { NO_OWN_LOCK } from "./own-lock.js";
import type { OwnLock } from "./own-lock.js";

/** The doctor checks about the workspace itself, in the order shown. */
export const OPEN_CHECK_IDS = ["workspace", "file_locations", "install_dir", "lock"] as const;

type DoctorDone = Extract<DoctorReply, { ok: true }>;

export type OpenCheckState =
  | { readonly phase: "none" }
  /**
   * U-247: `lockHeld` carried while the same workspace is checked again after a check that found the
   * lock held, so a screen shown meanwhile keeps the run button off until the new answer says otherwise.
   */
  | { readonly phase: "checking"; readonly handle: string; readonly lockHeld?: true }
  /** Codex V-27 L-1: a failed check says nothing of the lock, so a held lock before it stays held (`lockHeld`). */
  | { readonly phase: "error"; readonly handle: string; readonly code: string; readonly lockHeld?: true }
  /**
   * `lockHeld`: the doctor's answer. R-111b (a), M-1: `byOther` false when this window's own work may have
   * held the lock while the check went on (its run or apply in the workspace, or a locking call that started,
   * went on or ended meanwhile; OwnLock): then the lock is not counted, carried or shown as another's.
   */
  | { readonly phase: "done"; readonly handle: string; readonly reply: DoctorDone; readonly lockHeld: boolean; readonly byOther?: boolean };

/**
 * U-247, Codex V-27 L-1: whether the check counts the workspace `handle`'s lock as held by another
 * process: its answer said so, or a check of it since (still going, or failed) has not said it is free.
 */
export function heldFor(state: OpenCheckState, handle: string | undefined): boolean {
  if (state.phase === "none" || state.handle !== handle || state.lockHeld !== true) return false;
  // R-111b (a): the window's own run's lock is not another process's.
  return state.phase !== "done" || state.byOther !== false;
}

/** Whether the doctor's lock check says a live process holds the workspace's lock. */
export function lockHeld(reply: DoctorDone): boolean {
  return reply.view.checks.some((check) => check.id === "lock" && check.textId === "doctor.lock.held");
}

/** The workspace checks that are not ok (warn or fail), in OPEN_CHECK_IDS order. */
export function openProblems(reply: DoctorDone): DoctorCheckView[] {
  return OPEN_CHECK_IDS.flatMap((id) => reply.view.checks.filter((check) => check.id === id && (check.status === "warn" || check.status === "fail")));
}

export class OpenCheck {
  state: OpenCheckState = { phase: "none" };
  private generation = 0;
  private readonly watchers = new Map<string, () => void>();

  /** R-111b (a), M-1: `own` says what of this window's own work may hold a workspace's lock. */
  constructor(
    private readonly api: CodarynApi,
    private readonly own: OwnLock = NO_OWN_LOCK,
  ) {}

  /** Checks `workspace` (or forgets the last result). An answer for an earlier call is dropped. */
  async run(workspace: Workspace | null): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    if (workspace === null) {
      this.set({ phase: "none" });
      return;
    }
    const handle = workspace.handle;
    // Only an answer frees a held lock: a check that is still going or failed keeps it (V-27 L-1).
    const stillHeld = heldFor(this.state, handle);
    this.set(stillHeld ? { phase: "checking", handle, lockHeld: true } : { phase: "checking", handle });
    // R-111b M-1: own work going on when the check starts, or started before its answer, may be what it saw.
    const startedBefore = this.own.started();
    const busyBefore = this.own.busy(handle);
    let reply: DoctorReply;
    try {
      reply = asDoctor(await this.api.doctor(handle));
    } catch {
      // A call that rejected is a failure as the host's own are: shown, the lock kept, the next check recovers.
      reply = { ok: false, code: "host_error" };
    }
    if (generation !== this.generation) return;
    const ownWork = busyBefore || this.own.busy(handle) || this.own.started() !== startedBefore;
    if (reply.ok) this.set({ phase: "done", handle, reply, lockHeld: lockHeld(reply), byOther: !ownWork });
    else this.set(stillHeld ? { phase: "error", handle, code: reply.code, lockHeld: true } : { phase: "error", handle, code: reply.code });
  }

  /** One watcher per key (a screen shown again replaces its own). */
  watch(key: string, watcher: () => void): void {
    this.watchers.set(key, watcher);
  }

  private set(state: OpenCheckState): void {
    this.state = state;
    for (const watcher of this.watchers.values()) watcher();
  }
}

/**
 * The card on the workspace screen. `ownRun`: a run of this window goes on in this workspace, so a
 * held lock is that run's and is not called another run's.
 */
export function openCheckCard(t: Texts, state: OpenCheckState, ownRunNow: boolean, showChecks: () => void): HTMLElement {
  const card = el("section", undefined, { id: "open-check", "aria-labelledby": "open-check-title", "data-open-check": state.phase });
  // R-111b M-1: a held answer the window's own work may have caused is not another run's either.
  const ownRun = ownRunNow || (state.phase === "done" && state.byOther === false);
  card.setAttribute("data-locked", String(state.phase === "done" && state.lockHeld && !ownRun));
  if (state.phase === "none") {
    card.setAttribute("hidden", "");
    return card;
  }
  card.append(el("h3", t.format("open.title"), { id: "open-check-title" }));
  if (state.phase === "checking") {
    card.append(el("p", t.format("open.checking")));
    return card;
  }
  if (state.phase === "error") {
    card.append(el("p", `${t.format("open.failed", { code: state.code })} ${errorText(t, state.code)}`, { role: "alert", class: "error", "data-error": state.code }));
    return card;
  }
  const word = (status: string): string => {
    const shared = state.reply.labels[`doctor.status.${status}`];
    if (shared !== undefined) return shared;
    const own = `status.${status}`;
    return t.has(own) ? t.format(own) : status;
  };
  const problems = openProblems(state.reply).filter((check) => !(check.id === "lock" && ownRun));
  if (problems.length === 0) card.append(el("p", t.format("open.clean"), { class: "open-clean" }));
  else {
    const list = el("ul", undefined, { class: "checks" });
    for (const check of problems) {
      const item = el("li", undefined, { "data-check": check.id, "data-status": check.status });
      if (check.id === "lock" && state.lockHeld) {
        item.setAttribute("data-lock", "held");
        item.setAttribute("role", "alert");
        item.append(el("span", word(check.status), { class: "status" }), el("span", t.format("open.locked"), { class: "label" }));
      } else {
        item.append(
          el("span", word(check.status), { class: "status" }),
          el("span", state.reply.labels[`doctor.check.${check.id}`] ?? check.id, { class: "label" }),
          el("span", check.message, { class: "detail", lang: "en", title: t.format("checks.detailInEnglish") }),
        );
      }
      list.append(item);
    }
    card.append(list);
  }
  card.append(button(t.format("open.all"), showChecks, { id: "open-check-all" }));
  return card;
}
