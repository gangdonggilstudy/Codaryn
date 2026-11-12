/**
 * DR-39 (DR-9, R-19 I-5): `codaryn cleanup`, seeing and cleaning up a workspace's state directory
 * with the store's summarizeState, planCleanup and applyCleanup (src/contracts/cleanup.ts).
 *
 * - A preview is the default: the state's summary and the plan for the selection (items with their
 *   warnings, what is blocked, totals, parked files, the digest). Nothing is removed.
 * - Run records are removed only with `--confirm <the plan's digest>` (MIN_PLAN_DIGEST_PREFIX or
 *   more lowercase hex). People's discarded files (`discarded/<runId>/`) need `--delete-discarded`
 *   besides: the two confirmations are apart in the same command (DR-39 P-4). The CLI checks the
 *   given digest against a plan made now; the store makes the plan again under the workspace lock
 *   and removes nothing unless its digest is the same (plan_changed).
 * - Never removed: parked files, the lock, `.gitignore`, a running run, a run without a result, and
 *   a plan run that an apply not selected uses (a revert of that apply needs it). The store blocks
 *   them; a marked run (DR-38) is not blocked but warned about (P-5).
 * - Selection: run records by `--older-than <days>`, `--run <id>[,<id>...]` and `--reverted`;
 *   discarded files by `--discarded-older-than <days>` and `--discarded-run <id>[,<id>...]`. A run
 *   is selected when it matches every criterion of its part; a part with none selects nothing.
 *   Run ids are exact (no `latest`).
 *
 * The output (CleanupOutput) is the CLI's until the contract owner takes it into the contract; it
 * holds the contract's StateSummary, CleanupPlan and CleanupOutcome as the store gives them.
 */

import { realpath as realpathCallback } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CLEANUP_BLOCK_CODES, CLEANUP_KEPT_REASONS, CLEANUP_WARNING_CODES, MIN_PLAN_DIGEST_PREFIX } from "../contracts/index.js";
import type {
  ApplyCleanup,
  CleanupOutcome,
  CleanupPlan,
  CleanupSelection,
  Clock,
  MessageCatalog,
  PlanCleanup,
  StateSize,
  StateSummary,
  SummarizeState,
} from "../contracts/index.js";
import { createMessageCatalog } from "../i18n/index.js";
import { applyCleanup as storeApplyCleanup, planCleanup as storePlanCleanup, summarizeState as storeSummarizeState } from "../store/index.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { RUN_ID_PATTERN } from "./args.js";
import { cliError } from "./run.js";
import { knownKeyValues } from "./settings.js";
import type { SettingsEnvironment } from "./settings.js";
import { localPathProblem } from "./task.js";
import { hideKeys } from "./text-safety.js";

const realpathNative = promisify(realpathCallback.native);

export const CLEANUP_USAGE =
  "codaryn cleanup --workspace <dir> [--older-than <days>] [--run <id>[,<id>...]] [--reverted] " +
  "[--discarded-older-than <days>] [--discarded-run <id>[,<id>...]] [--confirm <first 12+ hex of the digest> [--delete-discarded]] [--json]";

/** What `codaryn cleanup` prints (one JSON line with `--json`). Exit codes: 0, 1 (some kept for a problem), 3 (plan changed). */
export type CleanupOutput =
  | {
      readonly schemaVersion: 1;
      readonly kind: "cleanup";
      /** Nothing was removed. */
      readonly mode: "preview";
      readonly exitCode: 0;
      readonly summary: StateSummary;
      readonly plan: CleanupPlan;
    }
  | {
      readonly schemaVersion: 1;
      readonly kind: "cleanup";
      readonly mode: "applied";
      /** 1 when an item was kept for a reason other than `not_confirmed`. */
      readonly exitCode: 0 | 1;
      readonly outcome: Extract<CleanupOutcome, { readonly ok: true }>;
    }
  | {
      readonly schemaVersion: 1;
      readonly kind: "cleanup";
      /** The confirmed digest is not the plan's (it changed, or another plan was shown); nothing was removed. */
      readonly mode: "plan_changed";
      readonly exitCode: 3;
    };

export interface CleanupEnvironment {
  readonly argv: readonly string[];
  readonly cwd: string;
  /** Read only to keep the current key out of the printed text. */
  readonly env: SettingsEnvironment;
  readonly clock: Clock;
  /** N-4: the person's language. Absent: English. */
  readonly messages?: MessageCatalog;
  /** The store's functions (the defaults); injected by tests. */
  readonly summarizeState?: SummarizeState;
  readonly planCleanup?: PlanCleanup;
  readonly applyCleanup?: ApplyCleanup;
}

interface CleanupArgs {
  readonly workspace: string;
  readonly selection: CleanupSelection;
  readonly confirm: string | null;
  readonly deleteDiscarded: boolean;
  readonly json: boolean;
}

const VALUE_OPTIONS = ["--workspace", "--older-than", "--run", "--discarded-older-than", "--discarded-run", "--confirm"] as const;
type ValueOption = (typeof VALUE_OPTIONS)[number];
const SWITCHES = ["--reverted", "--delete-discarded", "--json"] as const;
type CleanupSwitch = (typeof SWITCHES)[number];
const DIGEST_PREFIX = /^[0-9a-f]+$/;
const DAYS = /^(0|[1-9][0-9]{0,5})$/;

function usage(message: string): { ok: false; message: string } {
  return { ok: false, message: `${message}. usage: ${CLEANUP_USAGE}` };
}

function runIdsOf(value: string, flag: string): readonly string[] | { message: string } {
  const ids = value.split(",");
  // N-27 (a): exact run directory names only; `latest` is not resolved here.
  if (ids.some((id) => !RUN_ID_PATTERN.test(id) || id === "latest")) return { message: `${flag} takes run ids separated by commas (not "latest")` };
  return [...new Set(ids)];
}

export function parseCleanupArgs(argv: readonly string[]): { ok: true; args: CleanupArgs } | { ok: false; message: string } {
  const [command, ...rest] = argv;
  if (command !== "cleanup") return usage("not the cleanup command");
  const values = new Map<ValueOption, string>();
  const switches = new Set<CleanupSwitch>();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index] as string;
    if ((SWITCHES as readonly string[]).includes(flag)) {
      if (switches.has(flag as CleanupSwitch)) return usage(`${flag} is repeated`);
      switches.add(flag as CleanupSwitch);
      continue;
    }
    if (!(VALUE_OPTIONS as readonly string[]).includes(flag) || values.has(flag as ValueOption)) return usage("unknown or repeated option");
    const value = rest[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) return usage(`${flag} needs a value`);
    values.set(flag as ValueOption, value);
    index += 1;
  }
  const workspace = values.get("--workspace");
  if (workspace === undefined) return usage("--workspace is required");

  const days = (flag: ValueOption): number | undefined | { message: string } => {
    const value = values.get(flag);
    if (value === undefined) return undefined;
    return DAYS.test(value) ? Number(value) : { message: `${flag} takes a whole number of days (0 or more)` };
  };
  const ids = (flag: ValueOption): readonly string[] | undefined | { message: string } => {
    const value = values.get(flag);
    return value === undefined ? undefined : runIdsOf(value, flag);
  };
  const olderThan = days("--older-than");
  const runIds = ids("--run");
  const discardedOlderThan = days("--discarded-older-than");
  const discardedRunIds = ids("--discarded-run");
  for (const part of [olderThan, runIds, discardedOlderThan, discardedRunIds]) {
    if (typeof part === "object" && part !== null && "message" in part) return usage(part.message);
  }
  const runs = {
    ...(typeof olderThan === "number" ? { olderThanDays: olderThan } : {}),
    ...(Array.isArray(runIds) ? { runIds } : {}),
    ...(switches.has("--reverted") ? { reverted: true as const } : {}),
  };
  const discarded = {
    ...(typeof discardedOlderThan === "number" ? { olderThanDays: discardedOlderThan } : {}),
    ...(Array.isArray(discardedRunIds) ? { runIds: discardedRunIds } : {}),
  };

  const confirm = values.get("--confirm") ?? null;
  if (confirm !== null && (!DIGEST_PREFIX.test(confirm) || confirm.length < MIN_PLAN_DIGEST_PREFIX || confirm.length > 64)) {
    return usage(`--confirm must be ${MIN_PLAN_DIGEST_PREFIX} to 64 lowercase hexadecimal characters of the plan's digest`);
  }
  const deleteDiscarded = switches.has("--delete-discarded");
  if (deleteDiscarded && confirm === null) return usage("--delete-discarded is a second confirmation and needs --confirm");
  return {
    ok: true,
    args: {
      workspace,
      selection: {
        ...(Object.keys(runs).length === 0 ? {} : { runs }),
        ...(Object.keys(discarded).length === 0 ? {} : { discarded }),
      },
      confirm,
      deleteDiscarded,
      json: switches.has("--json"),
    },
  };
}

/** `codaryn cleanup`. Text or one JSON line on stdout; errors are CliErrorOutput. */
export async function runCleanup(io: CleanupEnvironment): Promise<CommandOutcome> {
  const parsed = parseCleanupArgs(io.argv);
  if (!parsed.ok) return cliError("invalid_arguments", parsed.message);
  const { selection, confirm, deleteDiscarded, json } = parsed.args;

  // S-5: a network or device path is refused before the file system is touched.
  const problem = localPathProblem(parsed.args.workspace, io.cwd);
  if (problem !== null) return cliError("invalid_arguments", `the path given by --workspace ${problem}`);
  let workspaceRoot: string;
  try {
    workspaceRoot = await realpathNative(path.resolve(io.cwd, parsed.args.workspace));
    if (!(await lstat(workspaceRoot)).isDirectory()) throw new Error("not a directory");
  } catch {
    return cliError("workspace_not_found", "the workspace is not an existing directory");
  }

  const summarize = io.summarizeState ?? storeSummarizeState;
  const plan = io.planCleanup ?? storePlanCleanup;
  const apply = io.applyCleanup ?? storeApplyCleanup;
  const now = (): string => new Date(io.clock.now()).toISOString();

  let output: CleanupOutput;
  try {
    const shown = await plan({ workspaceRoot, selection, now: now() });
    if (confirm === null) {
      output = { schemaVersion: 1, kind: "cleanup", mode: "preview", exitCode: 0, summary: await summarize({ workspaceRoot }), plan: shown };
    } else if (!shown.digest.startsWith(confirm)) {
      output = { schemaVersion: 1, kind: "cleanup", mode: "plan_changed", exitCode: 3 };
    } else {
      const outcome = await apply({ workspaceRoot, selection, now: now(), confirmation: { digest: shown.digest, discarded: deleteDiscarded } });
      if (!outcome.ok) {
        if (outcome.code === "workspace_locked") {
          return cliError("workspace_locked", "another Codaryn process holds the workspace lock; nothing was removed");
        }
        output = { schemaVersion: 1, kind: "cleanup", mode: "plan_changed", exitCode: 3 };
      } else {
        const problem = outcome.kept.some((item) => item.reason !== "not_confirmed");
        output = { schemaVersion: 1, kind: "cleanup", mode: "applied", exitCode: problem ? 1 : 0, outcome };
      }
    }
  } catch {
    return cliError("internal_error", "the cleanup stopped because of an internal error; nothing more was removed");
  }

  const currentKey = knownKeyValues(io.env);
  const text = json ? jsonLine(output) : renderCleanup(output, io.messages ?? createMessageCatalog("en"));
  return { text: hideKeys(text, currentKey), exitCode: output.exitCode };
}

const sizeText = (size: StateSize): string => `${size.files} file(s), ${size.bytes} bytes`;

/** The person's text: the catalog's lines (cleanup.*) and the run ids and sizes. */
export function renderCleanup(output: CleanupOutput, messages: MessageCatalog): string {
  const out: string[] = [];
  if (output.mode === "plan_changed") {
    out.push(messages.format("cleanup.plan_changed"));
    return `${out.join("\n")}\n`;
  }
  if (output.mode === "applied") {
    const { removed, kept } = output.outcome;
    const runs = removed.filter((item) => item.target === "run").length;
    const folders = removed.filter((item) => item.target === "discarded").length;
    const bytes = removed.reduce((sum, item) => sum + item.size.bytes, 0);
    out.push(messages.format("cleanup.done", { runs, folders, bytes }));
    for (const item of kept) {
      const reason = (CLEANUP_KEPT_REASONS as readonly string[]).includes(item.reason) ? messages.format(`cleanup.kept.${item.reason}`) : item.reason;
      out.push(`- ${item.target} ${item.runId}: ${reason}`);
    }
    return `${out.join("\n")}\n`;
  }

  const { summary, plan } = output;
  out.push(messages.format("cleanup.summary.runs", { count: summary.runs.count, bytes: summary.runs.bytes }));
  out.push(messages.format("cleanup.summary.discarded", { files: summary.discarded.files, bytes: summary.discarded.bytes }));
  out.push(messages.format("cleanup.summary.parked", { files: summary.parked.files, bytes: summary.parked.bytes }));
  out.push("");
  if (plan.items.length === 0 && plan.blocked.length === 0) {
    out.push(messages.format("cleanup.nothing"));
    return `${out.join("\n")}\n`;
  }
  const warningText = (code: string): string =>
    (CLEANUP_WARNING_CODES as readonly string[]).includes(code) ? messages.format(`cleanup.warning.${code as (typeof CLEANUP_WARNING_CODES)[number]}`) : code;
  const itemsOf = (target: "run" | "discarded"): void => {
    for (const item of plan.items.filter((entry) => entry.target === target)) {
      const warnings = item.warnings.map(warningText);
      out.push(`- ${item.runId}: ${sizeText(item.size)}${warnings.length === 0 ? "" : `; ${warnings.join("; ")}`}`);
    }
  };
  if (plan.totals.runs.count > 0) {
    out.push(messages.format("cleanup.confirm.runs", { count: plan.totals.runs.count, bytes: plan.totals.runs.bytes }));
    itemsOf("run");
  }
  if (plan.totals.discarded.count > 0) {
    out.push(messages.format("cleanup.confirm.discarded", { files: plan.totals.discarded.files, bytes: plan.totals.discarded.bytes }));
    itemsOf("discarded");
  }
  for (const item of plan.blocked) {
    const reason = (CLEANUP_BLOCK_CODES as readonly string[]).includes(item.code) ? messages.format(`cleanup.blocked.${item.code}`) : item.code;
    out.push(`- ${item.target} ${item.runId}: ${reason}`);
  }
  if (plan.items.length > 0) {
    const digest = plan.digest.slice(0, MIN_PLAN_DIGEST_PREFIX);
    out.push("");
    // No catalog text for these yet: fixed English, as other command hints.
    out.push(`Nothing was removed. To remove the run records, run the same command with --confirm ${digest}.`);
    if (plan.totals.discarded.count > 0) out.push("People's discarded files are deleted only with --delete-discarded besides.");
  }
  return `${out.join("\n")}\n`;
}
