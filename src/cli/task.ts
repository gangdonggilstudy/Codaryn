/**
 * task.json validation, and the quick form task built from the config file.
 * Error messages name fields only, never values from the file.
 * Security rules come from `./security`: variable names (S-3), local paths (S-5),
 * bounded limits (S-7) and timer values (S-7).
 */

import path from "node:path";
import {
  DENY_ALL_POLICY,
  MAX_OUTPUT_TOKENS_LIMIT,
  QUICK_TASK_ID,
  QUICK_TASK_WORKFLOW,
  TASK_ID_PATTERN_SOURCE,
  TASK_SCHEMA_VERSION,
} from "../contracts/index.js";
import type {
  CodarynConfig,
  CommandRule,
  FileRule,
  Limits,
  ModelConfig,
  ModelProviderName,
  PolicyConfig,
  ProtectedPathProblemReason,
  ResolvedTaskSpec,
  VerifierConfig,
} from "../contracts/index.js";
import { checkProtectedPaths } from "../policy/index.js";
import { checkLocalPathSyntax, checkTimerMs, resolveBoundedLimits, validateSecretEnvNames } from "./security/index.js";

/** `invalid_config` when the config file caused the failure (S-7 bounds, quick form). */
export type TaskErrorCode = "invalid_task" | "invalid_config";

export type ParseTaskOutcome =
  | { readonly ok: true; readonly task: ResolvedTaskSpec }
  | { readonly ok: false; readonly code: TaskErrorCode; readonly message: string };

export type Rec = Record<string, unknown>;

/** A validation failure. Its message names a field, never a value. `code` overrides the default. */
export class InputError extends Error {
  constructor(
    message: string,
    readonly code?: TaskErrorCode,
  ) {
    super(message);
  }
}

export function fail(message: string, code?: TaskErrorCode): never {
  throw new InputError(message, code);
}

export function record(value: unknown, field: string, keys: readonly string[]): Rec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${field} must be an object`);
  const rec = value as Rec;
  const extra = Object.keys(rec).find((key) => !keys.includes(key));
  if (extra !== undefined) fail(`${field} has an unknown field`);
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
export function optionalOutputTokens(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > MAX_OUTPUT_TOKENS_LIMIT) {
    fail(`${field} must be a positive integer of at most ${MAX_OUTPUT_TOKENS_LIMIT}`);
  }
  return value;
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
      fail("model.model and model.maxOutputTokens are only for the anthropic provider");
    }
    return { provider: "scripted", scriptPath: resolveLocal(baseDir, text(rec["scriptPath"], "model.scriptPath"), "model.scriptPath") };
  }
  if (rec["provider"] === "anthropic") {
    if (rec["scriptPath"] !== undefined) fail("model.scriptPath is only for the scripted provider");
    const model = optionalText(rec["model"], "model.model");
    const maxOutputTokens = optionalOutputTokens(rec["maxOutputTokens"], "model.maxOutputTokens");
    return {
      provider: "anthropic",
      ...(model === undefined ? {} : { model }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    };
  }
  return fail('model.provider must be "scripted" or "anthropic"');
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
 */
function parseProtectedPaths(value: unknown): string[] {
  const field = "policy.protectedPaths";
  const [problem] = checkProtectedPaths(value);
  if (problem !== undefined) {
    const at = problem.index === null ? field : `${field}[${problem.index}]`;
    fail(`${at} ${PROTECTED_PATH_MESSAGES[problem.reason]}`);
  }
  return [...(value as readonly string[])];
}

export function parsePolicy(value: unknown): PolicyConfig {
  const rec = record(value, "policy", ["commands", "network", "destructive", "restorePathTokens", "protectedPaths"]);
  if (!Array.isArray(rec["commands"])) fail("policy.commands must be an array");
  const commands = (rec["commands"] as unknown[]).map((item, index): CommandRule => {
    const field = `policy.commands[${index}]`;
    const rule = record(item, field, ["executable", "argsPrefix", "allowExtraArgs"]);
    if (typeof rule["allowExtraArgs"] !== "boolean") fail(`${field}.allowExtraArgs must be a boolean`);
    return {
      executable: text(rule["executable"], `${field}.executable`),
      argsPrefix: strings(rule["argsPrefix"], `${field}.argsPrefix`),
      allowExtraArgs: rule["allowExtraArgs"],
    };
  });
  if (rec["network"] !== "deny") fail('policy.network must be "deny"');
  if (rec["destructive"] !== "deny") fail('policy.destructive must be "deny"');
  if (typeof rec["restorePathTokens"] !== "boolean") fail("policy.restorePathTokens must be a boolean");
  const protectedPaths = rec["protectedPaths"] === undefined ? undefined : parseProtectedPaths(rec["protectedPaths"]);
  return {
    commands,
    network: "deny",
    destructive: "deny",
    restorePathTokens: rec["restorePathTokens"],
    ...(protectedPaths === undefined ? {} : { protectedPaths }),
  };
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

const RULE_TYPES = ["exists", "absent", "contains", "not_contains"];

function parseRule(value: unknown, field: string): FileRule {
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

function parseVerifier(value: unknown, index: number): VerifierConfig {
  const field = `verifiers[${index}]`;
  const kind = (value as Rec | null)?.["kind"];
  if (kind === "command") {
    const rec = record(value, field, ["id", "kind", "executable", "args", "cwd", "timeoutMs", "expectExitCode"]);
    const expect = rec["expectExitCode"];
    if (expect !== undefined && (typeof expect !== "number" || !Number.isInteger(expect))) {
      fail(`${field}.expectExitCode must be an integer`);
    }
    const cwd = optionalText(rec["cwd"], `${field}.cwd`);
    const timeoutMs = timerMs(rec["timeoutMs"], `${field}.timeoutMs`);
    return {
      id: text(rec["id"], `${field}.id`),
      kind: "command",
      executable: text(rec["executable"], `${field}.executable`),
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
  return fail(`${field}.kind must be "command" or "file_rules"`);
}

/** Values from the config file that bound or complete a task file. */
export interface TaskDefaults {
  /** Upper bounds, and values for the fields the task leaves out (S-7). */
  readonly limits?: Partial<Limits> | undefined;
}

/** Runs a validation and turns an InputError into a failed outcome. */
function attempt(code: TaskErrorCode, build: () => ResolvedTaskSpec): ParseTaskOutcome {
  try {
    return { ok: true, task: build() };
  } catch (error) {
    if (error instanceof InputError) return { ok: false, code: error.code ?? code, message: error.message };
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
    const policy = parsePolicy(rec["policy"]);

    return {
      schemaVersion: 1,
      id,
      goal,
      workflow,
      workspaceRoot,
      model,
      policy,
      privacy: { secretEnv },
      limits: boundedLimits("task", model.provider, ownLimits, defaults.limits),
      verifiers,
    };
  });
}

export interface QuickTaskInput {
  /** Absolute, or relative to `cwd`. */
  readonly workspace: string;
  readonly goal: string;
  readonly cwd: string;
  readonly config: CodarynConfig | null;
}

/**
 * The quick form (`--workspace`, `--goal`): an anthropic task whose policy, limits, verifiers and
 * secret names come from the config file. Limits must be set there, with a token limit (S-7).
 * The caller checks `--workspace` with `localPathProblem` first (S-5). Failures are `invalid_config`.
 */
export function buildQuickTask(input: QuickTaskInput): ParseTaskOutcome {
  return attempt("invalid_config", () => ({
    schemaVersion: 1,
    id: QUICK_TASK_ID,
    goal: text(input.goal, "--goal"),
    workflow: QUICK_TASK_WORKFLOW,
    workspaceRoot: path.resolve(input.cwd, text(input.workspace, "--workspace")),
    model: { provider: "anthropic" },
    policy: input.config?.policy ?? DENY_ALL_POLICY,
    privacy: { secretEnv: [...(input.config?.secretEnv ?? [])] },
    limits: boundedLimits("quick", "anthropic", undefined, input.config?.limits),
    verifiers: [...(input.config?.verifiers ?? [])],
  }));
}

/** Adds the config file's secret names to the task's, without duplicates. */
export function withConfigSecrets(task: ResolvedTaskSpec, config: CodarynConfig | null): ResolvedTaskSpec {
  const extra = (config?.secretEnv ?? []).filter((name) => !task.privacy.secretEnv.includes(name));
  if (extra.length === 0) return task;
  return { ...task, privacy: { secretEnv: [...task.privacy.secretEnv, ...extra] } };
}
