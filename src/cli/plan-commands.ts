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

import { MIN_PLAN_DIGEST_PREFIX, PLAN_ACTION_KINDS, toRunId, toShownWorkspace, workflowSettingsOf } from "../contracts/index.js";
import type { HumanOutput, JournalRecord, MaskedPlanAction, MessageCatalog, PlanOutput, PrivacyGateway, ReviewOutput, RunId, ShownWorkspace } from "../contracts/index.js";
import type { ApplyApprovalView, ApplyFacts, ApplyLifeHooks } from "../contracts/app.js";
import { isRunTimestamp, latestRun } from "../store/index.js";
import { applyLife } from "../app/apply-life.js";
import type { ApplyLifeAdapter, ApplyLifeEnvironment } from "../app/apply-life.js";
import { parseApplyArgs, parsePlanArgs, parseReviewArgs } from "./args.js";
import type { ApplyArgs } from "./args.js";
import type { CommandOutcome } from "./guard.js";
import { jsonLine } from "./guard.js";
import { PROGRESS_PREFIX } from "./progress.js";
import { createRunDisplay } from "./run.js";
import type { CliEnvironment } from "./run.js";
import { argumentsError, cliError, withHint } from "../app/prepare.js";
import { knownKeyValues } from "../app/input/settings.js";
import type { KnownKeys } from "../app/input/security/index.js";
import { cleanText, hideKeys } from "../app/input/text-safety.js";
import { LOAD_MESSAGES, loadAny, runArgsOf, prepareFor, recordReview, showPlan } from "../app/plan-view.js";
import type { PlanViewEnvironment, Prepared } from "../app/plan-view.js";

// U-306 (CLI migration C-7a): the plan view's and review's preparation and checks are the app layer's
// (src/app/plan-view.ts); these names stay for the tests (plan A).
export { NO_GOAL } from "../app/plan-view.js";
export type { PlanViewEnvironment, Prepared } from "../app/plan-view.js";
import { FINAL_MESSAGE_MAX_LINES, builtinReviewItemText, changesApplyQuestion, changesApprovalText, displayWidth, formatLocalTime, quoteModelText, renderChangesPlan } from "./human/index.js";

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
export type AdapterApply = ApplyLifeAdapter;

/** U-320: the app owns the life fields; the CLI adds only its drawing/input fields. */
export interface ApplyCommandEnvironment extends PlanCommandEnvironment, ApplyLifeEnvironment {
  /** Present only when stdin and stderr are terminals. */
  readonly ask?: (question: string) => Promise<string | null>;
  /** One line (with its line feed) to stderr; absent or --quiet: no progress. */
  readonly writeProgress?: (line: string) => void;
  readonly human?: HumanOutput;
  /** The carrying run's CLI drawing fields extend the app's RunLifeEnvironment. */
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
  // U-306 (C-7a): the plan view's rules are the app layer's (showPlan); the JSON line and the text are the CLI's.
  const shown = await showPlan(io, parsed.args.form, parsed.args.runId);
  if (!shown.ok) return shown.outcome;
  if (parsed.args.json) return { output: shown.output, exitCode: shown.output.exitCode };
  const currentKey = knownKeyValues(io.env);
  // U-195 (DR-69 B-4): a run plan (kind "changes") has its own view (U-191); a plan of mode apply, as before.
  if (shown.kind === "changes") return { text: renderChangesPlan(shown.output, currentKey, io.messages), exitCode: shown.output.exitCode };
  return { text: renderPlan(shown.output, currentKey, io.messages), exitCode: shown.output.exitCode };
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
  return applyThroughApp(io, args, ready.value);
}

/** Compatibility entry point: the caller already prepared a task with plan "run" (plan A). */
export async function applyChangesPlan(io: ApplyCommandEnvironment, args: ApplyArgs, value: Prepared): Promise<CommandOutcome> {
  // Even callers outside that precondition must never turn this changes-only helper into a
  // moves/discards lifetime. Supported calls keep applyLife's existing single read and order.
  if (workflowSettingsOf(value.prepared.task).plan !== "run") {
    const loaded = await loadAny(io, value);
    if (!loaded.ok) return cliError(loaded.code, LOAD_MESSAGES[loaded.code]);
    if (loaded.plan.kind !== "changes") {
      return withHint(
        cliError(
          "run_not_plan",
          'that run made a plan of moves and discards (plan "apply"), but the task given to apply resolves to plan "run"; give the task the plan run used; nothing was run',
        ),
        "plan_kind_differs",
      );
    }
  }
  return applyThroughApp(io, args, value);
}

/** U-320 (C-7b): one app life; the CLI supplies only questions and drawing. */
async function applyThroughApp(io: ApplyCommandEnvironment, args: ApplyArgs, value: Prepared): Promise<CommandOutcome> {
  const write = args.quiet ? undefined : io.writeProgress;
  const ask = io.adapter === undefined ? io.ask : undefined;
  let facts = null as ApplyFacts | null;
  let otherTask = null as string | null;
  let announcedRun = false;
  // U-309 deliberately turns hook failures into no. The old CLI instead rejected a failed ask
  // (including its question renderer): remember it and rethrow after the life has cleaned up.
  let questionFailed = false;
  let questionError: unknown;
  const question = async (render: () => string): Promise<boolean> => {
    try {
      const answer = (await ask!(render()))?.trim().toLowerCase() ?? "";
      return YES.has(answer);
    } catch (error) {
      questionFailed = true;
      questionError = error;
      return false;
    }
  };
  const announceRun = (): void => {
    if (announcedRun) return;
    announcedRun = true;
    if (otherTask !== null && write !== undefined) {
      try { write(cleanText(PROGRESS_PREFIX + otherTask) + "\n"); } catch { /* Progress is best effort. */ }
    }
  };
  const runIo = io.run;
  const display = runIo === undefined || workflowSettingsOf(value.prepared.task).plan !== "run"
    ? undefined
    : createRunDisplay(runIo, runArgsOf(args.form, args.cancelFile, args.quiet), value.notes, value.prepared.defaultDisplay);
  let runPrivacy = null as PrivacyGateway | null;
  const hooks: ApplyLifeHooks = {
    ready(ready) {
      facts = ready;
      otherTask = ready.otherTask
        ? catalogLine(io.messages, (catalog) => catalog.format("apply.notice.plan_task_differs"), () => PLAN_TASK_DIFFERS_ENGLISH)
        : null;
    },
    ...(ask === undefined ? {} : {
      approve: (view: ApplyApprovalView) => question(() => {
        const key = knownKeyValues(io.env);
        return view.kind === "moves"
          ? [renderPlan(view.plan, key, io.messages).trimEnd(), ...(otherTask === null ? [] : [otherTask]), applyQuestion(io.messages)].join("\n")
          : [renderChangesPlan(view.plan, key, io.messages).trimEnd(), ...(otherTask === null ? [] : [otherTask]), changesApprovalText(view.plan, { commandsAllowed: view.commandsAllowed }, io.messages).trimEnd(), changesApplyQuestion(io.messages)].join("\n");
      }),
      consentToUnsafeMoves: (count: number) => question(() => unsafeMoveQuestion(count, io.messages)),
    }),
    observer: {
      onStoredRecord(record) {
        if (write === undefined || facts === null) return;
        const lines: string[] = [];
        try {
          const line = io.human?.applyProgressLine?.(record) ?? null;
          if (line !== null) lines.push(line);
          if (record.type === "apply_started" && otherTask !== null) lines.push(otherTask);
        } catch { /* Progress is best effort. */ }
        for (const line of lines) {
          try {
            const masked = facts.mask(PROGRESS_PREFIX + line);
            if (masked !== null) write(cleanText(masked) + "\n");
          } catch { /* Progress is best effort. */ }
        }
      },
      ...(display === undefined ? {} : {
        onStoredRunRecord: (record: JournalRecord) => display.observer.onStoredRecord?.(record),
        ...(display.observer.confirm === undefined ? {} : { confirm: display.observer.confirm }),
      }),
    },
    applyEnded({ result, lockLeft }) {
      if (write === undefined || io.human?.applySummary === undefined || facts === null) return;
      try {
        const input = args.form.input;
        const typed = input.kind === "quick" ? input.workspace : null;
        const workspaceShown = typed === null ? null : toShownWorkspace(typed, facts.mask(typed));
        const summary = io.human.applySummary(result, {
          workspaceForm: input.kind === "task" ? "task" : "given",
          ...(workspaceShown === null ? {} : { workspaceShown }),
          ...(lockLeft ? { lockLeft: true } : {}),
        });
        const masked = facts.mask(summary);
        if (masked !== null) write(cleanText(masked, true));
      } catch { /* Human output is best effort. */ }
    },
    runReady() {
      announceRun();
      if (runPrivacy !== null) display?.ready(runPrivacy);
    },
  };
  const end = await applyLife({
    ...io,
    ...(runIo === undefined ? {} : { run: {
      ...runIo,
      // Capture the same gateway for drawing only. applyLife alone wraps this journal and runs
      // the engine; there is no second runPrepared/runLife call and no second CLI event wrapper.
      assemble: async (input) => {
        const assembled = await runIo.assemble(input);
        if (assembled.ok) runPrivacy = assembled.deps.privacy;
        return assembled;
      },
    } }),
  }, args, value, hooks);
  if (questionFailed) throw questionError;
  if (end.kind === "error") return end.outcome;
  if (end.kind === "applied") return { output: end.result, exitCode: end.result.exitCode };
  // carried means approval succeeded, even if runLife refused before runReady (e.g. a lock).
  // The old CLI wrote this notice before trying the run; failed approval must not write it.
  announceRun();
  return display!.finish(end.end);
}

/** U-131 (N5): the English of apply.notice.plan_task_differs, when no catalog is given. */
const PLAN_TASK_DIFFERS_ENGLISH =
  "The plan was made with another task than the one given to this apply (for example a task file, and the quick form now): the checks and rules used are this apply's, not those of the plan's task. The apply was not stopped for this. An apply with the same task form as the plan run uses that task's checks and rules.";

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
  // U-306 (C-7a): the review's rules are the app layer's (recordReview); the JSON line and the text are
  // the CLI's. The revert line is asked for only when the text is shown, as before.
  const recorded = await recordReview(io, { form: args.form, run: args.runId, verdict: args.verdict, note: args.note, revertLine: !args.json });
  if (!recorded.ok) return recorded.outcome;
  if (args.json) return { output: recorded.output, exitCode: recorded.output.exitCode };
  return { text: renderReview(recorded.output, currentKey, io.messages, recorded.revert), exitCode: recorded.output.exitCode };
}

/** Exposed for tests: the latest run rule the commands share with the store (N-23 b). */
export const latestPlanRule = latestRun;
/** Exposed for tests: the JSON line writer (N-19). */
export const planJsonLine = jsonLine;
