/** App-layer common contracts. Type-only; re-exported by app.ts. */

import type { DefaultConfigDisplay } from "./config.js";
import type { CliErrorCategory, CliErrorCode, Clock, InputDiagnostic } from "./engine.js";
import type { MessageLanguage } from "./human.js";
import type { JournalRecord } from "./journal.js";
import type { MaskedText } from "./text.js";

/** Process facts an adapter hands to the app layer. The app layer never touches process globals. */
export interface AppEnvironment {
  /**
   * Environment variables. Copied for every call (on Windows into a copy that looks names up
   * without case, DR-4); this object is never changed. The copy, with the variables file loaded,
   * is also the parent environment of the run's commands (DR-4).
   */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** U-3: the running Codaryn install directory. Null refuses every run. */
  readonly installDir: string | null;
  /** `process.versions.node`, for `doctor`. */
  readonly nodeVersion: string;
  /** Reads a UTF-8 file. Rejects when it cannot be read. */
  readonly readFile: (file: string) => Promise<string>;
  readonly isDirectory: (dir: string) => Promise<boolean>;
  /** True for an existing regular file. Never throws. */
  readonly isFile: (file: string) => Promise<boolean>;
  /**
   * C-2: the variables a `--vars-file` defines, as name → value. Throws when the file cannot be
   * read. It must not change `process.env`. Synchronous because the run's loading step is.
   */
  readonly readVarsFile: (file: string) => Readonly<Record<string, string>>;
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
  /** Defaults to `process.platform`. Windows looks environment names up without case. */
  readonly platform?: NodeJS.Platform;
  /**
   * N-1: the home directory, for the default config location the CLI reads when neither a config
   * path nor CODARYN_CONFIG is given. Absent or null: no default location (as the CLI without one).
   */
  readonly homeDir?: string | null;
  /** N-4, N-20: the operating system's locale, for `doctor`'s language check. Absent: not known. */
  readonly osLocale?: string | null;
  /**
   * C-6a (P-2): registers a handler for a process signal and returns its remover (as the CLI's
   * cancel source takes it). The app registers SIGINT and SIGTERM when a run's cancel source is made,
   * right before the assembly as the CLI does, and removes them when the run ends; either signal
   * then cancels that run. Not during the checks before it: the process ends as Node's default
   * there. Absent (the GUI's engine host): no handler; RunHandle.cancel and the cancel file cancel.
   * The app layer still never touches the process itself.
   */
  readonly onSignal?: (name: "SIGINT" | "SIGTERM", handler: () => void) => () => void;
}

/** One error that stopped a call before anything changed, or an internal error after a start. */
export interface AppError {
  readonly code: CliErrorCode;
  /** Fixed text, field positions and counts only. Never a value read from a file or the environment. */
  readonly message: string;
  /** N-6: where in the config or task file the problem is (field path, line and column), when it can be said safely. */
  readonly diagnostic?: InputDiagnostic;
  /**
   * U-55 (AXM-9): the CLI's own facts when the error came from its output (fromCliError keeps
   * them). toCliError gives every error cliErrorFacts of its code where these are absent.
   */
  readonly category?: CliErrorCategory;
  readonly retryable?: boolean;
}

export type RunEvent =
  /**
   * A record as the journal stored it (masked), in `seq` order, after it was written. Model-given
   * tool names outside the built-in set read "(unknown tool)" and call ids are masked again (L-1).
   * C-6a: every string in it is masked again with the run's gateway, its closed words too, so a
   * registered value that matched one changes it; RunObserver.onStoredRecord gives the record as stored.
   */
  | { readonly kind: "record"; readonly record: JournalRecord }
  /** A run-level note outside the journal (for example the Y-4 hint). Also in the result's notices. */
  | { readonly kind: "notice"; readonly text: MaskedText };

export type AppCallOutcome<T> = { readonly ok: true; readonly output: T } | { readonly ok: false; readonly error: AppError };

/**
 * DR-17: the task form `plan`, `apply`, `review` and `changes` take, as G-A defines it for the CLI:
 * a task file, or a workspace with the config file's defaults and an optional profile. It decides
 * the secrets (S-2 to S-4) and the workspace exactly as for a run; it needs no goal and no model.
 */
export interface TaskForm {
  readonly input: { readonly kind: "task"; readonly taskPath: string } | { readonly kind: "workspace"; readonly workspace: string };
  readonly configPath: string | null;
  readonly varsFile: string | null;
  readonly profile: string | null;
  /**
   * R-14 L-3: `--workflow` (G-F, GT-D1): the task type the workspace form resolves to, so a plan made
   * with `startRun`'s `workflowRef` is shown, applied and reviewed on the same form without a
   * profile. Null: the profile's or the config's. A task file names its own; the CLI refuses both.
   */
  readonly workflowRef: string | null;
}

/**
 * C-7b: a run's facts for the adapter that draws it (a run plan's run through ApplyLifeHooks.runReady),
 * as RunHandle gives a run's.
 * - runId: the run's id.
 * - configLanguage (N-4): the config's `language`, or null when it sets none. A run plan's run is
 *   drawn in it, as a run is. The apply's own question, lines and summary are not: the CLI picks them
 *   without the config's language, as before.
 * - defaultConfig (N-1): the default config location's fixed display form when the config came from it.
 * - mask: the run's own masking (its gateway), as RunHandle.mask.
 */
export interface RunFacts {
  readonly runId: string;
  readonly configLanguage: MessageLanguage | null;
  readonly defaultConfig: DefaultConfigDisplay | null;
  readonly mask: (text: string) => MaskedText | null;
}
