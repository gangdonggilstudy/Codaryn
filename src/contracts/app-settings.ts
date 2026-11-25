/** App-layer settings contracts. Type-only; re-exported by app.ts. */

import type { CodarynConfig } from "./config.js";
import type { InitSuggestedCommand, InitSuggestedProtectedPath } from "./human.js";
import type { CommandRule } from "./task.js";
import type { PolicyNarrowingKind } from "./workflow.js";

/** N-2: create the config file with the defaults (`init --json`, no questions). */
export interface CreateSettingsRequest {
  /** Where to write. Null: the default location (N-1). CODARYN_CONFIG names a file to read, not this one. */
  readonly configPath: string | null;
  /** The workspace the file must lie outside of (S-1). Null: not checked against one. */
  readonly workspace: string | null;
}

/** The fixed candidates init would ask about for a workspace (N-2, N-14). */
export interface SettingsSuggestionsRequest {
  readonly workspace: string;
}

export interface SettingsSuggestions {
  readonly kind: "settings_suggestions";
  /** package.json scripts on init's fixed list, with the rule each becomes (arguments fixed). Allowing one widens the policy. */
  readonly commands: readonly { readonly shown: InitSuggestedCommand; readonly rule: CommandRule }[];
  /** Fixed protected path names that exist in the workspace. Protecting one narrows the policy. */
  readonly protectedPaths: readonly InitSuggestedProtectedPath[];
}

/** Settings change (standalone-gui 3.6, UX 7): the whole new config as the GUI built it. */
export interface SettingsChangeRequest {
  /** The file to change, chosen as readSettings chooses it. It must exist (createSettings first). */
  readonly configPath: string | null;
  /** The new config: a JSON value. It is checked like a config file read from disk. */
  readonly next: unknown;
}

export interface ApplySettingsChangeRequest extends SettingsChangeRequest {
  /** The proposal's `baseDigest`: the file must still be what the proposal saw. */
  readonly baseDigest: string;
  /** True only after the person confirmed the proposal's `widening` (the GUI's main process asks). */
  readonly confirmWidening: boolean;
}

export interface SettingsFieldChange {
  /** Top-level field, or one level down inside `policy` and `limits` (for example "limits.maxModelTurns"). */
  readonly field: string;
  readonly change: "added" | "removed" | "changed";
}

export interface SettingsWidening {
  readonly kind:
    | "command_added"
    | "extra_args_allowed"
    /**
     * U-107 (R-79 F-1): calls a rule asked a person about (U-74 `confirm: true`) are allowed without
     * asking: the rule lost `confirm`, or a plain rule matching the same calls was added.
     */
    | "confirm_removed"
    | "limit_raised"
    | "protected_path_removed"
    | "integrity_path_removed"
    | "secret_env_removed"
    | "verifier_removed"
    /** R-14 L-2: a command verifier added or changed; it runs with the person's rights on every run. */
    | "verifier_command_added"
    | "restore_path_tokens_enabled"
    | "plan_action_allowed"
    /** A provider's API address: top-level `apiBaseUrl`, or `providers.<name>.apiBaseUrl` (GUI F-3). */
    | "api_base_url_changed"
    /** GUI F-3: quick runs use another provider (`provider`), so the workspace's text goes to another API. */
    | "provider_changed"
    | "profile_changed"
    | "workflow_changed"
    /**
     * U-183 (DR-69 B-4): an entry of a list of writable paths (the config's `policy.writablePaths`,
     * a profile's, a task type definition's) covers a path that list did not cover: an entry added, a
     * broader prefix, the root. The field is the entry (`…writablePaths[i]`).
     */
    | "writable_path_added"
    /** U-183 (DR-69 B-4): a list of writable paths is gone, so that limit is lifted (no limit). The field is the list. */
    | "writable_paths_unlimited"
    /**
     * U-204 (DR-69 bundle A, A-7, R-7): a list of unreadable paths (the config's
     * `policy.unreadablePaths`, a profile's, a task type definition's) no longer has an entry it had,
     * by the gate's matching: removed, replaced by a broader one, the list gone or emptied. A
     * profile's or a definition's entry the config's new list still has is not one. The field is the list.
     */
    | "unreadable_path_removed"
    /**
     * U-204 (A-7, R-7, Q-4, DR-70): a lower group size k (never below 5): the config's
     * (`policy.minGroupSize`, 5 when it sets none), or a profile's or a task type definition's own
     * raise judged with the config's new value. The field is the `minGroupSize` that changed.
     */
    | "min_group_size_lowered";
  /** Where: a field path such as "policy.commands[2]". Never a value. */
  readonly field: string;
}

export interface SettingsChangeProposal {
  readonly kind: "settings_change";
  readonly file: { readonly source: "argument" | "environment" | "default"; readonly path: string; readonly display: string };
  /** SHA-256 of the file as it is now; apply needs it back. */
  readonly baseDigest: string;
  /** SHA-256 of the text that would be written. */
  readonly digest: string;
  readonly changes: readonly SettingsFieldChange[];
  /** Changes that let runs do more. Empty: nothing to confirm. */
  readonly widening: readonly SettingsWidening[];
  /** DR-41: what each task type's own rules would leave out of the new config's policy. See WorkflowPolicyNarrowing. */
  readonly policyNarrowings: readonly WorkflowPolicyNarrowing[];
  /** The new config as parsed. */
  readonly config: CodarynConfig;
}

/**
 * DR-41: a task type whose own policy leaves part of the config's policy out of its quick runs
 * (workflowPolicyNarrowings: a command rule dropped or kept in part, a plan action kind, path token
 * restoring). Kinds and counts only, never a rule, a command or a path. Built-in task types first,
 * then the config's, as workflowDefinitions orders them.
 */
export interface WorkflowPolicyNarrowing {
  readonly workflow: string;
  readonly kind: PolicyNarrowingKind;
  readonly count: number;
}

export interface SettingsWritten {
  readonly kind: "settings_written";
  readonly file: SettingsChangeProposal["file"];
  /** False when nothing changed (the file was left as it was). */
  readonly written: boolean;
  /** SHA-256 of the file now. */
  readonly digest: string;
  readonly changes: readonly SettingsFieldChange[];
  readonly widening: readonly SettingsWidening[];
}

/** The config file a run would read, and what it holds (standalone-gui 3.2, 3.6). */
export interface ReadSettingsRequest {
  /** `--config`. Null: CODARYN_CONFIG, then the default location (N-1). */
  readonly configPath: string | null;
}

export interface SettingsView {
  readonly kind: "settings";
  /**
   * The file chosen, or null when none is (no --config, no CODARYN_CONFIG, no default location).
   * `path` is for reading and writing it; show `display` (N-14). `exists` false only for the
   * default location, where a missing file means "no config yet" (the wizard creates one).
   */
  readonly file: {
    readonly source: "argument" | "environment" | "default";
    readonly path: string;
    readonly display: string;
    readonly exists: boolean;
  } | null;
  /** The parsed config, or null when there is no file. A file that fails a check is an AppError instead. */
  readonly config: CodarynConfig | null;
  /** N-8: profile names in the file's order, for the new task screen. */
  readonly profiles: readonly string[];
  /** G-A: task type ids the config file defines, in the file's order. */
  readonly workflows: readonly string[];
  /** G-A BUILTIN_WORKFLOW_IDS: the built-in task types, available with or without a config file. */
  readonly builtinWorkflows: readonly string[];
  /** N-8, G-A: each profile with the task type it uses when the task names none (`workflowRef`), or null; file order. */
  readonly profileWorkflows: readonly { readonly profile: string; readonly workflowRef: string | null }[];
  /**
   * Whether the key of the provider a quick run would use is set (SP-6: the config's `provider`,
   * else anthropic; ANTHROPIC_API_KEY or OPENAI_API_KEY). Never its value (C-1).
   */
  readonly keyAvailable: boolean;
  /** DR-41: what each task type's own rules leave out of this config's policy. See WorkflowPolicyNarrowing. */
  readonly policyNarrowings: readonly WorkflowPolicyNarrowing[];
  /** U-215 (DR-69 bundle A): the config's unreadable paths and group size k, for the settings screen. See SettingsPrivateData. */
  readonly privateData: SettingsPrivateData;
}

/**
 * U-215 (DR-69 bundle A, DR-70): the config's own private data settings, as the settings screen shows
 * and changes them (an edit applied to the config, then proposeSettingsChange, which judges taking an
 * entry away and lowering k as widenings, U-204). From the config's `policy` only: a profile's, a
 * task type definition's and a task file's own entries and k are not here.
 */
export interface SettingsPrivateData {
  /** The config's `policy.unreadablePaths`, in the file's order; empty when it has none. */
  readonly unreadablePaths: readonly string[];
  readonly minGroupSize: {
    /** The config's `policy.minGroupSize`, or null when it sets none. */
    readonly configured: number | null;
    /** What a run gets from the config alone (effectiveMinGroupSize: never below 5); a profile, a definition or a task file may raise it. */
    readonly effective: number;
    /** The values any source may set (MIN_GROUP_SIZE_LIMITS: whole numbers), so the window needs no copy of the contract's numbers. */
    readonly min: number;
    readonly max: number;
  };
}

/**
 * Y-1, Y-2, DR-22: the models a provider's key can use. A real API request: only when a person
 * asked for the list. `configPath` null: CODARYN_CONFIG, then the default location (N-1).
 */
export interface ListModelsRequest {
  /**
   * DR-22, SP-6: one of the API providers (API_PROVIDER_NAMES, CONNECTED_MODEL_PROVIDERS). It decides
   * the key, the address, the lister and where a choice is written, whatever the config file's
   * `provider` is. Another name is `invalid_arguments` before anything is read.
   */
  readonly provider: string;
  readonly configPath: string | null;
  readonly varsFile: string | null;
}

/**
 * Y-3, SP-6: lists again and writes this id as that provider's model in the config file, only when
 * the list holds it (as the CLI's `models --use`: anthropic's top-level `model`, or
 * `providers.<name>.model`).
 */
export interface SelectModelRequest extends ListModelsRequest {
  readonly model: string;
}
