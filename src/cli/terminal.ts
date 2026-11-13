/**
 * U-110: one line from the person at a terminal, for every question the CLI asks (apply, revert,
 * models, init, and the permission question of a run).
 */

import { createInterface } from "node:readline/promises";

export interface LineSource {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
}

/**
 * Writes `question` to `output` and reads one line from `input`. Null when no line came: the input
 * ended (Ctrl+D, Ctrl+Z, or a last line without Enter), the reader closed, or `signal` aborted.
 * readline's question() alone never settles at the end of input, so the reader's close ends it.
 */
export async function askLine(question: string, source: LineSource, signal?: AbortSignal): Promise<string | null> {
  const prompt = createInterface({ input: source.input, output: source.output });
  try {
    return await new Promise<string | null>((resolve) => {
      prompt.once("close", () => resolve(null));
      prompt.question(question, signal === undefined ? {} : { signal }).then(resolve, () => resolve(null));
    });
  } finally {
    prompt.close();
  }
}
