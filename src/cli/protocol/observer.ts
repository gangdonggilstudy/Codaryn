/**
 * Glue between a run and the line protocol, for `run.ts` and `apply` to connect (adapter-contract 6).
 *
 * - `protocolJournal` wraps the run's journal with the app layer's DR-15 event wrapper: each record
 *   the engine appends becomes an event line once the journal stored it, built in memory and
 *   masked again with the run's gateway. The journal file is never read back.
 * - `createProtocolObserver` writes event lines for an observer-based caller (the app layer's
 *   `startRun`) and, with an AnswerBook, answers permission questions over stdin.
 *
 * Writing is best effort, like progress lines: a failed write (a closed pipe) never changes the run.
 */

import type { Clock, Journal, PrivacyGateway } from "../../contracts/index.js";
import { journalWithEvents } from "../../app/events.js";
import type { ApplyEvent, ApplyObserver, ConfirmAnswer, ConfirmRequest, RunEvent, RunObserver } from "../../app/types.js";
import type { AnswerBook } from "./answers.js";
import { confirmLine, eventLine } from "./lines.js";

export type WriteLine = (line: string) => void;

function writeSafely(write: WriteLine, line: string): void {
  try {
    write(line);
  } catch {
    // The adapter's pipe is gone; the run goes on.
  }
}

/** The error a question's promise rejects with when the run is cancelled while it waits. */
export class QuestionCancelledError extends Error {
  constructor() {
    super("the run was cancelled while a question waited");
    this.name = "AbortError";
  }
}

/**
 * The answer to one question over the protocol: the confirm line, then the adapter's answer.
 * stdin ended without a cancel → `dismissed` (recorded as the default denial, `by: "default"`).
 * Cancelled → rejects with QuestionCancelledError (recorded as `by: "cancelled"`).
 */
export async function askOverProtocol(write: WriteLine, answers: AnswerBook, request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer> {
  writeSafely(write, confirmLine(request));
  const outcome = await answers.wait(request.id, signal);
  if (outcome.kind === "answered") return outcome.answer;
  if (outcome.kind === "no_answer") return { decision: "dismissed" };
  throw new QuestionCancelledError();
}

/**
 * An observer that writes every event as a line and, when `answers` is given (`--confirm stdio`),
 * asks questions over the protocol. Without `answers` it has no `confirm`: the app layer then
 * records each question as denied by default itself (DR-10).
 */
export function createProtocolObserver(options: { readonly write: WriteLine; readonly answers: AnswerBook | null }): RunObserver & ApplyObserver {
  const { write, answers } = options;
  return {
    onEvent(event: RunEvent | ApplyEvent): void {
      writeSafely(write, eventLine(event));
    },
    ...(answers === null ? {} : { confirm: (request: ConfirmRequest, signal: AbortSignal) => askOverProtocol(write, answers, request, signal) }),
  };
}

/**
 * The run's journal with event lines (DR-15): `run.ts` passes the journal, run id, gateway and
 * clock it assembled. Records the journal could not store are not written.
 */
export function protocolJournal(input: {
  readonly journal: Journal;
  readonly runId: string;
  readonly privacy: PrivacyGateway;
  readonly clock: Clock;
  readonly write: WriteLine;
}): Journal {
  return journalWithEvents(input.journal, input.runId, { onEvent: (event) => writeSafely(input.write, eventLine(event)) }, input.privacy, input.clock);
}
