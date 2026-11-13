/**
 * U-110: one line from the person at a terminal, for every question the CLI asks (apply, revert,
 * models, init, and the permission question of a run). Review R-88: what each command does with
 * Ctrl+C is the caller's (main); this tells it apart.
 */

import { createInterface } from "node:readline/promises";

export interface LineSource {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
}

/**
 * What one question got: the line typed; none (the input ended, also before the question, R-88 L2;
 * a last line without Enter; the reader closed, as with Ctrl+D at a terminal; `signal` aborted); or
 * an interrupt (Ctrl+C at a terminal, which readline reads as a key rather than a signal, R-88 M2).
 */
export type AskAnswer = { readonly line: string } | { readonly none: true } | { readonly interrupted: true };

/** Inputs whose end was seen: a later question answers none at once (R-88 L2). */
const endedInputs = new WeakSet<object>();
const watchedInputs = new WeakSet<object>();

type Input = NodeJS.ReadableStream & { readonly readableEnded?: boolean; ref?: () => unknown; unref?: () => unknown };

/**
 * Writes `question` to `output` and reads one line from `input`. readline's question() alone never
 * settles at the end of input, so the reader's close ends it. While it asks, the input holds the
 * process open; afterwards reading stops and the input no longer does (R-88 L1: after a question
 * closed with Ctrl+D or Ctrl+C the process ended only when the input did).
 */
export async function askLine(question: string, source: LineSource, signal?: AbortSignal): Promise<AskAnswer> {
  const input = source.input as Input;
  if (!watchedInputs.has(input)) {
    watchedInputs.add(input);
    input.once("end", () => endedInputs.add(input));
  }
  if (input.readableEnded === true || endedInputs.has(input)) return { none: true };
  input.ref?.();
  const prompt = createInterface({ input, output: source.output });
  try {
    return await new Promise<AskAnswer>((resolve) => {
      // With a listener, readline reports Ctrl+C here instead of closing the question.
      prompt.once("SIGINT", () => resolve({ interrupted: true }));
      prompt.once("close", () => resolve({ none: true }));
      prompt.question(question, signal === undefined ? {} : { signal }).then(
        (line) => resolve({ line }),
        () => resolve({ none: true }),
      );
    });
  } finally {
    prompt.close();
    input.pause();
    input.unref?.();
  }
}
