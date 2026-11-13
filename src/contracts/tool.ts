/**
 * Tool names, arguments, results and the fixed permission table.
 * Requirements are fixed here in code. A model, a task or a project file cannot lower them.
 */

import { MAX_PLAN_ACTIONS, MAX_PLAN_SUMMARY_CHARS } from "./plan.js";
import type { PlanActionKind, ProposePlanArgs, ProposePlanPayload } from "./plan.js";
import { CONTENT_HASH_PATTERN_SOURCE } from "./text.js";
import type { ContentHash, JsonObject, MaskedText, RawText } from "./text.js";

export const TOOL_NAMES = ["read_file", "search_files", "write_file", "run_command"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Largest `run_command.timeoutMs` a model may ask for (T-3). The engine rejects a larger value as
 * `invalid_args`, and TOOL_DEFINITIONS states it as the schema maximum. The run's own
 * `maxDurationMs` still ends the run first when it is shorter.
 */
export const MAX_COMMAND_TIMEOUT_MS = 600_000;

/** All paths are relative to the workspace root and use `/` or the platform separator. */
export interface ReadFileArgs {
  readonly path: string;
}

export interface SearchFilesArgs {
  /** Directory to search recursively. Use "." for the workspace root. */
  readonly path: string;
  /** Keep entries whose relative path contains this literal string. */
  readonly nameContains?: string;
  /** Keep files that contain this literal string and report the matching lines. */
  readonly text?: string;
}

export type FileChange =
  | { readonly kind: "replace_all"; readonly content: string }
  | { readonly kind: "replace_text"; readonly oldText: string; readonly newText: string };

export interface WriteFileArgs {
  readonly path: string;
  /**
   * Required. The hash returned by the last `read_file` of this path,
   * or `null` to state that the file must not exist yet.
   */
  readonly expectedHash: ContentHash | null;
  readonly change: FileChange;
}

export interface RunCommandArgs {
  readonly executable: string;
  readonly args: readonly string[];
  /** Working directory relative to the workspace root. Defaults to ".". */
  readonly cwd?: string;
  /** Defaults to DEFAULT_COMMAND_TIMEOUT_MS. At most MAX_COMMAND_TIMEOUT_MS; more is `invalid_args` (T-3). */
  readonly timeoutMs?: number;
}

export interface ToolArgsByName {
  readonly read_file: ReadFileArgs;
  readonly search_files: SearchFilesArgs;
  readonly write_file: WriteFileArgs;
  readonly run_command: RunCommandArgs;
}

export interface ReadFilePayload {
  readonly path: string;
  /** UTF-8 text without the byte order mark. */
  readonly content: string;
  readonly hash: ContentHash;
  readonly hadBom: boolean;
}

export interface SearchMatch {
  /** 1-based line number. */
  readonly line: number;
  readonly text: string;
}

export interface SearchEntry {
  readonly path: string;
  readonly kind: "file" | "dir";
  /** Present only when `text` was given. */
  readonly matches?: readonly SearchMatch[];
}

export interface SearchFilesPayload {
  /** Sorted by path in code unit order. */
  readonly entries: readonly SearchEntry[];
  readonly truncated: boolean;
}

export interface WriteFilePayload {
  readonly path: string;
  readonly previousHash: ContentHash | null;
  readonly newHash: ContentHash;
  readonly created: boolean;
}

export interface RunCommandPayload {
  /** `null` when the process did not exit normally (timeout or kill). */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  /** True when stdout or stderr was cut at MAX_COMMAND_OUTPUT_BYTES. */
  readonly truncated: boolean;
}

export interface ToolPayloadByName {
  readonly read_file: ReadFilePayload;
  readonly search_files: SearchFilesPayload;
  readonly write_file: WriteFilePayload;
  readonly run_command: RunCommandPayload;
}

export type ToolPayload = ToolPayloadByName[ToolName];

/**
 * AC-D15 (DR-13): what the engine records, returns and sends back in place of a tool name that is
 * in no tool list (ALL_TOOL_NAMES). A valid tool-name token, so a provider can send it back as a
 * tool_use name; never offered, so a call to it is `unknown_tool`. People see "(unknown tool)".
 */
export const UNKNOWN_TOOL_RECORD_NAME = "unknown_tool";

/**
 * AC-D15: a call id the engine keeps as the model gave it: 1 to 64 of `A-Z a-z 0-9 _ -`, holding no
 * registered secret, and not already standing for another id. The engine replaces any other id with
 * REPLACED_CALL_ID_PREFIX and a number (the same one for every use of that id in the run) before it
 * records the call, answers it or sends it back, so the pair of a call and its result still match.
 * DR-35 (c): the same for every provider. An OpenAI `call_id` that passes is recorded as given, as an
 * Anthropic tool_use id is (it is not a secret, and it lets a record be matched with its requests);
 * for one that does not, the adapter keeps the original in memory only and answers with it.
 */
export const CALL_ID_PATTERN_SOURCE = "^[A-Za-z0-9_-]{1,64}$";
export const REPLACED_CALL_ID_PREFIX = "codaryn-call-";

/**
 * A call as the model requested it. Names and args are unvalidated and may contain tokens.
 * AC-D15: the engine records it only with a known name (else UNKNOWN_TOOL_RECORD_NAME) and an id
 * that passes CALL_ID_PATTERN_SOURCE and masking (else a replacement).
 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: JsonObject;
}

/**
 * A validated call after policy check, permitted restoration and effective re-check.
 * Path fields may hold restored values. Document fields of `write_file` stay masked.
 */
export type EffectiveToolCall = {
  readonly [N in ToolName]: {
    readonly id: string;
    readonly name: N;
    readonly args: ToolArgsByName[N];
  };
}[ToolName];

export const TOOL_ERROR_CODES = [
  "unknown_tool",
  "invalid_args",
  "policy_denied",
  "unresolved_token",
  "invalid_token",
  "protected_span_violation",
  "masking_failed",
  "conflict",
  "not_found",
  "not_text",
  "too_large",
  "no_match",
  "ambiguous_match",
  "spawn_failed",
  "cancelled",
  "io_error",
  /** G-A: `propose_plan` refused the plan (PLAN_PROBLEMS). The message names the action index and the code. */
  "invalid_plan",
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

/** U-15 (AXM-7): the content of a failed result before masking: the code, then the message. */
export function failedToolContent(code: ToolErrorCode, message: string): string {
  return `error (${code}): ${message}`;
}

/**
 * U-50 (AXM-6, review R-53 I-2): what to do next after a tool that ran failed, one fixed sentence
 * per code, which the engine adds to the tool's message (toolFailureMessage) before
 * failedToolContent. Model-bound fixed texts (FIXED_MODEL_TEXTS); no value of the call in them.
 * A refusal before the call runs has its own hint (REFUSAL_HINTS); these are for the outcomes of
 * a tool runner (RawToolOutcome, RawWorkflowToolOutcome). No hint where the tool's message already
 * says what to do (conflict, no_match, ambiguous_match, its own invalid_args; invalid_plan names
 * the action and the problem, and its end is what the organize test reads; spawn_failed names its
 * reason, which is not only a missing program: on Windows a .cmd inside the workspace, an argument
 * cmd.exe cannot take or a file type that cannot be started, review R-68 M-1) or there is nothing
 * to add (cancelled, io_error; unknown_tool and unresolved_token come before a call runs).
 * R-68 L-1, L-2: not_found also comes from search_files given a file, and not_text from a
 * directory given to read_file or write_file; their hints are true for those too.
 */
export const TOOL_FAILURE_HINTS: { readonly [C in ToolErrorCode]?: string } = {
  policy_denied: "The path must stay inside the workspace, also after links are followed, and outside Codaryn's records folder.",
  not_found: "No entry of the kind this tool needs is at this path: it is missing, or it is a file where a directory is needed. Check the path before you try again.",
  not_text: "The path is not a UTF-8 text file: it is a directory, or the file holds binary data or another encoding. These tools cannot read or change it.",
  too_large: "It is larger than this tool can handle; use a smaller file or directory.",
  protected_span_violation: "A line that holds a protected placeholder must stay exactly as it is; change other lines only.",
  invalid_token: "Keep protected placeholders exactly as they were given, or leave them out.",
  masking_failed: "The result could not be masked, so none of it is shown.",
};

/**
 * U-50: a tool runner's failure message with its code's hint after it (`<message>. <hint>`, the
 * period left out when the message ends with one), or the message alone when the code has no hint
 * or the message already ends with it.
 */
export function toolFailureMessage(code: ToolErrorCode, message: string): string {
  const hint = TOOL_FAILURE_HINTS[code];
  if (hint === undefined || message.endsWith(hint)) return message;
  if (message.length === 0) return hint;
  return `${message}${message.endsWith(".") ? "" : "."} ${hint}`;
}

/** What a tool runner returns. Local only: it must be masked before it is recorded or sent. */
export type RawToolOutcome =
  | { readonly ok: true; readonly payload: ToolPayload }
  | { readonly ok: false; readonly code: ToolErrorCode; readonly message: RawText };

/** The masked form of a tool outcome. This is what the journal and the model receive. */
export interface ToolResult {
  readonly callId: string;
  readonly tool: string;
  readonly ok: boolean;
  /**
   * JSON text of the payload when ok, otherwise a short masked message. U-15 (AXM-7): every failed
   * result the engine hands back reads `error (<errorCode>): <message>` (failedToolContent), so the
   * model gets the same text from every provider (Anthropic's `is_error` stays as well).
   */
  readonly content: MaskedText;
  readonly errorCode: ToolErrorCode | null;
}

/** Display label only. It never decides whether a call is allowed. */
export type DisplayClass = "read" | "write-local" | "exec" | "external";

export type PathAccess = "read" | "write" | "cwd";

export interface ToolRequirements {
  /** Argument fields that hold a path, and how the tool uses each one. */
  readonly paths: readonly { readonly field: string; readonly access: PathAccess }[];
  readonly command: boolean;
  readonly network: boolean;
  readonly destructive: boolean;
  /**
   * G-A: a plan action (PLAN_ACTION_DESCRIPTORS only). The gate denies it unless
   * `PolicyConfig.planActions` lists the kind: permission `destructive`, code
   * `plan_action_not_allowed`. Absent on every tool.
   */
  readonly planAction?: PlanActionKind;
}

export interface ToolDescriptor {
  readonly name: string;
  readonly displayClass: DisplayClass;
  readonly requires: ToolRequirements;
  /** Fields whose tokens may be restored when policy permits. Dot paths into args. */
  readonly restoreFields: readonly string[];
  /** Fields that stay masked and are handled by `PrivacyGateway.rebuildDocument`. */
  readonly documentFields: readonly string[];
  /**
   * G-A (E5): "plan" marks the tool whose success ends the run as `needs-input`/`plan_pending`
   * (`propose_plan`). The engine acts on this property, never on a tool name.
   */
  readonly endsRun?: "plan";
}

export const BUILTIN_TOOLS: { readonly [N in ToolName]: ToolDescriptor & { readonly name: N } } = {
  read_file: {
    name: "read_file",
    displayClass: "read",
    requires: {
      paths: [{ field: "path", access: "read" }],
      command: false,
      network: false,
      destructive: false,
    },
    restoreFields: ["path"],
    documentFields: [],
  },
  search_files: {
    name: "search_files",
    displayClass: "read",
    requires: {
      paths: [{ field: "path", access: "read" }],
      command: false,
      network: false,
      destructive: false,
    },
    restoreFields: ["path"],
    documentFields: [],
  },
  write_file: {
    name: "write_file",
    displayClass: "write-local",
    requires: {
      paths: [{ field: "path", access: "write" }],
      command: false,
      network: false,
      destructive: false,
    },
    restoreFields: ["path"],
    documentFields: ["change.content", "change.oldText", "change.newText"],
  },
  run_command: {
    name: "run_command",
    displayClass: "exec",
    requires: {
      paths: [{ field: "cwd", access: "cwd" }],
      command: true,
      network: false,
      destructive: false,
    },
    restoreFields: ["cwd"],
    documentFields: [],
  },
};

/**
 * What a provider tells the model about a tool. Fixed text: it must never spell the privacy
 * token marker, because it reaches the model without passing `PrivacyGateway.mask`.
 */
export interface ToolDefinition {
  readonly description: string;
  /**
   * JSON Schema of the args object. It mirrors the engine's shape validation. U-143 (SP-U10): it
   * uses only TOOL_SCHEMA_KEYWORDS, the part of JSON Schema both providers are given.
   */
  readonly inputSchema: JsonObject;
}

/**
 * U-143 (SP-U10, second-provider.md 4.9): the JSON Schema keywords a tool's `inputSchema` may use,
 * the subset both providers receive. Every adapter sends the schema as it is (Anthropic
 * `input_schema`, OpenAI `parameters` with `strict: false`, SP-D6), so a tool definition that keeps
 * to this subset means the same to both. Within it:
 * - `type` is one JSON type name, or a name and "null" (`["string", "null"]`);
 * - `additionalProperties` is `false` only;
 * - every name in `required` is a key of the same object's `properties`.
 * Tool names keep to TOOL_NAME_PATTERN_SOURCE. Whether OpenAI accepts each keyword in strict mode
 * is not relied on: strict is off (C-7 was not checked against the real API).
 */
export const TOOL_SCHEMA_KEYWORDS = [
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "const",
  "anyOf",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "additionalProperties",
  "description",
] as const;
export type ToolSchemaKeyword = (typeof TOOL_SCHEMA_KEYWORDS)[number];

/** U-143 (SP-U10): a tool name both providers accept as a function name. */
export const TOOL_NAME_PATTERN_SOURCE = "^[a-zA-Z0-9_-]{1,64}$";

const PATH_PROPERTY: JsonObject = {
  type: "string",
  minLength: 1,
  description: "Path relative to the workspace root.",
};

export const TOOL_DEFINITIONS: { readonly [N in ToolName]: ToolDefinition } = {
  read_file: {
    description:
      "Read a UTF-8 text file in the workspace. Returns its content and its hash. " +
      "Pass that hash as expectedHash when you change the file.",
    inputSchema: {
      type: "object",
      properties: { path: PATH_PROPERTY },
      required: ["path"],
      additionalProperties: false,
    },
  },
  search_files: {
    description:
      "List files and directories under a workspace directory, recursively. " +
      "nameContains keeps paths that contain that literal string. " +
      "text keeps files that contain that literal string and returns the matching lines.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description: 'Directory relative to the workspace root. Use "." for the root.',
        },
        nameContains: { type: "string" },
        text: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  write_file: {
    description:
      "Create or change a UTF-8 text file in the workspace. expectedHash is the hash from your " +
      "last read_file of this path, or null for a file that must not exist yet. The change either " +
      "replaces the whole content or replaces one exact occurrence of oldText that appears only once.",
    inputSchema: {
      type: "object",
      properties: {
        path: PATH_PROPERTY,
        expectedHash: {
          type: ["string", "null"],
          pattern: CONTENT_HASH_PATTERN_SOURCE,
          description: "64 lowercase hex characters from read_file, or null for a new file.",
        },
        change: {
          anyOf: [
            {
              type: "object",
              properties: { kind: { const: "replace_all" }, content: { type: "string" } },
              required: ["kind", "content"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { const: "replace_text" },
                oldText: { type: "string", minLength: 1 },
                newText: { type: "string" },
              },
              required: ["kind", "oldText", "newText"],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ["path", "expectedHash", "change"],
      additionalProperties: false,
    },
  },
  run_command: {
    description:
      "Run a program without a shell inside the workspace. Only commands the task policy allows " +
      "will run. Returns the exit code, stdout and stderr.",
    inputSchema: {
      type: "object",
      properties: {
        executable: { type: "string", minLength: 1 },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string", description: 'Working directory relative to the workspace root. Default ".".' },
        timeoutMs: { type: "integer", minimum: 1, maximum: MAX_COMMAND_TIMEOUT_MS },
      },
      required: ["executable", "args"],
      additionalProperties: false,
    },
  },
};

/**
 * G-A: tools only a task type offers (design general-tasks.md 5.3 and 6). They are not in
 * TOOL_NAMES, so a task without task type settings never sees them and everything keyed by
 * ToolName (the engine's dispatch, TOOL_DEFINITIONS, `ModelRequest.tools`) is unchanged.
 * A task lists them in `tools` (WorkflowSettings); the engine offers them through
 * `ModelRequest.workflowTools` and runs them with `ToolRunner.executeWorkflowTool`.
 */
export const WORKFLOW_TOOL_NAMES = ["inspect_files", "propose_plan"] as const;
export type WorkflowToolName = (typeof WORKFLOW_TOOL_NAMES)[number];

/** Every tool name a task's `tools` may list: the built-in ones first, in TOOL_NAMES order. */
export const ALL_TOOL_NAMES = [...TOOL_NAMES, ...WORKFLOW_TOOL_NAMES] as const;
export type AnyToolName = ToolName | WorkflowToolName;

/** Most entries one `inspect_files` call returns. More continue with `after`. */
export const MAX_INSPECT_ENTRIES = 500;
/** Most bytes one `inspect_files` call hashes with `hash: true`. Files beyond it get no `sha256`. */
export const MAX_INSPECT_HASH_BYTES = 64 * 1024 * 1024;

/** Lists a directory's tree with sizes and times. Reads no file content except to hash it. */
export interface InspectFilesArgs {
  /** Directory relative to the workspace root. "." for the root. */
  readonly path: string;
  /** The `next` value of the previous call: entries after this path, in code unit order. */
  readonly after?: string;
  /** Adds each file's SHA-256 (for finding duplicates), within MAX_INSPECT_HASH_BYTES per call. */
  readonly hash?: boolean;
}

export interface InspectEntry {
  /** Relative to the workspace root, `/` separated. */
  readonly path: string;
  readonly kind: "file" | "dir";
  /** Bytes; null for a directory. */
  readonly size: number | null;
  /** Last modification, ISO 8601 UTC; null when unknown. */
  readonly modifiedAt: string | null;
  /** Only with `hash: true`, for files hashed within the call's byte budget. */
  readonly sha256?: ContentHash;
}

export interface InspectFilesPayload {
  /** Sorted by path in code unit order, at most MAX_INSPECT_ENTRIES. The state directory is never listed. */
  readonly entries: readonly InspectEntry[];
  /** Pass as `after` to continue; null when the listing is complete. */
  readonly next: string | null;
  /** True when `hash` was asked and some files were left without `sha256` (byte budget). */
  readonly hashesIncomplete: boolean;
}

export interface WorkflowToolArgsByName {
  readonly inspect_files: InspectFilesArgs;
  readonly propose_plan: ProposePlanArgs;
}

export interface WorkflowToolPayloadByName {
  readonly inspect_files: InspectFilesPayload;
  readonly propose_plan: ProposePlanPayload;
}

export type WorkflowToolPayload = WorkflowToolPayloadByName[WorkflowToolName];

/** A task type tool call after the same checks as EffectiveToolCall. */
export type EffectiveWorkflowToolCall = {
  readonly [N in WorkflowToolName]: {
    readonly id: string;
    readonly name: N;
    readonly args: WorkflowToolArgsByName[N];
  };
}[WorkflowToolName];

export type RawWorkflowToolOutcome =
  | { readonly ok: true; readonly payload: WorkflowToolPayload }
  | { readonly ok: false; readonly code: ToolErrorCode; readonly message: RawText };

/**
 * Requirements of the task type tools. `propose_plan` declares no path itself: each action is
 * judged with PLAN_ACTION_DESCRIPTORS (plan.ts). It writes plan.json, so its display class is not
 * "read" and a call whose outcome is unknown is not retried.
 */
export const WORKFLOW_TOOLS: { readonly [N in WorkflowToolName]: ToolDescriptor & { readonly name: N } } = {
  inspect_files: {
    name: "inspect_files",
    displayClass: "read",
    requires: {
      paths: [{ field: "path", access: "read" }],
      command: false,
      network: false,
      destructive: false,
    },
    restoreFields: ["path"],
    documentFields: [],
  },
  propose_plan: {
    name: "propose_plan",
    displayClass: "write-local",
    requires: {
      paths: [],
      command: false,
      network: false,
      destructive: false,
    },
    restoreFields: [],
    documentFields: [],
    endsRun: "plan",
  },
};

/** Every descriptor by name, built-in and task type tools. */
export const ALL_TOOL_DESCRIPTORS: { readonly [N in AnyToolName]: ToolDescriptor & { readonly name: N } } = {
  ...BUILTIN_TOOLS,
  ...WORKFLOW_TOOLS,
};

const PLAN_PATH_PROPERTY: JsonObject = {
  type: "string",
  minLength: 1,
  description: "File path relative to the workspace root.",
};

/** What a provider tells the model about the task type tools. Fixed text, as TOOL_DEFINITIONS. */
export const WORKFLOW_TOOL_DEFINITIONS: { readonly [N in WorkflowToolName]: ToolDefinition } = {
  inspect_files: {
    description:
      "List files and directories under a workspace directory, recursively, with size and " +
      "modification time. Set hash to true to also get each file's SHA-256, for example to find " +
      "duplicates. When next is not null, call again with after set to it to continue.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description: 'Directory relative to the workspace root. Use "." for the root.',
        },
        after: { type: "string", minLength: 1 },
        hash: { type: "boolean" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  propose_plan: {
    description:
      "Propose the complete plan of file moves and discards, once. Nothing is changed now: a " +
      "person reviews the plan and applies it later. move renames a file to a path that must not " +
      "exist yet. discard sets a file aside so it can be restored. Only regular files can be moved " +
      "or discarded. After this call the run ends.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", minLength: 1, maxLength: MAX_PLAN_SUMMARY_CHARS },
        actions: {
          type: "array",
          minItems: 1,
          maxItems: MAX_PLAN_ACTIONS,
          items: {
            anyOf: [
              {
                type: "object",
                properties: { kind: { const: "move" }, from: PLAN_PATH_PROPERTY, to: PLAN_PATH_PROPERTY },
                required: ["kind", "from", "to"],
                additionalProperties: false,
              },
              {
                type: "object",
                properties: { kind: { const: "discard" }, path: PLAN_PATH_PROPERTY },
                required: ["kind", "path"],
                additionalProperties: false,
              },
            ],
          },
        },
      },
      required: ["summary", "actions"],
      additionalProperties: false,
    },
  },
};

/** Every definition by name, built-in and task type tools. */
export const ALL_TOOL_DEFINITIONS: { readonly [N in AnyToolName]: ToolDefinition } = {
  ...TOOL_DEFINITIONS,
  ...WORKFLOW_TOOL_DEFINITIONS,
};

/**
 * Created by `createToolRunner` (src/tools). Besides the workspace and the privacy gateway it
 * takes an optional `changeRecorder` (`ChangeRecorder`, see changes.ts). When one is given,
 * `write_file` hands it the file's original before writing, and does not write when that fails.
 * G-A: it also takes an optional `planRecorder` (`PlanRecorder`, plan.ts), which `propose_plan`
 * needs; without one `propose_plan` fails with `io_error` and stores nothing. DR-28: `propose_plan`
 * hands every action to it with `shown`, built with the runner's own `privacy` gateway
 * (PlanRecorder.savePlan).
 */
export interface ToolRunner {
  /** Executes one call that already passed every check. Never throws for tool-level failures. */
  execute(call: EffectiveToolCall, signal: AbortSignal): Promise<RawToolOutcome>;
  /**
   * G-A: executes one task type tool call that already passed every check (for `propose_plan`, the
   * policy check of every action). Never throws for tool-level failures. A runner without it
   * cannot run task type tools: the engine then answers such a call `unknown_tool`.
   */
  executeWorkflowTool?(call: EffectiveWorkflowToolCall, signal: AbortSignal): Promise<RawWorkflowToolOutcome>;
}

export const MAX_READ_BYTES = 262_144;
export const MAX_SEARCH_ENTRIES = 500;
export const MAX_SEARCH_MATCHES_PER_FILE = 20;
export const MAX_COMMAND_OUTPUT_BYTES = 65_536;
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

/**
 * Child processes receive only these environment variables (when set in the parent).
 * Names are compared case-insensitively on Windows. Registered secrets and API keys are never passed.
 */
export const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LANG",
] as const;
