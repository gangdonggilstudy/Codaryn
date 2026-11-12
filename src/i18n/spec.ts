/**
 * N-4: the message keys, the parameters each message takes, and the kinds of those parameters.
 *
 * Rule (S-3, S-6, S-12): a message never holds a value read from a file or the environment.
 * Every parameter has a kind, and the translator turns a value into text by its kind alone:
 * - term kinds: a code from a closed set Codaryn defines (a status, an error code, ...). The
 *   message gets the code and its label in the message language. Anything else becomes "?".
 * - fixed kinds: numbers, and field positions built from field names the contracts define.
 *   Any other name in a position becomes "?".
 * - recorded kinds: ids and paths a run recorded (masked). Only display messages (progress,
 *   summary, revert, runs) take them, never an error or diagnostic message. Control characters
 *   are replaced and key-shaped text is hidden before they are shown.
 *
 * Codes, JSON fields, exit codes and command names stay English in both languages.
 */

import type {
  CliErrorCode,
  DoctorCheckId,
  DoctorCheckStatus,
  IntegrityPhase,
  ModelErrorKind,
  PermissionKind,
  PolicyDenialCode,
  RevertSkipReason,
  RunReason,
  TerminalRunStatus,
  ToolErrorCode,
  ToolName,
  VerifierOutcome,
} from "../contracts/index.js";
import type { Language, LanguageSource } from "./language.js";

/** Which input file a message is about. */
export type InputFile = "config" | "task" | "script" | "vars";

/**
 * Where the config file came from (N-1): `--config`, CODARYN_CONFIG, the default location, or
 * none. Temporary until the N-A contract names these.
 */
export type ConfigSource = "option" | "env" | "default" | "none";

/** Closed sets of codes. Each language gives every code a label. */
export interface TermKinds {
  readonly status: TerminalRunStatus;
  readonly reason: RunReason;
  readonly tool: ToolName;
  readonly permission: PermissionKind;
  readonly denial: PolicyDenialCode | ToolErrorCode;
  readonly phase: IntegrityPhase;
  readonly verifierOutcome: VerifierOutcome;
  readonly modelErrorKind: ModelErrorKind;
  readonly revertSkip: RevertSkipReason;
  readonly checkStatus: DoctorCheckStatus;
  readonly doctorCheck: DoctorCheckId;
  /** Label: what went wrong, one clause. */
  readonly errorCode: CliErrorCode;
  readonly language: Language;
  readonly languageSource: LanguageSource;
  readonly input: InputFile;
  readonly configSource: ConfigSource;
}
export type TermKind = keyof TermKinds;

/** One label per code, for every term kind. */
export type TermTables = { readonly [K in TermKind]: { readonly [C in TermKinds[K]]: string } };

/** Values in a closed form. */
export interface FixedKinds {
  /** A non-negative integer. */
  readonly count: number;
  /** A non-negative integer number of milliseconds, shown with units. */
  readonly durationMs: number;
  /**
   * A field position such as `policy.commands[2]` or `limits.maxModelTurns`, or "" for the top
   * level. Names outside KNOWN_FIELD_NAMES are shown as "?", so a name taken from a file (an
   * unknown field, a profile name) never reaches the message.
   */
  readonly field: string;
}

/** What a run recorded. Display messages only. */
export interface RecordedKinds {
  /** A short identifier as recorded: run id, task id, verifier id, provider. Otherwise "?". */
  readonly id: string;
  /** A path as the run's records hold it (masked). Cleaned and cut to MAX_SHOWN_PATH characters. */
  readonly recordedPath: string;
}

export type ParamKind = TermKind | keyof FixedKinds | keyof RecordedKinds;

export const TERM_KINDS = [
  "status",
  "reason",
  "tool",
  "permission",
  "denial",
  "phase",
  "verifierOutcome",
  "modelErrorKind",
  "revertSkip",
  "checkStatus",
  "doctorCheck",
  "errorCode",
  "language",
  "languageSource",
  "input",
  "configSource",
] as const satisfies readonly TermKind[];
export const FIXED_KINDS = ["count", "durationMs", "field"] as const satisfies readonly (keyof FixedKinds)[];
export const RECORDED_KINDS = ["id", "recordedPath"] as const satisfies readonly (keyof RecordedKinds)[];

/** Message groups that may show recorded ids and paths. */
export const DISPLAY_GROUPS = ["progress", "summary", "revert", "runs"] as const;

/** The value a caller passes for a parameter of that kind. */
export type ParamValue<K extends ParamKind> = K extends TermKind
  ? TermKinds[K]
  : K extends keyof FixedKinds
    ? FixedKinds[K]
    : K extends keyof RecordedKinds
      ? RecordedKinds[K]
      : never;

type ParamSpec = { readonly [param: string]: ParamKind };

/**
 * Every message and its parameters. Keys are `<group>.<name>`; one message is one line.
 */
export const MESSAGE_PARAMS = {
  // Language (N-4)
  "language.current": { language: "language", source: "languageSource" },
  "language.ignored": { setting: "languageSource" },

  // Errors that stop a command (stderr, N-5): what, how to fix, code
  "error.title": { code: "errorCode" },
  "error.fix": { code: "errorCode" },
  "error.check": {},

  // Problems in an input file (N-6): position, never the value
  "input.notFound": { input: "input" },
  "input.jsonSyntax": { input: "input", line: "count", column: "count" },
  "input.unknownField": { input: "input", parent: "field", suggestion: "field" },
  "input.unknownFieldNoSuggestion": { input: "input", parent: "field" },
  "input.missingField": { input: "input", field: "field" },
  "input.invalidField": { input: "input", field: "field" },
  "input.insideWorkspace": { input: "input" },
  "input.moreProblems": { count: "count" },

  // Config file (N-1, R-2)
  "config.notFound": {},
  "config.notFoundFix": {},
  "config.defaultLocationWindows": {},
  "config.defaultLocationXdg": {},
  "config.defaultLocationHome": {},
  "config.using": { source: "configSource" },

  // API key (R-4, N-10). The value is never asked for or shown.
  "key.notSet": {},
  "key.howToWindows": {},
  "key.howToPosix": {},
  "key.howToVarsFile": {},
  "key.neverAsked": {},

  // Model (N-3)
  "model.notSet": {},
  "model.placeholder": {},
  "model.howTo": {},
  "model.notFoundHint": {},

  // Why a tool call was denied and how to allow it (R-11, UX 4.6)
  "hint.denied": { denial: "denial" },

  // Progress lines on stderr, without the "codaryn: " prefix (U-8, N-5)
  "progress.runStarted": { task: "id", provider: "id" },
  "progress.turn": { turn: "count" },
  "progress.modelError": { turn: "count", kind: "modelErrorKind" },
  "progress.toolAllowed": { tool: "tool" },
  "progress.toolDenied": { tool: "tool", permission: "permission", denial: "denial" },
  "progress.toolDeniedUnspecified": { tool: "tool" },
  "progress.fileCreated": { path: "recordedPath" },
  "progress.fileChanged": { path: "recordedPath" },
  "progress.verifier": { id: "id", outcome: "verifierOutcome" },
  "progress.repair": { attempt: "count", failed: "count" },
  "progress.integrityUnchanged": { phase: "phase" },
  "progress.integrityChanged": { phase: "phase", count: "count" },
  "progress.finished": { status: "status", reason: "reason" },

  // End-of-run summary on stderr (N-5, UX 4.7)
  "summary.title": { status: "status", reason: "reason" },
  "summary.changes": { count: "count" },
  "summary.changeCreated": { path: "recordedPath" },
  "summary.changeModified": { path: "recordedPath" },
  "summary.moreChanges": { count: "count" },
  "summary.verifiers": { passed: "count", total: "count" },
  "summary.counts": { denied: "count", turns: "count", toolCalls: "count", duration: "durationMs" },
  "summary.tokens": { input: "count", output: "count" },
  "summary.tokensUnknown": {},
  "summary.denial": { tool: "tool", denial: "denial" },
  "summary.next": { reason: "reason" },
  "summary.reportLabel": {},
  "summary.revertLabel": {},

  // revert and its preview (N-7, UX 4.8)
  "revert.previewTitle": { count: "count" },
  "revert.previewDelete": { path: "recordedPath" },
  "revert.previewRestore": { path: "recordedPath" },
  "revert.previewSkipTitle": { count: "count" },
  "revert.skip": { path: "recordedPath", reason: "revertSkip" },
  "revert.previewApply": {},
  "revert.alreadyReverted": {},
  "revert.done": { count: "count" },
  "revert.partial": { reverted: "count", skipped: "count" },

  // Run list (N-7)
  "runs.empty": {},
  "runs.columnRun": {},
  "runs.columnStarted": {},
  "runs.columnResult": {},
  "runs.columnChanges": {},
  "runs.noResult": {},
  "runs.reverted": {},

  // codaryn init (N-2): asked at a terminal only, never the key
  "init.notTerminal": {},
  "init.exists": {},
  "init.confirmCreate": {},
  "init.limits": { turns: "count", toolCalls: "count", tokens: "count", minutes: "count" },
  "init.askCommand": {},
  "init.askProtected": {},
  "init.askLanguage": { language: "language" },
  "init.modelPlaceholder": {},
  "init.saved": {},
  "init.nothingCreated": {},

  // codaryn doctor
  "doctor.check": { check: "doctorCheck", status: "checkStatus" },
  "doctor.noNetwork": {},
  "doctor.secretsSet": { set: "count", total: "count" },
} as const satisfies { readonly [key: string]: ParamSpec };

export type MessageKey = keyof typeof MESSAGE_PARAMS;
export type MessageSpec<K extends MessageKey> = (typeof MESSAGE_PARAMS)[K];

/** What a caller passes for message K. */
export type MessageParams<K extends MessageKey> = {
  readonly [P in keyof MessageSpec<K>]: MessageSpec<K>[P] extends ParamKind ? ParamValue<MessageSpec<K>[P]> : never;
};

/** A term parameter as a template sees it: the code (English) and its label in the message language. */
export interface Term {
  readonly code: string;
  readonly label: string;
}

/** What a template receives: terms as Term, everything else as finished text. */
export type RenderedParams<S> = { readonly [P in keyof S]: S[P] extends TermKind ? Term : string };

export type Template<S> = (params: RenderedParams<S>) => string;

/** One language's messages. TypeScript checks that each language has every key with its parameters. */
export type MessageCatalog = { readonly [K in MessageKey]: Template<MessageSpec<K>> };

/**
 * Field names the contracts define (task, config, verifiers, policy, limits, integrity, scripted
 * model files) and the planned `language` and `profiles` (N-4, N-8). A position may only show
 * these names.
 */
export const KNOWN_FIELD_NAMES: ReadonlySet<string> = new Set([
  // task and config
  "schemaVersion",
  "id",
  "goal",
  "workflow",
  "workspaceRoot",
  "model",
  "provider",
  "scriptPath",
  "maxOutputTokens",
  "apiBaseUrl",
  "requestTimeoutMs",
  "maxRetries",
  "language",
  "profiles",
  // policy
  "policy",
  "commands",
  "executable",
  "argsPrefix",
  "allowExtraArgs",
  "network",
  "destructive",
  "restorePathTokens",
  "protectedPaths",
  // privacy
  "privacy",
  "secretEnv",
  // limits
  "limits",
  "maxModelTurns",
  "maxToolCalls",
  "maxTotalTokens",
  "maxDurationMs",
  "maxRepairAttempts",
  "maxSameFailures",
  // verifiers
  "verifiers",
  "kind",
  "args",
  "cwd",
  "timeoutMs",
  "expectExitCode",
  "rules",
  "type",
  "path",
  "text",
  // integrity
  "integrity",
  "paths",
  // scripted model file
  "steps",
  "toolCalls",
  "name",
  "stop",
  "usage",
  "inputTokens",
  "outputTokens",
  "delayMs",
]);

/** Longest recorded path shown, in characters. */
export const MAX_SHOWN_PATH = 200;
/** Longest field position accepted, in characters. */
export const MAX_FIELD_POSITION = 200;
