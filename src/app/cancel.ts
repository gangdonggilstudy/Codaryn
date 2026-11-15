/**
 * U-293 (Codex V-31 L-1): a run's cancel source in the app layer: SIGINT, SIGTERM and a cancel file
 * that appears all abort one signal, as the CLI's (src/cli/cancel.ts createCancelSource, PM decision
 * P-2), with its two edges made whole. The CLI's registered the two signals in one expression and
 * removed them in one loop: a registration that threw left the one before it registered, and a
 * removal that threw skipped the other. Here a registration that throws removes what was registered
 * before it and is thrown on (the start is refused as before), and each removal is tried on its own;
 * a removal's exception never reaches the run, so it cannot take the run's end with it. The file is
 * looked for at once and then every RUN_CANCEL_FILE_POLL_MS, as the CLI's. Its options and source have
 * the CLI's shapes, stated here so the app imports nothing of src/cli for it. U-296 (C-6a's fourth
 * commit): the CLI's helper (src/cli/cancel.ts) passes this one on under its old names, so every
 * cancel source of a run has these edges: codaryn run, apply's run of a run plan and apply's plan of
 * moves (main.ts), and a run through the app layer (app.ts).
 */

/** The same fields as the CLI's CancelSourceOptions (src/cli/cancel.ts). */
export interface RunCancelSourceOptions {
  /** Absolute path, or `null` when no cancel file was requested. */
  readonly cancelFile: string | null;
  readonly fileExists: (path: string) => boolean;
  /** Registers a handler and returns a function that removes it. */
  readonly onSignal: (name: "SIGINT" | "SIGTERM", handler: () => void) => () => void;
  readonly pollMs?: number;
}

export interface RunCancelSource {
  readonly signal: AbortSignal;
  dispose(): void;
}

/** The CLI's CANCEL_FILE_POLL_MS. */
export const RUN_CANCEL_FILE_POLL_MS = 100;

/** Calls every remover once, each on its own; an exception of one stops none of the others. */
function removeAll(removers: (() => void)[]): void {
  for (const remove of removers.splice(0)) {
    try {
      remove();
    } catch {
      // A remover that throws cannot keep the others, or the run's end, from happening.
    }
  }
}

export function createRunCancelSource(options: RunCancelSourceOptions): RunCancelSource {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  const removers: (() => void)[] = [];
  try {
    for (const name of ["SIGINT", "SIGTERM"] as const) removers.push(options.onSignal(name, cancel));
  } catch (error) {
    removeAll(removers);
    throw error;
  }

  let timer: NodeJS.Timeout | null = null;
  const file = options.cancelFile;
  if (file !== null) {
    const check = (): void => {
      if (options.fileExists(file)) cancel();
    };
    check();
    timer = setInterval(check, options.pollMs ?? RUN_CANCEL_FILE_POLL_MS);
    timer.unref();
  }

  return {
    signal: controller.signal,
    dispose(): void {
      if (timer !== null) clearInterval(timer);
      removeAll(removers);
    },
  };
}
