/**
 * The task file parser's common part (IR-26 step 3 T0): the error class, scalar and local path
 * checks, and field diagnostics. Error messages name fields only, never values from the file.
 * task.ts passes its public names on; this module never imports task.ts.
 */

import path from "node:path";
import { API_PROVIDERS, API_PROVIDER_NAMES } from "../../contracts/index.js";
import type { ApiProviderName, ProtectedPathProblemReason, ResolvedTaskSpec } from "../../contracts/index.js";
import { toSchemaFieldPath } from "../../contracts/index.js";
import type { CliErrorHint } from "../../contracts/index.js";
import { checkProtectedPaths } from "../../policy/index.js";
import { checkLocalPathSyntax, checkTimerMs } from "./security/index.js";

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
export function positionFromMessage(message: string): InputErrorPosition | undefined {
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
export function localPathText(value: unknown, field: string): string {
  const raw = text(value, field);
  const syntax = checkLocalPathSyntax(raw);
  if (!syntax.ok) fail(`${field} ${syntax.reason === "invalid" ? "is not a valid local path" : "is a network or device path"}`);
  return raw;
}

/** Resolves a path from a file against `baseDir` after the S-5 check. */
export function resolveLocal(baseDir: string, target: string, field: string): string {
  const problem = localPathProblem(target, baseDir);
  if (problem !== null) fail(`${field} ${problem}`);
  return path.resolve(baseDir, target);
}

/** S-7: a time value Node timers can honour. */
export function timerMs(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  const checked = checkTimerMs(value, field);
  if (!checked.ok) fail(checked.message);
  return value as number;
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
export function parsePathList(value: unknown, field: "policy.protectedPaths" | "policy.writablePaths" | "policy.unreadablePaths"): string[] {
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
