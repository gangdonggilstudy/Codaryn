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
 * - DR-44 (가): the records of a run not reverted, or only partly (NOT_REVERTED_WARNINGS), need
 *   `--include-not-reverted` besides (CleanupConfirmation.includeNotReverted): a confirmation apart
 *   from the other two. The preview's head line says how many such runs the plan holds
 *   (cleanup.confirm.not_reverted). Without it the store keeps them (not_reverted_not_confirmed),
 *   and a plan run whose apply stays with them (used_by_kept_apply), and removes the rest; that is
 *   the person's choice, so the command still ends with 0. They are never blocked.
 * - DR-44 (d): folders an earlier cleanup could not remove entirely (`leftover` items) are in every
 *   plan; the summary, the plan and the outcome name them. A removal that fails after the move is
 *   `partly_removed`: never reported as removed, and the command ends with 1.
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
import { CLEANUP_BLOCK_CODES, CLEANUP_KEPT_REASONS, CLEANUP_WARNING_CODES, MIN_PLAN_DIGEST_PREFIX, needsNotRevertedConfirmation } from "../contracts/index.js";
import type {
  ApplyCleanup,
  CleanupItemRef,
  CleanupKeptReason,
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
  "[--discarded-older-than <days>] [--discarded-run <id>[,<id>...]] [--confirm <first 12+ hex of the digest> [--delete-discarded] [--include-not-reverted]] [--json]";

/**
 * What `codaryn cleanup` prints (one JSON line with `--json`). Exit codes: 0, 1 (an item kept for a
 * problem, partly_removed among them), 3 (plan changed, or a confirmation missing).
 */
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
  /** DR-44 (가): the records of runs not reverted (or only partly) may go too. */
  readonly includeNotReverted: boolean;
  readonly json: boolean;
}

const VALUE_OPTIONS = ["--workspace", "--older-than", "--run", "--discarded-older-than", "--discarded-run", "--confirm"] as const;
type ValueOption = (typeof VALUE_OPTIONS)[number];
const SWITCHES = ["--reverted", "--delete-discarded", "--include-not-reverted", "--json"] as const;
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
  const includeNotReverted = switches.has("--include-not-reverted");
  if (includeNotReverted && confirm === null) return usage("--include-not-reverted is a confirmation of its own and needs --confirm");
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
      includeNotReverted,
      json: switches.has("--json"),
    },
  };
}

/** `codaryn cleanup`. Text or one JSON line on stdout; errors are CliErrorOutput. */
export async function runCleanup(io: CleanupEnvironment): Promise<CommandOutcome> {
  const parsed = parseCleanupArgs(io.argv);
  if (!parsed.ok) return cliError("invalid_arguments", parsed.message);
  const { selection, confirm, deleteDiscarded, includeNotReverted, json } = parsed.args;

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
      const outcome = await apply({
        workspaceRoot,
        selection,
        now: now(),
        confirmation: { digest: shown.digest, discarded: deleteDiscarded, includeNotReverted },
      });
      if (!outcome.ok) {
        if (outcome.code === "workspace_locked") {
          return cliError("workspace_locked", "another Codaryn process holds the workspace lock; nothing was removed");
        }
        output = { schemaVersion: 1, kind: "cleanup", mode: "plan_changed", exitCode: 3 };
      } else {
        const problem = outcome.kept.some((item) => !PERSON_CHOICES.has(item.reason));
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

/**
 * Items kept by the person's own choice (a confirmation not given, or what such a choice keeps):
 * they do not make the command fail. Every other reason does (DR-44 (d): partly_removed among them).
 * U-13: discarded_left is one of them: the apply's discarded files were not chosen or their removal
 * was not confirmed. When their removal failed, the folder's own item (partly_removed) ends it 1.
 */
const PERSON_CHOICES: ReadonlySet<CleanupKeptReason> = new Set<CleanupKeptReason>(["not_confirmed", "not_reverted_not_confirmed", "discarded_left", "used_by_kept_apply"]);

const sizeText = (size: StateSize): string => `${size.files} file(s), ${size.bytes} bytes`;

/** How an item is named: its run id, or a leftover's folder name. */
export function itemName(item: CleanupItemRef): string {
  return item.target === "leftover" ? `cleanup-${item.leftoverId}` : item.runId;
}

/** DR-44 (a): run records in the plan that go only with includeNotReverted (NOT_REVERTED_WARNINGS). */
function notRevertedRuns(plan: CleanupPlan): number {
  return plan.items.filter((item) => item.target === "run" && needsNotRevertedConfirmation(item.warnings)).length;
}

/** A catalog text, or `fallback` while this build's catalog does not have the id yet (N-B). */
function textOr(make: () => string, fallback: string): string {
  try {
    return make();
  } catch {
    return fallback;
  }
}

/** DR-44 (a): the head line under cleanup.confirm.runs. */
export function notRevertedHeadLine(messages: MessageCatalog, count: number): string {
  return textOr(
    () => messages.format("cleanup.confirm.not_reverted", { count }),
    `${count} of them not reverted, or only partly: their records go only with --include-not-reverted besides --confirm.`,
  );
}

/** The person's text: the catalog's lines (cleanup.*) and the item names and sizes. */
export function renderCleanup(output: CleanupOutput, messages: MessageCatalog): string {
  const out: string[] = [];
  const keptText = (reason: CleanupKeptReason): string =>
    (CLEANUP_KEPT_REASONS as readonly string[]).includes(reason) ? textOr(() => messages.format(`cleanup.kept.${reason}`), reason) : reason;
  if (output.mode === "plan_changed") {
    out.push(messages.format("cleanup.plan_changed"));
    return `${out.join("\n")}\n`;
  }
  if (output.mode === "applied") {
    const { removed, kept } = output.outcome;
    const runs = removed.filter((item) => item.target === "run");
    const folders = removed.filter((item) => item.target === "discarded");
    const leftovers = removed.filter((item) => item.target === "leftover");
    const bytes = [...runs, ...folders].reduce((sum, item) => sum + item.size.bytes, 0);
    // DR-44 (d): only what was removed entirely is counted.
    out.push(messages.format("cleanup.done", { runs: runs.length, folders: folders.length, bytes }));
    if (leftovers.length > 0) {
      const leftoverBytes = leftovers.reduce((sum, item) => sum + item.size.bytes, 0);
      out.push(textOr(() => messages.format("cleanup.done_leftovers", { count: leftovers.length, bytes: leftoverBytes }), `Removed what earlier cleanups left: ${leftovers.length} folder(s), ${leftoverBytes} bytes`));
    }
    // U-13 (UXM-1): apply runs whose records stay because their discarded files stay.
    const discardedLeft = kept.filter((item) => item.target === "run" && item.reason === "discarded_left").length;
    if (discardedLeft > 0) {
      out.push(
        textOr(
          () => messages.format("cleanup.done_discarded_left", { count: discardedLeft }),
          `Kept the records of ${discardedLeft} apply run(s) whose discarded files stay; they go once those applies are reverted or their discarded files are deleted too.`,
        ),
      );
    }
    for (const item of kept) out.push(`- ${item.target} ${itemName(item)}: ${keptText(item.reason)}`);
    return `${out.join("\n")}\n`;
  }

  const { summary, plan } = output;
  out.push(messages.format("cleanup.summary.runs", { count: summary.runs.count, bytes: summary.runs.bytes }));
  out.push(messages.format("cleanup.summary.discarded", { files: summary.discarded.files, bytes: summary.discarded.bytes }));
  out.push(messages.format("cleanup.summary.parked", { files: summary.parked.files, bytes: summary.parked.bytes }));
  // DR-44 (d): when above 0 (a store before DR-44 gives none).
  const leftoverSummary = summary.leftovers as StateSummary["leftovers"] | undefined;
  if (leftoverSummary !== undefined && leftoverSummary.count > 0) {
    out.push(
      textOr(
        () => messages.format("cleanup.summary.leftovers", { count: leftoverSummary.count, bytes: leftoverSummary.bytes }),
        `Folders an earlier cleanup could not remove entirely: ${leftoverSummary.count} (${leftoverSummary.bytes} bytes)`,
      ),
    );
  }
  // U-3 (R-34b P-2, R-34c L-1): folders named like a leftover but without the cleanup's mark are
  // shown only; they are never items and never removed (StateSummary.unknownFolders, absent when none).
  const unknownFolders = summary.unknownFolders;
  if (unknownFolders !== undefined && unknownFolders.count > 0) {
    out.push(
      textOr(
        () => messages.format("cleanup.summary.unknown_folders", { count: unknownFolders.count, bytes: unknownFolders.bytes }),
        `Unknown folders (named like a cleanup's leftover but without its mark; never removed): ${unknownFolders.count} (${unknownFolders.bytes} bytes)`,
      ),
    );
  }
  out.push("");
  if (plan.items.length === 0 && plan.blocked.length === 0) {
    out.push(messages.format("cleanup.nothing"));
    return `${out.join("\n")}\n`;
  }
  const warningText = (code: string): string =>
    (CLEANUP_WARNING_CODES as readonly string[]).includes(code)
      ? textOr(() => messages.format(`cleanup.warning.${code as (typeof CLEANUP_WARNING_CODES)[number]}`), code)
      : code;
  const itemsOf = (target: "run" | "discarded" | "leftover"): void => {
    for (const item of plan.items.filter((entry) => entry.target === target)) {
      const warnings = item.warnings.map(warningText);
      out.push(`- ${itemName(item)}: ${sizeText(item.size)}${warnings.length === 0 ? "" : `; ${warnings.join("; ")}`}`);
    }
  };
  const notReverted = notRevertedRuns(plan);
  const runs = plan.items.some((item) => item.target === "run");
  const discarded = plan.items.some((item) => item.target === "discarded");
  const leftoverItems = plan.items.filter((item) => item.target === "leftover");
  if (runs) {
    out.push(messages.format("cleanup.confirm.runs", { count: plan.totals.runs.count, bytes: plan.totals.runs.bytes }));
    // DR-44 (a): how many of them were not reverted, or only partly.
    if (notReverted > 0) out.push(`  ${notRevertedHeadLine(messages, notReverted)}`);
    itemsOf("run");
  }
  if (discarded) {
    out.push(messages.format("cleanup.confirm.discarded", { files: plan.totals.discarded.files, bytes: plan.totals.discarded.bytes }));
    itemsOf("discarded");
  }
  if (leftoverItems.length > 0) {
    const size = leftoverItems.reduce((sum, item) => ({ files: sum.files + item.size.files, bytes: sum.bytes + item.size.bytes }), { files: 0, bytes: 0 });
    out.push(
      textOr(
        () => messages.format("cleanup.confirm.leftovers", { count: leftoverItems.length, bytes: size.bytes }),
        `What earlier cleanups could not remove entirely goes too: ${leftoverItems.length} folder(s) (${size.bytes} bytes)`,
      ),
    );
    itemsOf("leftover");
  }
  for (const item of plan.blocked) {
    const reason = (CLEANUP_BLOCK_CODES as readonly string[]).includes(item.code) ? messages.format(`cleanup.blocked.${item.code}`) : item.code;
    out.push(`- ${item.target} ${item.runId}: ${reason}`);
  }
  if (plan.items.length > 0) {
    const digest = plan.digest.slice(0, MIN_PLAN_DIGEST_PREFIX);
    out.push("");
    // No catalog text for these: fixed English, as other command hints.
    // R-34 I-3: name what there is to confirm.
    if (runs) {
      // R-34b P-3: the offered command never carries --include-not-reverted; that confirmation is
      // the person's own, told apart with what it loses.
      out.push(`Nothing was removed. To remove the run records, run the same command with --confirm ${digest}.`);
      if (notReverted > 0) {
        out.push(
          // U-3: the three kinds the head line names (NOT_REVERTED_WARNINGS), a damaged run among them.
          `The records of ${notReverted} run(s) not reverted, only partly reverted, or whose records cannot be checked are kept unless you add --include-not-reverted yourself; once they are removed, those runs can no longer be reverted.`,
        );
      }
      if (discarded) out.push("People's discarded files are deleted only with --delete-discarded besides.");
      // U-13 (UXM-1): an apply's records stay while its discarded files do, whatever else is confirmed.
      const discardedLeft = plan.items.filter((item) => item.target === "run" && item.warnings.includes("discarded_left")).length;
      if (discardedLeft > 0) {
        out.push(
          `The records of ${discardedLeft} apply run(s) whose discarded files are still kept stay unless those files are deleted in the same cleanup (--delete-discarded, with their folders selected) or the apply is reverted first; only the records say what the files were.`,
        );
      }
    } else if (discarded) {
      out.push(`Nothing was removed. To delete the discarded files, run the same command with --confirm ${digest} --delete-discarded.`);
    } else {
      out.push(`Nothing was removed. To remove what earlier cleanups left, run the same command with --confirm ${digest}.`);
    }
  }
  return `${out.join("\n")}\n`;
}
