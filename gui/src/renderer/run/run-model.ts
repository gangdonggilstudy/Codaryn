/**
 * GU-3 (docs/design/standalone-gui.md 3.5, 3.6): the window's state of the one run at a time
 * (GUI-D12). Pure: no DOM, so unit tests run it under Node. Screens are rebuilt when shown; this
 * state is what they show.
 * - Phases: idle → starting (startRun is checking; nothing to cancel yet, AC 5.3) → running →
 *   cancelling (asked) → done. A start that fails goes back to idle with its error code.
 * - Items and counts are taken only for the run that goes on (its run id).
 * - A "gap" item (records went missing) is kept once: the window says the report has them all.
 * - The goal text is kept for this app session only, to run again (GUI-D11); it is never saved.
 */

import type { RunDonePayload, RunEventsPayload, RunItemView } from "../../shared/ipc.js";

export type RunPhase = "idle" | "starting" | "running" | "cancelling" | "done";
export type RunFilter = "all" | "denied" | "files" | "checks";

/**
 * The longest goal the window sends: MAX_GOAL_CHARS of src/shared/ipc.ts, repeated because the page
 * loads nothing outside its own directory (a unit test keeps the two equal).
 */
export const GOAL_LIMIT = 20_000;

/** Most items kept in the window; older ones are dropped first (the report keeps every record). */
export const MAX_KEPT_ITEMS = 5000;

const FILTER_KINDS: Readonly<Record<Exclude<RunFilter, "all">, readonly string[]>> = {
  denied: ["tool_denied"],
  files: ["file_changed", "file_moved", "file_discarded"],
  checks: ["verifier_result", "integrity_checked"],
};

export interface RunRequest {
  readonly goal: string;
  readonly profile: string | null;
  readonly workflow: string | null;
}

export class RunModel {
  phase: RunPhase = "idle";
  runId: string | null = null;
  startedAt: number | null = null;
  items: RunItemView[] = [];
  counts = { turns: 0, tools: 0 };
  /** Records went missing from the progress (once per run). */
  gap = false;
  done: RunDonePayload | null = null;
  startError: string | null = null;
  /** The last request of this session (GUI-D11: memory only). */
  last: RunRequest | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A screen's failure does not stop the others.
      }
    }
  }

  /** Whether a new run may start now. */
  get canStart(): boolean {
    return this.phase === "idle" || this.phase === "done";
  }

  /** Whether the cancel button works now (not before startRun answered, AC 5.3). */
  get canCancel(): boolean {
    return this.phase === "running";
  }

  starting(request: RunRequest): boolean {
    if (!this.canStart) return false;
    this.phase = "starting";
    this.last = request;
    this.runId = null;
    this.startedAt = null;
    this.items = [];
    this.counts = { turns: 0, tools: 0 };
    this.gap = false;
    this.done = null;
    this.startError = null;
    this.changed();
    return true;
  }

  started(runId: string, now: number): void {
    if (this.phase !== "starting") return;
    this.phase = "running";
    this.runId = runId;
    this.startedAt = now;
    this.changed();
  }

  failedToStart(code: string): void {
    if (this.phase !== "starting") return;
    this.phase = "idle";
    this.startError = code;
    this.changed();
  }

  cancelling(): void {
    if (this.phase !== "running") return;
    this.phase = "cancelling";
    this.changed();
  }

  /** The cancel did not reach the run (it ended meanwhile, or the host is gone). */
  cancelFailed(): void {
    if (this.phase === "cancelling") {
      this.phase = "running";
      this.changed();
    }
  }

  events(payload: RunEventsPayload): void {
    if (this.runId === null || payload.runId !== this.runId || (this.phase !== "running" && this.phase !== "cancelling")) return;
    for (const item of payload.items) {
      if (item.kind === "gap") {
        this.gap = true;
        continue;
      }
      this.items.push(item);
    }
    if (this.items.length > MAX_KEPT_ITEMS) {
      this.items.splice(0, this.items.length - MAX_KEPT_ITEMS);
      this.gap = true;
    }
    this.counts = { ...payload.counts };
    this.changed();
  }

  finished(payload: RunDonePayload): void {
    if (this.runId === null || payload.runId !== this.runId || this.phase === "done") return;
    this.phase = "done";
    this.done = payload;
    this.changed();
  }

  /** The items a filter shows, oldest first. */
  shown(filter: RunFilter): RunItemView[] {
    if (filter === "all") return this.items;
    const kinds = FILTER_KINDS[filter];
    return this.items.filter((item) => kinds.includes(item.kind));
  }

  /** Seconds since the run started, or null. */
  elapsed(now: number): number | null {
    return this.startedAt === null ? null : Math.max(0, Math.floor((now - this.startedAt) / 1000));
  }
}

/** `m:ss` or `h:mm:ss`. */
export function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** A record's ISO time as local `HH:MM:SS`, or "" when there is none. */
export function localTime(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
