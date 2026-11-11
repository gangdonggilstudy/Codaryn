/**
 * task.json validation, and the quick form task built from the config file.
 * Error messages name fields only, never values from the file.
 */

import path from "node:path";
import {
  DEFAULT_MAX_REPAIR_ATTEMPTS,
  DEFAULT_MAX_SAME_FAILURES,
  DENY_ALL_POLICY,
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
  PolicyConfig,
  ResolvedLimits,
  ResolvedTaskSpec,
  VerifierConfig,
} from "../contracts/index.js";

export type ParseTaskOutcome =
  | { readonly ok: true; readonly task: ResolvedTaskSpec }
  | { readonly ok: false; readonly message: string };

export type Rec = Record<string, unknown>;

/** A validation failure. Its message names a field, never a value. */
export class InputError extends Error {}

export function fail(message: string): never {
  throw new InputError(message);
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

export function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field);
}

function resolveFrom(baseDir: string, target: string): string {
  return path.resolve(baseDir, target);
}

function parseModel(value: unknown, baseDir: string): ModelConfig {
  const rec = record(value, "model", ["provider", "scriptPath", "model", "maxOutputTokens"]);
  if (rec["provider"] === "scripted") {
    if (rec["model"] !== undefined || rec["maxOutputTokens"] !== undefined) {
      fail("model.model and model.maxOutputTokens are only for the anthropic provider");
    }
    return { provider: "scripted", scriptPath: resolveFrom(baseDir, text(rec["scriptPath"], "model.scriptPath")) };
  }
  if (rec["provider"] === "anthropic") {
    if (rec["scriptPath"] !== undefined) fail("model.scriptPath is only for the scripted provider");
    const model = optionalText(rec["model"], "model.model");
    const maxOutputTokens = optionalPositive(rec["maxOutputTokens"], "model.maxOutputTokens");
    return {
      provider: "anthropic",
      ...(model === undefined ? {} : { model }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    };
  }
  return fail('model.provider must be "scripted" or "anthropic"');
}

/**
 * `policy.protectedPaths`: relative path prefixes, `/` or `\` separated, without a `..` segment.
 * Kept as written; the policy gate compares them with resolved paths (R-5).
 */
function parseProtectedPaths(value: unknown): string[] {
  const field = "policy.protectedPaths";
  const entries = strings(value, field);
  for (const [index, entry] of entries.entries()) {
    const at = `${field}[${index}]`;
    if (entry.trim().length === 0) fail(`${at} must be a non-empty path`);
    if (entry.includes("\0")) fail(`${at} must not contain a NUL character`);
    if (path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry) || /^[A-Za-z]:/.test(entry)) {
      fail(`${at} must be relative to the workspace root`);
    }
    if (entry.split(/[\\/]/).includes("..")) fail(`${at} must not contain a '..' segment`);
  }
  return entries;
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

/** Validates the limit fields that are present. Absent fields stay absent. */
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

/**
 * Each field from `own` when present there, else from `defaults`. The four budget limits must end
 * up set. The repair limits fall back to DEFAULT_MAX_REPAIR_ATTEMPTS and DEFAULT_MAX_SAME_FAILURES.
 */
export function mergeLimits(own: Partial<Limits> | undefined, defaults: Partial<Limits> | undefined): ResolvedLimits {
  const find = <K extends keyof Limits>(field: K): Limits[K] | undefined => {
    if (own !== undefined && Object.hasOwn(own, field)) return own[field];
    if (defaults !== undefined && Object.hasOwn(defaults, field)) return defaults[field];
    return undefined;
  };
  const pick = <K extends "maxModelTurns" | "maxToolCalls" | "maxTotalTokens" | "maxDurationMs">(field: K): Limits[K] => {
    const value = find(field);
    if (value !== undefined) return value;
    const hint = field === "maxTotalTokens" ? " (use null for no limit)" : "";
    return fail(`limits.${field} is not set in the task or the config file${hint}`);
  };
  return {
    maxModelTurns: pick("maxModelTurns"),
    maxToolCalls: pick("maxToolCalls"),
    maxTotalTokens: pick("maxTotalTokens"),
    maxDurationMs: pick("maxDurationMs"),
    maxRepairAttempts: find("maxRepairAttempts") ?? DEFAULT_MAX_REPAIR_ATTEMPTS,
    maxSameFailures: find("maxSameFailures") ?? DEFAULT_MAX_SAME_FAILURES,
  };
}

/** Parses a verifier list and checks that ids are unique. */
export function parseVerifiers(value: unknown): VerifierConfig[] {
  if (!Array.isArray(value)) fail("verifiers must be an array");
  const verifiers = (value as unknown[]).map(parseVerifier);
  const ids = verifiers.map((verifier) => verifier.id);
  if (new Set(ids).size !== ids.length) fail("verifier ids must be unique");
  return verifiers;
}

/** Parses a list of environment variable names. */
export function parseSecretEnv(value: unknown, field: string): string[] {
  const names = strings(value, field);
  if (names.some((name) => name.length === 0)) fail(`${field} names must not be empty`);
  return names;
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
    const timeoutMs = optionalPositive(rec["timeoutMs"], `${field}.timeoutMs`);
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

/** Values a task file may leave to the config file. */
export interface TaskDefaults {
  readonly limits?: Partial<Limits> | undefined;
}

/** Runs a validation and turns an InputError into a failed outcome. */
function attempt(build: () => ResolvedTaskSpec): ParseTaskOutcome {
  try {
    return { ok: true, task: build() };
  } catch (error) {
    if (error instanceof InputError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Validates a parsed task file. `workspaceRoot` and `scriptPath` are resolved against
 * `taskDir` and returned as absolute paths. Limit fields the task leaves out come from `defaults`.
 */
export function parseTask(value: unknown, taskDir: string, defaults: TaskDefaults = {}): ParseTaskOutcome {
  return attempt(() => {
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

    return {
      schemaVersion: 1,
      id,
      goal: text(rec["goal"], "goal"),
      workflow: text(rec["workflow"], "workflow"),
      workspaceRoot: resolveFrom(taskDir, text(rec["workspaceRoot"], "workspaceRoot")),
      model: parseModel(rec["model"], taskDir),
      policy: parsePolicy(rec["policy"]),
      privacy: { secretEnv },
      limits: mergeLimits(ownLimits, defaults.limits),
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
 * secret names come from the config file. Limits must be set there; nothing else is required.
 */
export function buildQuickTask(input: QuickTaskInput): ParseTaskOutcome {
  return attempt(() => ({
    schemaVersion: 1,
    id: QUICK_TASK_ID,
    goal: text(input.goal, "--goal"),
    workflow: QUICK_TASK_WORKFLOW,
    workspaceRoot: path.resolve(input.cwd, text(input.workspace, "--workspace")),
    model: { provider: "anthropic" },
    policy: input.config?.policy ?? DENY_ALL_POLICY,
    privacy: { secretEnv: [...(input.config?.secretEnv ?? [])] },
    limits: mergeLimits(undefined, input.config?.limits),
    verifiers: [...(input.config?.verifiers ?? [])],
  }));
}

/** Adds the config file's secret names to the task's, without duplicates. */
export function withConfigSecrets(task: ResolvedTaskSpec, config: CodarynConfig | null): ResolvedTaskSpec {
  const extra = (config?.secretEnv ?? []).filter((name) => !task.privacy.secretEnv.includes(name));
  if (extra.length === 0) return task;
  return { ...task, privacy: { secretEnv: [...task.privacy.secretEnv, ...extra] } };
}
