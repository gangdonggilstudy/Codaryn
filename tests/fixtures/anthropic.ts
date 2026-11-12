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
 * Run length the model listing compares with the key: `listAnthropicModels` refuses a list entry
 * whose id, display name or created_at holds this many consecutive characters of the key
 * (`KEY_FRAGMENT_CHARS` in src/model/anthropic/index.ts, not exported; docs/cli-contract.md 16 does
 * not state it yet). Kept here so fixtures can stay clear of it.
 */
export const KEY_RUN_CHARS = 8;

/** True when `text` and `key` share KEY_RUN_CHARS consecutive characters. */
export function sharesKeyRun(text: string, key: string): boolean {
  for (let index = 0; index + KEY_RUN_CHARS <= key.length; index += 1) {
    if (text.includes(key.slice(index, index + KEY_RUN_CHARS))) return true;
  }
  return false;
}

/**
 * Prefix of every id the fake server lists. Every fake key starts with "cdy-fake" (eight
 * characters), so a listed id must not: the listing would refuse it as key material.
 */
export const LISTED_MODEL_PREFIX = "cdy-listed-model-";

/**
 * Models the fake server lists for `codaryn models` (Y-1). With the fake's page size of 2 they
 * span three pages. The last one has no `type` or `created_at` (both unconfirmed fields).
 */
export const FAKE_MODEL_CATALOG: readonly FakeModel[] = [
  fakeModel(`${LISTED_MODEL_PREFIX}alpha`, "Fake Model Alpha", 1_000_000, 128_000, { createdAt: "2026-05-01T00:00:00Z" }),
  fakeModel(`${LISTED_MODEL_PREFIX}beta`, "Fake Model Beta", 1_000_000, 64_000, { createdAt: "2026-04-01T00:00:00Z" }),
  fakeModel(`${LISTED_MODEL_PREFIX}gamma`, "Fake Model Gamma", 200_000, 64_000, { createdAt: "2026-03-01T00:00:00Z" }),
  fakeModel(`${LISTED_MODEL_PREFIX}delta`, "Fake Model Delta", 200_000, 8_192, { createdAt: "2026-02-01T00:00:00Z" }),
  fakeModel(`${LISTED_MODEL_PREFIX}epsilon`, "Fake Model Epsilon", 100_000, 4_096, { omitUnconfirmed: true }),
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

/**
 * DR-36 (c): a value with the Anthropic refusal shape (ANTHROPIC_KEY_REFUSAL_PATTERN_SOURCE: `sk-ant-`
 * at a word start, then 32 or more characters with a digit), built at run time from parts so no
 * source file holds the shape (the commit hook would flag it). Its words and the missing version
 * part of a real key (`api03-`) keep it apart from a real key's format. Never sent anywhere: every
 * case that uses it expects key_in_file before any request.
 */
export const ANTHROPIC_REFUSED_SHAPE = ["sk", "ant", "codaryn0test0shape0only0not0a0key"].join("-");

/** DR-36 (c), R-20 F: names that start like an Anthropic key and are no longer refused (built from parts). */
export const ANTHROPIC_NAMES_NOT_REFUSED: readonly { readonly label: string; readonly value: string }[] = [
  { label: "짧은 이름", value: ["sk", "ant", "design", "system"].join("-") },
  { label: "32자 이상이지만 숫자 없음", value: ["sk", "ant", "codaryn-shape-without-any-digit-in-it"].join("-") },
  { label: "단어에 붙은 sk-ant-", value: ["risk", "ant", "codaryn0test0shape0only0not0a0key"].join("-") },
];
