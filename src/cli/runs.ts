/**
 * N-7: the run list command and the `latest` run alias.
 *
 * - `codaryn runs [--workspace <dir>] [--limit <n>] [--json]` (RunsOutput, cli-contract 17.3):
 *   the workspace's runs, newest first. Text for people on stdout by default
 *   (`HumanOutput.runsText`), RunsOutput as one JSON line with `--json`. `--workspace` defaults to
 *   the current directory. Reads only: nothing is created, changed or locked.
 * - `resolveRunRef`: `--run latest` for the app layer (`changes`, `resolveRun`): U-22 (R-51 M-2), the
 *   CLI's one rule (resolveRunReference with the store's functions), as every command has it.
 *
 * The argument parser lives here until N-A moves it into args.ts; main.ts connects the command.
 */

import { realpath as realpathCallback } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  ANTHROPIC_API_KEY_ENV,
  RUNS_DEFAULT_LIMIT,
  RUNS_EXIT_CODES,
  RUNS_MAX_LIMIT,
} from "../contracts/index.js";
import type { HumanOutput, RunListing, RunsOutput } from "../contracts/index.js";
import { listRuns } from "../store/index.js";
import type { CommandOutcome, JsonOutcome } from "./guard.js";
import { STORE_RUN_REFERENCE_DEPS, resolveRunReference } from "./run-ref.js";
import { argumentsError, cliError } from "./run.js";
import { knownKeyValues } from "./settings.js";
import type { KnownKeys } from "./security/index.js";
import type { SettingsEnvironment } from "./settings.js";
import { localPathProblem } from "./task.js";
import { hideKeys } from "./text-safety.js";

const realpathNative = promisify(realpathCallback.native);

export const RUNS_USAGE = "codaryn runs [--workspace <dir>] [--limit <n>] [--json]";

export interface RunsArgs {
  readonly command: "runs";
  /** Null: the current directory. */
  readonly workspace: string | null;
  readonly limit: number;
  readonly json: boolean;
}

/**
 * U-37 (R-69 L2): an unknown or repeated option has the hint unknown_option and its `position` (the
 * argument's place after the command word, counted from 1), as the other commands' parsers (args.ts).
 */
export type ParseRunsArgsOutcome =
  | { readonly ok: true; readonly args: RunsArgs }
  | { readonly ok: false; readonly message: string; readonly hint?: "unknown_option"; readonly position?: number };

/** `codaryn runs [--workspace <dir>] [--limit <n>] [--json]`, each at most once. */
export function parseRunsArgs(argv: readonly string[]): ParseRunsArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "runs") return { ok: false, message: RUNS_USAGE };
  let workspace: string | null = null;
  let limit: number | null = null;
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index] as string;
    if (flag === "--json") {
      if (json) return { ok: false, message: `unknown or repeated option. ${RUNS_USAGE}`, hint: "unknown_option", position: index + 1 };
      json = true;
      continue;
    }
    const repeated = flag === "--workspace" ? workspace !== null : flag === "--limit" ? limit !== null : true;
    if (repeated) return { ok: false, message: `unknown or repeated option. ${RUNS_USAGE}`, hint: "unknown_option", position: index + 1 };
    const value = rest[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      return { ok: false, message: `${flag} needs a value. ${RUNS_USAGE}` };
    }
    index += 1;
    if (flag === "--workspace") {
      workspace = value;
    } else {
      if (!/^[1-9][0-9]{0,3}$/.test(value) || Number(value) > RUNS_MAX_LIMIT) {
        return { ok: false, message: `--limit must be a whole number from 1 to ${RUNS_MAX_LIMIT}. ${RUNS_USAGE}` };
      }
      limit = Number(value);
    }
  }
  return { ok: true, args: { command: "runs", workspace, limit: limit ?? RUNS_DEFAULT_LIMIT, json } };
}

type Resolved<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: JsonOutcome };

/** The workspace's real path. A network or device path is refused before the file system is touched (S-5). */
export async function resolveWorkspaceRoot(workspace: string, cwd: string): Promise<Resolved<string>> {
  const problem = localPathProblem(workspace, cwd);
  if (problem !== null) return { ok: false, error: cliError("invalid_arguments", `the path given by --workspace ${problem}`) };
  try {
    const root = await realpathNative(path.resolve(cwd, workspace));
    if (!(await lstat(root)).isDirectory()) throw new Error("not a directory");
    return { ok: true, value: root };
  } catch {
    return { ok: false, error: cliError("workspace_not_found", "the workspace is not an existing directory") };
  }
}

/**
 * The run id a `--run` value names. Any value but LATEST_RUN_ALIAS is returned as it is (args.ts
 * has already checked its form). `latest` follows the CLI's one rule, resolveRunReference with
 * the store's functions (STORE_RUN_REFERENCE_DEPS): the first checked run with a result, damaged
 * runs never chosen; a run directory literally named "latest" makes the alias ambiguous (N-18);
 * U-22 (DR-48, R-51 M-2): a newer run still going (no result, a live holder of the lock) is
 * `run_in_progress`, not the run before it. `workspaceRoot` is the real path.
 */
export async function resolveRunRef(workspaceRoot: string, ref: string): Promise<Resolved<string>> {
  const resolved = await resolveRunReference(workspaceRoot, ref, STORE_RUN_REFERENCE_DEPS);
  return resolved.ok ? { ok: true, value: resolved.runId } : { ok: false, error: cliError(resolved.code, resolved.message) };
}

export interface RunsEnvironment {
  readonly argv: readonly string[];
  readonly cwd: string;
  /** Read only to keep the current key out of the printed text. */
  readonly env: SettingsEnvironment;
  /** Renders the text list (`createHumanOutput` with the selected catalog). */
  readonly human: HumanOutput;
}

/** `codaryn runs`. Text on stdout, or RunsOutput as one JSON line with `--json`. */
export async function runRuns(io: RunsEnvironment): Promise<CommandOutcome> {
  const parsed = parseRunsArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const { limit, json } = parsed.args;

  const root = await resolveWorkspaceRoot(parsed.args.workspace ?? ".", io.cwd);
  if (!root.ok) return root.error;

  let listing: RunListing;
  try {
    listing = await listRuns({ workspaceRoot: root.value });
  } catch {
    return cliError("invalid_run_record", "the run records directory cannot be listed, or it is a link");
  }
  const output: RunsOutput = {
    schemaVersion: 1,
    kind: "runs",
    status: "listed",
    exitCode: RUNS_EXIT_CODES.listed,
    runs: listing.runs.slice(0, limit),
    omitted: Math.max(0, listing.runs.length - limit),
  };
  const currentKey = knownKeyValues(io.env);
  // N-23(a): the JSON hides key shapes and the current key too, as `report` does. Run ids and
  // task ids are names a command allowed during a run could have chosen.
  if (json) return { output: hideKeysInStrings(output, currentKey), exitCode: output.exitCode };
  return { text: hideKeys(io.human.runsText(output), currentKey), exitCode: output.exitCode };
}

/** Every string in `value` with key-shaped text and the current key hidden. */
function hideKeysInStrings<T>(value: T, currentKey: KnownKeys): T {
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return hideKeys(item, currentKey);
    if (Array.isArray(item)) return item.map(walk);
    if (typeof item === "object" && item !== null) {
      return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, walk(child)]));
    }
    return item;
  };
  return walk(value) as T;
}
