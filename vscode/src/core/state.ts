/**
 * The state of one run or apply as the extension shows it (vscode-extension 4.2, 5). A pure
 * reducer: the UI part feeds it protocol lines, the person's answers and the child's end, and
 * draws what it returns. No VS Code API here.
 *
 * Rules it keeps (adapter-contract 5.3, 5.9, 6; R-1 L-2):
 * - nothing can be cancelled before `started`; the cancel file is made only after it;
 * - a question waits until it is answered, the child ends, or the run is cancelled;
 * - `seq` gaps are counted, not fatal;
 * - the end is the child's stdout line, never an event (`run_finished` may come before result.json).
 */

import type { CliErrorOutput, EngineResult } from "../../../src/contracts/index.js";
import type { ApplyResult, ConfirmRequest } from "../../../src/app/index.js";
import type { FinalOutcome, ProtocolLine } from "./protocol.js";

export type Phase =
  /** Spawned; the CLI's pre-run checks are going on. */
  | "starting"
  | "running"
  | "awaiting_answer"
  /** Ended with a result line (run, apply or error). */
  | "finished"
  /** Ended without a usable result line. */
  | "transport_failed";

/** Which screen follows the end (vscode-extension 4.1). */
export type NextScreen = "result" | "plan" | "review" | "error" | "transport_error";

export interface RunView {
  readonly phase: Phase;
  readonly runId: string | null;
  /** Highest `seq` seen and how many numbers below it never arrived. */
  readonly lastSeq: number;
  readonly missedEvents: number;
  /** Lines that were not protocol lines, or arrived out of place. */
  readonly ignoredLines: number;
  readonly question: ConfirmRequest | null;
  readonly cancelRequested: boolean;
  readonly result: EngineResult | ApplyResult | null;
  readonly error: CliErrorOutput | null;
  readonly transportError: string | null;
  readonly next: NextScreen | null;
}

export type RunAction =
  | { readonly type: "line"; readonly line: ProtocolLine }
  /** A line was too long and dropped by the splitter. */
  | { readonly type: "dropped"; readonly count: number }
  | { readonly type: "answered"; readonly id: string }
  | { readonly type: "cancel_requested" }
  | { readonly type: "exited"; readonly outcome: FinalOutcome };

export const INITIAL_RUN_VIEW: RunView = {
  phase: "starting",
  runId: null,
  lastSeq: 0,
  missedEvents: 0,
  ignoredLines: 0,
  question: null,
  cancelRequested: false,
  result: null,
  error: null,
  transportError: null,
  next: null,
};

/** The screen a finished result opens: a pending plan or a review waits for a person. */
export function nextScreenOf(output: EngineResult | ApplyResult | CliErrorOutput): NextScreen {
  if (output.kind === "error") return "error";
  if (output.status === "needs-input" && output.reason === ("plan_pending" as string)) return "plan";
  if (output.status === "needs-input" && output.reason === ("awaiting_review" as string)) return "review";
  return "result";
}

/** Cancelling is offered only once the run is known to have started, and only once. */
export function canCancel(view: RunView): boolean {
  return (view.phase === "running" || view.phase === "awaiting_answer") && view.runId !== null && !view.cancelRequested;
}

function ended(view: RunView): boolean {
  return view.phase === "finished" || view.phase === "transport_failed";
}

export function reduceRun(view: RunView, action: RunAction): RunView {
  if (ended(view)) return view;
  switch (action.type) {
    case "dropped":
      return { ...view, ignoredLines: view.ignoredLines + action.count };
    case "cancel_requested":
      return canCancel(view) ? { ...view, cancelRequested: true } : view;
    case "answered":
      return view.question !== null && view.question.id === action.id ? { ...view, phase: "running", question: null } : view;
    case "exited": {
      const outcome = action.outcome;
      if (outcome.kind === "protocol_error") {
        return { ...view, phase: "transport_failed", question: null, transportError: outcome.reason, next: "transport_error" };
      }
      const output = outcome.output;
      if (output.kind === "error") return { ...view, phase: "finished", question: null, error: output, next: "error" };
      if (view.runId !== null && output.runId !== view.runId) {
        return { ...view, phase: "transport_failed", question: null, transportError: "run_id_mismatch", next: "transport_error" };
      }
      return { ...view, phase: "finished", question: null, runId: output.runId, result: output, next: nextScreenOf(output) };
    }
    case "line": {
      const line = action.line;
      if (line.kind === "ignored") return { ...view, ignoredLines: view.ignoredLines + 1 };
      if (line.kind === "started") {
        return view.phase === "starting" ? { ...view, phase: "running", runId: line.runId } : { ...view, ignoredLines: view.ignoredLines + 1 };
      }
      if (view.phase === "starting") return { ...view, ignoredLines: view.ignoredLines + 1 };
      if (line.kind === "confirm") {
        // One question at a time; another while one waits is out of place.
        return view.question === null ? { ...view, phase: "awaiting_answer", question: line.request } : { ...view, ignoredLines: view.ignoredLines + 1 };
      }
      if (line.event.kind === "notice") return view;
      const record = line.event.record;
      if (record.runId !== view.runId) return { ...view, ignoredLines: view.ignoredLines + 1 };
      if (record.seq <= view.lastSeq) return { ...view, ignoredLines: view.ignoredLines + 1 };
      return { ...view, lastSeq: record.seq, missedEvents: view.missedEvents + (record.seq - view.lastSeq - 1) };
    }
  }
}

/**
 * What the extension does, in order, when it must stop while the child runs (window closed,
 * extension deactivated). Before `started` there is no run to cancel: only stdin is closed and the
 * child ends after its checks. After it the cancel file comes first, then stdin is closed, so a
 * waiting question is recorded as cancelled, not as a default denial (R-1 L-2).
 */
export function shutdownSteps(view: RunView): readonly ("create_cancel_file" | "close_stdin")[] {
  if (ended(view)) return [];
  if (view.phase === "starting" || view.runId === null) return ["close_stdin"];
  return view.cancelRequested ? ["close_stdin"] : ["create_cancel_file", "close_stdin"];
}
