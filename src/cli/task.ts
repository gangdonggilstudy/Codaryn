/**
 * task.json validation. Error messages name fields only, never values from the file.
 */

import path from "node:path";
import { TASK_ID_PATTERN_SOURCE, TASK_SCHEMA_VERSION } from "../contracts/index.js";
import type {
  CommandRule,
  FileRule,
  Limits,
  ModelConfig,
  PolicyConfig,
  TaskSpec,
  VerifierConfig,
} from "../contracts/index.js";

export type ParseTaskOutcome =
  | { readonly ok: true; readonly task: TaskSpec }
  | { readonly ok: false; readonly message: string };

type Rec = Record<string, unknown>;

class TaskError extends Error {}

function fail(message: string): never {
  throw new TaskError(message);
}

function record(value: unknown, field: string, keys: readonly string[]): Rec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${field} must be an object`);
  const rec = value as Rec;
  const extra = Object.keys(rec).find((key) => !keys.includes(key));
  if (extra !== undefined) fail(`${field} has an unknown field`);
  return rec;
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) fail(`${field} must be a non-empty string`);
  return value;
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    fail(`${field} must be an array of strings`);
  }
  return value as string[];
}

function positive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail(`${field} must be a positive integer`);
  }
  return value;
}

function optionalPositive(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : positive(value, field);
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field);
}

function resolveFrom(baseDir: string, target: string): string {
  return path.resolve(baseDir, target);
}

function parseModel(value: unknown, baseDir: string): ModelConfig {
  const rec = record(value, "model", ["provider", "scriptPath"]);
  if (rec["provider"] === "scripted") {
    return { provider: "scripted", scriptPath: resolveFrom(baseDir, text(rec["scriptPath"], "model.scriptPath")) };
  }
  if (rec["provider"] === "anthropic") {
    if (rec["scriptPath"] !== undefined) fail("model.scriptPath is only for the scripted provider");
    return { provider: "anthropic" };
  }
  return fail('model.provider must be "scripted" or "anthropic"');
}

function parsePolicy(value: unknown): PolicyConfig {
  const rec = record(value, "policy", ["commands", "network", "destructive", "restorePathTokens"]);
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
  return { commands, network: "deny", destructive: "deny", restorePathTokens: rec["restorePathTokens"] };
}

function parseLimits(value: unknown): Limits {
  const rec = record(value, "limits", ["maxModelTurns", "maxToolCalls", "maxTotalTokens", "maxDurationMs"]);
  if (!Object.hasOwn(rec, "maxTotalTokens")) fail("limits.maxTotalTokens is required (use null for no limit)");
  return {
    maxModelTurns: positive(rec["maxModelTurns"], "limits.maxModelTurns"),
    maxToolCalls: positive(rec["maxToolCalls"], "limits.maxToolCalls"),
    maxTotalTokens: rec["maxTotalTokens"] === null ? null : positive(rec["maxTotalTokens"], "limits.maxTotalTokens"),
    maxDurationMs: positive(rec["maxDurationMs"], "limits.maxDurationMs"),
  };
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

/**
 * Validates a parsed task file. `workspaceRoot` and `scriptPath` are resolved against
 * `taskDir` and returned as absolute paths.
 */
export function parseTask(value: unknown, taskDir: string): ParseTaskOutcome {
  try {
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
    const secretEnv = strings(privacy["secretEnv"], "privacy.secretEnv");
    if (secretEnv.some((name) => name.length === 0)) fail("privacy.secretEnv names must not be empty");
    if (!Array.isArray(rec["verifiers"])) fail("verifiers must be an array");
    const verifiers = (rec["verifiers"] as unknown[]).map(parseVerifier);
    const ids = verifiers.map((verifier) => verifier.id);
    if (new Set(ids).size !== ids.length) fail("verifier ids must be unique");

    const task: TaskSpec = {
      schemaVersion: 1,
      id,
      goal: text(rec["goal"], "goal"),
      workflow: text(rec["workflow"], "workflow"),
      workspaceRoot: resolveFrom(taskDir, text(rec["workspaceRoot"], "workspaceRoot")),
      model: parseModel(rec["model"], taskDir),
      policy: parsePolicy(rec["policy"]),
      privacy: { secretEnv },
      limits: parseLimits(rec["limits"]),
      verifiers,
    };
    return { ok: true, task };
  } catch (error) {
    if (error instanceof TaskError) return { ok: false, message: error.message };
    throw error;
  }
}
