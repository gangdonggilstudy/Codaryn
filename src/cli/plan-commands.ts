/**
 * G-F: `codaryn plan`, `codaryn apply` and `codaryn review` (docs/design/general-tasks.md sections
 * 6 and 8; contract src/contracts/plan.ts and workflow.ts).
 *
 * All three take the task form `run` takes (DR-17) and pass the same steps 1 to 7 (`prepareTask`),
 * so they register the same secrets and resolve the same workflow. None of them sends anything to
 * a model, so a missing key or model does not stop them.
 * - plan: shows plan.json masked again with those secrets (DR-5), never the journal's copy, and
 *   says whether the workspace is over the inventory limit (DR-6). Changes nothing, takes no lock.
 * - apply: checks the approval (the digest's first characters, or a `[y/N]` question at a
 *   terminal whose default is no), takes the lock, builds ApplyDeps from the task's current policy,
 *   verifiers and secrets (DR-5), and runs `applyPlan`. One JSON line (ApplyResult) on stdout.
 * - review: writes review.json only, under the lock, for a run that ended as `awaiting_review`.
 */

import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  JOURNAL_FILE_NAME,
  MAX_PLAN_SUMMARY_CHARS,
  MAX_REPORT_FILE_BYTES,
  MIN_PLAN_DIGEST_PREFIX,
  PLAN_ACTION_KINDS,
  PLAN_EXIT_CODES,
  RESULT_FILE_NAME,
  RESULT_SCHEMA_VERSION,
  REVIEW_EXIT_CODES,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  UNSAFE_MOVE_CONSENT_ARGUMENT,
  planActionShownMatches,
  toRunId,
  toShownWorkspace,
  workflowSettingsOf,
} from "../contracts/index.js";
import type {
  AnyStoredPlan,
  ApplyJournal,
  InventoryChecker,
  ApplyJournalEntry,
  ApplyJournalEvent,
  ApplyPlan,
  ApplyResult,
  ApprovalChannel,
  ChangesPlanOutput,
  UnsafeMoveConsent,
  Clock,
  ContentHash,
  EngineResult,
  HumanOutput,
  ListRuns,
  LoadAnyPlan,
  LoadPlan,
  LoadPlanOutcome,
  MaskedPlanAction,
  MaskedText,
  MessageCatalog,
  PlanOutput,
  PrivacyGateway,
  ResolvedPlanAction,
  ReviewOutput,
  RunId,
  ShownWorkspace,
  StateUncheckedSince,
  StoredPlan,
} from "../contracts/index.js";
import { applyPlan as engineApplyPlan } from "../engine/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import {
  acquireLock,
  createApplyRecorders,
  hasRecordsChangedMark as storeHasRecordsChangedMark,
  stateUncheckedSince as storeStateUncheckedSince,
  prepareDiscardedRoot,
  inspectRun as storeInspectRun,
  isRunTimestamp,
  latestRun,
  listRuns as storeListRuns,
  loadAnyPlan as storeLoadAnyPlan,
  readReviewRecord,
  readRevertRecord,
  releaseLock,
  writeResult,
  writeReviewRecord,
} from "../store/index.js";
import type { RunInspection } from "../store/index.js";
import { createCommandRunner, createPlanExecutor, envValueFreeOfSecrets } from "../tools/index.js";
import { createIntegrityChecker, createInventoryChecker, createVerifierRunner } from "../verify/index.js";
import type { InventoryCheckerOptions } from "../verify/index.js";
import { createWorkspace } from "../workspace/index.js";
import { parseApplyArgs, parsePlanArgs, parseReviewArgs } from "./args.js";
import type { ApplyArgs, TaskFormArgs } from "./args.js";
import type { CommandOutcome } from "./guard.js";
import { jsonLine } from "./guard.js";
import { PROGRESS_PREFIX } from "./progress.js";
import { resolveRunReference } from "./run-ref.js";
import type { CheckedRun } from "./run-ref.js";
import { runPrepared } from "./run.js";
import type { CliEnvironment } from "./run.js";
import { argumentsError, cliError, prepareTask, withHint } from "../app/prepare.js";
import type { PrepareEnvironment, PreparedTask, RunArgs, RunNotes } from "../app/prepare.js";
import { createRunId } from "../app/input/run-id.js";
import { goalHoldsKey } from "../app/input/security/index.js";
import { envValue, knownKeyValues } from "../app/input/settings.js";
import type { KnownKeys } from "../app/input/security/index.js";
import { withoutEmptyStateChanged } from "./result-fields.js";
import { cleanText, hideKeys } from "../app/input/text-safety.js";
import { runGuards } from "../app/input/unreadable.js";
import { NO_GOAL, runArgsOf, notes, prepareFor, LOAD_MESSAGES, loadAny, changesView, loadShown, planRunMarked, readPlanJournal, field, planSummary, awaitingReview } from "../app/plan-view.js";
import type { PlanViewEnvironment, Prepared } from "../app/plan-view.js";

// U-306 (CLI migration C-7a): the plan view's and review's preparation and checks are the app layer's
// (src/app/plan-view.ts); these names stay for the tests (plan A).
export { NO_GOAL } from "../app/plan-view.js";
export type { PlanViewEnvironment, Prepared } from "../app/plan-view.js";
import { FINAL_MESSAGE_MAX_LINES, builtinReviewItemText, changesApplyQuestion, changesApprovalText, changesPlanOutput, displayWidth, formatLocalTime, quoteModelText, renderChangesPlan } from "./human/index.js";
import type { LoadedChangesPlan } from "./human/index.js";

/** U-21: rows of the plan's summary in the plan view, as many as the run summary gives the last message. */
const PLAN_SUMMARY_MAX_ROWS = FINAL_MESSAGE_MAX_LINES;

export interface PlanCommandEnvironment extends PlanViewEnvironment {
  readonly argv: readonly string[];
  /** U-14: the catalog of the plan view's lines (plan.*); English when absent. */
  readonly messages?: MessageCatalog;
}

/**
 * DR-1, DR-21 (PM decision on the app layer's question A-4 1): how the app layer applies for an
 * adapter (the GUI) after a person approved the plan on its screen. Only the app layer sets it;
 * the CLI's own process never does.
 * - The approval is recorded as `adapter`, never `cli-flag`. `--digest` must still be given and
 *   match: the approval names one plan.
 * - `unsafeMoveConsent` is the person's consent to this apply's unsafe moves, or null. The caller
 *   passes only what the person gave as input on screen for this one apply; never a value from a
 *   task, config, profile, plan, model or an earlier apply. Its channel must be `adapter` and its
 *   digest the full digest of the plan applied; anything else is refused before anything runs.
 * - No terminal question is asked and `--allow-unsafe-move` is refused: the person's input comes
 *   through the adapter only.
 */
export interface AdapterApply {
  readonly unsafeMoveConsent: (UnsafeMoveConsent & { readonly channel: "adapter" }) | null;
}

export interface ApplyCommandEnvironment extends PlanCommandEnvironment {
  readonly applyPlan?: ApplyPlan;
  /**
   * U-29 (R-44 R44-L1): the store's `stateUncheckedSince` (the default); injected by tests. Passed to
   * the engine as ApplyDeps.planRecordsUnchecked, which asks it once after the U-1 check. U-33: the
   * request names this apply's run id (`applyRunId`).
   */
  readonly stateUncheckedSince?: StateUncheckedSince;
  /** Set by the app layer only (AdapterApply). Absent: the CLI's channels (`--digest`, terminal). */
  readonly adapter?: AdapterApply;
  /**
   * DR-4: the parent environment of the verifiers' commands: the apply's own copy (the app layer's,
   * with its variables file loaded), filtered by CHILD_ENV_ALLOWLIST as for a run. Absent: `env`,
   * which is `process.env` in the CLI's own process (its variables file is loaded there).
   */
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
  /** DR-4: the platform the copy was made for (Windows looks names up without case). Absent: this process's. */
  readonly platform?: NodeJS.Platform;
  /**
   * Shows the question on stderr and returns the line typed, or null. Present only when stdin and
   * stderr are terminals; without it an apply needs `--digest`.
   */
  readonly ask?: (question: string) => Promise<string | null>;
  /** One line (with its line feed) to stderr; absent or `--quiet`: nothing is written. */
  readonly writeProgress?: (line: string) => void;
  /** The human renderer, for apply progress lines and the end summary (optional methods, G-A). */
  readonly human?: HumanOutput;
  readonly cancelSignal: (cancelFile: string | null) => { signal: AbortSignal; dispose(): void };
  /**
   * U-195 (DR-69 B-3, B-4): `codaryn run`'s environment, for a plan of kind "changes", whose apply is a
   * model run (runPrepared with the approved plan): the provider, the assembly, the progress lines
   * and the end summary are a run's. Absent: such a plan is not carried out here (internal_error,
   * nothing sent or written). A plan of mode apply never uses it.
   */
  readonly run?: CliEnvironment;
}

/**
 * U-36: a line from the catalog; main's English (`english`) while the catalog does not have its text
 * yet (N-B), as planViewText, and without a catalog. Never throws.
 */
function catalogLine(messages: MessageCatalog | undefined, line: (catalog: MessageCatalog) => string, english: () => string): string {
  if (messages === undefined) return english();
  try {
    return line(messages);
  } catch {
    return english();
  }
}

/** A run id for a message; not one throws, so catalogLine gives the English. */
function messageRunId(value: string): RunId {
  const runId = toRunId(value);
  if (runId === null) throw new Error("not a run id");
  return runId;
}

/** U-36: an action's kind as words (plan.action.<kind>) and what a discard says (plan.discard_kept). */
type ActionWords = { readonly [K in (typeof PLAN_ACTION_KINDS)[number]]: string } & { readonly kept: string };
const ENGLISH_ACTION_WORDS: ActionWords = { move: "move", discard: "discard", kept: "kept in .codaryn/discarded/ until removed" };

function actionWords(messages: MessageCatalog | undefined): ActionWords {
  if (messages === undefined) return ENGLISH_ACTION_WORDS;
  try {
    return { move: messages.format("plan.action.move"), discard: messages.format("plan.action.discard"), kept: messages.format("plan.discard_kept") };
  } catch {
    return ENGLISH_ACTION_WORDS;
  }
}

/**
 * One printable line per action, cleaned, keys hidden. U-36: the kind's words are padded to the
 * widest kind's, in terminal columns, and two more (English as before: `move     `, `discard  `).
 */
function actionLines(actions: readonly MaskedPlanAction[], currentKey: KnownKeys, messages?: MessageCatalog): string[] {
  const shown = (text: string): string => cleanText(hideKeys(text, currentKey));
  const words = actionWords(messages);
  const width = Math.max(...PLAN_ACTION_KINDS.map((kind) => displayWidth(words[kind]))) + 2;
  const kind = (name: (typeof PLAN_ACTION_KINDS)[number]): string => words[name] + " ".repeat(width - displayWidth(words[name]));
  return actions.map((action, index) =>
    action.kind === "move"
      ? `  ${index + 1}. ${kind("move")}${shown(action.from)}  ->  ${shown(action.to)}`
      : `  ${index + 1}. ${kind("discard")}${shown(action.path)}  (${words.kept})`,
  );
}

/** U-14: the plan view's lines the catalog has (plan.*), and their English while it does not (N-B). */
const PLAN_VIEW_TEXTS = {
  "plan.records_changed":
    "Warning: this run's records were changed by something other than the run (a records-changed mark), so this plan may not be the one the run made.",
  "plan.cannot_apply": "This plan cannot be applied. Make the plan again with a new codaryn run, read the new plan, and apply that one.",
  "plan.summary_label": "The agent's description (not part of what you approve)",
  "plan.digest_guarantee":
    "The digest names exactly these actions and the files' contents when the plan was made; apply refuses if the plan, a file or the run's records changed since.",
} as const;

function planViewText(messages: MessageCatalog | undefined, id: keyof typeof PLAN_VIEW_TEXTS): string {
  if (messages === undefined) return PLAN_VIEW_TEXTS[id];
  try {
    return (messages.format as (id: string) => string)(id);
  } catch {
    return PLAN_VIEW_TEXTS[id];
  }
}

/**
 * The text of `codaryn plan` without `--json`, and what apply's terminal question shows.
 * U-14 (UXM-6, AXM-2, AXM-15): a marked plan run has the warning first and, while pending, that it
 * cannot be applied in place of the command to apply it; the model's summary is the agent's
 * description under its label; the last line says what the digest guarantees.
 * U-36 (UXM-7): every line from the catalog (plan.heading, plan.status.<status>, plan.digest_label,
 * the action words, plan.inventory_limit, plan.applied_by with the apply's local time,
 * plan.next_apply with the digest's first characters); English as before.
 */
export function renderPlan(output: PlanOutput, currentKey: KnownKeys, messages?: MessageCatalog): string {
  const marked = output.recordsChanged === true;
  const lines = [
    ...(marked ? [planViewText(messages, "plan.records_changed")] : []),
    catalogLine(
      messages,
      (catalog) => catalog.format("plan.heading", { runId: messageRunId(output.runId), count: output.actions.length, status: catalog.format(`plan.status.${output.status}`) }),
      () => `Plan of run ${output.runId}: ${output.actions.length} action(s), ${output.status}`,
    ),
    // The digest is an item after its label (G-A: no message takes a digest).
    catalogLine(messages, (catalog) => `${catalog.format("plan.digest_label")}: ${output.digest}`, () => `Digest: ${output.digest}`),
    ...actionLines(output.actions, currentKey, messages),
  ];
  // U-21 (R-49 R49-L2, R-52 R52-L1): the model's words as the run summary draws them: the label on
  // its own line, then quoteModelText's rows (quote mark, single spaces, folded to the terminal).
  const summaryRows = output.summary === undefined ? [] : quoteModelText(hideKeys(output.summary, currentKey), PLAN_SUMMARY_MAX_ROWS);
  if (summaryRows.length > 0) lines.push(`${planViewText(messages, "plan.summary_label")}:`, ...summaryRows);
  if (output.inventoryLimitReached) {
    lines.push(
      catalogLine(
        messages,
        (catalog) => catalog.format("plan.inventory_limit"),
        () => "The workspace has more files than the inventory check can list; an apply would stop as plan_stale and move nothing.",
      ),
    );
  }
  const appliedBy = output.appliedBy;
  const prefix = output.digest.slice(0, MIN_PLAN_DIGEST_PREFIX);
  if (appliedBy !== null) {
    // UXM-23: the apply's time in local wall time, as `runs` shows times; left out when it is not a
    // run timestamp (N-24 (c)). No message takes a time.
    const time = isRunTimestamp(appliedBy.at) ? formatLocalTime(Date.parse(appliedBy.at)) : null;
    lines.push(
      catalogLine(
        messages,
        (catalog) => `${catalog.format("plan.applied_by", { runId: messageRunId(appliedBy.runId) })}${time === null ? "" : ` (${time})`}`,
        () => `Applied by run ${appliedBy.runId} at ${appliedBy.at}.`,
      ),
    );
  } else if (marked) lines.push(planViewText(messages, "plan.cannot_apply"));
  else {
    // The digest's first characters after the command (G-A: no message takes a digest).
    lines.push(
      catalogLine(
        messages,
        (catalog) => `${catalog.format("plan.next_apply", { runId: messageRunId(output.runId) })} ${prefix}`,
        () => `To apply it: codaryn apply <the same task form> --run ${output.runId} --digest ${prefix}`,
      ),
    );
  }
  lines.push(planViewText(messages, "plan.digest_guarantee"));
  return `${lines.join("\n")}\n`;
}

/** `codaryn plan ... --run <runId|latest> [--json]` (DR-5, DR-17). */
export async function runPlan(io: PlanCommandEnvironment): Promise<CommandOutcome> {
  const parsed = parsePlanArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const ready = await prepareFor(io, parsed.args.form, parsed.args.runId, null, false);
  if (!ready.ok) return ready.outcome;
  const loaded = await loadAny(io, ready.value);
  // U-195 (DR-69 B-4): a run plan (kind "changes") has its own view (U-191); a plan of mode apply, as before.
  if (loaded.ok && loaded.plan.kind === "changes") {
    const view = await changesView(io, ready.value, { plan: loaded.plan, digest: loaded.digest, applied: loaded.applied });
    if (!view.ok) return view.outcome;
    if (parsed.args.json) return { output: view.output, exitCode: view.output.exitCode };
    return { text: renderChangesPlan(view.output, knownKeyValues(io.env), io.messages), exitCode: view.output.exitCode };
  }
  const shown = await loadShown(io, ready.value, true, loaded as LoadPlanOutcome);
  if (!shown.ok) return shown.outcome;
  // U-14 (AXM-2): a marked plan run is still shown, as one that cannot be applied; its journal may
  // have been changed too, so the summary is left out.
  const marked = await planRunMarked(io, ready.value.workspaceRoot, ready.value.runId);
  const summary = marked ? null : await planSummary(io, ready.value.workspaceRoot, ready.value.runId, shown.digest, shown.privacy);
  const output: PlanOutput = { ...shown.output, ...(summary === null ? {} : { summary }), ...(marked ? { recordsChanged: true as const } : {}) };
  const currentKey = knownKeyValues(io.env);
  if (parsed.args.json) return { output, exitCode: output.exitCode };
  return { text: renderPlan(output, currentKey, io.messages), exitCode: output.exitCode };
}

const YES = new Set(["y", "yes", "예", "네"]);

/** U-36: apply's question after the plan view at a terminal (apply.question, then the [y/N] text). */
export function applyQuestion(messages?: MessageCatalog): string {
  return catalogLine(messages, (catalog) => `${catalog.format("apply.question")} ${catalog.format("prompt.yes_no_default_no")} `, () => "Apply this plan? [y/N] ");
}

/**
 * U-36: the question after an apply stopped as consent_required at a terminal (DR-21):
 * apply.unsafe_move_question, then the [y/N] text. One text for every count.
 */
export function unsafeMoveQuestion(count: number, messages?: MessageCatalog): string {
  return catalogLine(
    messages,
    (catalog) => `${catalog.format("apply.unsafe_move_question", { count })} ${catalog.format("prompt.yes_no_default_no")} `,
    () =>
      `${count} move${count === 1 ? "" : "s"} of this plan can only be made without the guarantee that nothing at the ` +
      `destination is replaced (the drive has no hard links). Nothing was moved. Apply again and make ` +
      `${count === 1 ? "it" : "them"} anyway, for this apply only? [y/N] `,
  );
}

/** `codaryn apply ... --run <planRunId> --digest <prefix> [--cancel-file <path>] [--quiet]` (6.2, 6.4). */
export async function runApply(io: ApplyCommandEnvironment): Promise<CommandOutcome> {
  const parsed = parseApplyArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const args = parsed.args;
  const ready = await prepareFor(io, args.form, args.runId, args.cancelFile, args.quiet);
  if (!ready.ok) return ready.outcome;
  const { prepared, workspaceRoot, runId: planRunId } = ready.value;
  const task = prepared.task;
  const mode = workflowSettingsOf(task).plan;
  // U-195 (DR-69 B-3, B-4): a task resolved to plan "run" carries out a run plan with a model run.
  if (mode === "run") return applyChangesPlan(io, args, ready.value);
  if (mode !== "apply") {
    // U-228: a task with no plan mode. When the run has a plan, the message names its kind and the
    // person is told to give the task the plan run used (plan_kind_differs); else as before.
    const any = await loadAny(io, ready.value);
    if (any.ok) {
      const made = any.plan.kind === "changes" ? 'a plan of files to write (plan "run")' : 'a plan of moves and discards (plan "apply")';
      return withHint(
        cliError("run_not_plan", `that run made ${made}, but the task given to apply resolves to no plan mode; give the task the plan run used; nothing was moved or run`),
        "plan_kind_differs",
      );
    }
    return cliError("run_not_plan", 'the task given to apply resolves to no plan mode (neither plan "apply" nor plan "run"); nothing was moved or run');
  }
  const loaded = await loadAny(io, ready.value);
  if (loaded.ok && loaded.plan.kind === "changes") {
    // U-228: the run has a plan, of the other kind (plan_kind_differs); the message as before.
    return withHint(
      cliError(
        "run_not_plan",
        'that run made a plan of files to write (plan "run"), but the task given to apply resolves to plan "apply"; give the task the plan run used; nothing was moved',
      ),
      "plan_kind_differs",
    );
  }
  const shown = await loadShown(io, ready.value, false, loaded as LoadPlanOutcome);
  if (!shown.ok) return shown.outcome;
  if (shown.output.appliedBy !== null) {
    return cliError("plan_already_applied", "that plan was already applied; nothing was moved. Revert the apply run to undo it");
  }
  // U-1 (R-33 R33-L3): a plan run whose records were changed by something else may hold another plan
  // than the one the person saw. It is refused before anything is asked; a mark that cannot be read
  // counts (fail closed). The engine checks again under the lock (ApplyDeps.planRecordsChanged).
  const planRecordsChanged = (): Promise<boolean> => planRunMarked(io, workspaceRoot, planRunId);
  if (await planRecordsChanged()) {
    return cliError(
      "plan_records_changed",
      "the plan run's records were changed by something other than the run (a records-changed mark), so its plan may not be the one shown; nothing was asked, recorded or moved. Make the plan again with a new codaryn run (codaryn plan only shows a plan, it does not make one)",
    );
  }

  // DR-1, DR-21: an adapter's apply (AdapterApply) has the adapter's channel only: no terminal
  // question, no consent argument, and a consent only from the person's input on its screen.
  const adapter = io.adapter;
  const ask = adapter === undefined ? io.ask : undefined;
  if (adapter !== undefined) {
    if (args.allowUnsafeMove) {
      return cliError("invalid_arguments", `an adapter's apply takes the person's consent in its request, not ${UNSAFE_MOVE_CONSENT_ARGUMENT}; nothing was moved`);
    }
    const consent = adapter.unsafeMoveConsent;
    if (consent !== null && (consent.channel !== "adapter" || consent.digest !== shown.digest)) {
      return cliError("invalid_arguments", "the consent to unsafe moves is not the adapter's consent for this plan's digest; nothing was moved");
    }
  }

  // U-131 (N5, UXM-15): a plan made with another task than this apply's is told before the
  // approval question and right after the apply's start line, not only in the end summary (the
  // engine's notice stays there). The same task id goes to the engine (ApplyDeps.planTaskId).
  const planTaskId = await planTaskIdOf(io, workspaceRoot, planRunId);
  const otherTask =
    planTaskId !== null && planTaskId !== task.id
      ? catalogLine(io.messages, (catalog) => catalog.format("apply.notice.plan_task_differs"), () => PLAN_TASK_DIFFERS_ENGLISH)
      : null;

  // Approval (6.4 1): the digest's first characters (cli-flag, or adapter for the app layer), or a
  // [y/N] question at a terminal.
  let approval: ApprovalChannel;
  if (args.digest !== null) {
    if (!shown.digest.startsWith(args.digest)) {
      return cliError("plan_not_approved", "--digest does not match the plan's digest; nothing was moved. `codaryn plan` shows it");
    }
    approval = adapter === undefined ? "cli-flag" : "adapter";
  } else if (ask !== undefined) {
    // R-18 L1: the plan view lists the workspace (the inventory limit, DR-6) only here, and the
    // apply's cancel stops that listing too. A cancel during it ends with nothing moved.
    const cancel = io.cancelSignal(args.cancelFile === null ? null : path.resolve(io.cwd, args.cancelFile));
    let inventoryLimitReached: boolean;
    try {
      inventoryLimitReached = (await (io.createInventoryChecker ?? createInventoryChecker)({ workspaceRoot, signal: cancel.signal }).capture()).limitReached;
    } catch {
      if (cancel.signal.aborted) return cliError("plan_not_approved", "the apply was cancelled before the plan was shown; nothing was moved");
      // Any other failure: the plan is shown without the limit line; the engine's own listing checks it.
      inventoryLimitReached = false;
    } finally {
      cancel.dispose();
    }
    const currentKey = knownKeyValues(io.env);
    // U-14 (AXM-15): the approval question shows the agent's description too (not part of the digest).
    const summary = await planSummary(io, workspaceRoot, planRunId, shown.digest, shown.privacy);
    const question = [
      renderPlan({ ...shown.output, inventoryLimitReached, ...(summary === null ? {} : { summary }) }, currentKey, io.messages).trimEnd(),
      ...(otherTask === null ? [] : [otherTask]),
      applyQuestion(io.messages),
    ].join("\n");
    const answer = (await ask(question))?.trim().toLowerCase() ?? "";
    if (!YES.has(answer)) return cliError("plan_not_approved", "the plan was not approved; nothing was moved");
    approval = "cli-tty";
  } else {
    return cliError("plan_not_approved", "an apply needs --digest with the plan's digest (codaryn plan shows it); nothing was moved");
  }

  /** One apply run: lock, engine, result.json, end summary. `unsafeMoves` is from its preflight record. */
  const applyOnce = async (consent: UnsafeMoveConsent | null): Promise<{ ok: true; result: ApplyResult; unsafeMoves: number } | { ok: false; outcome: CommandOutcome }> => {
    const runId = createRunId(new Date(io.clock.now()), io.randomBytes);
    const lock = await acquireLock({ workspaceRoot, runId, clock: io.clock });
    if (!lock.ok) return { ok: false, outcome: cliError("workspace_locked", "another run or revert holds the workspace; nothing was moved") };
    const cancel = io.cancelSignal(args.cancelFile === null ? null : path.resolve(io.cwd, args.cancelFile));
    let result: ApplyResult;
    let unsafeMoves = 0;
    /** U-220: the apply's lock could not be released at its end (told in its summary). */
    let lockLeft = false;
    try {
      const workspace = await createWorkspace({ root: workspaceRoot });
      const privacy = shown.privacy;
      // T-1 as in a run; DR-4: the commands' parent environment is the apply's copy, never process.env
      // behind the caller's back.
      const commandRunner = createCommandRunner({
        allowEnvValue: envValueFreeOfSecrets(privacy),
        workspaceRoot,
        parentEnv: (io.parentEnv ?? io.env) as NodeJS.ProcessEnv,
        ...(io.platform === undefined ? {} : { platform: io.platform }),
      });
      // U-210 (U-203, R-3; R-108 H-1): the apply's task's unreadable paths, for its gate, its checks and
      // its integrity checks (watched as the protected ones are), from one place (runGuards).
      const guards = runGuards(task, workspace);
      const protectedPaths = guards.protectedPaths;
      const integrity =
        protectedPaths.length > 0 || prepared.integrityPaths.length > 0
          ? createIntegrityChecker({ workspace, protectedPaths, externalPaths: prepared.integrityPaths })
          : undefined;
      // DR-38: the apply's journal and the plan run's applied mark come with the state guard that
      // knows them (the store's createApplyRecorders, the contract's CreateApplyRecorders), passed as
      // ApplyDeps.stateGuard. `runId` is this apply run; `planRunId` the plan run it carries out,
      // whose directory gets the applied mark. The journal notes each discarded file as its own.
      const recorders = createApplyRecorders({ workspaceRoot, runId, clock: io.clock, planRunId });
      const journal = observeApply(
        recorders.journal,
        privacy,
        args.quiet ? undefined : io.writeProgress,
        io.human,
        (event) => {
          if (event.type === "plan_checked") unsafeMoves = event.unsafeMoves?.length ?? 0;
        },
        (event) => (event.type === "apply_started" ? otherTask : null),
      );
      result = await (io.applyPlan ?? engineApplyPlan)({
        plan: shown.plan,
        planRunId,
        digest: shown.digest,
        approval,
        // DR-21: absent consent is none; the engine counts it only for this plan's digest.
        unsafeMoveConsent: consent,
        runId,
        taskId: task.id,
        maxDurationMs: task.limits.maxDurationMs,
        verifierConfigs: task.verifiers,
        executor: createPlanExecutor({ workspace, workspaceRoot, runId }),
        // U-182 (DR-69 B-4): the apply's task's writable lists judge each action's writes, as the
        // plan run's gate judged them when the plan was proposed (DR-5: the apply's own policy).
        // U-210 (bundle A, A-6): and its unreadable paths, under which no action moves or discards a file.
        policy: guards.gate(),
        planActions: task.policy.planActions ?? [],
        // DR-9: discarded files go to .codaryn/discarded/<apply runId>/, outside the run directories.
        discardedRoot: await prepareDiscardedRoot(workspaceRoot, runId),
        privacy,
        // U-210 (R-6; U-223): the apply's checks keep the numbers of unreadable sources out, as a run's do.
        verifiers: createVerifierRunner({ workspace, commandRunner, ...guards.verifiers }),
        // R-13 L-3: the listing stops when the apply is cancelled (it can take long near DR-6's limit).
        inventory: (io.createInventoryChecker ?? createInventoryChecker)({ workspaceRoot, signal: cancel.signal }),
        journal,
        clock: io.clock,
        signal: cancel.signal,
        ...(integrity === undefined ? {} : { integrity }),
        // At the apply clock's time (the store's markApplied uses the clock it was given).
        markApplied: () => recorders.markApplied(),
        stateGuard: recorders.stateGuard,
        // U-1: the same check under the lock, right after apply_started (a mark written since).
        planRecordsChanged,
        // U-16 (UXM-15): the task the plan run ran with; the engine tells when it is not this one.
        ...(planTaskId === null ? {} : { planTaskId }),
        // U-29: whether a run since the plan could not check the state directory (told, not refused;
        // the engine counts a rejection as unchecked). U-33 (R-56 Q-3): `applyRunId` is this apply,
        // which the store leaves out (its journal has no run_finished yet).
        planRecordsUnchecked: () => (io.stateUncheckedSince ?? storeStateUncheckedSince)({ workspaceRoot, planRunId, applyRunId: runId }),
      });
      // ApplyResult is stored as the apply run's result.json; the store's writer takes it as JSON.
      // DR-38 (PM after bf04750): an empty stateChanged is left out, in the output and in result.json.
      result = withoutEmptyStateChanged(result);
      await writeResult(workspaceRoot, result as unknown as EngineResult);
    } catch {
      return {
        ok: false,
        outcome: cliError("internal_error", "the apply stopped because of an internal error; `codaryn report` and `codaryn revert` work on what was done"),
      };
    } finally {
      // U-220 (U-176, U-201): a release that throws after its retries, or answers false, leaves the
      // lock; the apply's result and exit code stay and its summary says so, never internal_error.
      lockLeft = !(await releaseLock({ workspaceRoot, runId }).then((value) => value === true, () => false));
      cancel.dispose();
    }
    if (!args.quiet && io.writeProgress !== undefined && io.human?.applySummary !== undefined) {
      try {
        const form = args.form.input.kind === "task" ? "task" : "given";
        // DR-51 (U-38): the typed --workspace of the quick form, after the apply's own masking.
        const input = args.form.input;
        const typed = input.kind === "quick" ? input.workspace : null;
        const typedMasked = typed === null ? null : shown.privacy.mask(typed);
        const workspaceShown = typed === null || typedMasked === null ? null : toShownWorkspace(typed, typedMasked.ok ? typedMasked.text : null);
        const summary = io.human.applySummary(result, { workspaceForm: form, ...(workspaceShown === null ? {} : { workspaceShown }), ...(lockLeft ? { lockLeft: true } : {}) });
        const masked = shown.privacy.mask(summary);
        if (masked.ok) io.writeProgress(cleanText(masked.text, true));
      } catch {
        // Human output is best effort.
      }
    }
    return { ok: true, result, unsafeMoves };
  };

  // DR-21: the person's consent to unsafe moves holds for one apply and comes only from the person:
  // the CLI's own argument, or, at a terminal, the answer after an apply stopped as
  // consent_required (nothing was moved, so the plan is not applied yet and a second apply run
  // makes the moves), or the adapter's request (AdapterApply). No task, config, profile, plan or
  // model gives it.
  const givenConsent: UnsafeMoveConsent | null =
    adapter !== undefined ? adapter.unsafeMoveConsent : args.allowUnsafeMove ? { channel: "cli-flag", digest: shown.digest } : null;
  const first = await applyOnce(givenConsent);
  if (!first.ok) return first.outcome;
  let final = first;
  if (first.result.reason === "consent_required" && givenConsent === null && ask !== undefined) {
    const answer = (await ask(unsafeMoveQuestion(first.unsafeMoves, io.messages)))?.trim().toLowerCase() ?? "";
    if (YES.has(answer)) {
      const second = await applyOnce({ channel: "cli-tty", digest: shown.digest });
      if (!second.ok) return second.outcome;
      final = second;
    }
  }
  return { output: final.result, exitCode: final.result.exitCode };
}

/**
 * U-195 (PM decision 2): the goal a run plan's run is given: the plan run's own goal, the person's
 * words, as its journal recorded them (the first model request's user message, masked by the plan
 * run), in every task form. Never the model's summary (the engine tells that as the approved plan).
 * null when it cannot be read: the journal is gone or not this run's, or that message is not there.
 */
async function planRunGoal(io: PlanCommandEnvironment, workspaceRoot: string, planRunId: string): Promise<string | null> {
  try {
    const text = await (io.readJournal ?? readPlanJournal)(workspaceRoot, planRunId);
    for (const line of text.split("\n")) {
      if (line.length === 0) continue;
      const record: unknown = JSON.parse(line);
      if (field(record, "runId") !== planRunId) return null;
      if (field(record, "type") !== "model_request") continue;
      if (field(record, "turn") !== 1) return null;
      const messages = field(record, "newMessages");
      const first: unknown = Array.isArray(messages) ? messages[0] : undefined;
      const content = field(first, "content");
      return field(first, "role") === "user" && typeof content === "string" && content.trim().length > 0 ? content : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * U-195 (DR-69 B-3, B-4, B-7): `codaryn apply` of a plan of kind "changes" (the task resolves to
 * `plan: "run"`). The approval is a plan of mode apply's (DR-1: --digest, the terminal question with
 * the plan's view, the adapter's), then a model run carries the plan out: runPrepared with the
 * approved plan, whose engine (runApprovedPlan) checks every planned file, claims the plan once
 * (applied.json) and writes planned files only. The output is the run's EngineResult (planRunId,
 * planDigest). Refused before anything is asked, sent or written: a plan of the other kind
 * (run_not_plan), a plan already carried out (plan_already_applied), a records-changed mark
 * (plan_records_changed), an unsafe-move consent (it is for moves: invalid_arguments), the view's
 * checks (plan_secrets_differ), a plan run whose goal cannot be read (invalid_run_record: the run is
 * given the plan run's goal, planRunGoal, in every task form).
 * Exported for tests while U-177 has the parsers refuse plan "run", so that no task resolves to it
 * yet and runApply cannot reach this path from the command line (the refusal goes with U-187's fix).
 */
export async function applyChangesPlan(io: ApplyCommandEnvironment, args: ApplyArgs, value: Prepared): Promise<CommandOutcome> {
  const { workspaceRoot, runId: planRunId } = value;
  const loaded = await loadAny(io, value);
  if (!loaded.ok) return cliError(loaded.code, LOAD_MESSAGES[loaded.code]);
  if (loaded.plan.kind !== "changes") {
    // U-228: the run has a plan, of the other kind (plan_kind_differs); the message as before.
    return withHint(
      cliError(
        "run_not_plan",
        'that run made a plan of moves and discards (plan "apply"), but the task given to apply resolves to plan "run"; give the task the plan run used; nothing was run',
      ),
      "plan_kind_differs",
    );
  }
  const plan = loaded.plan;
  if (loaded.applied !== null) {
    return cliError("plan_already_applied", "that plan was already carried out; nothing was run. Revert the run that carried it out to undo it");
  }
  if (await planRunMarked(io, workspaceRoot, planRunId)) {
    return cliError(
      "plan_records_changed",
      "the plan run's records were changed by something other than the run (a records-changed mark), so its plan may not be the one shown; nothing was asked, sent or written. Make the plan again with a new codaryn run",
    );
  }
  const adapter = io.adapter;
  if (args.allowUnsafeMove || (adapter !== undefined && adapter.unsafeMoveConsent !== null)) {
    return cliError("invalid_arguments", `the consent to unsafe moves (${UNSAFE_MOVE_CONSENT_ARGUMENT}) is for a plan of moves; a run plan moves no file; nothing was run`);
  }
  const view = await changesView(io, value, { plan, digest: loaded.digest, applied: loaded.applied });
  if (!view.ok) return view.outcome;
  const goal = await planRunGoal(io, workspaceRoot, planRunId);
  if (goal === null) {
    return cliError("invalid_run_record", "the plan run's records do not hold the goal it was given, so its plan is not carried out; nothing was asked, sent or written");
  }
  const runIo = io.run;
  if (runIo === undefined) return cliError("internal_error", "this build cannot carry out a run plan here; nothing was sent or written");

  // U-131 (N5) as for a plan of mode apply: a plan made with another task is told before the question.
  const planTaskId = await planTaskIdOf(io, workspaceRoot, planRunId);
  const otherTask =
    planTaskId !== null && planTaskId !== value.prepared.task.id
      ? catalogLine(io.messages, (catalog) => catalog.format("apply.notice.plan_task_differs"), () => PLAN_TASK_DIFFERS_ENGLISH)
      : null;
  const ask = adapter === undefined ? io.ask : undefined;
  let approval: ApprovalChannel;
  if (args.digest !== null) {
    if (!loaded.digest.startsWith(args.digest)) return cliError("plan_not_approved", "--digest does not match the plan's digest; nothing was run. `codaryn plan` shows it");
    approval = adapter === undefined ? "cli-flag" : "adapter";
  } else if (ask !== undefined) {
    // U-228 (U-198's texts): after the plan's view, what approving starts (a run whose file tools write
    // only these files; the summary's note; the commands' note when commands are allowed), then the
    // question of a run plan, not the moves plan's apply.question.
    const question = [
      renderChangesPlan(view.output, knownKeyValues(io.env), io.messages).trimEnd(),
      ...(otherTask === null ? [] : [otherTask]),
      changesApprovalText(view.output, { commandsAllowed: value.prepared.task.policy.commands.length > 0 }, io.messages).trimEnd(),
      changesApplyQuestion(io.messages),
    ].join("\n");
    const answer = (await ask(question))?.trim().toLowerCase() ?? "";
    if (!YES.has(answer)) return cliError("plan_not_approved", "the plan was not approved; nothing was run");
    approval = "cli-tty";
  } else {
    return cliError("plan_not_approved", "an apply needs --digest with the plan's digest (codaryn plan shows it); nothing was run");
  }
  if (otherTask !== null && !args.quiet && io.writeProgress !== undefined) {
    try {
      io.writeProgress(`${cleanText(`${PROGRESS_PREFIX}${otherTask}`)}\n`);
    } catch {
      // Progress is best effort.
    }
  }
  const prepared: PreparedTask = { ...value.prepared, task: { ...value.prepared.task, goal } };
  const outcome = await runPrepared(runIo, runArgsOf(args.form, args.cancelFile, args.quiet), value.notes, prepared, {
    planRunId,
    digest: loaded.digest,
    approval,
    plan,
  });
  return { output: outcome.output, exitCode: outcome.exitCode };
}

/**
 * Writes an apply record's progress line after storing it (G-A applyProgressLine, best effort) and
 * tells `observe` of every stored shown record. Start records (`plan_item_started`) are stored only.
 */
function observeApply(
  journal: ApplyJournal,
  privacy: PrivacyGateway,
  write: ((line: string) => void) | undefined,
  human: HumanOutput | undefined,
  observe: (event: ApplyJournalEvent) => void,
  /** U-131 (N5): one more progress line after a record's own (null: none). */
  after: (event: ApplyJournalEvent) => string | null = () => null,
): ApplyJournal {
  const render = write === undefined || human?.applyProgressLine === undefined ? undefined : human.applyProgressLine.bind(human);
  return {
    async append(event: ApplyJournalEntry) {
      const stored = await journal.append(event);
      // R-9 I-4: a start record is stored for the revert only. It is not a shown record
      // (ApplyJournalEvent): neither the observer nor the renderer gets it.
      if (event.type === "plan_item_started") return stored;
      observe(event);
      if (write === undefined) return stored;
      const lines: string[] = [];
      try {
        const line = render === undefined ? null : render(event);
        if (line !== null) lines.push(line);
        const more = after(event);
        if (more !== null) lines.push(more);
      } catch {
        // Progress is best effort.
      }
      for (const line of lines) {
        try {
          const masked = privacy.mask(`${PROGRESS_PREFIX}${line}`);
          if (masked.ok) write(`${cleanText(masked.text)}\n`);
        } catch {
          // Progress is best effort.
        }
      }
      return stored;
    },
    close: () => journal.close(),
  };
}

/** U-131 (N5): the English of apply.notice.plan_task_differs, when no catalog is given. */
const PLAN_TASK_DIFFERS_ENGLISH =
  "The plan was made with another task than the one given to this apply (for example a task file, and the quick form now): the checks and rules used are this apply's, not those of the plan's task. The apply was not stopped for this. An apply with the same task form as the plan run uses that task's checks and rules.";

/**
 * U-16 (UXM-15, ApplyDeps.planTaskId): the task id the plan run ran with, as its run list entry
 * gives it (its run_started.taskId). null when it cannot be read: nothing is compared then.
 */
async function planTaskIdOf(io: PlanCommandEnvironment, workspaceRoot: string, planRunId: string): Promise<string | null> {
  try {
    const listing = await (io.listRuns ?? storeListRuns)({ workspaceRoot });
    for (const entry of listing.runs) {
      if (entry.state === "checked" && entry.runId === planRunId) return typeof entry.taskId === "string" ? entry.taskId : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * U-36: review's text without --json: the recorded line (review.recorded, or review.recorded_replaced
 * when an earlier review was replaced, with the verdict's words), the checklist as items, and
 * review.unchanged. English as before. U-131 (N3, AXM-21): `revert`, given for a rejected run that
 * changed files, adds the command that undoes them (summary.next_revert, or summary.next_revert_typed
 * with the --workspace the person typed, DR-51).
 */
export function renderReview(
  output: ReviewOutput,
  currentKey: KnownKeys,
  messages?: MessageCatalog,
  revert?: { readonly workspaceShown: ShownWorkspace | null },
): string {
  const lines = [
    catalogLine(
      messages,
      (catalog) =>
        catalog.format(output.replaced ? "review.recorded_replaced" : "review.recorded", {
          runId: messageRunId(output.runId),
          verdict: catalog.format(`review.verdict.${output.verdict}`),
        }),
      () => `Review of run ${output.runId}: ${output.verdict}${output.replaced ? " (an earlier review was replaced)" : ""}.`,
    ),
    // U-210 (R-110 L-3): a built-in task type's item in the chosen language (analyze-private's), as the end summary shows it.
    ...output.checklist.map((item, index) => `  ${index + 1}. ${(messages === undefined ? null : builtinReviewItemText(item, messages)) ?? cleanText(hideKeys(item, currentKey))}`),
    catalogLine(messages, (catalog) => catalog.format("review.unchanged"), () => "The run's result and records are unchanged; `codaryn report` shows the verdict."),
    ...(revert === undefined
      ? []
      : [
          catalogLine(
            messages,
            (catalog) =>
              revert.workspaceShown === null
                ? catalog.format("summary.next_revert", { runId: messageRunId(output.runId) })
                : catalog.format("summary.next_revert_typed", { runId: messageRunId(output.runId), workspace: revert.workspaceShown }),
            () => `Revert: codaryn revert --workspace ${revert.workspaceShown ?? "<workspace>"} --run ${output.runId}`,
          ),
        ]),
  ];
  return `${lines.join("\n")}\n`;
}

/** `codaryn review ... --run <runId|latest> (--accept | --reject) [--note <text>] [--json]` (GT-D6). */
export async function runReview(io: PlanCommandEnvironment): Promise<CommandOutcome> {
  const parsed = parseReviewArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const args = parsed.args;
  const currentKey = knownKeyValues(io.env);
  // S-8: a note is written to review.json and shown by report; a key never goes there.
  if (args.note !== null && goalHoldsKey(args.note, currentKey)) {
    return cliError("key_in_file", "the note contains a key value; nothing was written");
  }
  // R-4 L-4: without a note no secret is needed and none is read.
  const ready = await prepareFor(io, args.form, args.runId, null, false, args.note !== null);
  if (!ready.ok) return ready.outcome;
  const { prepared, workspaceRoot, runId } = ready.value;
  const review = await awaitingReview(workspaceRoot, runId);
  if (!review.ok) return review.outcome;

  let note: MaskedText | null = null;
  if (args.note !== null) {
    const masked = createPrivacyGateway({ secrets: [...prepared.secrets] }).mask(cleanText(args.note));
    if (!masked.ok) return cliError("internal_error", "the note could not be masked; nothing was written");
    note = masked.text;
  }

  const lockId = createRunId(new Date(io.clock.now()), io.randomBytes);
  const lock = await acquireLock({ workspaceRoot, runId: lockId, clock: io.clock });
  if (!lock.ok) return cliError("workspace_locked", "another run or revert holds the workspace; nothing was written");
  let replaced: boolean;
  try {
    replaced = (await readReviewRecord(workspaceRoot, runId).catch(() => null)) !== null;
    await writeReviewRecord(workspaceRoot, {
      schemaVersion: 1,
      kind: "review_record",
      runId,
      at: new Date(io.clock.now()).toISOString(),
      verdict: args.verdict,
      note,
    });
  } catch {
    return cliError("internal_error", "the review could not be written; review.json was left as it was");
  } finally {
    await releaseLock({ workspaceRoot, runId: lockId });
  }
  const output: ReviewOutput = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    kind: "review",
    runId,
    verdict: args.verdict,
    exitCode: REVIEW_EXIT_CODES[args.verdict],
    checklist: review.checklist,
    replaced,
  };
  if (args.json) return { output, exitCode: output.exitCode };
  // U-131 (N3): a rejected run that changed files: how to undo them, with the workspace as typed.
  // U-153 (R-94 I2): not when its changes were already reverted completely (the command would only
  // end as already_reverted). A record that cannot be read counts as none: the line is given.
  let revert: { readonly workspaceShown: ShownWorkspace | null } | undefined;
  const revertedFully = args.verdict === "rejected" && review.changedFiles > 0 && (await readRevertRecord(workspaceRoot, runId).catch(() => null))?.status === "complete";
  if (args.verdict === "rejected" && review.changedFiles > 0 && !revertedFully) {
    const typed = args.form.input.kind === "quick" ? args.form.input.workspace : null;
    const masked = typed === null ? null : createPrivacyGateway({ secrets: [...prepared.secrets] }).mask(typed);
    revert = { workspaceShown: typed === null || masked === null ? null : toShownWorkspace(typed, masked.ok ? masked.text : null) };
  }
  return { text: renderReview(output, currentKey, io.messages, revert), exitCode: output.exitCode };
}

/** Exposed for tests: the latest run rule the commands share with the store (N-23 b). */
export const latestPlanRule = latestRun;
/** Exposed for tests: the JSON line writer (N-19). */
export const planJsonLine = jsonLine;
