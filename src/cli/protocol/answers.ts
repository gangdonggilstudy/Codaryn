/**
 * `--confirm stdio` (adapter-contract 6, 5.9; R-1 L-2; DR-10): answers to permission questions,
 * read one JSON line at a time from stdin.
 *
 * - A line that is not a well-formed answer, names no open question, or answers one already
 *   answered is ignored; the open question keeps waiting.
 * - When stdin ends (EOF), every open and every later question has no answer. Before that is
 *   settled the cancel source is checked once: a cancel already requested makes the outcome
 *   "cancelled", otherwise it is "no_answer" (a default denial, never recorded as the person's).
 *   An adapter that shuts down makes the cancel file first and closes stdin after, so its close is
 *   recorded as a cancel in every adapter.
 * - The run's own cancel signal settles a waiting question as "cancelled".
 */

import type { ConfirmAnswer } from "../../app/types.js";
import { MAX_ANSWER_LINE_LENGTH, parseAnswerLine } from "./lines.js";

export type AnswerOutcome =
  /** The adapter answered (`dismissed` included: the person closed the question). */
  | { readonly kind: "answered"; readonly answer: ConfirmAnswer }
  /** stdin ended with no cancel requested: the default, a denial (`by: "default"`). */
  | { readonly kind: "no_answer" }
  /** The run was cancelled while the question waited, or before stdin ended. */
  | { readonly kind: "cancelled" };

export class AnswerBook {
  private readonly open = new Map<string, (outcome: AnswerOutcome) => void>();
  private readonly settled = new Set<string>();
  private ended = false;

  /** `isCancelRequested` is asked once when stdin ends, and for each question asked after that. */
  constructor(private readonly isCancelRequested: () => boolean = () => false) {}

  /** Waits for the answer to the question `id`, which has just been written as a confirm line. */
  wait(id: string, signal: AbortSignal): Promise<AnswerOutcome> {
    if (signal.aborted) return Promise.resolve({ kind: "cancelled" });
    // An id asked twice is not answerable: the adapter could not tell the two apart.
    if (this.open.has(id) || this.settled.has(id)) return Promise.resolve({ kind: "no_answer" });
    if (this.ended) return Promise.resolve(this.endOutcome());
    return new Promise((resolve) => {
      const onAbort = (): void => {
        this.open.delete(id);
        this.settled.add(id);
        resolve({ kind: "cancelled" });
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.open.set(id, (outcome) => {
        signal.removeEventListener("abort", onAbort);
        resolve(outcome);
      });
    });
  }

  /** One stdin line without its ending. True when it answered an open question. */
  line(text: string): boolean {
    const parsed = parseAnswerLine(text);
    if (!parsed.ok) return false;
    const settle = this.open.get(parsed.id);
    if (settle === undefined) return false;
    this.open.delete(parsed.id);
    this.settled.add(parsed.id);
    settle({ kind: "answered", answer: parsed.answer });
    return true;
  }

  /** stdin ended. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    const outcome = this.endOutcome();
    for (const [id, settle] of this.open) {
      this.settled.add(id);
      settle(outcome);
    }
    this.open.clear();
  }

  get waiting(): number {
    return this.open.size;
  }

  private endOutcome(): AnswerOutcome {
    let cancelled = false;
    try {
      cancelled = this.isCancelRequested();
    } catch {
      cancelled = false;
    }
    return cancelled ? { kind: "cancelled" } : { kind: "no_answer" };
  }
}

/** The part of a readable stream this needs (process.stdin in the real CLI). */
export type AnswerInput = Pick<NodeJS.ReadableStream, "setEncoding" | "on" | "off">;

/**
 * Feeds `input`'s lines (LF or CRLF) to `book` and calls `book.end()` when the input ends, closes
 * or fails. A line longer than MAX_ANSWER_LINE_LENGTH is dropped as a whole. Returns a function
 * that stops listening (it does not end the book).
 */
export function readAnswers(input: AnswerInput, book: AnswerBook): () => void {
  let buffer = "";
  let dropping = false;
  const onData = (chunk: string): void => {
    let rest = String(chunk);
    for (;;) {
      const end = rest.indexOf("\n");
      if (end < 0) break;
      const piece = rest.slice(0, end);
      rest = rest.slice(end + 1);
      if (dropping) {
        dropping = false;
        buffer = "";
        continue;
      }
      const line = buffer + piece;
      buffer = "";
      if (line.length <= MAX_ANSWER_LINE_LENGTH) book.line(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
    if (!dropping) {
      buffer += rest;
      if (buffer.length > MAX_ANSWER_LINE_LENGTH) {
        dropping = true;
        buffer = "";
      }
    }
  };
  const onEnd = (): void => {
    const last = buffer;
    buffer = "";
    if (!dropping && last.length > 0) book.line(last.endsWith("\r") ? last.slice(0, -1) : last);
    dropping = false;
    book.end();
  };
  const onError = (): void => onEnd();
  input.setEncoding("utf8");
  input.on("data", onData);
  input.on("end", onEnd);
  input.on("close", onEnd);
  input.on("error", onError);
  return () => {
    input.off("data", onData);
    input.off("end", onEnd);
    input.off("close", onEnd);
    input.off("error", onError);
  };
}
