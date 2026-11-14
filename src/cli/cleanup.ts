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
 *   and removes nothing unless its digest is the same (plan_changed). U-268 (nc-human's migration
 *   preparation, C-9b (a)): both plans are made at one time, the clock read once, as the app's
 *   cleanup does; before, the store's was made at a second reading, so a run that crossed an
 *   `--older-than` boundary in between ended the command as cleanup_plan_changed.
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
 * The output is the contract's CleanupOutput (U-22, DR-48): `status` says what happened (preview,
 * removed, nothing_removed, partly_failed) and the exit code follows it (CLEANUP_EXIT_CODES);
 * `outcome.ok` is true only when something was removed and nothing was kept for a problem. A
 * confirmed digest that is not the plan's is the error cleanup_plan_changed (exit 2).
 *
 * U-34 (UXM-7, AXM-22): every line a person reads is a catalog text (cleanup.*), in their language;
 * the renderer adds only item names, run ids, and the options to type after a next-step text.
 *
 * U-319 (the CLI migration's C-9b, PM): the store's summary, plan and cleanup, the status rule and the
 * failure's code are the app layer's one copy (src/app/cleanup.ts: summaryOf, cleanupPlanOf,
 * cleanupConfirmed), which the GUI's calls use too; the workspace is the app's resolver's
 * (resolveWorkspaceRoot, S-5). The CLI keeps its arguments and their limits (the app checks its own
 * request form apart), the digest prefix matched to the plan it shows, its one output of summary and
 * plan, its texts on the codes, the renderer and the hiding of keys.
 */

import {
  CLEANUP_BLOCK_CODES,
  CLEANUP_CONFIRM_FLAGS,
  CLEANUP_EXIT_CODES,
  CLEANUP_ITEM_FATES,
  CLEANUP_KEPT_REASONS,
  CLEANUP_WARNING_CODES,
  MIN_PLAN_DIGEST_PREFIX,
  STATE_DISCARDED_WITHOUT_RECORDS,
  needsNotRevertedConfirmation,
} from "../contracts/index.js";
import type {
  ApplyCleanup,
  CleanupConfirmFlag,
  CleanupItem,
  CleanupItemFate,
  CleanupItemRef,
  CleanupKeptReason,
  CleanupOutput,
  CleanupPlan,
  CleanupSelection,
  CleanupTarget,
  Clock,
  MessageCatalog,
  PlanCleanup,
  StateSummary,
  SummarizeState,
} from "../contracts/index.js";
import { createMessageCatalog } from "../i18n/index.js";
import { lockReleaseFailedLine } from "./human/index.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { RUN_ID_PATTERN } from "./args.js";
import type { ArgsFailure } from "./args.js";
import { argumentsError, cliError } from "../app/prepare.js";
import { knownKeyValues } from "../app/input/settings.js";
import type { SettingsEnvironment } from "../app/input/settings.js";
import { hideKeys } from "../app/input/text-safety.js";
import { cleanupConfirmed, cleanupPlanOf, summaryOf } from "../app/cleanup.js";
import { resolveWorkspaceRoot } from "../app/workspace-root.js";

export const CLEANUP_USAGE =
  "codaryn cleanup --workspace <dir> [--older-than <days>] [--run <id>[,<id>...]] [--reverted] " +
  "[--discarded-older-than <days>] [--discarded-run <id>[,<id>...]] [--confirm <first 12+ hex of the digest> [--delete-discarded] [--include-not-reverted]] [--json]";

/** U-22: the contract's type, under the name the CLI's tests and the app layer used. */
export type { CleanupOutput } from "../contracts/index.js";

/** U-22 (DR-48): the confirmed digest is not the plan's; an error, not a cleanup's output. */
const PLAN_CHANGED_MESSAGE =
  "the confirmed digest is not the cleanup plan's: the state directory changed since the preview, or another preview's digest was given. Nothing was removed. Preview again and confirm its digest";

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

/** A parse failure with the usage line; U-37: with the reason's hint (and unknown_option's place). */
function usage(message: string, reason: Pick<ArgsFailure, "hint" | "position"> = {}): ArgsFailure {
  return { ok: false, message: `${message}. usage: ${CLEANUP_USAGE}`, ...reason };
}

function runIdsOf(value: string, flag: string): readonly string[] | { message: string } {
  const ids = value.split(",");
  // N-27 (a): exact run directory names only; `latest` is not resolved here.
  if (ids.some((id) => !RUN_ID_PATTERN.test(id) || id === "latest")) return { message: `${flag} takes run ids separated by commas (not "latest")` };
  return [...new Set(ids)];
}

export function parseCleanupArgs(argv: readonly string[]): { ok: true; args: CleanupArgs } | ArgsFailure {
  const [command, ...rest] = argv;
  if (command !== "cleanup") return usage("not the cleanup command", { hint: "unknown_command" });
  const values = new Map<ValueOption, string>();
  const switches = new Set<CleanupSwitch>();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index] as string;
    if ((SWITCHES as readonly string[]).includes(flag)) {
      if (switches.has(flag as CleanupSwitch)) return usage(`${flag} is repeated`, { hint: "unknown_option", position: index + 1 });
      switches.add(flag as CleanupSwitch);
      continue;
    }
    if (!(VALUE_OPTIONS as readonly string[]).includes(flag) || values.has(flag as ValueOption)) {
      return usage("unknown or repeated option", { hint: "unknown_option", position: index + 1 });
    }
    const value = rest[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) return usage(`${flag} needs a value`);
    values.set(flag as ValueOption, value);
    index += 1;
  }
  const workspace = values.get("--workspace");
  if (workspace === undefined) return usage("--workspace is required. If you mean the current directory, give --workspace .");

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
    if (typeof part === "object" && part !== null && "message" in part) {
      // U-37 (R-69 L2, PM): the --run form error is run_id_form, as other commands' --run is. Not
      // --discarded-run: the hint names --run.
      return usage(part.message, part === runIds ? { hint: "run_id_form" } : {});
    }
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
    return usage(`--confirm must be ${MIN_PLAN_DIGEST_PREFIX} to 64 lowercase hexadecimal characters of the plan's digest`, { hint: "digest_form" });
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
  if (!parsed.ok) return argumentsError(parsed);
  const { selection, confirm, deleteDiscarded, includeNotReverted, json } = parsed.args;

  // S-5: a network or device path is refused before the file system is touched (U-319: the app's
  // resolver, with the same texts).
  const root = await resolveWorkspaceRoot(parsed.args.workspace, io.cwd);
  if (!root.ok) return root.error;
  const workspaceRoot = root.value;

  // U-268: one reading of the clock for the plan shown and the store's plan under the lock (the
  // request's time selects by age only; the cleanup record's time is the store's own).
  const now = new Date(io.clock.now()).toISOString();

  let output: CleanupOutput;
  try {
    // U-319: the app's one copy, with the store's functions the tests give (io).
    const shown = await cleanupPlanOf(workspaceRoot, selection, now, io);
    if (confirm === null) {
      output = { schemaVersion: 1, kind: "cleanup", status: "preview", exitCode: CLEANUP_EXIT_CODES.preview, summary: await summaryOf(workspaceRoot, io), plan: shown };
    } else if (!shown.digest.startsWith(confirm)) {
      return cliError("cleanup_plan_changed", PLAN_CHANGED_MESSAGE);
    } else {
      const done = await cleanupConfirmed(workspaceRoot, selection, now, { digest: shown.digest, discarded: deleteDiscarded, includeNotReverted }, io);
      if (!done.ok) {
        if (done.code === "workspace_locked") {
          return cliError("workspace_locked", "another Codaryn process holds the workspace lock; nothing was removed");
        }
        return cliError("cleanup_plan_changed", PLAN_CHANGED_MESSAGE);
      } else {
        // U-22 (DR-48, AXM-3): the status and ok are the one copy's (the contract's one rule).
        output = { schemaVersion: 1, kind: "cleanup", status: done.status, exitCode: CLEANUP_EXIT_CODES[done.status], outcome: done.outcome };
      }
    }
  } catch {
    return cliError("internal_error", "the cleanup stopped because of an internal error; nothing more was removed");
  }

  const currentKey = knownKeyValues(io.env);
  // U-86: with no selection option the preview offers example commands.
  const text = json ? jsonLine(output) : renderCleanup(output, io.messages ?? createMessageCatalog("en"), { selected: Object.keys(selection).length > 0 });
  return { text: hideKeys(text, currentKey), exitCode: output.exitCode };
}

/** How an item is named: its run id, or a leftover's folder name. */
export function itemName(item: CleanupItemRef): string {
  return item.target === "leftover" ? `cleanup-${item.leftoverId}` : item.runId;
}

/** U-86: the flag a person types for each confirmation besides --confirm. */
const CONFIRM_FLAG_ARGUMENT: { readonly [F in CleanupConfirmFlag]: string } = {
  include_not_reverted: "--include-not-reverted",
  delete_discarded: "--delete-discarded",
};

/**
 * U-86: an item's fate, the store's (CleanupPlan's CLEANUP_ITEM_FATES) or, from a store before U-86,
 * by its kind as the contract says: a run's records with a NOT_REVERTED_WARNINGS code need
 * include_not_reverted, a discarded-files folder delete_discarded, anything else nothing.
 */
function fateOf(plan: CleanupPlan, index: number, item: CleanupItem): CleanupItemFate {
  const fates = plan[CLEANUP_ITEM_FATES];
  const given = fates !== undefined && fates.length === plan.items.length ? fates[index] : undefined;
  if (given !== undefined) return given;
  if (item.target === "run" && needsNotRevertedConfirmation(item.warnings)) return { removedWith: ["include_not_reverted"] };
  if (item.target === "discarded") return { removedWith: ["delete_discarded"] };
  return { removedWith: [] };
}

/**
 * U-86: the preview's groups, in order, each named by its text (cleanup.group.<group>). R-76 M-1
 * (PM): an item that needs both flags has a group of its own, so each group holds what goes with
 * exactly its flags: a confirmation removes the confirm group's items and those of each group whose
 * flags it gives (both only with both). The blocked items follow them, under their own line (L-1).
 */
const GROUPS = ["confirm", "include_not_reverted", "delete_discarded", "both", "kept"] as const;
type Group = (typeof GROUPS)[number];

function groupOf(fate: CleanupItemFate): Group {
  if ("keptFor" in fate) return "kept";
  const notReverted = fate.removedWith.includes("include_not_reverted");
  const discarded = fate.removedWith.includes("delete_discarded");
  if (notReverted && discarded) return "both";
  if (discarded) return "delete_discarded";
  return notReverted ? "include_not_reverted" : "confirm";
}

/**
 * The person's text: the catalog's lines (cleanup.*) and the item names and sizes. U-86 (UXM-10):
 * the preview groups the items by what must be given for each to go; `selected` (default true):
 * whether a selection option was given, without which it offers example commands.
 * U-257 (U-201): a confirmed cleanup that finished but could not release the workspace lock
 * (CleanupOutcome.lockLeft, in the JSON since U-201) ends with lock.release_failed
 * (lockReleaseFailedLine), as a run's, an apply's and a revert's summaries do; never otherwise.
 */
export function renderCleanup(output: CleanupOutput, messages: MessageCatalog, options: { readonly selected?: boolean } = {}): string {
  const out: string[] = [];
  const keptText = (reason: CleanupKeptReason): string =>
    (CLEANUP_KEPT_REASONS as readonly string[]).includes(reason) ? messages.format(`cleanup.kept.${reason}`) : reason;
  // U-34: the kind of an item named in a kept or blocked line.
  const targetName = (target: CleanupTarget): string => messages.format(`cleanup.target.${target}`);
  if (output.status !== "preview") {
    const { removed, kept } = output.outcome;
    // U-22: a confirmed cleanup that removed nothing says so first.
    if (output.status === "nothing_removed") out.push(messages.format("cleanup.nothing_removed"));
    const runs = removed.filter((item) => item.target === "run");
    const folders = removed.filter((item) => item.target === "discarded");
    const leftovers = removed.filter((item) => item.target === "leftover");
    const bytes = [...runs, ...folders].reduce((sum, item) => sum + item.size.bytes, 0);
    // DR-44 (d): only what was removed entirely is counted.
    if (output.status !== "nothing_removed") out.push(messages.format("cleanup.done", { runs: runs.length, folders: folders.length, bytes }));
    if (leftovers.length > 0) {
      const leftoverBytes = leftovers.reduce((sum, item) => sum + item.size.bytes, 0);
      out.push(messages.format("cleanup.done_leftovers", { count: leftovers.length, bytes: leftoverBytes }));
    }
    // U-13 (UXM-1): apply runs whose records stay because their discarded files stay.
    const discardedLeft = kept.filter((item) => item.target === "run" && item.reason === "discarded_left").length;
    if (discardedLeft > 0) out.push(messages.format("cleanup.done_discarded_left", { count: discardedLeft }));
    for (const item of kept) out.push(`- ${targetName(item.target)} ${itemName(item)}: ${keptText(item.reason)}`);
    // U-257: the lock this cleanup could not release, last; only then, so every other text is as before.
    const lockLine = lockReleaseFailedLine(output.outcome.lockLeft, messages);
    if (lockLine !== null) out.push(lockLine);
    return `${out.join("\n")}\n`;
  }

  const { summary, plan } = output;
  out.push(messages.format("cleanup.summary.runs", { count: summary.runs.count, bytes: summary.runs.bytes }));
  out.push(messages.format("cleanup.summary.discarded", { files: summary.discarded.files, bytes: summary.discarded.bytes }));
  // U-86 (the rest of UXM-1): discarded files whose run has no records left, when there are any.
  const recordless = summary[STATE_DISCARDED_WITHOUT_RECORDS];
  if (recordless !== undefined && recordless.count > 0) {
    out.push(messages.format("cleanup.summary.discarded_without_records", { count: recordless.count, bytes: recordless.bytes }));
  }
  out.push(messages.format("cleanup.summary.parked", { files: summary.parked.files, bytes: summary.parked.bytes }));
  // DR-44 (d): when above 0 (a store before DR-44 gives none).
  const leftoverSummary = summary.leftovers as StateSummary["leftovers"] | undefined;
  if (leftoverSummary !== undefined && leftoverSummary.count > 0) {
    out.push(messages.format("cleanup.summary.leftovers", { count: leftoverSummary.count, bytes: leftoverSummary.bytes }));
  }
  // U-3 (R-34b P-2, R-34c L-1): folders named like a leftover but without the cleanup's mark are
  // shown only; they are never items and never removed (StateSummary.unknownFolders, absent when none).
  const unknownFolders = summary.unknownFolders;
  if (unknownFolders !== undefined && unknownFolders.count > 0) {
    out.push(messages.format("cleanup.summary.unknown_folders", { count: unknownFolders.count, bytes: unknownFolders.bytes }));
  }
  out.push("");
  const selected = options.selected ?? true;
  if (selected && plan.items.length === 0 && plan.blocked.length === 0) {
    out.push(messages.format("cleanup.nothing"));
    return `${out.join("\n")}\n`;
  }
  const warningText = (code: string): string =>
    (CLEANUP_WARNING_CODES as readonly string[]).includes(code)
      ? messages.format(`cleanup.warning.${code as (typeof CLEANUP_WARNING_CODES)[number]}`)
      : code;
  // U-86: each item with its fate, grouped in GROUPS order; items keep the plan's order in a group.
  const placed = plan.items.map((item, index) => ({ item, fate: fateOf(plan, index, item) }));
  for (const group of GROUPS) {
    const members = placed.filter(({ fate }) => groupOf(fate) === group);
    if (members.length === 0) continue;
    const files = members.reduce((sum, { item }) => sum + item.size.files, 0);
    const bytes = members.reduce((sum, { item }) => sum + item.size.bytes, 0);
    const count = members.length;
    if (group === "kept") out.push(messages.format("cleanup.group.kept", { count }));
    else if (group === "delete_discarded" || group === "both") out.push(messages.format(`cleanup.group.${group}`, { count, files, bytes }));
    else out.push(messages.format(`cleanup.group.${group}`, { count, bytes }));
    for (const { item, fate } of members) {
      // The kind is named: one group can hold an apply run's records and its discarded files.
      const size = messages.format("cleanup.size", { files: item.size.files, bytes: item.size.bytes });
      out.push(`- ${targetName(item.target)} ${itemName(item)}: ${size}`);
      // One line per warning; a kept item says why it stays (its removal warnings do not apply).
      if ("keptFor" in fate) out.push(`  ${keptText(fate.keptFor)}`);
      else for (const code of item.warnings) out.push(`  ${warningText(code)}`);
    }
  }
  // R-76 L-1 (PM): what cannot be removed in this cleanup, last and under its own line, so it is not
  // read as one of the group above.
  if (plan.blocked.length > 0) out.push(messages.format("cleanup.group.blocked", { count: plan.blocked.length }));
  for (const item of plan.blocked) {
    const reason = (CLEANUP_BLOCK_CODES as readonly string[]).includes(item.code) ? messages.format(`cleanup.blocked.${item.code}`) : item.code;
    out.push(`- ${targetName(item.target)} ${item.runId}: ${reason}`);
  }
  if (plan.items.length > 0) {
    // R-34 I-3, U-34 (G-A), U-86: no text takes the digest; the options to type follow the text on
    // the same line, one space apart, so they can be copied. --confirm alone when something goes
    // with it; every flag some item needs (CLEANUP_CONFIRM_FLAGS order) when one does.
    const confirm = `--confirm ${plan.digest.slice(0, MIN_PLAN_DIGEST_PREFIX)}`;
    const needed = CLEANUP_CONFIRM_FLAGS.filter((flag) => placed.some(({ fate }) => "removedWith" in fate && fate.removedWith.includes(flag)));
    out.push("");
    if (placed.some(({ fate }) => groupOf(fate) === "confirm")) out.push(`${messages.format("cleanup.command.confirm")} ${confirm}`);
    if (needed.length > 0) out.push(`${messages.format("cleanup.command.all")} ${[confirm, ...needed.map((flag) => CONFIRM_FLAG_ARGUMENT[flag])].join(" ")}`);
  }
  if (!selected) {
    // U-86: with nothing selected, what to type to select (leftovers, always in a plan, show above).
    if (plan.items.length > 0 || plan.blocked.length > 0) out.push("");
    out.push(messages.format("cleanup.no_selection"), `  ${messages.format("cleanup.example.older_than")}`, `  ${messages.format("cleanup.example.reverted")}`);
  }
  return `${out.join("\n")}\n`;
}
