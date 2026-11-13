/**
 * task.json validation, and the quick form task built from the config file.
 * Error messages name fields only, never values from the file.
 * Security rules come from `./security`: variable names (S-3), local paths (S-5),
 * bounded limits (S-7) and timer values (S-7).
 */

import path from "node:path";
import {
  API_PROVIDERS,
  API_PROVIDER_NAMES,
  DENY_ALL_POLICY,
  MIN_GROUP_SIZE_LIMITS,
  MODEL_PROVIDER_NAMES,
  QUICK_TASK_ID,
  QUICK_TASK_WORKFLOW,
  TASK_ID_PATTERN_SOURCE,
  TASK_SCHEMA_VERSION,
} from "../contracts/index.js";
import type {
  ApiModelConfig,
  ApiProviderName,
  CodarynConfig,
  CommandRule,
  ConfirmableCommandRule,
  ConfirmablePolicyConfig,
  FileRule,
  MarkdownFileRule,
  MarkdownHeading,
  MarkdownRuleType,
  Limits,
  ModelConfig,
  ModelProviderName,
  PolicyConfig,
  ProtectedPathProblemReason,
  ResolvedTaskSpec,
  VerifierConfig,
} from "../contracts/index.js";
import { toSchemaFieldPath } from "../contracts/index.js";
import {
  AGGREGATE_OPS,
  ALL_TOOL_NAMES,
  COMPLETION_MODES,
  CONFIGURABLE_VERIFIER_KINDS,
  MARKDOWN_RULE_TYPES,
  MAX_MARKDOWN_HEADING_CHARS,
  MAX_MARKDOWN_RULE_HEADINGS,
  MAX_REVIEW_CHECKLIST_ITEMS,
  MAX_REVIEW_CHECKLIST_ITEM_CHARS,
  PLAN_ACTION_KINDS,
  PLAN_MODES,
  TABLE_FORMATS,
  WORKFLOW_ID_PATTERN_SOURCE,
} from "../contracts/index.js";
import type {
  AggregateOp,
  AnyToolName,
  CliErrorHint,
  CompletionMode,
  DataRule,
  HumanReviewConfig,
  PlanActionKind,
  PlanMode,
  RowCountRule,
  TableFormat,
  TableRef,
} from "../contracts/index.js";
import { checkProtectedPaths } from "../policy/index.js";
import { checkLocalPathSyntax, checkTimerMs, resolveBoundedLimits, validateSecretEnvNames } from "../app/input/security/index.js";

/** `invalid_config` when the config file caused the failure (S-7 bounds, quick form). */
export type TaskErrorCode = "invalid_task" | "invalid_config";

export type ParseTaskOutcome =
  | { readonly ok: true; readonly task: ResolvedTaskSpec }
  | {
      readonly ok: false;
      readonly code: TaskErrorCode;
      readonly message: string;
      readonly position?: InputErrorPosition;
      /** U-177: the error's hint when the parser knows the cause (CliErrorOutput.hint). */
      readonly hint?: CliErrorHint;
    };

/**
 * N-15: where a validation failure is, as schema field text. The CLI turns it into an
 * InputDiagnostic only through `toSchemaFieldPath`, so a position that is not a plain schema path
 * (a profile or key name, for example) is dropped rather than printed.
 */
export interface InputErrorPosition {
  readonly code: "unknown_field" | "invalid_value" | "missing_field";
  readonly field: string;
  readonly suggestion?: string | null;
}

export type Rec = Record<string, unknown>;

/**
 * A validation failure. Its message names a field, never a value. `code` overrides the default.
 * U-177: `hint` is the error's hint when the parser knows the cause; the outcome carries it.
 */
export class InputError extends Error {
  constructor(
    message: string,
    readonly code?: TaskErrorCode,
    readonly position?: InputErrorPosition,
    readonly hint?: CliErrorHint,
  ) {
    super(message);
  }
}

/** N-15: a message that starts with a schema field path names that field. */
function positionFromMessage(message: string): InputErrorPosition | undefined {
  const head = message.split(" ", 1)[0] ?? "";
  return toSchemaFieldPath(head) === null ? undefined : { code: "invalid_value", field: head };
}

export function fail(message: string, code?: TaskErrorCode, position?: InputErrorPosition): never {
  throw new InputError(message, code, position ?? positionFromMessage(message));
}

const ROOT_FIELDS = new Set(["config", "task", "script"]);

/** Optimal string alignment distance, case folded. Small strings only (field names). */
function nameDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const rows: number[][] = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      const row = rows[i] as number[];
      const up = rows[i - 1] as number[];
      const cost = x.charAt(i - 1) === y.charAt(j - 1) ? 0 : 1;
      let best = Math.min((up[j] as number) + 1, (row[j - 1] as number) + 1, (up[j - 1] as number) + cost);
      if (i > 1 && j > 1 && x.charAt(i - 1) === y.charAt(j - 2) && x.charAt(i - 2) === y.charAt(j - 1)) {
        best = Math.min(best, ((rows[i - 2] as number[])[j - 2] as number) + 1);
      }
      row[j] = best;
    }
  }
  return (rows[x.length] as number[])[y.length] as number;
}

/**
 * N-6 (A11): the allowed name closest to an unknown key, or null. Only an allowed name is ever
 * returned; the unknown key is compared, never shown. Keys longer than 64 characters are not compared.
 */
export function closestFieldName(unknown: string, allowed: readonly string[]): string | null {
  if (unknown.length === 0 || unknown.length > 64) return null;
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const name of allowed) {
    const distance = nameDistance(unknown, name);
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best !== null && bestDistance <= Math.min(2, Math.floor(best.length / 2)) ? best : null;
}

export function record(value: unknown, field: string, keys: readonly string[]): Rec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${field} must be an object`, undefined, { code: value === undefined ? "missing_field" : "invalid_value", field });
  }
  const rec = value as Rec;
  const extra = Object.keys(rec).find((key) => !keys.includes(key));
  if (extra !== undefined) {
    // N-6, N-15: the unknown key itself is never named; the allowed names and the closest one are.
    const near = closestFieldName(extra, keys);
    const hint = near === null ? "" : `; did you mean ${near}?`;
    fail(`${field} has an unknown field; allowed fields: ${keys.join(", ")}${hint}`, undefined, {
      code: "unknown_field",
      field,
      suggestion: near === null ? null : ROOT_FIELDS.has(field) ? near : `${field}.${near}`,
    });
  }
  return rec;
}

export function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) fail(`${field} must be a non-empty string`);
  return value;
}

export function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    fail(`${field} must be an array of strings`);
  }
  return value as string[];
}

export function positive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail(`${field} must be a positive integer`);
  }
  return value;
}

export function optionalPositive(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : positive(value, field);
}

/** T-14: an output token cap per request, at most MAX_OUTPUT_TOKENS_LIMIT. */
/**
 * An output token cap within the provider's bounds (API_PROVIDERS: minOutputTokens and
 * maxOutputTokensLimit). The default provider is anthropic, whose rule and message are the ones
 * before SP-4.
 */
export function optionalOutputTokens(value: unknown, field: string, provider: ApiProviderName = "anthropic"): number | undefined {
  if (value === undefined) return undefined;
  const { minOutputTokens, maxOutputTokensLimit } = API_PROVIDERS[provider];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minOutputTokens || value > maxOutputTokensLimit) {
    fail(
      minOutputTokens <= 1
        ? `${field} must be a positive integer of at most ${maxOutputTokensLimit}`
        : `${field} must be an integer from ${minOutputTokens} to ${maxOutputTokensLimit} for the ${provider} provider`,
    );
  }
  return value;
}

/** `"a"`, `"a" or "b"`, `"a", "b" or "c"`: a closed list of names in a message. */
export function quotedChoices(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  return quoted.length <= 1 ? quoted.join("") : `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
}

/** SP-1: whether a value names an API provider (API_PROVIDER_NAMES). */
export function isApiProviderName(value: unknown): value is ApiProviderName {
  return typeof value === "string" && (API_PROVIDER_NAMES as readonly string[]).includes(value);
}

export function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field);
}

/**
 * S-5: a path must not reach another machine or a device, as written or once resolved.
 * Returns the fixed reason, or null when the path is a plain local path.
 */
export function localPathProblem(raw: string, baseDir: string): string | null {
  for (const candidate of [raw, path.resolve(baseDir, raw)]) {
    const syntax = checkLocalPathSyntax(candidate);
    if (!syntax.ok) return syntax.reason === "invalid" ? "is not a valid local path" : "is a network or device path";
  }
  return null;
}

/**
 * X-1 (S-5): an executable or a working directory as written in a command rule or a verifier.
 * It must not name a network or device path (UNC, `\\.\`, `\\?\`, a DOS device name, `/dev/`),
 * so neither a run nor `doctor` reaches another machine through it. The value is kept as written.
 */
function localPathText(value: unknown, field: string): string {
  const raw = text(value, field);
  const syntax = checkLocalPathSyntax(raw);
  if (!syntax.ok) fail(`${field} ${syntax.reason === "invalid" ? "is not a valid local path" : "is a network or device path"}`);
  return raw;
}

/** Resolves a path from a file against `baseDir` after the S-5 check. */
function resolveLocal(baseDir: string, target: string, field: string): string {
  const problem = localPathProblem(target, baseDir);
  if (problem !== null) fail(`${field} ${problem}`);
  return path.resolve(baseDir, target);
}

/** S-7: a time value Node timers can honour. */
function timerMs(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  const checked = checkTimerMs(value, field);
  if (!checked.ok) fail(checked.message);
  return value as number;
}

function parseModel(value: unknown, baseDir: string): ModelConfig {
  const rec = record(value, "model", ["provider", "scriptPath", "model", "maxOutputTokens"]);
  if (rec["provider"] === "scripted") {
    if (rec["model"] !== undefined || rec["maxOutputTokens"] !== undefined) {
      fail(`model.model and model.maxOutputTokens are only for an API provider (${API_PROVIDER_NAMES.join(", ")})`);
    }
    return { provider: "scripted", scriptPath: resolveLocal(baseDir, text(rec["scriptPath"], "model.scriptPath"), "model.scriptPath") };
  }
  // SP-4: any API provider (API_PROVIDER_NAMES), its output cap within its own bounds.
  const provider = rec["provider"];
  if (isApiProviderName(provider)) {
    if (rec["scriptPath"] !== undefined) fail("model.scriptPath is only for the scripted provider");
    // N-3: a placeholder (blank or `<...>`) is accepted here and counts as not set.
    const model = rec["model"] === undefined ? undefined : typeof rec["model"] === "string" ? rec["model"] : fail("model.model must be a string");
    const maxOutputTokens = optionalOutputTokens(rec["maxOutputTokens"], "model.maxOutputTokens", provider);
    const config = {
      provider,
      ...(model === undefined ? {} : { model }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    } as ApiModelConfig;
    return config;
  }
  return fail(`model.provider must be ${quotedChoices(MODEL_PROVIDER_NAMES)}`);
}

const PROTECTED_PATH_MESSAGES: { readonly [R in ProtectedPathProblemReason]: string } = {
  not_a_list: "must be an array of relative paths",
  not_a_string: "must be a string",
  empty: "must be a non-empty path",
  absolute: "must be relative to the workspace root",
  parent_segment: "must not contain a '..' segment",
  invalid_name: "is not a name that can address an ordinary file",
};

/**
 * `policy.protectedPaths` (T-13): the policy module's `checkProtectedPaths` decides, so the CLI
 * rejects exactly what the gate would treat as unusable. The message names the position only.
 * Entries are kept as written; the gate compares them with resolved paths (R-5).
 * U-182 (DR-69 B-4): `policy.writablePaths` has the same format (PolicyConfig.writablePaths), so
 * the same check names its position. An empty list is kept: it allows no file tool write.
 * U-210 (bundle A, R-1): so has `policy.unreadablePaths` (PolicyConfig.unreadablePaths).
 */
function parsePathList(value: unknown, field: "policy.protectedPaths" | "policy.writablePaths" | "policy.unreadablePaths"): string[] {
  const [problem] = checkProtectedPaths(value);
  if (problem !== undefined) {
    const at = problem.index === null ? field : `${field}[${problem.index}]`;
    fail(`${at} ${PROTECTED_PATH_MESSAGES[problem.reason]}`);
  }
  return [...(value as readonly string[])];
}

/**
 * U-109 (review R-79 L-1, design Q-2): where a policy is written. Only the user's settings, the
 * config file's `policy` and each profile's, may mark a command rule `confirm: true`, ask before
 * running (ConfirmableCommandRule). A task file and a task type's definition may not (an unknown
 * field, as before), so no file that comes with a task can make a question. `confirm` is `true`
 * or absent: `false` would only mean what its absence means and is refused rather than read.
 */
export type PolicySource = "task" | "definition" | "settings";

const COMMAND_RULE_FIELDS = ["executable", "argsPrefix", "allowExtraArgs"] as const;

export function parsePolicy(value: unknown, source: "settings"): ConfirmablePolicyConfig;
export function parsePolicy(value: unknown, source: "task" | "definition"): PolicyConfig;
export function parsePolicy(value: unknown, source: PolicySource): ConfirmablePolicyConfig {
  const rec = record(value, "policy", ["commands", "network", "destructive", "restorePathTokens", "protectedPaths", "planActions", "writablePaths", "unreadablePaths", "minGroupSize"]);
  if (!Array.isArray(rec["commands"])) fail("policy.commands must be an array");
  const ruleFields: readonly string[] = source === "settings" ? [...COMMAND_RULE_FIELDS, "confirm"] : COMMAND_RULE_FIELDS;
  const commands = (rec["commands"] as unknown[]).map((item, index): ConfirmableCommandRule => {
    const field = `policy.commands[${index}]`;
    const rule = record(item, field, ruleFields);
    if (typeof rule["allowExtraArgs"] !== "boolean") fail(`${field}.allowExtraArgs must be a boolean`);
    const confirm = rule["confirm"];
    // The diagnostic names the rule: `confirm` is not among the contract's SCHEMA_FIELD_NAMES yet.
    if (confirm !== undefined && confirm !== true) fail(`${field}.confirm must be true when it is given`, undefined, { code: "invalid_value", field });
    return {
      executable: localPathText(rule["executable"], `${field}.executable`),
      argsPrefix: strings(rule["argsPrefix"], `${field}.argsPrefix`),
      allowExtraArgs: rule["allowExtraArgs"],
      ...(confirm === true ? { confirm: true as const } : {}),
    };
  });
  if (rec["network"] !== "deny") fail('policy.network must be "deny"');
  if (rec["destructive"] !== "deny") fail('policy.destructive must be "deny"');
  if (typeof rec["restorePathTokens"] !== "boolean") fail("policy.restorePathTokens must be a boolean");
  const protectedPaths = rec["protectedPaths"] === undefined ? undefined : parsePathList(rec["protectedPaths"], "policy.protectedPaths");
  // U-182 (DR-69 B-4): each source's list is kept as given; the run builds writablePathSets from them.
  const writablePaths = rec["writablePaths"] === undefined ? undefined : parsePathList(rec["writablePaths"], "policy.writablePaths");
  const planActions = rec["planActions"] === undefined ? undefined : parsePlanActions(rec["planActions"]);
  // U-210 (bundle A, A-6; R-2, Q-4): each source's list and k are kept as given; the run unites the
  // lists and takes the largest k (ResolvedTaskSpec.unreadablePaths, .minGroupSize).
  const unreadablePaths = rec["unreadablePaths"] === undefined ? undefined : parsePathList(rec["unreadablePaths"], "policy.unreadablePaths");
  const minGroupSize = rec["minGroupSize"] === undefined ? undefined : parseMinGroupSize(rec["minGroupSize"]);
  return {
    commands,
    network: "deny",
    destructive: "deny",
    restorePathTokens: rec["restorePathTokens"],
    ...(protectedPaths === undefined ? {} : { protectedPaths }),
    ...(planActions === undefined ? {} : { planActions }),
    ...(writablePaths === undefined ? {} : { writablePaths }),
    ...(unreadablePaths === undefined ? {} : { unreadablePaths }),
    ...(minGroupSize === undefined ? {} : { minGroupSize }),
  };
}

/**
 * U-210 (bundle A, Q-4, DR-70): `policy.minGroupSize`, a whole number within MIN_GROUP_SIZE_LIMITS in
 * every source, the config file's included: no source lowers k below 5, each can only raise it.
 */
function parseMinGroupSize(value: unknown): number {
  const { min, max } = MIN_GROUP_SIZE_LIMITS;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    // U-210 (R-110 M-1): the hint says why in the chosen language; the message is as before.
    const message = `policy.minGroupSize must be a whole number from ${min} to ${max}`;
    throw new InputError(message, undefined, positionFromMessage(message), "min_group_size_range");
  }
  return value;
}

/** G-A: `policy.planActions`, the plan action kinds an applied plan may carry. Unique entries. */
function parsePlanActions(value: unknown): PlanActionKind[] {
  if (!Array.isArray(value)) fail("policy.planActions must be an array");
  const kinds = value as unknown[];
  kinds.forEach((kind, index) => {
    if (!(PLAN_ACTION_KINDS as readonly unknown[]).includes(kind)) fail(`policy.planActions[${index}] must be one of ${PLAN_ACTION_KINDS.join(", ")}`);
    if (kinds.indexOf(kind) !== index) fail(`policy.planActions[${index}] is listed twice`);
  });
  return kinds as PlanActionKind[];
}

/** G-A: the workflow fields a task file and a definition share (`tools`, `plan`, `completion`, `humanReview`). */
export function parseToolList(value: unknown, field: string): AnyToolName[] {
  if (!Array.isArray(value) || value.length === 0) fail(`${field} must be a non-empty array of tool names`);
  (value as unknown[]).forEach((tool, index) => {
    if (!(ALL_TOOL_NAMES as readonly unknown[]).includes(tool)) fail(`${field}[${index}] must be one of ${ALL_TOOL_NAMES.join(", ")}`);
  });
  return value as AnyToolName[];
}

/**
 * A task file's or a config definition's `plan` (invalid_task or invalid_config by the caller).
 * U-195 (DR-69 B-4): every PLAN_MODES value, "run" again: codaryn apply carries out a run plan now.
 * U-177's refusal is no longer given, and U-235 took its hint plan_run_not_available out of the
 * contract's list (cli-contract 8.3's one exception).
 */
export function parsePlanMode(value: unknown, field: string): PlanMode {
  if (!(PLAN_MODES as readonly unknown[]).includes(value)) fail(`${field} must be one of ${PLAN_MODES.join(", ")}`);
  return value as PlanMode;
}

export function parseCompletion(value: unknown, field: string): CompletionMode {
  if (!(COMPLETION_MODES as readonly unknown[]).includes(value)) fail(`${field} must be one of ${COMPLETION_MODES.join(", ")}`);
  return value as CompletionMode;
}

export function parseHumanReview(value: unknown, field: string): HumanReviewConfig {
  const rec = record(value, field, ["checklist"]);
  const list = rec["checklist"];
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_REVIEW_CHECKLIST_ITEMS) {
    fail(`${field}.checklist must be an array of 1 to ${MAX_REVIEW_CHECKLIST_ITEMS} lines`);
  }
  (list as unknown[]).forEach((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0 || [...item].length > MAX_REVIEW_CHECKLIST_ITEM_CHARS) {
      fail(`${field}.checklist[${index}] must be a non-blank line of at most ${MAX_REVIEW_CHECKLIST_ITEM_CHARS} characters`);
    }
  });
  return { checklist: [...(list as string[])] };
}

/** A workflow definition id (WORKFLOW_ID_PATTERN_SOURCE). */
export function parseWorkflowRef(value: unknown, field: string): string {
  if (typeof value !== "string" || !new RegExp(WORKFLOW_ID_PATTERN_SOURCE).test(value)) {
    fail(`${field} must be a workflow id: 1-64 letters, digits, '.', '_' and '-'`);
  }
  return value;
}

const LIMIT_FIELDS = [
  "maxModelTurns",
  "maxToolCalls",
  "maxTotalTokens",
  "maxDurationMs",
  "maxRepairAttempts",
  "maxSameFailures",
] as const;

type MutableLimits = { -readonly [K in keyof Limits]?: Limits[K] };

function nonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${field} must be an integer of 0 or more`);
  }
  return value;
}

/**
 * Validates the shape and the type of the limit fields that are present. Absent fields stay absent.
 * Upper bounds (config over task, absolute caps, no null tokens for anthropic) are S-7's
 * `resolveBoundedLimits`, applied once the provider is known.
 */
export function parsePartialLimits(value: unknown): Partial<Limits> {
  const rec = record(value, "limits", LIMIT_FIELDS);
  const limits: MutableLimits = {};
  for (const field of LIMIT_FIELDS) {
    if (!Object.hasOwn(rec, field)) continue;
    const item = rec[field];
    const name = `limits.${field}`;
    if (field === "maxTotalTokens") {
      limits.maxTotalTokens = item === null ? null : positive(item, name);
    } else if (field === "maxRepairAttempts") {
      limits.maxRepairAttempts = nonNegative(item, name);
    } else {
      // maxSameFailures, like the budget limits, is at least 1.
      limits[field] = positive(item, name);
    }
  }
  return limits;
}

/** S-7: the run's limits, with the config file's values as upper bounds. */
function boundedLimits(
  form: "task" | "quick",
  provider: ModelProviderName,
  own: Partial<Limits> | undefined,
  config: Partial<Limits> | undefined,
): ResolvedTaskSpec["limits"] {
  const outcome = resolveBoundedLimits({ form, provider, task: own, config });
  return outcome.ok ? outcome.limits : fail(outcome.message, outcome.code);
}

/** Parses a verifier list and checks that ids are unique. */
export function parseVerifiers(value: unknown): VerifierConfig[] {
  if (!Array.isArray(value)) fail("verifiers must be an array");
  const verifiers = (value as unknown[]).map(parseVerifier);
  const ids = verifiers.map((verifier) => verifier.id);
  if (new Set(ids).size !== ids.length) fail("verifier ids must be unique");
  return verifiers;
}

/** S-3: a list of environment variable names. The message gives a position, never an entry. */
export function parseSecretEnv(value: unknown, field: string): string[] {
  const outcome = validateSecretEnvNames(value, field);
  return outcome.ok ? [...outcome.names] : fail(outcome.message);
}

const RULE_TYPES = ["exists", "absent", "contains", "not_contains", ...MARKDOWN_RULE_TYPES];

function parseRule(value: unknown, field: string): FileRule {
  // U-116: a Markdown rule has fields of its own, so it is told apart before the fields are checked.
  const given = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec)["type"] : undefined;
  if (given === "markdown_headings" || given === "markdown_links") return parseMarkdownRule(value, field, given);
  const rec = record(value, field, ["type", "path", "text"]);
  const type = rec["type"];
  const rulePath = text(rec["path"], `${field}.path`);
  if (type === "exists" || type === "absent") {
    if (rec["text"] !== undefined) fail(`${field}.text is not used by this rule type`);
    return { type, path: rulePath };
  }
  if (type === "contains" || type === "not_contains") {
    return { type, path: rulePath, text: text(rec["text"], `${field}.text`) };
  }
  return fail(`${field}.type must be one of ${RULE_TYPES.join(", ")}`);
}

/**
 * U-116 (P1 bundle C): a Markdown rule of file_rules in the contract's shape and limits
 * (MarkdownFileRule). A heading's text is kept trimmed, as M-2 compares it; its limit counts code
 * points after trimming. The verifier reads the file; the parser only checks the shape. The
 * diagnostic names the rule: `headings`, `level` and `order` are not among the contract's
 * SCHEMA_FIELD_NAMES yet; the message names the place.
 */
function parseMarkdownRule(value: unknown, field: string, type: MarkdownRuleType): MarkdownFileRule {
  if (type === "markdown_links") {
    const rec = record(value, field, ["type", "path"]);
    return { type, path: text(rec["path"], `${field}.path`) };
  }
  const rec = record(value, field, ["type", "path", "headings", "order"]);
  const rulePath = text(rec["path"], `${field}.path`);
  const list = rec["headings"];
  const atRule = (code: "invalid_value" | "missing_field" = "invalid_value") => ({ code, field });
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MARKDOWN_RULE_HEADINGS) {
    fail(`${field}.headings must be an array of 1 to ${MAX_MARKDOWN_RULE_HEADINGS} headings`, undefined, atRule(list === undefined ? "missing_field" : "invalid_value"));
  }
  const headings = (list as unknown[]).map((item, index): MarkdownHeading => {
    const at = `${field}.headings[${index}]`;
    const heading = record(item, at, ["text", "level"]);
    const written = heading["text"];
    const trimmed = typeof written === "string" ? written.trim() : "";
    const points = Array.from(trimmed).length;
    if (typeof written !== "string" || points === 0 || points > MAX_MARKDOWN_HEADING_CHARS) {
      fail(`${at}.text must be a string of 1 to ${MAX_MARKDOWN_HEADING_CHARS} characters after trimming`, undefined, atRule());
    }
    const level = heading["level"];
    if (level !== undefined && !(typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 6)) fail(`${at}.level must be an integer from 1 to 6`, undefined, atRule());
    return { text: trimmed, ...(level === undefined ? {} : { level: level as number }) };
  });
  const order = rec["order"];
  if (order !== undefined && order !== "any" && order !== "in_order") fail(`${field}.order must be "any" or "in_order"`, undefined, atRule());
  return { type, path: rulePath, headings, ...(order === undefined ? {} : { order: order as "any" | "in_order" }) };
}

function parseTableRef(value: unknown, field: string): TableRef {
  const rec = record(value, field, ["path", "format"]);
  const format = rec["format"];
  if (!(TABLE_FORMATS as readonly unknown[]).includes(format)) fail(`${field}.format must be one of ${TABLE_FORMATS.join(", ")}`);
  return { path: text(rec["path"], `${field}.path`), format: format as TableFormat };
}

function count(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(`${field} must be an integer of 0 or more`);
  return value;
}

function parseRowCount(value: unknown, field: string): RowCountRule {
  const rec = record(value, field, ["equals", "min", "max", "sameAs"]);
  const given = ["equals", "min", "max", "sameAs"].filter((key) => rec[key] !== undefined);
  if (rec["equals"] !== undefined) {
    if (given.length !== 1) fail(`${field} takes equals alone`);
    return { equals: count(rec["equals"], `${field}.equals`) };
  }
  if (rec["sameAs"] !== undefined) {
    if (given.length !== 1) fail(`${field} takes sameAs alone`);
    return { sameAs: parseTableRef(rec["sameAs"], `${field}.sameAs`) };
  }
  if (given.length === 0) fail(`${field} needs equals, min, max or sameAs`);
  const min = rec["min"] === undefined ? undefined : count(rec["min"], `${field}.min`);
  const max = rec["max"] === undefined ? undefined : count(rec["max"], `${field}.max`);
  if (min !== undefined && max !== undefined && min > max) fail(`${field}.min must not exceed ${field}.max`);
  return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
}

function tolerance(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${field} must be a number of 0 or more`);
  return value;
}

/** G-A (VF-04): one data rule. Values are checked for shape only; the verifier reads the tables. */
function parseDataRule(value: unknown, field: string): DataRule {
  const type = (value as Rec | null)?.["type"];
  if (type === "table_shape") {
    const rec = record(value, field, ["type", "table", "columns", "columnsMatch", "rows"]);
    const match = rec["columnsMatch"];
    if (match !== undefined && match !== "exact" && match !== "includes") fail(`${field}.columnsMatch must be "exact" or "includes"`);
    if (rec["columns"] === undefined && rec["rows"] === undefined) fail(`${field} needs columns or rows`);
    return {
      type,
      table: parseTableRef(rec["table"], `${field}.table`),
      ...(rec["columns"] === undefined ? {} : { columns: strings(rec["columns"], `${field}.columns`) }),
      ...(match === undefined ? {} : { columnsMatch: match as "exact" | "includes" }),
      ...(rec["rows"] === undefined ? {} : { rows: parseRowCount(rec["rows"], `${field}.rows`) }),
    };
  }
  if (type === "aggregate_match") {
    const rec = record(value, field, ["type", "source", "column", "op", "groupBy", "target", "targetColumn", "targetKeyColumn", "tolerance"]);
    const op = rec["op"];
    if (!(AGGREGATE_OPS as readonly unknown[]).includes(op)) fail(`${field}.op must be one of ${AGGREGATE_OPS.join(", ")}`);
    const groupBy = rec["groupBy"] === undefined ? undefined : text(rec["groupBy"], `${field}.groupBy`);
    const keyColumn = rec["targetKeyColumn"] === undefined ? undefined : text(rec["targetKeyColumn"], `${field}.targetKeyColumn`);
    if ((groupBy === undefined) !== (keyColumn === undefined)) fail(`${field}.targetKeyColumn goes with groupBy, and only with it`);
    let limits: { absolute?: number; relative?: number } | undefined;
    if (rec["tolerance"] !== undefined) {
      const tol = record(rec["tolerance"], `${field}.tolerance`, ["absolute", "relative"]);
      limits = {
        ...(tol["absolute"] === undefined ? {} : { absolute: tolerance(tol["absolute"], `${field}.tolerance.absolute`) }),
        ...(tol["relative"] === undefined ? {} : { relative: tolerance(tol["relative"], `${field}.tolerance.relative`) }),
      };
    }
    return {
      type,
      source: parseTableRef(rec["source"], `${field}.source`),
      column: text(rec["column"], `${field}.column`),
      op: op as AggregateOp,
      ...(groupBy === undefined ? {} : { groupBy }),
      target: parseTableRef(rec["target"], `${field}.target`),
      targetColumn: text(rec["targetColumn"], `${field}.targetColumn`),
      ...(keyColumn === undefined ? {} : { targetKeyColumn: keyColumn }),
      ...(limits === undefined ? {} : { tolerance: limits }),
    };
  }
  return fail(`${field}.type must be "table_shape" or "aggregate_match"`);
}

function parseVerifier(value: unknown, index: number): VerifierConfig {
  const field = `verifiers[${index}]`;
  const kind = (value as Rec | null)?.["kind"];
  if (kind === "command") {
    const rec = record(value, field, ["id", "kind", "executable", "args", "cwd", "timeoutMs", "expectExitCode"]);
    const expect = rec["expectExitCode"];
    if (expect !== undefined && (typeof expect !== "number" || !Number.isInteger(expect))) {
      fail(`${field}.expectExitCode must be an integer`);
    }
    const cwd = rec["cwd"] === undefined ? undefined : localPathText(rec["cwd"], `${field}.cwd`);
    const timeoutMs = timerMs(rec["timeoutMs"], `${field}.timeoutMs`);
    return {
      id: text(rec["id"], `${field}.id`),
      kind: "command",
      executable: localPathText(rec["executable"], `${field}.executable`),
      args: strings(rec["args"], `${field}.args`),
      ...(cwd === undefined ? {} : { cwd }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(expect === undefined ? {} : { expectExitCode: expect as number }),
    };
  }
  if (kind === "file_rules") {
    const rec = record(value, field, ["id", "kind", "rules"]);
    const rules = rec["rules"];
    if (!Array.isArray(rules) || rules.length === 0) fail(`${field}.rules must be a non-empty array`);
    return {
      id: text(rec["id"], `${field}.id`),
      kind: "file_rules",
      rules: rules.map((rule, ruleIndex) => parseRule(rule, `${field}.rules[${ruleIndex}]`)),
    };
  }
  if (kind === "data_checks") {
    // G-A (VF-04): literal table checks for data analysis.
    const rec = record(value, field, ["id", "kind", "rules"]);
    const rules = rec["rules"];
    if (!Array.isArray(rules) || rules.length === 0) fail(`${field}.rules must be a non-empty array`);
    return {
      id: text(rec["id"], `${field}.id`),
      kind: "data_checks",
      rules: (rules as unknown[]).map((rule, ruleIndex) => parseDataRule(rule, `${field}.rules[${ruleIndex}]`)),
    };
  }
  return fail(`${field}.kind must be one of ${CONFIGURABLE_VERIFIER_KINDS.join(", ")}`);
}

/** Values from the config file that bound or complete a task file. */
export interface TaskDefaults {
  /** Upper bounds, and values for the fields the task leaves out (S-7). */
  readonly limits?: Partial<Limits> | undefined;
  /**
   * G-A, review R-11 L-1: a workflow definition's limits. Values for the fields the task leaves
   * out, taken before the config file's; never a bound (the bound stays `limits`, S-7). A default
   * above the config file's bound is lowered to it; a null default under a numeric bound is skipped.
   */
  readonly workflowLimits?: Partial<Limits> | undefined;
}

/** R-11 L-1: the task's own limits with the workflow definition's defaults under them. */
function withWorkflowDefaults(
  own: Partial<Limits> | undefined,
  workflow: Partial<Limits> | undefined,
  bound: Partial<Limits> | undefined,
): Partial<Limits> | undefined {
  if (workflow === undefined) return own;
  const out: Record<string, number | null> = { ...(own as Record<string, number | null> | undefined) };
  for (const [key, value] of Object.entries(workflow) as [keyof Limits, number | null | undefined][]) {
    if (value === undefined || Object.hasOwn(out, key)) continue;
    const cap = bound?.[key];
    if (value === null) {
      if (typeof cap !== "number") out[key] = null;
      continue;
    }
    out[key] = typeof cap === "number" ? Math.min(value, cap) : value;
  }
  return out as Partial<Limits>;
}

/** Runs a validation and turns an InputError into a failed outcome. */
function attempt(code: TaskErrorCode, build: () => ResolvedTaskSpec): ParseTaskOutcome {
  try {
    return { ok: true, task: build() };
  } catch (error) {
    if (error instanceof InputError) {
      return {
        ok: false,
        code: error.code ?? code,
        message: error.message,
        ...(error.position === undefined ? {} : { position: error.position }),
        ...(error.hint === undefined ? {} : { hint: error.hint }),
      };
    }
    throw error;
  }
}

/**
 * Validates a parsed task file. `workspaceRoot` and `scriptPath` must be local paths (S-5); they
 * are resolved against `taskDir` and returned as absolute paths. Limits are bounded by the config
 * file's (S-7); a failure caused by the config file's limits has the code `invalid_config`.
 */
export function parseTask(value: unknown, taskDir: string, defaults: TaskDefaults = {}): ParseTaskOutcome {
  return attempt("invalid_task", () => {
    const rec = record(value, "task", [
      "schemaVersion",
      "id",
      "goal",
      "workflow",
      "workspaceRoot",
      "model",
      "policy",
      "privacy",
      "limits",
      "verifiers",
      "workflowRef",
      "tools",
      "plan",
      "completion",
      "humanReview",
    ]);
    if (rec["schemaVersion"] !== TASK_SCHEMA_VERSION) fail("schemaVersion must be 1");
    const id = text(rec["id"], "id");
    if (!new RegExp(TASK_ID_PATTERN_SOURCE).test(id)) fail("id may use letters, digits, '.', '_' and '-' (1-64)");
    const privacy = record(rec["privacy"], "privacy", ["secretEnv"]);
    const secretEnv = parseSecretEnv(privacy["secretEnv"], "privacy.secretEnv");
    const verifiers = parseVerifiers(rec["verifiers"]);
    const ownLimits = rec["limits"] === undefined ? undefined : parsePartialLimits(rec["limits"]);
    const goal = text(rec["goal"], "goal");
    const workflow = text(rec["workflow"], "workflow");
    const workspaceRoot = resolveLocal(taskDir, text(rec["workspaceRoot"], "workspaceRoot"), "workspaceRoot");
    const model = parseModel(rec["model"], taskDir);
    const policy = parsePolicy(rec["policy"], "task");
    // G-A: the task's own workflow fields; resolved against the definition afterwards (resolveWorkflow).
    const workflowRef = rec["workflowRef"] === undefined ? undefined : parseWorkflowRef(rec["workflowRef"], "workflowRef");
    const tools = rec["tools"] === undefined ? undefined : parseToolList(rec["tools"], "tools");
    const plan = rec["plan"] === undefined ? undefined : parsePlanMode(rec["plan"], "plan");
    const completion = rec["completion"] === undefined ? undefined : parseCompletion(rec["completion"], "completion");
    const humanReview = rec["humanReview"] === undefined ? undefined : parseHumanReview(rec["humanReview"], "humanReview");

    return {
      schemaVersion: 1,
      id,
      goal,
      workflow,
      workspaceRoot,
      model,
      policy,
      privacy: { secretEnv },
      limits: boundedLimits("task", model.provider, withWorkflowDefaults(ownLimits, defaults.workflowLimits, defaults.limits), defaults.limits),
      verifiers,
      ...(workflowRef === undefined ? {} : { workflowRef }),
      ...(tools === undefined ? {} : { tools }),
      ...(plan === undefined ? {} : { plan }),
      ...(completion === undefined ? {} : { completion }),
      ...(humanReview === undefined ? {} : { humanReview }),
    };
  });
}

export interface QuickTaskInput {
  /** Absolute, or relative to `cwd`. */
  readonly workspace: string;
  readonly goal: string;
  readonly cwd: string;
  readonly config: CodarynConfig | null;
  /** G-A (DR-2): `--workflow <id>`; it becomes the label and the task's `workflowRef`. */
  readonly workflowRef?: string | null;
  /**
   * U-17 (UXM-3, AXM-14): for a command that runs no model and no verifier (`plan`, `review`).
   * Limits the config file does not give are not an error: READ_ONLY_LIMITS stand in, and nothing
   * runs under them. Limits that are given are still checked.
   */
  readonly readOnly?: boolean;
}

/** U-17: the limits of a quick form read by a command that runs nothing. Never a run's limits. */
export const READ_ONLY_LIMITS: ResolvedTaskSpec["limits"] = { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: 1, maxDurationMs: 1, maxRepairAttempts: 1, maxSameFailures: 1 };

/** U-17: as boundedLimits, but a limit that is not set (the config's, or a workflow's partial ones) is no error. */
function readOnlyLimits(provider: ModelProviderName, config: Partial<Limits> | undefined): ResolvedTaskSpec["limits"] {
  const outcome = resolveBoundedLimits({ form: "quick", provider, task: undefined, config });
  if (outcome.ok) return outcome.limits;
  return outcome.message.includes("is not set") ? READ_ONLY_LIMITS : fail(outcome.message, outcome.code);
}

/**
 * The quick form (`--workspace`, `--goal`): a task for the config's API provider (SP-D3, SP-D10:
 * the chosen profile's `provider`, already laid over by selectProfile, else the file's, else
 * anthropic) whose policy, limits, verifiers and secret names come from the config file. Limits
 * must be set there, with a token limit (S-7).
 * The caller checks `--workspace` with `localPathProblem` first (S-5). Failures are `invalid_config`.
 */
export function buildQuickTask(input: QuickTaskInput): ParseTaskOutcome {
  return attempt("invalid_config", () => ({
    schemaVersion: 1,
    id: QUICK_TASK_ID,
    goal: text(input.goal, "--goal"),
    workflow: input.workflowRef ?? QUICK_TASK_WORKFLOW,
    ...(input.workflowRef === undefined || input.workflowRef === null ? {} : { workflowRef: input.workflowRef }),
    workspaceRoot: path.resolve(input.cwd, text(input.workspace, "--workspace")),
    model: { provider: quickProvider(input.config) },
    policy: input.config?.policy ?? DENY_ALL_POLICY,
    privacy: { secretEnv: [...(input.config?.secretEnv ?? [])] },
    limits: input.readOnly === true ? readOnlyLimits(quickProvider(input.config), input.config?.limits) : boundedLimits("quick", quickProvider(input.config), undefined, input.config?.limits),
    verifiers: [...(input.config?.verifiers ?? [])],
  }));
}

/**
 * SP-D3, SP-D10: the API provider of the quick form. `config` is the effective one: with
 * `--profile` it already holds the profile's `provider` (selectProfile).
 */
export function quickProvider(config: CodarynConfig | null): ApiProviderName {
  return config?.provider ?? "anthropic";
}

/** Adds the config file's secret names to the task's, without duplicates. */
export function withConfigSecrets(task: ResolvedTaskSpec, config: CodarynConfig | null): ResolvedTaskSpec {
  const extra = (config?.secretEnv ?? []).filter((name) => !task.privacy.secretEnv.includes(name));
  if (extra.length === 0) return task;
  return { ...task, privacy: { secretEnv: [...task.privacy.secretEnv, ...extra] } };
}
