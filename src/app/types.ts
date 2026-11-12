/**
 * Adapter contract of the app layer (docs/design/adapter-contract.md, sections 4 and 5).
 *
 * Interim location: these types belong in `src/contracts/app.ts` (migration step 1, role 1).
 * They live here until that contract change is made; the shapes are the ones the design adopted
 * (AC-D1 to AC-D12), with the deviations listed in the A-1 report.
 */

import type {
  CliErrorCode,
  Clock,
  ContentHash,
  DoctorOutput,
  EngineResult,
  JournalRecord,
  MaskedText,
  PermissionKind,
  ReportOutput,
  RevertOutput,
  ToolName,
} from "../contracts/index.js";

/** Process facts an adapter hands to the app layer. The app layer never touches process globals. */
export interface AppEnvironment {
  /** Environment variables. Copied for every call; this object is never changed. */
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
   * read. It must not change `process.env`. Synchronous because the run's loading step is
   * (deviation from the design's asynchronous form; see the A-1 report).
   */
  readonly readVarsFile: (file: string) => Readonly<Record<string, string>>;
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
  /** Defaults to `process.platform`. Windows looks environment names up without case. */
  readonly platform?: NodeJS.Platform;
}

/** One error that stopped a call before anything changed, or an internal error after a start. */
export interface AppError {
  readonly code: CliErrorCode;
  /** Fixed text, field positions and counts only. Never a value read from a file or the environment. */
  readonly message: string;
}

export interface StartRunRequest {
  readonly input:
    | { readonly kind: "task"; readonly taskPath: string }
    | { readonly kind: "quick"; readonly workspace: string; readonly goal: string };
  /** `--config`. Null: CODARYN_CONFIG (and later the default location, N-1). */
  readonly configPath: string | null;
  /** `--vars-file` (C-2). */
  readonly varsFile: string | null;
  /** `--profile` (N-8). Not available until N-8 is merged: a value is then `invalid_arguments`. */
  readonly profile: string | null;
  /** `--cancel-file` (P-2). Must lie outside the workspace (T-12). */
  readonly cancelFile: string | null;
}
// There is no field for a key, an API address, or a policy, limit or protected path override
// (C-1, C-5, M-9).

export type RunEvent =
  /** A record as the journal stored it (masked), in `seq` order, after it was written. */
  | { readonly kind: "record"; readonly record: JournalRecord }
  /** A run-level note outside the journal (for example the Y-4 hint). Also in the result's notices. */
  | { readonly kind: "notice"; readonly text: MaskedText };

/** Stage 4 (AC-D4): the engine does not ask yet, so `RunObserver.confirm` is never called. */
export type ConfirmRequest =
  | {
      readonly kind: "permission";
      readonly id: string;
      readonly callId: string;
      readonly tool: ToolName;
      readonly permission: PermissionKind;
      readonly subject: MaskedText;
    }
  | {
      readonly kind: "plan";
      readonly id: string;
      readonly planHash: ContentHash;
      readonly steps: readonly MaskedText[];
    };

export type ConfirmAnswer =
  | { readonly decision: "allow_once" }
  | { readonly decision: "approve"; readonly planHash: ContentHash }
  | { readonly decision: "deny" };

export interface RunObserver {
  /** Called synchronously for each event. Exceptions are ignored and never change the run. */
  onEvent?(event: RunEvent): void;
  /** Reserved for stage 4 (adapter-contract 5.7). Not called yet. */
  confirm?(request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer>;
}

export type RunOutcome =
  | { readonly ok: true; readonly result: EngineResult }
  /** An internal error after the start (`internal_error`). The lock is released. */
  | { readonly ok: false; readonly error: AppError };

export interface RunHandle {
  /** Known before the first event is delivered. */
  readonly runId: string;
  /** Real path of the workspace root, as the run's assembly resolved it. */
  readonly workspaceRoot: string;
  /** Idempotent. After the run ended it does nothing. */
  cancel(): void;
  /** Never rejects. Resolves after result.json was written and the workspace lock released. */
  readonly done: Promise<RunOutcome>;
}

export type StartOutcome =
  | { readonly ok: true; readonly handle: RunHandle }
  | { readonly ok: false; readonly error: AppError };

export type AppCallOutcome<T> = { readonly ok: true; readonly output: T } | { readonly ok: false; readonly error: AppError };

export interface ReportRequest {
  readonly workspace: string;
  readonly runId: string;
}

export interface RevertRequest {
  readonly workspace: string;
  readonly runId: string;
}

export interface DoctorRequest {
  readonly configPath: string | null;
  readonly varsFile: string | null;
  /** At most one of the two (W-5). */
  readonly taskPath: string | null;
  readonly workspace: string | null;
}

export interface CodarynApp {
  /**
   * Checks and assembles a run exactly as `codaryn run` does, then starts the engine and returns
   * its handle. A failure before the start returns an AppError and creates nothing.
   */
  startRun(request: StartRunRequest, observer?: RunObserver): Promise<StartOutcome>;
  /** `codaryn report --json`: reads the run's records only, takes no lock. */
  report(request: ReportRequest): Promise<AppCallOutcome<ReportOutput>>;
  /** `codaryn revert`: holds the lock and puts back files whose hash is still the run's. */
  revert(request: RevertRequest): Promise<AppCallOutcome<RevertOutput>>;
  /** `codaryn doctor --json`: no network access, no write. */
  doctor(request: DoctorRequest): Promise<AppCallOutcome<DoctorOutput>>;
}
