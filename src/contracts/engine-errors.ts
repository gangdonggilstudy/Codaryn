/** CLI error codes, facts, diagnostics and hints. Re-exported by engine.ts. */

import type { ApiKeyEnv, ApiModelEnv } from "./config.js";
import type { InputDiagnosticFile, SchemaFieldPath } from "./human.js";
import type { ModelErrorKind } from "./model.js";
import { modelErrorRetryable } from "./model.js";

/**
 * Errors that end the CLI before a run starts, or before a revert changes anything.
 * No journal is written for them.
 */
export const CLI_ERROR_EXIT_CODES = {
  invalid_arguments: 2,
  invalid_task: 2,
  /** The config file cannot be read, or a value in it is invalid. */
  invalid_config: 2,
  /** A task or config file, or `--goal`, has a key field or a key value. Checked before anything else in those inputs. */
  key_in_file: 2,
  invalid_script: 2,
  secret_env_missing: 2,
  workspace_not_found: 2,
  /**
   * U-3: the workspace's real path is the running CLI's install directory (the package root that
   * holds the entry file), lies inside it or contains it. Checked before the lock; nothing is written.
   */
  workspace_is_install_dir: 2,
  /**
   * Another run (or revert) holds `<workspace>/.codaryn/lock.json`. N-25 (a): the human-readable
   * error adds `lock.remove_hint`: when no Codaryn is running in that workspace, remove the file.
   */
  workspace_locked: 6,
  /**
   * DR-48 (AXM-8), `--run latest` (`report`, `changes`, `revert`): the latest run has no result yet
   * and holds the workspace lock with a live holder, so it is still going. Try again when it ends.
   * Nothing was changed. `run_not_found` stays for a workspace with no run that could be chosen.
   */
  run_in_progress: 6,
  provider_not_configured: 7,
  provider_not_implemented: 7,
  /** `codaryn models` (Y-1): the Models API request failed. The message names the ModelErrorKind. */
  model_list_failed: 8,
  /** `codaryn models --use` (Y-3), `codaryn init` (N-2): the config file could not be written. It was left as it was. */
  config_write_failed: 2,
  /** `codaryn init` (N-2): a file already exists where the config would be written. Nothing was written. */
  config_exists: 2,
  /** `codaryn revert`: the workspace has no journal for that run id. */
  run_not_found: 2,
  /** `codaryn revert`: the run's journal cannot be read or parsed. Nothing was changed. */
  invalid_run_record: 2,
  /**
   * IR-E1: the workspace's state directory `.codaryn`, or its `runs` directory, is a link, a junction
   * or not a plain directory. Every command that takes the workspace lock (run, apply, review, revert,
   * the app's apply check and text save) refuses before anything is written. Nothing was written.
   */
  state_dir_not_plain: 2,
  /**
   * G-A (R-9c C-1), `codaryn revert --run <apply runId>`: the plan run that apply used
   * (`apply_started.planRunId`) has no directory or no plan.json any more. The real paths of the
   * apply's files are known only from that plan (DR-24 f), so nothing was changed. A plan run must
   * be kept while its apply may be reverted. `codaryn plan`, `codaryn apply` (LoadPlanOutcome): the
   * plan run ended as `plan_pending` but its plan.json is gone; nothing was shown or changed.
   */
  plan_run_missing: 2,
  /**
   * G-A, `codaryn plan`, `codaryn apply`: the run has no stored plan (it did not end as
   * `plan_pending`), or the task given to `apply` does not resolve to `plan: "apply"`. Nothing was
   * changed.
   */
  run_not_plan: 2,
  /**
   * G-A, `codaryn apply`: no approval. `--digest` is missing (without a terminal), shorter than
   * MIN_PLAN_DIGEST_PREFIX, or not a prefix of the stored plan's digest, or the terminal answer was
   * no. Nothing was changed.
   */
  plan_not_approved: 2,
  /** G-A, `codaryn apply`: the plan was already applied (applied.json exists). Nothing was changed. */
  plan_already_applied: 2,
  /**
   * DR-28 (R-11 M-1), `codaryn plan`, `codaryn apply` and the app layer: the secrets registered now
   * mask the plan's paths differently from the plan run (planActionShownMatches is false for an
   * action), or the plan was stored without its masked form. Checked right after the plan is
   * loaded: nothing was shown, asked, recorded or moved. Use the same task form, and so the same
   * secrets, as the plan run, or make the plan again.
   */
  plan_secrets_differ: 2,
  /**
   * DR-48 (AXM-3), `codaryn cleanup --confirm` and the app layer: the plan made again under the lock
   * has another digest than the confirmed one (the state directory changed since the preview, or
   * another preview's digest was given). Nothing was removed. Preview again and confirm its digest.
   * It was a CleanupOutput (`mode: "plan_changed"`, exit 3) before DR-48.
   */
  cleanup_plan_changed: 2,
  /**
   * U-1 (R-33 R33-L3), `codaryn apply` and the app layer: the plan run has a records-changed mark
   * (DR-38, RECORDS_CHANGED_FILE_NAME; one that cannot be read counts too), so its plan may differ
   * from what a person saw. Checked right after the plan is loaded, before anything is asked:
   * nothing was asked, recorded or moved, and no apply run was made. Make the plan again with a new
   * `codaryn run` (U-14, UXM-6: `codaryn plan` only shows a plan, it does not make one).
   */
  plan_records_changed: 2,
  /** G-A, `codaryn review`: the run did not end as `needs-input`/`awaiting_review`. Nothing was written. */
  run_not_awaiting_review: 2,
  internal_error: 70,
} as const;
export type CliErrorCode = keyof typeof CLI_ERROR_EXIT_CODES;

/**
 * U-55 (AXM-9): the kinds of CLI error.
 * - input: what was given must change (arguments, a task, config or script file, a path, a run id
 *   that names no plan run, an approval or secrets that do not match).
 * - state: the workspace or its records are not in the state the command needs (locked, a run in
 *   progress, a run or plan missing, already applied, changed, not awaiting review).
 * - environment: the machine or the provider (a key or setting missing, a provider not built in,
 *   the model listing failing, the config file not writable).
 * - internal: Codaryn's own failure.
 */
export const CLI_ERROR_CATEGORIES = ["input", "state", "environment", "internal"] as const;
export type CliErrorCategory = (typeof CLI_ERROR_CATEGORIES)[number];

export const CLI_ERROR_CATEGORY: { readonly [C in CliErrorCode]: CliErrorCategory } = {
  invalid_arguments: "input",
  invalid_task: "input",
  invalid_config: "input",
  key_in_file: "input",
  invalid_script: "input",
  secret_env_missing: "environment",
  workspace_not_found: "input",
  workspace_is_install_dir: "input",
  workspace_locked: "state",
  run_in_progress: "state",
  provider_not_configured: "environment",
  provider_not_implemented: "environment",
  model_list_failed: "environment",
  config_write_failed: "environment",
  config_exists: "state",
  run_not_found: "state",
  invalid_run_record: "state",
  state_dir_not_plain: "state",
  plan_run_missing: "state",
  run_not_plan: "input",
  plan_not_approved: "input",
  plan_already_applied: "state",
  plan_secrets_differ: "input",
  cleanup_plan_changed: "state",
  plan_records_changed: "state",
  run_not_awaiting_review: "state",
  internal_error: "internal",
};

/**
 * U-55: whether the same command may succeed later, unchanged. Only a lock or a run that ends lets
 * it (workspace_locked, run_in_progress; a dead lock is reclaimed). cleanup_plan_changed needs a new
 * preview first, so it is false; internal_error is false so a program does not repeat it blindly.
 * model_list_failed goes by the listing's model error (cliErrorFacts). U-82 (review R-71 L1):
 * config_write_failed has no entry, so no `retryable` (unknown): a name the system refuses or a
 * missing drive and a file another program holds or a full disk give the same code and message.
 */
export const CLI_ERROR_RETRYABLE: { readonly [C in Exclude<CliErrorCode, "model_list_failed" | "config_write_failed">]: boolean } = {
  invalid_arguments: false,
  invalid_task: false,
  invalid_config: false,
  key_in_file: false,
  invalid_script: false,
  secret_env_missing: false,
  workspace_not_found: false,
  workspace_is_install_dir: false,
  workspace_locked: true,
  run_in_progress: true,
  provider_not_configured: false,
  provider_not_implemented: false,
  config_exists: false,
  run_not_found: false,
  invalid_run_record: false,
  state_dir_not_plain: false,
  plan_run_missing: false,
  run_not_plan: false,
  plan_not_approved: false,
  plan_already_applied: false,
  plan_secrets_differ: false,
  cleanup_plan_changed: false,
  plan_records_changed: false,
  run_not_awaiting_review: false,
  internal_error: false,
};

/**
 * U-55: `category` and `retryable` of a CLI error, to spread into its CliErrorOutput. For
 * model_list_failed, `modelError` is the listing's failure (ListModelsOutcome's kind, httpStatus and,
 * U-82, its own `retryable`, which comes first); without it, or when modelErrorRetryable cannot
 * tell, `retryable` is left out. config_write_failed has none either (R-71 L1).
 */
export function cliErrorFacts(
  code: CliErrorCode,
  modelError?: { readonly kind: ModelErrorKind; readonly httpStatus?: number; readonly retryable?: boolean },
): { readonly category: CliErrorCategory; readonly retryable?: boolean } {
  const category = CLI_ERROR_CATEGORY[code];
  const retryable =
    code === "model_list_failed"
      ? modelError === undefined
        ? undefined
        : modelErrorRetryable(modelError.kind, modelError.httpStatus, modelError.retryable)
      : code === "config_write_failed"
        ? undefined
        : CLI_ERROR_RETRYABLE[code];
  return retryable === undefined ? { category } : { category, retryable };
}

/** Printed on stdout as one JSON line when the CLI stops before a run starts. */
export interface CliErrorOutput {
  readonly schemaVersion: 1;
  readonly kind: "error";
  readonly code: CliErrorCode;
  readonly exitCode: number;
  /** Never contains secret values, keys or file contents. */
  readonly message: string;
  /**
   * U-55 (AXM-9, PM Q-3): what kind of problem it is (CLI_ERROR_CATEGORY) and whether the same
   * command may succeed later unchanged (cliErrorFacts). Every error the CLI and the app layer make
   * has them; optional in the type only for outputs made before U-55. `retryable` is absent only
   * when it cannot be told (model_list_failed whose request failed as an api_error without an HTTP
   * status): unknown, never false. The exit code does not change.
   */
  readonly category?: CliErrorCategory;
  readonly retryable?: boolean;
  /**
   * N-15: where in a config, task or script file the problem is, for `invalid_config`,
   * `invalid_task` and `invalid_script` when it can be said safely. Absent otherwise.
   */
  readonly diagnostic?: InputDiagnostic;
  /**
   * R-12 L-2: advice the CLI can give beyond the code, because it knows the cause. The human error
   * adds it as its own line (`error.hint.<hint>`); `message` says the same for JSON readers.
   * Absent otherwise.
   */
  readonly hint?: CliErrorHint | DetailedCliErrorHint;
  /**
   * U-37: the values a DETAILED_CLI_ERROR_HINTS line needs, for the human error only. Under a symbol
   * key, so the JSON line (JSON.stringify) never has it; a spread copy keeps it. Absent, or not
   * matching the hint, the human error leaves that hint's line out.
   */
  readonly [CLI_ERROR_HINT_DETAIL]?: CliErrorHintDetail;
}

/**
 * R-12 L-2: the error hints (CliErrorOutput.hint).
 * - quick_form_needs_task: `plan`, `apply` or `review` in the quick form (`--workspace`) failed on
 *   the config file's run settings (limits included, `invalid_config`); the plan run's task given
 *   with `--task` brings its own settings, and its secrets (DR-28).
 *
 * U-37 (UXM-2, DR-57): the reason of an argument, input or setting error, which `message` gives in
 * English only, so the human error tells it in the chosen language. JSON readers get more values of
 * `hint` and nothing else. One hint per error, the one that names the cause.
 * - invalid_arguments: unknown_command (no command word, or a word that is no command, also after
 *   `help`), workspace_goal_together (the quick form needs both `--workspace` and `--goal`),
 *   apply_needs_run_id (apply takes the plan run's id; `latest` is not accepted), digest_form (a
 *   digest given with `--digest` or cleanup's `--confirm` is MIN_PLAN_DIGEST_PREFIX to 64 lowercase
 *   hex characters), review_needs_verdict (`--accept` or `--reject`), run_id_form (`--run` takes a
 *   run id or `latest`), version_no_json (`--version` takes no other argument).
 * - invalid_task (or invalid_config for the config file): task_file_unreadable (the file given with
 *   `--task` cannot be read: missing, not a file, unreadable), input_too_large (an input file is
 *   larger than the limit), input_inside_workspace (an input file is inside the workspace or its
 *   place cannot be confirmed).
 * - invalid_config: profile_needs_config (`--profile` needs a config file), profile_not_found (the
 *   config file has no profile of that name), task_type_not_found (the task type named by
 *   `workflowRef` or `--workflow` is neither built in nor in the config's `workflows`; invalid_task
 *   when the task file names it).
 * - invalid_config: config_missing (U-115, UXM-9): the quick form or the one-line run found no config
 *   file at all (no --config, no CODARYN_CONFIG, and none at the default location), so its settings
 *   were missing; the person has not made one yet (codaryn init).
 * - U-235 (PM): plan_run_not_available, U-177's hint while the parsers refused plan "run" (before
 *   B-4), is no longer listed. U-195 had stopped giving it; the PM took it out as an exception to
 *   cli-contract 8.3's add-only rule (no output carries it any more).
 * - key_in_file: key_in_goal, key_in_task, key_in_config (where a key value was found);
 *   key_field_in_task or key_field_in_config when its place is a SchemaFieldPath.
 * - run_not_plan: plan_kind_differs (U-228): the run has a plan, of another kind than the task given
 *   to apply carries out (a plan of files to write with a task of plan "apply" or of no plan mode, a
 *   plan of moves with a task of plan "run" or of no plan mode). The human error then says the plan
 *   is of another kind (`error.run_not_plan.other_kind`) and gives this hint as its fix, in place of
 *   run_not_plan's own lines, which speak of a run without a plan.
 * - invalid_task, invalid_config: plan_tool_missing (U-228, U-224): the task type resolves to a plan
 *   mode without its plan tool among the tools (WORKFLOW_PROBLEMS `plan_tool_missing`).
 * - invalid_task, invalid_config (U-210, review R-110 M-1; bundle A): unreadable_paths_required
 *   (analyze-private while the run has no unreadable path, WORKFLOW_PROBLEMS
 *   `unreadable_paths_required`); unreadable_with_commands (a command rule or a `command` verifier
 *   while the run has unreadable paths: `unreadable_with_commands`, and `commands_not_allowed` when
 *   the run has them); min_group_size_range (`policy.minGroupSize` outside MIN_GROUP_SIZE_LIMITS, in a
 *   task file, the config file or a profile).
 * Each has a listed `error.hint.<hint>` without parameters; DETAILED_CLI_ERROR_HINTS are apart.
 */
export const CLI_ERROR_HINTS = [
  "quick_form_needs_task",
  "unknown_command",
  "workspace_goal_together",
  "apply_needs_run_id",
  "digest_form",
  "review_needs_verdict",
  "run_id_form",
  "version_no_json",
  "task_file_unreadable",
  "input_too_large",
  "input_inside_workspace",
  "profile_needs_config",
  "profile_not_found",
  "task_type_not_found",
  "key_in_goal",
  "key_in_task",
  "key_in_config",
  "config_missing",
  "plan_kind_differs",
  "plan_tool_missing",
  "unreadable_paths_required",
  "unreadable_with_commands",
  "min_group_size_range",
] as const;
export type CliErrorHint = (typeof CLI_ERROR_HINTS)[number];
/**
 * U-37: hints whose line takes a value from CliErrorOutput's CLI_ERROR_HINT_DETAIL. Kept apart from
 * CLI_ERROR_HINTS, so a renderer that knows only those leaves these lines out rather than fail.
 * - unknown_option (invalid_arguments, `position`): an option the command does not take, or one
 *   given twice. Told by its position, never by its name (DR-57).
 * - key_field_in_task, key_field_in_config (key_in_file, `field`): where the key field or value is.
 * - provider_settings_missing (provider_not_configured, `missing`): the line, then one item line per
 *   setting not set (`error.missing.<setting>`), in PROVIDER_SETTINGS order.
 */
export const DETAILED_CLI_ERROR_HINTS = ["unknown_option", "key_field_in_task", "key_field_in_config", "provider_settings_missing"] as const;
export type DetailedCliErrorHint = (typeof DETAILED_CLI_ERROR_HINTS)[number];
/** U-37: every value CliErrorOutput.hint may have. */
export const ALL_CLI_ERROR_HINTS = [...CLI_ERROR_HINTS, ...DETAILED_CLI_ERROR_HINTS] as const;

/** U-37: the key of CliErrorOutput's hint detail. A symbol, so no JSON line carries it. */
export const CLI_ERROR_HINT_DETAIL: unique symbol = Symbol("codaryn.cliErrorHintDetail");

/** U-37: the settings provider_not_configured can miss, in the order their items are told. */
export const PROVIDER_SETTINGS = ["key", "model", "output_limit"] as const;
export type ProviderSetting = (typeof PROVIDER_SETTINGS)[number];

/**
 * U-37: one setting not set, as the run's settings resolve it (src/app/input/settings.ts):
 * - key: the provider's key variable (`error.missing.key`).
 * - model: no model left, or only a placeholder (`error.missing.model`,
 *   `error.missing.model_placeholder`): the task's `model.model`, the provider's model variable,
 *   the config's field for it (`model`, or `providers.<provider>.model`).
 * - output_limit: `maxOutputTokens` (`error.missing.output_limit`): the task's
 *   `model.maxOutputTokens` or the config's field for it.
 * Names and field positions only, never a value.
 */
export type ProviderSettingMissing =
  | { readonly setting: "key"; readonly keyEnv: ApiKeyEnv }
  | { readonly setting: "model"; readonly modelEnv: ApiModelEnv; readonly field: SchemaFieldPath; readonly placeholder: boolean }
  | { readonly setting: "output_limit"; readonly field: SchemaFieldPath };

/**
 * U-37: what a detailed hint's line needs. Numbers, field positions and fixed names only; no text
 * typed or read from a file reaches it.
 * - position (unknown_option): the argument's place after the command word, counted from 1; for a
 *   repeated option, the place of its second use.
 * - field (key_field_in_task, key_field_in_config): a SchemaFieldPath (`toSchemaFieldPath`); when
 *   the place is not one, the plain key_in_task or key_in_config is the hint.
 * - missing (provider_settings_missing): at least one item, in PROVIDER_SETTINGS order, each once.
 */
export interface CliErrorHintDetail {
  readonly position?: number;
  readonly field?: SchemaFieldPath;
  readonly missing?: readonly ProviderSettingMissing[];
}

/**
 * N-15 (review M1): a structured input diagnostic. It holds a fixed code, a schema field position
 * and numbers only: never the JSON parser's message, a value, or the name of an unknown key.
 */
export const INPUT_DIAGNOSTIC_CODES = ["json_syntax", "unknown_field", "invalid_value", "missing_field", "too_deep"] as const;
export type InputDiagnosticCode = (typeof INPUT_DIAGNOSTIC_CODES)[number];

export interface InputDiagnostic {
  readonly code: InputDiagnosticCode;
  readonly file: InputDiagnosticFile;
  /**
   * The field: for `unknown_field` the object that holds the unknown key (`config`, `limits`,
   * `policy.commands[0]`), never the key itself; for `invalid_value` and `missing_field` the field.
   * Null for `json_syntax` and `too_deep`, and whenever no safe position exists.
   */
  readonly field: SchemaFieldPath | null;
  /** `json_syntax` only: 1-based line and column (in Unicode code points, a BOM not counted). Else null. */
  readonly line: number | null;
  readonly column: number | null;
  /** `unknown_field` only: the closest allowed field name at that position, when one is close. */
  readonly suggestion?: SchemaFieldPath | null;
}
