/**
 * Tool names, arguments, results and the fixed permission table.
 * Requirements are fixed here in code. A model, a task or a project file cannot lower them.
 */

import { CONTENT_HASH_PATTERN_SOURCE } from "./text.js";
import type { ContentHash, JsonObject, MaskedText, RawText } from "./text.js";

export const TOOL_NAMES = ["read_file", "search_files", "write_file", "run_command"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

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
  /** Defaults to DEFAULT_COMMAND_TIMEOUT_MS. */
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

/** A call as the model requested it. Names and args are unvalidated and may contain tokens. */
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
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

/** What a tool runner returns. Local only: it must be masked before it is recorded or sent. */
export type RawToolOutcome =
  | { readonly ok: true; readonly payload: ToolPayload }
  | { readonly ok: false; readonly code: ToolErrorCode; readonly message: RawText };

/** The masked form of a tool outcome. This is what the journal and the model receive. */
export interface ToolResult {
  readonly callId: string;
  readonly tool: string;
  readonly ok: boolean;
  /** JSON text of the payload when ok, otherwise a short masked message. */
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
}

export interface ToolDescriptor {
  readonly name: string;
  readonly displayClass: DisplayClass;
  readonly requires: ToolRequirements;
  /** Fields whose tokens may be restored when policy permits. Dot paths into args. */
  readonly restoreFields: readonly string[];
  /** Fields that stay masked and are handled by `PrivacyGateway.rebuildDocument`. */
  readonly documentFields: readonly string[];
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
  /** JSON Schema of the args object. It mirrors the engine's shape validation. */
  readonly inputSchema: JsonObject;
}

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
        timeoutMs: { type: "integer", minimum: 1 },
      },
      required: ["executable", "args"],
      additionalProperties: false,
    },
  },
};

export interface ToolRunner {
  /** Executes one call that already passed every check. Never throws for tool-level failures. */
  execute(call: EffectiveToolCall, signal: AbortSignal): Promise<RawToolOutcome>;
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
