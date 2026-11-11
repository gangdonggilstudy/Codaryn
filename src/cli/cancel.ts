/**
 * Cancellation sources (PM decision P-2): SIGINT, SIGTERM, and a cancel file that appears.
 * All of them abort one signal.
 */

export interface CancelSourceOptions {
  /** Absolute path, or `null` when no cancel file was requested. */
  readonly cancelFile: string | null;
  readonly fileExists: (path: string) => boolean;
  /** Registers a handler and returns a function that removes it. */
  readonly onSignal: (name: "SIGINT" | "SIGTERM", handler: () => void) => () => void;
  readonly pollMs?: number;
}

export interface CancelSource {
  readonly signal: AbortSignal;
  dispose(): void;
}

export const CANCEL_FILE_POLL_MS = 100;

export function createCancelSource(options: CancelSourceOptions): CancelSource {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  const removers = [options.onSignal("SIGINT", cancel), options.onSignal("SIGTERM", cancel)];

  let timer: NodeJS.Timeout | null = null;
  const file = options.cancelFile;
  if (file !== null) {
    const check = (): void => {
      if (options.fileExists(file)) cancel();
    };
    check();
    timer = setInterval(check, options.pollMs ?? CANCEL_FILE_POLL_MS);
    timer.unref();
  }

  return {
    signal: controller.signal,
    dispose(): void {
      if (timer !== null) clearInterval(timer);
      for (const remove of removers) remove();
    },
  };
}
