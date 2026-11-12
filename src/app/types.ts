/**
 * Adapter contract of the app layer (docs/design/adapter-contract.md, sections 4 and 5, with the
 * R-1 decisions DR-1 to DR-4 and DR-7).
 *
 * Interim location: these types belong in `src/contracts/app.ts` (migration step 1, role 1).
 * Types marked "assumption (G-A)" stand for general task contracts (plan, apply, review) that the
 * G-A contract commit has not defined yet; they are replaced by G-A's types when it is merged.
 */

import type {
  CliErrorCode,
  Clock,
  DoctorOutput,
  EngineResult,
  JournalRecord,
  MaskedText,
  PermissionKind,
  ReportOutput,
  RevertOutput,
  TerminalRunStatus,
  ToolName,
} from "../contracts/index.js";

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
}

/** One error that stopped a call before anything changed, or an internal error after a start. */
export interface AppError {
  readonly code: CliErrorCode;
  /** Fixed text, field positions and counts only. Never a value read from a file or the environment. */
  readonly message: string;
}

/** The settings of one run, as `codaryn run` takes them. */
export interface StartRunRequest {
  readonly input:
    | { readonly kind: "task"; readonly taskPath: string }
    | { readonly kind: "quick"; readonly workspace: string; readonly goal: string };
  /** `--config`. Null: CODARYN_CONFIG, then the default location (N-1). */
  readonly configPath: string | null;
  /** `--vars-file` (C-2). */
  readonly varsFile: string | null;
  /** `--profile` (N-8). */
  readonly profile: string | null;
  /**
   * DR-2: the workflow definition to use (`--workflow`, GT 4.2). Assumption (G-A): the CLI takes
   * it once the general task commands are connected; until then a value is `invalid_arguments`.
   * A task file names its own `workflowRef`.
   */
  readonly workflowRef: string | null;
  /** `--cancel-file` (P-2). Must lie outside the workspace (T-12). */
  readonly cancelFile: string | null;
}
// There is no field for a key, an API address, or a policy, limit or protected path override
// (C-1, C-5, M-9).

export type RunEvent =
  /**
   * A record as the journal stored it (masked), in `seq` order, after it was written. Model-given
   * tool names outside the built-in set read "(unknown tool)" and call ids are masked again (L-1).
   */
  | { readonly kind: "record"; readonly record: JournalRecord }
  /** A run-level note outside the journal (for example the Y-4 hint). Also in the result's notices. */
  | { readonly kind: "notice"; readonly text: MaskedText };

/**
 * DR-1, DR-3: questions during a run are permission questions only. Plan approval is a step
 * between runs (`plan`, `applyPlan`). Only the user's settings and profiles can make a permission
 * ask (never a task file, M-9); after an answer the effective arguments are judged again. The
 * engine asks from the start of stage 5; until then `RunObserver.confirm` is never called.
 */
export interface ConfirmRequest {
  readonly kind: "permission";
  readonly id: string;
  readonly callId: string;
  readonly tool: ToolName;
  readonly permission: PermissionKind;
  /** The effective arguments, masked: fixed text and masked values only. */
  readonly subject: MaskedText;
}

export type ConfirmAnswer =
  | { readonly decision: "allow_once" }
  | { readonly decision: "deny" }
  /** The person closed the question without answering. Recorded as the default (`by: "default"`), a denial. */
  | { readonly decision: "dismissed" };

export interface RunObserver {
  /** Called synchronously for each event. Exceptions are ignored and never change the run. */
  onEvent?(event: RunEvent): void;
  /** Stage 5 (DR-3). Not called yet. */
  confirm?(request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer>;
}

export type RunOutcome =
  | { readonly ok: true; readonly result: EngineResult }
  /** An internal error after the start (`internal_error`). The lock is released. */
  | { readonly ok: false; readonly error: AppError };

export interface RunHandle {
  /** Known before the first event is delivered and before the engine starts. */
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

/**
 * DR-7: the changes of one run, masked again with the secrets a run with the same settings
 * registers now (the run's own mapping is gone when it ends). Adapters show these texts only; they
 * never read the snapshot directory themselves.
 */
export interface ChangesRequest {
  /** The settings the run was started with; they decide the secrets and the workspace. */
  readonly run: StartRunRequest;
  readonly runId: string;
}

export type ChangedFileUnavailable =
  /** The recorded path holds a privacy token, so the file cannot be found from it. */
  | "masked_path"
  /** No usable original was kept (none recorded, or it is not the state the run replaced). */
  | "snapshot_missing"
  /** The original or the current file is not UTF-8 text. */
  | "not_text"
  /** Larger than MAX_READ_BYTES. */
  | "too_large"
  | "unreadable"
  /** Masking failed; no text is given. */
  | "mask_failed";

export interface ChangedFileView {
  /** As the journal recorded it (masked). */
  readonly path: MaskedText;
  /** The run created the file: there is no original. */
  readonly created: boolean;
  /**
   * as_run_left: the file's hash is the one the run left. changed_since_run: it was changed later.
   * missing: it no longer exists. unknown: it could not be read.
   */
  readonly state: "as_run_left" | "changed_since_run" | "missing" | "unknown";
  /** The original, masked. Null when the run created the file or it is unavailable. */
  readonly before: MaskedText | null;
  /** The current content, masked. Null when the file is missing or unavailable. */
  readonly after: MaskedText | null;
  /** Why `before` or `after` is missing although the file has one; null when both are given as expected. */
  readonly unavailable: ChangedFileUnavailable | null;
}

export interface ChangesOutput {
  readonly kind: "changes";
  readonly runId: string;
  /** Always "current_secrets": masked with the secrets registered now, not with the run's table. */
  readonly masking: "current_secrets";
  /** One entry per changed path, in the order the run first changed them. */
  readonly files: readonly ChangedFileView[];
}

/** Assumption (G-A): `codaryn plan` output, a masked view of the proposed plan (DR-1, DR-5). */
export interface PlanView {
  readonly kind: "plan";
  readonly runId: string;
  /** The GT digest (SHA-256 of plan.json); the one value an approval names. */
  readonly digest: string;
  readonly actions: readonly MaskedText[];
}

/** Assumption (G-A): DR-1, DR-2. The settings decide the policy and verifiers at apply time (DR-5). */
export interface ApplyPlanRequest {
  readonly settings: StartRunRequest;
  readonly planRunId: string;
  /** The digest, or its first 12 or more characters (GT 6.2). */
  readonly digest: string;
}

/** Assumption (G-A): the apply result (`kind: "apply"`), a new run that names the plan run. */
export interface ApplyResultView {
  readonly kind: "apply";
  readonly runId: string;
  readonly planRunId: string;
  readonly status: TerminalRunStatus;
  readonly exitCode: number;
}

/** DR-2: applying has the same event and cancel channel as a run. */
export interface ApplyHandle {
  readonly runId: string;
  cancel(): void;
  readonly done: Promise<AppCallOutcome<ApplyResultView>>;
}

/** Assumption (G-A): `codaryn review` (GT-D6), the person's verdict on an `awaiting_review` run. */
export interface ReviewRequest {
  readonly workspace: string;
  readonly runId: string;
  readonly decision: "accept" | "reject";
  readonly note: string | null;
}

export interface ReviewOutputView {
  readonly kind: "review";
  readonly runId: string;
  readonly decision: "accept" | "reject";
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
  /** DR-7: the run's changes, masked again with the secrets registered now. Reads only. */
  changes(request: ChangesRequest): Promise<AppCallOutcome<ChangesOutput>>;
  /**
   * DR-1 (assumption, G-A): present once the general task commands exist. An adapter opens the plan
   * screen after a `needs-input`/`plan_pending` result and checks for these before offering them.
   */
  plan?(request: ReportRequest): Promise<AppCallOutcome<PlanView>>;
  applyPlan?(request: ApplyPlanRequest, observer?: RunObserver): Promise<{ readonly ok: true; readonly handle: ApplyHandle } | { readonly ok: false; readonly error: AppError }>;
  review?(request: ReviewRequest): Promise<AppCallOutcome<ReviewOutputView>>;
}
