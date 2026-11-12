/**
 * GU-3 (docs/design/standalone-gui.md 3.6, 4.2): the runs the engine host started for the window.
 * - `start` calls the app layer's `startRun` (the quick form, AC 5.1) and gives the run a random
 *   token. Its events become progress items (the shared catalog's sentences, masked and cleaned)
 *   that go out about every 100 ms as one `events` message; the end goes out as `done`, after
 *   the last events. Nothing is written for a run before the answer to its `startRun` call, so the
 *   main process always knows the token first (timers run after that answer is written).
 * - `cancel` is the handle's cancel (the same signal as Ctrl+C and the cancel file, AC 5.3).
 * - `cancelAll` stops every run when the main process is gone (R-10 L-2, DR-8).
 * - The result that goes out with `done` keeps the fields the window shows: no workspace path,
 *   no journal path; every text is masked by the engine and cleaned again here.
 */

import { MAX_FINAL_MESSAGE_CHARS, maskingOf } from "../shared/ipc.js";
import { encodeLine } from "../shared/protocol.js";
import type { HostRunItem } from "../shared/protocol.js";
import { failureOf } from "./settings.js";
import type { HostFailure, Shown } from "./settings.js";

/** One app layer RunEvent turned into a progress item, or null when it shows nothing. */
export type RunItemOf = (event: unknown) => HostRunItem | null;

/** The app layer's StartRunRequest for the quick form. */
export interface HostStartRunRequest {
  readonly input: { readonly kind: "quick"; readonly workspace: string; readonly goal: string };
  readonly configPath: null;
  readonly varsFile: null;
  readonly profile: string | null;
  readonly workflowRef: string | null;
  readonly cancelFile: null;
}

/** The app layer's ApplyPlanRequest as the engine host builds it. */
export interface HostApplyRequest {
  readonly settings: HostTaskForm;
  readonly planRunId: string;
  readonly digest: string;
  readonly cancelFile: null;
  readonly unsafeMoveConsent: { readonly digest: string } | null;
}

export interface RunsDeps {
  readonly startRun: (request: HostStartRunRequest, observer: { onEvent(event: unknown): void }) => Promise<unknown>;
  /** GU-5: the app layer's applyPlan (ApplyPlanRequest); absent before the general task commands. */
  readonly applyPlan?: (request: HostApplyRequest, observer: { onEvent(event: unknown): void }) => Promise<unknown>;
  readonly itemOf: RunItemOf;
  readonly shown: Shown;
  /** The display filter that keeps line breaks and tabs (the agent's last message); by line with `shown` when absent. */
  readonly shownText?: Shown;
  readonly token: () => string;
  readonly write: (line: string) => void;
  readonly log: (text: string) => void;
  /** How long events are gathered before they go out. */
  readonly flushMs?: number;
}

export const RUN_FLUSH_MS = 100;
/** Items kept for one run while they wait to go out; more are dropped with one "gap" item. */
const MAX_PENDING_ITEMS = 5000;
const MAX_LIST = 500;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const texts = (value: unknown, shown: Shown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, MAX_LIST).map(shown) : []);

/** `shown` line by line and between tabs: LF and TAB stay, everything else is cleaned as `shown` does. */
export const byLine = (shown: Shown): Shown => (text: string) => text.replace(/\r\n/g, "\n").split("\n").map((line) => line.split("\t").map(shown).join("\t")).join("\n");

/**
 * U-21 (DR-47): the agent's last message as the window may see it: cleaned keeping LF and TAB, keys
 * hidden again (the engine masked it), and cut again at MAX_FINAL_MESSAGE_CHARS code points when
 * hiding made it longer. Null when there is none or it is not the contract's shape.
 */
export function finalMessageValue(value: unknown, shownText: Shown): { readonly text: string; readonly truncated: boolean } | null {
  if (!isObj(value) || typeof value["text"] !== "string" || typeof value["truncated"] !== "boolean") return null;
  const chars = [...shownText(value["text"])];
  const cut = chars.length > MAX_FINAL_MESSAGE_CHARS;
  return { text: (cut ? chars.slice(0, MAX_FINAL_MESSAGE_CHARS) : chars).join(""), truncated: value["truncated"] || cut };
}

/** A run's result as the window may see it (RunResultView in src/shared/ipc.ts, checked again by the main process). */
export function runResultValue(outcome: unknown, shown: Shown, shownText: Shown = byLine(shown)): Obj | HostFailure {
  if (!isObj(outcome) || outcome["ok"] !== true || !isObj(outcome["result"])) return failureOf(outcome);
  const result = outcome["result"];
  const usage = isObj(result["usage"]) ? result["usage"] : {};
  const changes = Array.isArray(result["changes"]) ? result["changes"].slice(0, MAX_LIST) : [];
  const verifiers = Array.isArray(result["verifiers"]) ? result["verifiers"].slice(0, MAX_LIST) : [];
  const plan = result["plan"];
  const review = result["review"];
  return {
    ok: true,
    result: {
      runId: typeof result["runId"] === "string" ? result["runId"] : "",
      status: result["status"],
      reason: result["reason"],
      exitCode: num(result["exitCode"]),
      changes: changes.flatMap((change) => (isObj(change) && typeof change["path"] === "string" ? [{ path: shown(change["path"]), created: change["created"] === true }] : [])),
      verifiers: verifiers.flatMap((verifier, index) => (isObj(verifier) && typeof verifier["outcome"] === "string" ? [{ number: index + 1, outcome: verifier["outcome"] }] : [])),
      usage: {
        turns: num(usage["modelTurns"]),
        tools: num(usage["toolCalls"]),
        inputTokens: num(usage["inputTokens"]),
        outputTokens: num(usage["outputTokens"]),
        durationMs: num(usage["durationMs"]),
      },
      notices: texts(result["notices"], shown),
      plan: isObj(plan) && typeof plan["digest"] === "string" ? { digest: plan["digest"], actions: num(plan["actions"]) } : null,
      review: isObj(review) ? { checklist: texts(review["checklist"], shown) } : null,
      protectedChanged: Array.isArray(result["protectedChanged"]) ? result["protectedChanged"].length : null,
      finalMessage: finalMessageValue(result["finalMessage"], shownText),
      // U-40 (DR-52): the masking counts, two counts only; null when none or not counts.
      masking: maskingOf(result["masking"]),
    },
  };
}

interface Running {
  cancel: () => void;
  readonly pending: HostRunItem[];
  dropped: boolean;
  open: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  turns: number;
  tools: number;
}

export interface RunRegistry {
  start(args: { readonly workspace: string; readonly goal: string; readonly profile: string | null; readonly workflowRef: string | null }): Promise<Obj | HostFailure>;
  /**
   * GU-5: applies a plan (DR-1, DR-2): the same events and cancel as a run. `consent` is the
   * person's DR-21 consent for this plan's digest, set only by the main process after its dialog.
   */
  startApply(args: { readonly workspace: string; readonly profile: string | null; readonly workflowRef: string | null; readonly planRunId: string; readonly digest: string; readonly consent: boolean }): Promise<Obj | HostFailure>;
  cancel(token: string): boolean;
  cancelAll(): void;
  readonly size: number;
}

/**
 * The app layer's `TaskForm` (src/app/types.ts) for the workspace form, field for field. The engine
 * host does not load the engine's types, so they are repeated here; every field is required, so a
 * field the app layer needs cannot be left out (R21-M-1: a missing `workflowRef` became
 * `--workflow undefined` and every plan, apply, review and changes call was refused). A unit test
 * passes these forms through the built app layer's `taskFormArguments`.
 */
export interface HostTaskForm {
  readonly input: { readonly kind: "workspace"; readonly workspace: string };
  readonly configPath: null;
  readonly varsFile: null;
  readonly profile: string | null;
  readonly workflowRef: string | null;
}

/**
 * The task form `plan`, `applyPlan`, `review` and `changes` take (DR-17): the workspace with the
 * config file's defaults, the profile, and (R-14 L-3) the task kind the run was started with.
 */
export function taskForm(workspace: string, profile: string | null, workflowRef: string | null): HostTaskForm {
  return { input: { kind: "workspace", workspace }, configPath: null, varsFile: null, profile, workflowRef };
}

/** An apply's result (AppCallOutcome<ApplyResult>) as the window may see it; `unsafeMoves` from its plan_checked record. */
export function applyResultValue(outcome: unknown, shown: Shown, unsafeMoves: number | null): Obj | HostFailure {
  if (!isObj(outcome) || outcome["ok"] !== true || !isObj(outcome["output"])) return failureOf(outcome);
  const output = outcome["output"];
  const base = runResultValue({ ok: true, result: { ...output, changes: [], plan: undefined, review: undefined } }, shown);
  if (base["ok"] !== true) return base as HostFailure;
  const applied = Array.isArray(output["applied"]) ? output["applied"].slice(0, MAX_LIST) : [];
  return {
    ok: true,
    result: {
      ...((base as Obj)["result"] as Obj),
      kind: "apply",
      planRunId: typeof output["planRunId"] === "string" ? output["planRunId"] : null,
      unsafeMoves,
      applied: applied.flatMap((item): Obj[] => {
        const action = isObj(item) ? item["action"] : null;
        if (!isObj(action)) return [];
        const unsafe = isObj(item) && item["unsafe"] === true;
        if (action["kind"] === "move" && typeof action["from"] === "string" && typeof action["to"] === "string") {
          return [{ kind: "move", from: shown(action["from"]), to: shown(action["to"]), unsafe }];
        }
        if (action["kind"] === "discard" && typeof action["path"] === "string") return [{ kind: "discard", from: shown(action["path"]), to: null, unsafe }];
        return [];
      }),
    },
  };
}

export function createRunRegistry(deps: RunsDeps): RunRegistry {
  const runs = new Map<string, Running>();
  const flushMs = deps.flushMs ?? RUN_FLUSH_MS;

  const flush = (token: string, run: Running): void => {
    run.timer = null;
    if (run.pending.length === 0) return;
    const items = run.pending.splice(0, run.pending.length);
    try {
      deps.write(encodeLine({ v: 1, type: "events", run: token, items, counts: { turns: run.turns, tools: run.tools } }));
    } catch {
      deps.log("codaryn engine host: progress items could not be sent");
    }
  };

  const later = (token: string, run: Running): void => {
    if (run.open && run.timer === null) run.timer = setTimeout(() => flush(token, run), flushMs);
  };

  /** Starts through `begin` and tracks the run; `resultOf` turns its end into the done value. */
  async function launch(
    begin: (observer: { onEvent(event: unknown): void }) => Promise<unknown>,
    resultOf: (done: unknown, unsafeMoves: number | null) => Obj | HostFailure,
  ): Promise<Obj | HostFailure> {
    {
      const token = deps.token();
      const run: Running = { cancel: () => undefined, pending: [], dropped: false, open: false, timer: null, turns: 0, tools: 0 };
      let lastSeq = 0;
      let unsafeMoves: number | null = null;
      const observer = {
        onEvent(event: unknown): void {
          const record = isObj(event) && event["kind"] === "record" && isObj(event["record"]) ? event["record"] : null;
          if (record !== null) {
            const seq = record["seq"];
            if (typeof seq === "number" && lastSeq > 0 && seq > lastSeq + 1) run.pending.push({ at: null, kind: "gap", text: "" });
            if (typeof seq === "number") lastSeq = seq;
            if (record["type"] === "model_request") run.turns += 1;
            if (record["type"] === "tool_result") run.tools += 1;
            if (record["type"] === "plan_checked") unsafeMoves = Array.isArray(record["unsafeMoves"]) ? record["unsafeMoves"].length : 0;
          }
          let item: HostRunItem | null = null;
          try {
            item = deps.itemOf(event);
          } catch {
            item = null;
          }
          if (item !== null) {
            if (run.pending.length < MAX_PENDING_ITEMS) run.pending.push(item);
            else if (!run.dropped) {
              run.dropped = true;
              run.pending.push({ at: null, kind: "gap", text: "" });
            }
          }
          later(token, run);
        },
      };
      const outcome = await begin(observer);
      const handle = isObj(outcome) && outcome["ok"] === true && isObj(outcome["handle"]) ? outcome["handle"] : null;
      if (handle === null || typeof handle["runId"] !== "string" || typeof handle["cancel"] !== "function" || !(handle["done"] instanceof Promise)) {
        return failureOf(outcome);
      }
      const cancel = handle["cancel"] as () => void;
      run.cancel = () => cancel.call(handle);
      runs.set(token, run);
      // Items gathered so far go out by timer, so after this call's answer.
      run.open = true;
      later(token, run);
      (handle["done"] as Promise<unknown>).then(
        (done) => {
          setTimeout(() => {
            if (run.timer !== null) clearTimeout(run.timer);
            flush(token, run);
            run.open = false;
            runs.delete(token);
            try {
              deps.write(encodeLine({ v: 1, type: "done", run: token, outcome: resultOf(done, unsafeMoves) }));
            } catch {
              deps.write(encodeLine({ v: 1, type: "done", run: token, outcome: { ok: false, code: "host_error" } }));
            }
          }, 0);
        },
        () => undefined,
      );
      return { ok: true, run: token, runId: handle["runId"] };
    }
  }

  return {
    get size() {
      return runs.size;
    },

    start(args) {
      return launch(
        (observer) =>
          deps.startRun(
            { input: { kind: "quick", workspace: args.workspace, goal: args.goal }, configPath: null, varsFile: null, profile: args.profile, workflowRef: args.workflowRef, cancelFile: null },
            observer,
          ),
        (done) => runResultValue(done, deps.shown, deps.shownText),
      );
    },

    startApply(args) {
      const applyPlan = deps.applyPlan;
      if (applyPlan === undefined) return Promise.resolve({ ok: false, code: "host_error" });
      return launch(
        (observer) =>
          applyPlan(
            {
              settings: taskForm(args.workspace, args.profile, args.workflowRef),
              planRunId: args.planRunId,
              digest: args.digest,
              cancelFile: null,
              // DR-21: a consent only when the main process asked the person; it names this plan's digest.
              unsafeMoveConsent: args.consent ? { digest: args.digest } : null,
            },
            observer,
          ),
        (done, unsafeMoves) => applyResultValue(done, deps.shown, unsafeMoves),
      );
    },

    cancel(token) {
      const run = runs.get(token);
      if (run === undefined) return false;
      run.cancel();
      return true;
    },

    cancelAll() {
      for (const run of runs.values()) run.cancel();
    },
  };
}
