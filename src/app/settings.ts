/**
 * Settings read for the GUI's wizard and settings screen (standalone-gui 3.2, 3.6, 5.2): which
 * config file a run would read, whether it is there, what it says, and the profile and workflow
 * names a new task can choose.
 *
 * The file is chosen and checked exactly as `codaryn run` does (src/cli/run.ts steps 3 to 5), with
 * the CLI's own functions in the same order:
 *   chooseConfigFile (--config → CODARYN_CONFIG → the N-1 default location, S-5)
 *   → read (a missing file is "no config" only at the default location; a BOM is dropped)
 *   → rawTextHoldsKey (C-1, S-6) → JSON with a line and column on a syntax error (N-6)
 *   → findKeyInJson (depth limit) → parseConfig (with the field position, N-6).
 * Nothing here judges a value itself. Reads only. The settings change (settings-change.ts) uses
 * the same checks for the text it would write.
 *
 * The CLI keeps this sequence inline in run.ts; a shared config reader there would let this file
 * call one function instead (A-4 report).
 */

import { ANTHROPIC_API_KEY_ENV, BUILTIN_WORKFLOW_IDS } from "../contracts/index.js";
import type { CodarynConfig, DefaultConfigLocation, InputDiagnostic } from "../contracts/index.js";
import { chooseConfigFile, isMissingFile } from "../cli/config-file.js";
import { parseConfig } from "../cli/config.js";
import { jsonSyntaxError, positionDiagnostic } from "../cli/run.js";
import { MAX_KEY_SCAN_DEPTH, findKeyInJson, rawTextHoldsKey } from "../cli/security/index.js";
import { envValue } from "../cli/settings.js";
import { appError } from "./errors.js";
import type { AppCallOutcome, AppError, ReadSettingsRequest, SettingsView } from "./types.js";

const KEY_HINT = `keys are read only from the ${ANTHROPIC_API_KEY_ENV} environment variable`;

type Failure = { readonly ok: false; readonly error: AppError };

function failure(code: "invalid_config" | "key_in_file", message: string, diagnostic?: InputDiagnostic): Failure {
  return { ok: false, error: diagnostic === undefined ? appError(code, message) : { ...appError(code, message), diagnostic } };
}

export interface SettingsIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly readFile: (file: string) => Promise<string>;
  readonly defaultConfig: DefaultConfigLocation | null;
}

export type ChosenFile = { readonly source: "argument" | "environment" | "default"; readonly path: string; readonly display: string };

/** Key checks, JSON and parseConfig on a config file's text (BOM dropped), in run.ts's order. */
export function checkConfigText(text: string, currentKey: string | null): { readonly ok: true; readonly config: CodarynConfig } | Failure {
  if (rawTextHoldsKey(text, currentKey)) return failure("key_in_file", `the config file contains a key value; ${KEY_HINT}`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const syntax = jsonSyntaxError("config file", "config", text);
    return failure("invalid_config", syntax.message, syntax.diagnostic);
  }
  const found = findKeyInJson(value, currentKey);
  if (found.kind === "key") return failure("key_in_file", `the config file has a key field or key value at ${found.location}; ${KEY_HINT}`);
  if (found.kind === "too_deep") {
    return failure("invalid_config", `the config file is nested more than ${MAX_KEY_SCAN_DEPTH} levels deep`, {
      code: "too_deep",
      file: "config",
      field: null,
      line: null,
      column: null,
    });
  }
  const parsed = parseConfig(value);
  if (!parsed.ok) return failure("invalid_config", parsed.message, positionDiagnostic("config", parsed.position));
  return { ok: true, config: parsed.config };
}

/**
 * The chosen config file with its raw text (as read, BOM included) and its parsed config.
 * `file` null: none chosen. `raw` null: the default location has no file yet.
 */
export async function loadSettingsFile(
  io: SettingsIo,
  configPath: string | null,
): Promise<
  | { readonly ok: true; readonly currentKey: string | null; readonly file: ChosenFile | null; readonly raw: string | null; readonly config: CodarynConfig | null }
  | Failure
> {
  const currentKey = envValue(io.env, ANTHROPIC_API_KEY_ENV);
  const chosen = chooseConfigFile({ argument: configPath, env: io.env, cwd: io.cwd, defaultLocation: io.defaultConfig });
  if (!chosen.ok) return failure("invalid_config", chosen.message);
  const candidate = chosen.candidate;
  if (candidate === null) return { ok: true, currentKey, file: null, raw: null, config: null };
  const file: ChosenFile = { source: candidate.source, path: candidate.path, display: candidate.display };
  let raw: string;
  try {
    raw = await io.readFile(candidate.path);
  } catch (error) {
    if (candidate.optional && isMissingFile(error)) return { ok: true, currentKey, file, raw: null, config: null };
    return failure(
      "invalid_config",
      candidate.source === "default" ? `the config file at the default location ${candidate.display} cannot be read` : "the config file cannot be read as JSON",
    );
  }
  const checked = checkConfigText(raw.replace(/^﻿/, ""), currentKey);
  if (!checked.ok) return checked;
  return { ok: true, currentKey, file, raw, config: checked.config };
}

/** Each profile with the workflow it uses when the task names none, in the file's order. Pure. */
export function profileWorkflowsOf(config: CodarynConfig | null): { readonly profile: string; readonly workflowRef: string | null }[] {
  return Object.entries(config?.profiles ?? {}).map(([profile, entry]) => ({ profile, workflowRef: entry.workflowRef ?? null }));
}

export async function readSettingsIn(io: SettingsIo, request: ReadSettingsRequest): Promise<AppCallOutcome<SettingsView>> {
  const loaded = await loadSettingsFile(io, request.configPath);
  if (!loaded.ok) return loaded;
  const config = loaded.config;
  return {
    ok: true,
    output: {
      kind: "settings",
      file: loaded.file === null ? null : { ...loaded.file, exists: loaded.raw !== null },
      config,
      profiles: Object.keys(config?.profiles ?? {}),
      workflows: Object.keys(config?.workflows ?? {}),
      builtinWorkflows: [...BUILTIN_WORKFLOW_IDS],
      profileWorkflows: profileWorkflowsOf(config),
      keyAvailable: loaded.currentKey !== null,
    },
  };
}
