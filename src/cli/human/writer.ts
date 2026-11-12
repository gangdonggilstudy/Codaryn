/**
 * N-5: where the human lines go. stderr only, never stdout (stdout carries the one output of the
 * command). With `--quiet` nothing is written. A failing write (a closed stderr) is ignored: human
 * output never changes a command's result or exit code.
 */

export interface HumanWriterOptions {
  /** Writes text to stderr (`process.stderr.write` in the CLI). */
  readonly write: (text: string) => void;
  /** `--quiet`: write nothing. */
  readonly quiet: boolean;
}

export interface HumanWriter {
  /** Writes the lines, each ending with a line feed. */
  lines(lines: readonly string[]): void;
  /** Writes text as it is (it should end with a line feed). */
  text(text: string): void;
}

export function createHumanWriter(options: HumanWriterOptions): HumanWriter {
  const send = (text: string): void => {
    if (options.quiet || text.length === 0) return;
    try {
      options.write(text);
    } catch {
      // Human output is best effort.
    }
  };
  return {
    lines(lines) {
      if (lines.length > 0) send(`${lines.join("\n")}\n`);
    },
    text: send,
  };
}
