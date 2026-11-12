/**
 * GU-3 (docs/design/standalone-gui.md 3.6): the one run the app has at a time (GUI-D12), as the
 * main process tracks it. No Electron, so this is tested under Node.
 * - `begin` takes the run token the engine host gave in its answer to `startRun`; messages for any
 *   other token are dropped.
 * - Progress items and the end are checked (src/shared/protocol.ts parsed them, toRunResultView
 *   checks the result) before they go to the window.
 * - `waitDone` lets closing the window wait for the end (result.json written, lock released), at
 *   most the time given (3.6: 10 seconds).
 */

import { IPC_EVENTS, toRunResultView } from "../shared/ipc.js";
import type { RunDonePayload, RunEventsPayload } from "../shared/ipc.js";
import type { HostRunMessage } from "../shared/protocol.js";

export interface RunManagerDeps {
  /** Sends to the window (nothing when there is none). */
  readonly send: (channel: string, payload: RunEventsPayload | RunDonePayload) => void;
  /** The shared catalog's words for a status and a reason, in the window's language. */
  readonly labels: (status: string, reason: string) => Promise<{ readonly status: string; readonly reason: string }>;
  /** Told when a run begins (true) and when it ends (false). */
  readonly onChange?: (running: boolean) => void;
}

interface Active {
  readonly token: string;
  readonly runId: string;
  readonly ended: Promise<void>;
  readonly end: () => void;
}

/** Messages kept for tokens not begun yet (the answer to startRun and the first events can come together). */
const EARLY_TOKENS = 4;
const EARLY_MESSAGES = 200;

export class RunManager {
  private active: Active | null = null;
  private readonly early = new Map<string, HostRunMessage[]>();

  constructor(private readonly deps: RunManagerDeps) {}

  /** Whether a run goes on now. */
  get running(): boolean {
    return this.active !== null;
  }

  get runId(): string | null {
    return this.active?.runId ?? null;
  }

  get token(): string | null {
    return this.active?.token ?? null;
  }

  begin(token: string, runId: string): void {
    let end = (): void => undefined;
    const ended = new Promise<void>((resolve) => {
      end = resolve;
    });
    this.active = { token, runId, ended, end };
    this.deps.onChange?.(true);
    const kept = this.early.get(token) ?? [];
    this.early.clear();
    for (const message of kept) void this.receive(message);
  }

  /** A message from the engine host. Only the active run's messages go on. */
  async receive(message: HostRunMessage): Promise<void> {
    const active = this.active;
    if (active === null) {
      // Kept briefly: begin() for this token may follow (the answer to startRun came in the same read).
      let list = this.early.get(message.run);
      if (list === undefined) {
        if (this.early.size >= EARLY_TOKENS) this.early.delete(this.early.keys().next().value as string);
        list = [];
        this.early.set(message.run, list);
      }
      if (list.length < EARLY_MESSAGES) list.push(message);
      return;
    }
    if (message.run !== active.token) return;
    if (message.type === "events") {
      this.deps.send(IPC_EVENTS.runEvents, { runId: active.runId, items: message.items, counts: message.counts });
      return;
    }
    this.active = null;
    this.deps.onChange?.(false);
    const checked = toRunResultView(message.outcome);
    let payload: RunDonePayload;
    if (checked.ok) {
      let labels: { readonly status: string; readonly reason: string } = { status: checked.result.status, reason: checked.result.reason };
      try {
        labels = await this.deps.labels(checked.result.status, checked.result.reason);
      } catch {
        // The window shows its own words then.
      }
      payload = { runId: active.runId, ok: true, result: checked.result, labels };
    } else {
      payload = { runId: active.runId, ok: false, code: checked.code };
    }
    this.deps.send(IPC_EVENTS.runDone, payload);
    active.end();
  }

  /** The engine host ended: the run's end is unknown here (the run list shows it next time). */
  hostExited(): void {
    const active = this.active;
    if (active === null) return;
    this.active = null;
    this.deps.onChange?.(false);
    this.deps.send(IPC_EVENTS.runDone, { runId: active.runId, ok: false, code: "adapter_host_exited" });
    active.end();
  }

  /** Resolves true when the run has ended (or none goes on), false when `ms` passed first. */
  async waitDone(ms: number): Promise<boolean> {
    const active = this.active;
    if (active === null) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    });
    const ended = await Promise.race([active.ended.then(() => true as const), timeout]);
    clearTimeout(timer);
    return ended;
  }
}
