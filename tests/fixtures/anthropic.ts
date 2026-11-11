/**
 * Task, config and env files for runs with provider "anthropic". Mock API tests point them at a
 * local fake server; the live check (tests/live) uses them with the real API.
 * Only fake keys and fake model ids appear here. Every file goes into the temporary sandbox,
 * never into the repository.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CodarynConfig, CommandRule, Limits, VerifierConfig } from "../../src/contracts/index.js";
import { fakeModel } from "../support/fake-models.js";
import type { FakeModel } from "../support/fake-models.js";
import { DEFAULT_LIMITS } from "./builders.js";
import type { Sandbox } from "./builders.js";

/**
 * Limits for runs with provider "anthropic". S-7: the anthropic provider never runs without a
 * token limit (`maxTotalTokens: null` is refused), and every limit stays under the absolute caps.
 */
export const ANTHROPIC_LIMITS: Limits = { ...DEFAULT_LIMITS, maxTotalTokens: 200_000 };

/**
 * Models the fake server lists for `codaryn models` (Y-1). With the fake's page size of 2 they
 * span three pages. The last one has no `type` or `created_at` (both unconfirmed fields).
 */
export const FAKE_MODEL_CATALOG: readonly FakeModel[] = [
  fakeModel("cdy-fake-model-alpha", "Fake Model Alpha", 1_000_000, 128_000, { createdAt: "2026-05-01T00:00:00Z" }),
  fakeModel("cdy-fake-model-beta", "Fake Model Beta", 1_000_000, 64_000, { createdAt: "2026-04-01T00:00:00Z" }),
  fakeModel("cdy-fake-model-gamma", "Fake Model Gamma", 200_000, 64_000, { createdAt: "2026-03-01T00:00:00Z" }),
  fakeModel("cdy-fake-model-delta", "Fake Model Delta", 200_000, 8_192, { createdAt: "2026-02-01T00:00:00Z" }),
  fakeModel("cdy-fake-model-epsilon", "Fake Model Epsilon", 100_000, 4_096, { omitUnconfirmed: true }),
];

export const FAKE_MODEL_TASK = "cdy-fake-model-task";
export const FAKE_MODEL_ENV = "cdy-fake-model-env";
export const FAKE_MODEL_CONFIG = "cdy-fake-model-config";
export const FAKE_MODEL_ENV_FILE = "cdy-fake-model-envfile";
/** Appears only in files the CLI must never read on its own. */
export const FAKE_MODEL_DECOY = "cdy-fake-model-decoy";

export interface AnthropicTaskOptions {
  readonly id: string;
  readonly goal?: string;
  readonly workflow?: string;
  /** `model.model`. Left out when undefined. */
  readonly model?: string;
  /** `model.maxOutputTokens`. Left out when undefined. */
  readonly maxOutputTokens?: number;
  readonly commands?: readonly CommandRule[];
  readonly secretEnv?: readonly string[];
  /** Written as given (fields may be missing). "omit" leaves `limits` out. Default ANTHROPIC_LIMITS. */
  readonly limits?: Partial<Limits> | "omit";
  readonly verifiers?: readonly VerifierConfig[];
  /** Extra top-level fields, written as given. Used to try fields a task file must not have. */
  readonly extraTop?: Readonly<Record<string, unknown>>;
  /** Extra fields inside `model`, written as given. */
  readonly extraModel?: Readonly<Record<string, unknown>>;
}

/**
 * Writes task.json into the sandbox base with provider "anthropic" and `workspaceRoot: "./ws"`.
 * The object is built by hand so tests can leave out fields or add forbidden ones.
 */
export function writeAnthropicTask(sandbox: Sandbox, options: AnthropicTaskOptions): string {
  const model: Record<string, unknown> = { provider: "anthropic" };
  if (options.model !== undefined) model["model"] = options.model;
  if (options.maxOutputTokens !== undefined) model["maxOutputTokens"] = options.maxOutputTokens;
  Object.assign(model, options.extraModel);
  const task: Record<string, unknown> = {
    schemaVersion: 1,
    id: options.id,
    goal: options.goal ?? "모의 API 통합 테스트 작업",
    workflow: options.workflow ?? "document",
    workspaceRoot: "./ws",
    model,
    policy: { commands: options.commands ?? [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: options.secretEnv ?? [] },
  };
  if (options.limits !== "omit") task["limits"] = options.limits ?? ANTHROPIC_LIMITS;
  task["verifiers"] = options.verifiers ?? [];
  Object.assign(task, options.extraTop);
  writeFileSync(sandbox.taskPath, JSON.stringify(task, null, 2));
  return sandbox.taskPath;
}

/**
 * A config file for the fake server at `apiBaseUrl`: output cap 1024, request time limit 20 s,
 * 2 retries. `overrides` replace fields; `omit` removes them afterwards.
 */
export function fakeApiConfig(
  apiBaseUrl: string,
  overrides: Partial<CodarynConfig> = {},
  omit: readonly (keyof CodarynConfig)[] = [],
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    schemaVersion: 1,
    maxOutputTokens: 1024,
    apiBaseUrl,
    requestTimeoutMs: 20_000,
    maxRetries: 2,
    ...overrides,
  };
  for (const name of omit) delete config[name];
  return config;
}

/** Writes a config file into the sandbox base (outside the workspace) and returns its path. */
export function writeConfigFile(sandbox: Sandbox, config: object, name = "codaryn-config.json"): string {
  const path = join(sandbox.base, name);
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

/** Writes `NAME=value` lines. Callers pass fake values and paths inside the sandbox only. */
export function writeEnvFile(path: string, vars: Readonly<Record<string, string>>): string {
  const lines = Object.entries(vars).map(([name, value]) => `${name}=${value}`);
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}
