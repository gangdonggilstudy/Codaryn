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
  PLAN_EXIT_CODES,
  RESULT_FILE_NAME,
  RESULT_SCHEMA_VERSION,
  REVIEW_EXIT_CODES,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  UNSAFE_MOVE_CONSENT_ARGUMENT,
  planActionShownMatches,
  workflowSettingsOf,
} from "../contracts/index.js";
import type {
  ApplyJournal,
  InventoryChecker,
  ApplyJournalEntry,
  ApplyJournalEvent,
  ApplyPlan,
  ApplyResult,
  ApprovalChannel,
  UnsafeMoveConsent,
  Clock,
  ContentHash,
  EngineResult,
  HumanOutput,
  ListRuns,
  LoadPlan,
  MaskedPlanAction,
  MaskedText,
  MessageCatalog,
  PlanOutput,
  PrivacyGateway,
  ResolvedPlanAction,
  ReviewOutput,
  StateUncheckedSince,
  StoredPlan,
} from "../contracts/index.js";
import { applyPlan as engineApplyPlan } from "../engine/index.js";
import { createPolicyGate } from "../policy/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import {
  acquireLock,
  createApplyRecorders,
  hasRecordsChangedMark as storeHasRecordsChangedMark,
  stateUncheckedSince as storeStateUncheckedSince,
  prepareDiscardedRoot,
  inspectRun as storeInspectRun,
  latestRun,
  listRuns as storeListRuns,
  loadPlan as storeLoadPlan,
  readReviewRecord,
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
import type { RunArgs, TaskFormArgs } from "./args.js";
import type { CommandOutcome } from "./guard.js";
import { jsonLine } from "./guard.js";
import { PROGRESS_PREFIX } from "./progress.js";
import { resolveRunReference } from "./run-ref.js";
import type { CheckedRun } from "./run-ref.js";
import { argumentsError, cliError, prepareTask } from "./run.js";
import type { PrepareEnvironment, PreparedTask, RunNotes } from "./run.js";
import { createRunId } from "./run-id.js";
import { goalHoldsKey } from "./security/index.js";
import { envValue, knownKeyValues } from "./settings.js";
import type { KnownKeys } from "./security/index.js";
import { withoutEmptyStateChanged } from "./result-fields.js";
import { cleanText, hideKeys } from "./text-safety.js";
import { FINAL_MESSAGE_MAX_LINES, quoteModelText } from "./human/index.js";

/** U-21: rows of the plan's summary in the plan view, as many as the run summary gives the last message. */
const PLAN_SUMMARY_MAX_ROWS = FINAL_MESSAGE_MAX_LINES;

/** The goal the task form carries for commands that never run a model. */
export const NO_GOAL = "(no goal: plan, apply and review do not run a model)";

export interface PlanCommandEnvironment extends PrepareEnvironment {
  readonly argv: readonly string[];
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
  /** Overrides for tests; the store's functions otherwise. */
  readonly listRuns?: ListRuns;
  readonly loadPlan?: LoadPlan;
  /** The workspace listing (verify's `createInventoryChecker` when absent). Tests count its listings. */
  readonly createInventoryChecker?: (options: InventoryCheckerOptions) => InventoryChecker;
  readonly inspectRun?: (workspaceRoot: string, runId: string) => Promise<RunInspection>;
  /** N-23: told which run `--run latest` chose, before anything is read. */
  readonly announceLatest?: (entry: CheckedRun) => void;
  /**
   * U-1, U-14: the store's `hasRecordsChangedMark` (the default); injected by tests. `plan` shows a
   * marked plan run with a warning and without the command to apply it; `apply` asks for the plan
   * run before anything is asked of the person, and passes it to the engine for its check under the
   * lock. A rejection counts as a mark.
   */
  readonly hasRecordsChangedMark?: (workspaceRoot: string, runId: string) => Promise<boolean>;
  /** U-14 (AXM-15): the plan run's journal text, for the model's summary only; the file otherwise. */
  readonly readJournal?: (workspaceRoot: string, runId: string) => Promise<string>;
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
}

/** The RunArgs `prepareTask` takes for a task form. */
function runArgsOf(form: TaskFormArgs, cancelFile: string | null, quiet: boolean): RunArgs {
  return {
    command: "run",
    input: form.input.kind === "task" ? form.input : { kind: "quick", workspace: form.input.workspace, goal: NO_GOAL, oneLine: false },
    configPath: form.configPath,
    varsFile: form.varsFile,
    cancelFile,
    quiet,
    profile: form.profile,
    workflow: form.workflow,
  };
}

function notes(): RunNotes {
  return { configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0 };
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

/** Masks a stored action's paths with the command's secrets (DR-5). Null when masking fails. */
function maskAction(action: ResolvedPlanAction, privacy: PrivacyGateway): MaskedPlanAction | null {
  const mask = (text: string): MaskedText | null => {
    const masked = privacy.mask(text);
    return masked.ok ? masked.text : null;
  };
  if (action.kind === "move") {
    const from = mask(action.from);
    const to = mask(action.to);
    return from === null || to === null ? null : { kind: "move", from, to, sha256: action.sha256 };
  }
  const where = mask(action.path);
  return where === null ? null : { kind: "discard", path: where, sha256: action.sha256 };
}

/** One printable line per action, cleaned, keys hidden. */
function actionLines(actions: readonly MaskedPlanAction[], currentKey: KnownKeys): string[] {
  const shown = (text: string): string => cleanText(hideKeys(text, currentKey));
  return actions.map((action, index) =>
    action.kind === "move"
      ? `  ${index + 1}. move     ${shown(action.from)}  ->  ${shown(action.to)}`
      : `  ${index + 1}. discard  ${shown(action.path)}  (kept in .codaryn/discarded/ until removed)`,
  );
}

type Prepared = { readonly prepared: PreparedTask; readonly workspaceRoot: string; readonly runId: string };

/**
 * Review R-11 L-2: plan, apply and review run no model, but their quick form builds the run's
 * settings as `run` does, limits included, from the config file. A missing setting says so and
 * points at the plan run's task, which also keeps the plan run's secrets (DR-28).
 */
function withQuickFormHint(outcome: CommandOutcome, form: TaskFormArgs): CommandOutcome {
  if (form.input.kind !== "quick" || !("output" in outcome) || outcome.output.kind !== "error") return outcome;
  const output = outcome.output;
  if (output.code !== "invalid_config" || !output.message.includes("is not set")) return outcome;
  const message = `${output.message}. The quick form of plan, apply and review reads the run settings, limits included, from the config file; give the plan run's task with --task instead`;
  // R-12 L-2: the hint makes the human renderer add the advice as its own stderr line.
  return { ...outcome, output: { ...output, message, hint: "quick_form_needs_task" } };
}

/** Steps 1 to 7, the workspace's real path and the run `--run` names. */
async function prepareFor(
  io: PlanCommandEnvironment,
  form: TaskFormArgs,
  run: string,
  cancelFile: string | null,
  quiet: boolean,
  secrets = true,
): Promise<{ ok: true; value: Prepared } | { ok: false; outcome: CommandOutcome }> {
  // U-17: plan and review run nothing, so their quick form needs no run limits (TaskFormArgs.readOnly).
  const ready = await prepareTask(io, runArgsOf(form, cancelFile, quiet), notes(), { secrets, ...(form.readOnly === true ? { readOnly: true } : {}) });
  if (!("prepared" in ready)) return { ok: false, outcome: withQuickFormHint(ready, form) };
  let workspaceRoot: string;
  try {
    workspaceRoot = (await createWorkspace({ root: ready.prepared.task.workspaceRoot })).root;
  } catch {
    return { ok: false, outcome: cliError("workspace_not_found", "workspaceRoot is not an existing directory") };
  }
  const inspect = io.inspectRun ?? storeInspectRun;
  const reference = await resolveRunReference(workspaceRoot, run, { exists, listRuns: io.listRuns ?? storeListRuns, inspect });
  if (!reference.ok) return { ok: false, outcome: cliError(reference.code, reference.message) };
  // N-27: a run the run list judges damaged is not shown, applied or reviewed (as revert, N-26).
  let inspection: RunInspection;
  try {
    inspection = await inspect(workspaceRoot, reference.runId);
  } catch {
    inspection = "damaged";
  }
  if (inspection === "damaged") {
    return { ok: false, outcome: cliError("invalid_run_record", "the run's records do not pass the checks (`codaryn runs` shows it as damaged); nothing was shown or changed") };
  }
  if (reference.latest !== null) {
    try {
      io.announceLatest?.(reference.latest);
    } catch {
      // Best effort.
    }
  }
  return { ok: true, value: { prepared: ready.prepared, workspaceRoot, runId: reference.runId } };
}

const LOAD_MESSAGES = {
  run_not_found: "the workspace has no records for that run id",
  run_not_plan: "that run did not end with a stored plan (needs-input/plan_pending); there is nothing to show or apply",
  // R-9c C-1: the plan run ended as plan_pending but its plan.json is gone.
  plan_run_missing: "the plan run ended with a plan, but its plan.json is gone; nothing was shown or changed. Make the plan again",
  invalid_run_record: "the plan run's records cannot be used (plan.json or result.json cannot be read, or they disagree)",
} as const;

/** The plan, masked again, with its digest, applied state and the inventory limit (DR-5, DR-6). */
async function loadShown(
  io: PlanCommandEnvironment,
  value: Prepared,
  /**
   * R-18 L1: whether to list the workspace for `inventoryLimitReached` (DR-6). `plan` does; `apply`
   * does not (false here), and lists it with the apply's cancel signal only when it asks a person.
   */
  listInventory: boolean,
): Promise<
  | { ok: true; plan: StoredPlan; digest: ContentHash; output: PlanOutput; privacy: PrivacyGateway }
  | { ok: false; outcome: CommandOutcome }
> {
  const loaded = await (io.loadPlan ?? storeLoadPlan)({ workspaceRoot: value.workspaceRoot, runId: value.runId });
  if (!loaded.ok) return { ok: false, outcome: cliError(loaded.code, LOAD_MESSAGES[loaded.code]) };
  const privacy = createPrivacyGateway({ secrets: [...value.prepared.secrets] });
  const actions: MaskedPlanAction[] = [];
  for (const action of loaded.plan.actions) {
    const masked = maskAction(action, privacy);
    if (masked === null) return { ok: false, outcome: cliError("internal_error", "a path of the plan could not be masked; nothing is shown") };
    // DR-28 (R-11 M-1): the secrets registered now must leave exactly the text visible that the
    // plan run left visible (its masked form, stored with each action). Otherwise, or for a plan
    // stored without that form, nothing is shown, asked, recorded or moved.
    if (!planActionShownMatches(action, masked)) {
      return {
        ok: false,
        outcome: cliError(
          "plan_secrets_differ",
          "the secrets registered now mask the plan's paths differently from the plan run, or the plan has no masked form; nothing was shown, asked, recorded or moved. Use the plan run's task form (--task), or make the plan again",
        ),
      };
    }
    actions.push(masked);
  }
  const inventoryLimitReached = listInventory
    ? (await (io.createInventoryChecker ?? createInventoryChecker)({ workspaceRoot: value.workspaceRoot }).capture()).limitReached
    : false;
  const status = loaded.applied === null ? "pending" : "applied";
  const output: PlanOutput = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    kind: "plan",
    runId: value.runId,
    status,
    exitCode: PLAN_EXIT_CODES[status],
    digest: loaded.digest,
    actions,
    inventoryLimitReached,
    appliedBy: loaded.applied === null ? null : { runId: loaded.applied.applyRunId, at: loaded.applied.at },
  };
  return { ok: true, plan: loaded.plan, digest: loaded.digest, output, privacy };
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
 */
export function renderPlan(output: PlanOutput, currentKey: KnownKeys, messages?: MessageCatalog): string {
  const marked = output.recordsChanged === true;
  const lines = [
    ...(marked ? [planViewText(messages, "plan.records_changed")] : []),
    `Plan of run ${output.runId}: ${output.actions.length} action(s), ${output.status}`,
    `Digest: ${output.digest}`,
    ...actionLines(output.actions, currentKey),
  ];
  // U-21 (R-49 R49-L2, R-52 R52-L1): the model's words as the run summary draws them: the label on
  // its own line, then quoteModelText's rows (quote mark, single spaces, folded to the terminal).
  const summaryRows = output.summary === undefined ? [] : quoteModelText(hideKeys(output.summary, currentKey), PLAN_SUMMARY_MAX_ROWS);
  if (summaryRows.length > 0) lines.push(`${planViewText(messages, "plan.summary_label")}:`, ...summaryRows);
  if (output.inventoryLimitReached) {
    lines.push("The workspace has more files than the inventory check can list; an apply would stop as plan_stale and move nothing.");
  }
  if (output.appliedBy !== null) lines.push(`Applied by run ${output.appliedBy.runId} at ${output.appliedBy.at}.`);
  else if (marked) lines.push(planViewText(messages, "plan.cannot_apply"));
  else lines.push(`To apply it: codaryn apply <the same task form> --run ${output.runId} --digest ${output.digest.slice(0, 12)}`);
  lines.push(planViewText(messages, "plan.digest_guarantee"));
  return `${lines.join("\n")}\n`;
}

/** U-1, U-14: whether the plan run has a records-changed mark; one that cannot be read counts (fail closed). */
async function planRunMarked(io: PlanCommandEnvironment, workspaceRoot: string, runId: string): Promise<boolean> {
  try {
    return await (io.hasRecordsChangedMark ?? storeHasRecordsChangedMark)(workspaceRoot, runId);
  } catch {
    return true;
  }
}

async function readPlanJournal(workspaceRoot: string, runId: string): Promise<string> {
  const file = path.join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, runId, JOURNAL_FILE_NAME);
  const info = await lstat(file);
  if (!info.isFile() || info.size > MAX_REPORT_FILE_BYTES) throw new Error("the journal cannot be read");
  return await readFile(file, "utf8");
}

const PROPOSE_PLAN_TOOL = "propose_plan";
const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[name] : undefined;

/**
 * U-14 (AXM-15, PlanOutput.summary): the summary the model wrote for this plan. The one thing the
 * view reads from the plan run's journal: the masked args of the propose_plan call whose ok result
 * names this plan's digest, masked again with the current secrets. null when it cannot be found,
 * read or masked; the plan is shown without it.
 */
async function planSummary(io: PlanCommandEnvironment, workspaceRoot: string, runId: string, digest: ContentHash, privacy: PrivacyGateway): Promise<MaskedText | null> {
  try {
    const text = await (io.readJournal ?? readPlanJournal)(workspaceRoot, runId);
    const calls = new Map<string, string>();
    let callId: string | null = null;
    for (const line of text.split("\n")) {
      if (line.length === 0) continue;
      const record: unknown = JSON.parse(line);
      if (field(record, "runId") !== runId) return null;
      const type = field(record, "type");
      if (type === "model_response") {
        const toolCalls = field(record, "toolCalls");
        for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
          const id = field(call, "id");
          const argsJson = field(call, "argsJson");
          if (field(call, "name") === PROPOSE_PLAN_TOOL && typeof id === "string" && typeof argsJson === "string") calls.set(id, argsJson);
        }
      } else if (type === "tool_result") {
        const result = field(record, "result");
        const content = field(result, "content");
        const id = field(result, "callId");
        if (field(result, "tool") !== PROPOSE_PLAN_TOOL || field(result, "ok") !== true || typeof content !== "string" || typeof id !== "string") continue;
        let payload: unknown;
        try {
          payload = JSON.parse(content);
        } catch {
          continue;
        }
        if (field(payload, "digest") === digest) callId = id;
      }
    }
    const argsJson = callId === null ? undefined : calls.get(callId);
    if (argsJson === undefined) return null;
    const summary = field(JSON.parse(argsJson), "summary");
    if (typeof summary !== "string") return null;
    const masked = privacy.mask(summary);
    if (!masked.ok) return null;
    // R-49 R49-M1: the same hiding as the person's text, here, so every output that carries the
    // summary (--json, the app layer, apply's question) has it: registered secrets (above), the
    // current key and key-shaped text, control characters.
    const shown = cleanText(hideKeys(masked.text, knownKeyValues(io.env))).trim();
    // Masking may lengthen it (tokens); far beyond the tool's limit it is not the tool's record.
    if (shown.length === 0 || shown.length > MAX_PLAN_SUMMARY_CHARS * 4) return null;
    return shown as MaskedText;
  } catch {
    return null;
  }
}

/** `codaryn plan ... --run <runId|latest> [--json]` (DR-5, DR-17). */
export async function runPlan(io: PlanCommandEnvironment): Promise<CommandOutcome> {
  const parsed = parsePlanArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const ready = await prepareFor(io, parsed.args.form, parsed.args.runId, null, false);
  if (!ready.ok) return ready.outcome;
  const shown = await loadShown(io, ready.value, true);
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

/** `codaryn apply ... --run <planRunId> --digest <prefix> [--cancel-file <path>] [--quiet]` (6.2, 6.4). */
export async function runApply(io: ApplyCommandEnvironment): Promise<CommandOutcome> {
  const parsed = parseApplyArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const args = parsed.args;
  const ready = await prepareFor(io, args.form, args.runId, args.cancelFile, args.quiet);
  if (!ready.ok) return ready.outcome;
  const { prepared, workspaceRoot, runId: planRunId } = ready.value;
  const task = prepared.task;
  if (workflowSettingsOf(task).plan !== "apply") {
    return cliError("run_not_plan", 'the task given to apply does not resolve to a workflow with plan "apply"; nothing was moved');
  }
  const shown = await loadShown(io, ready.value, false);
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
    const question = [renderPlan({ ...shown.output, inventoryLimitReached, ...(summary === null ? {} : { summary }) }, currentKey, io.messages).trimEnd(), "Apply this plan? [y/N] "].join("\n");
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
      const protectedPaths = task.policy.protectedPaths ?? [];
      const integrity =
        protectedPaths.length > 0 || prepared.integrityPaths.length > 0
          ? createIntegrityChecker({ workspace, protectedPaths, externalPaths: prepared.integrityPaths })
          : undefined;
      // DR-38: the apply's journal and the plan run's applied mark come with the state guard that
      // knows them (the store's createApplyRecorders, the contract's CreateApplyRecorders), passed as
      // ApplyDeps.stateGuard. `runId` is this apply run; `planRunId` the plan run it carries out,
      // whose directory gets the applied mark. The journal notes each discarded file as its own.
      const recorders = createApplyRecorders({ workspaceRoot, runId, clock: io.clock, planRunId });
      const planTaskId = await planTaskIdOf(io, workspaceRoot, planRunId);
      const journal = observeApply(
        recorders.journal,
        privacy,
        args.quiet ? undefined : io.writeProgress,
        io.human,
        (event) => {
          if (event.type === "plan_checked") unsafeMoves = event.unsafeMoves?.length ?? 0;
        },
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
        policy: createPolicyGate({ config: task.policy, workspace }),
        planActions: task.policy.planActions ?? [],
        // DR-9: discarded files go to .codaryn/discarded/<apply runId>/, outside the run directories.
        discardedRoot: await prepareDiscardedRoot(workspaceRoot, runId),
        privacy,
        verifiers: createVerifierRunner({ workspace, commandRunner }),
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
      await releaseLock({ workspaceRoot, runId });
      cancel.dispose();
    }
    if (!args.quiet && io.writeProgress !== undefined && io.human?.applySummary !== undefined) {
      try {
        const form = args.form.input.kind === "task" ? "task" : "given";
        const summary = io.human.applySummary(result, { workspaceForm: form });
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
    const count = first.unsafeMoves;
    const question =
      `${count} move${count === 1 ? "" : "s"} of this plan can only be made without the guarantee that nothing at the ` +
      `destination is replaced (the drive has no hard links). Nothing was moved. Apply again and make ` +
      `${count === 1 ? "it" : "them"} anyway, for this apply only? [y/N] `;
    const answer = (await ask(question))?.trim().toLowerCase() ?? "";
    if (YES.has(answer)) {
      const second = await applyOnce({ channel: "cli-tty", digest: shown.digest });
      if (!second.ok) return second.outcome;
      final = second;
    }
  }
  return { output: final.result, exitCode: final.result.exitCode };
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
): ApplyJournal {
  const render = write === undefined || human?.applyProgressLine === undefined ? undefined : human.applyProgressLine.bind(human);
  return {
    async append(event: ApplyJournalEntry) {
      await journal.append(event);
      // R-9 I-4: a start record is stored for the revert only. It is not a shown record
      // (ApplyJournalEvent): neither the observer nor the renderer gets it.
      if (event.type === "plan_item_started") return;
      observe(event);
      if (render === undefined || write === undefined) return;
      try {
        const line = render(event);
        if (line === null) return;
        const masked = privacy.mask(`${PROGRESS_PREFIX}${line}`);
        if (masked.ok) write(`${cleanText(masked.text)}\n`);
      } catch {
        // Progress is best effort.
      }
    },
    close: () => journal.close(),
  };
}

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

/** The checklist of a run that ended as `needs-input`/`awaiting_review`, from its result.json. */
async function awaitingReview(
  workspaceRoot: string,
  runId: string,
): Promise<{ ok: true; checklist: readonly MaskedText[] } | { ok: false; outcome: CommandOutcome }> {
  const dir = path.join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
  try {
    const info = await lstat(dir);
    if (!info.isDirectory()) return { ok: false, outcome: cliError("invalid_run_record", "the run directory is not a plain directory") };
  } catch {
    return { ok: false, outcome: cliError("run_not_found", "the workspace has no records for that run id") };
  }
  let value: unknown;
  try {
    const file = path.join(dir, RESULT_FILE_NAME);
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_REPORT_FILE_BYTES) throw new Error("not a plain file");
    value = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return { ok: false, outcome: cliError("run_not_awaiting_review", "that run has no readable result; only a run that ended as awaiting_review can be reviewed") };
  }
  const result = value as Partial<EngineResult> | null;
  if (result === null || typeof result !== "object" || result.kind !== "run" || result.runId !== runId) {
    return { ok: false, outcome: cliError("invalid_run_record", "the run's result.json is not this run's result") };
  }
  if (result.status !== "needs-input" || result.reason !== "awaiting_review") {
    return { ok: false, outcome: cliError("run_not_awaiting_review", "that run did not end as needs-input/awaiting_review; nothing was written") };
  }
  const checklist = result.review?.checklist;
  if (!Array.isArray(checklist) || !checklist.every((item) => typeof item === "string")) {
    return { ok: false, outcome: cliError("invalid_run_record", "the run's result.json has no readable checklist") };
  }
  return { ok: true, checklist: checklist as MaskedText[] };
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
  const lines = [
    `Review of run ${runId}: ${args.verdict}${replaced ? " (an earlier review was replaced)" : ""}.`,
    ...review.checklist.map((item, index) => `  ${index + 1}. ${cleanText(hideKeys(item, currentKey))}`),
    "The run's result and records are unchanged; `codaryn report` shows the verdict.",
  ];
  return { text: `${lines.join("\n")}\n`, exitCode: output.exitCode };
}

/** Exposed for tests: the latest run rule the commands share with the store (N-23 b). */
export const latestPlanRule = latestRun;
/** Exposed for tests: the JSON line writer (N-19). */
export const planJsonLine = jsonLine;
