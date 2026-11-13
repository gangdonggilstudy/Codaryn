/**
 * U-306 (CLI migration C-7a; plan docs/reviews/2026-11-13-cli-migration-plan.md): the plan view's and
 * review's preparation and checks, the app layer's now: the task form's steps 1 to 7 and the run --run
 * names (prepareFor), the plan of either kind (loadAny), a plan of mode apply masked again and checked
 * against the plan run's masked form (loadShown, DR-28) or a run plan's view (changesView), the plan
 * run's records-changed mark (planRunMarked, fail closed), the model's summary (planSummary), and the
 * run that waits for review (awaitingReview). The text below is as it was in src/cli/plan-commands.ts
 * (TaskFormArgs in src/cli/args.ts), but for: the functions take PlanViewEnvironment (the fields of the
 * CLI's PlanCommandEnvironment they read, their comments as they were; PlanCommandEnvironment widens
 * it with argv and the catalog), and the names the CLI's apply and its plan and review commands use
 * are exported. The CLI's old places re-export what tests take (plan A).
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
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
  planActionShownMatches,
} from "../contracts/index.js";
import type {
  AnyStoredPlan,
  InventoryChecker,
  ChangesPlanOutput,
  Clock,
  ContentHash,
  EngineResult,
  ListRuns,
  LoadAnyPlan,
  LoadPlan,
  LoadPlanOutcome,
  MaskedPlanAction,
  MaskedText,
  PlanOutput,
  PrivacyGateway,
  ResolvedPlanAction,
  StoredPlan,
} from "../contracts/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import {
  hasRecordsChangedMark as storeHasRecordsChangedMark,
  inspectRun as storeInspectRun,
  listRuns as storeListRuns,
  loadAnyPlan as storeLoadAnyPlan,
} from "../store/index.js";
import type { RunInspection } from "../store/index.js";
import { createInventoryChecker } from "../verify/index.js";
import type { InventoryCheckerOptions } from "../verify/index.js";
import { createWorkspace } from "../workspace/index.js";
import type { CommandOutcome } from "./command-outcome.js";
import { resolveRunReference } from "./input/run-ref.js";
import type { CheckedRun } from "./input/run-ref.js";
import { cliError, prepareTask } from "./prepare.js";
import type { PrepareEnvironment, PreparedTask, RunArgs, RunNotes } from "./prepare.js";
import { knownKeyValues } from "./input/settings.js";
import { cleanText, hideKeys } from "./input/text-safety.js";
import { changesPlanOutput } from "../cli/human/changes-plan.js";
import type { LoadedChangesPlan } from "../cli/human/changes-plan.js";

/**
 * G-F (DR-17): the task form `plan`, `apply` and `review` share with `run`: `--task <file>`, or
 * `--workspace <dir>` with `--profile` and `--workflow`; and `--config`, `--vars-file`.
 * There is no goal: these commands do not run a model.
 */
export interface TaskFormArgs {
  readonly input: { readonly kind: "task"; readonly taskPath: string } | { readonly kind: "quick"; readonly workspace: string };
  /**
   * U-17 (UXM-3, AXM-14): the command runs no model and no verifier (`plan`, `review`), so its quick
   * form does not need the run's limits; the form is read for the secrets and the workflow only.
   */
  readonly readOnly?: boolean;
  readonly configPath: string | null;
  readonly varsFile: string | null;
  readonly profile: string | null;
  readonly workflow: string | null;
}

/** The goal the task form carries for commands that never run a model. */
export const NO_GOAL = "(no goal: plan, apply and review do not run a model)";

/** U-306: what the plan view's and review's rules read of a command's environment (PlanCommandEnvironment's, but for argv and the catalog). */
export interface PlanViewEnvironment extends PrepareEnvironment {
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
  /** Overrides for tests; the store's functions otherwise. */
  readonly listRuns?: ListRuns;
  readonly loadPlan?: LoadPlan;
  /**
   * U-195 (DR-69 B-4): the store's loadAnyPlan (the default), so `plan` and `apply` choose by the
   * plan's kind. A test that gives `loadPlan` only gets a plan of mode apply, as before.
   */
  readonly loadAnyPlan?: LoadAnyPlan;
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
}

/** The RunArgs `prepareTask` takes for a task form. */
export function runArgsOf(form: TaskFormArgs, cancelFile: string | null, quiet: boolean): RunArgs {
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

export function notes(): RunNotes {
  return { configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0 };
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

/** U-195: `notes` are the preparation's (the config's language), which a run plan's apply passes on to its run. */
export type Prepared = { readonly prepared: PreparedTask; readonly workspaceRoot: string; readonly runId: string; readonly notes: RunNotes };

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
export async function prepareFor(
  io: PlanViewEnvironment,
  form: TaskFormArgs,
  run: string,
  cancelFile: string | null,
  quiet: boolean,
  secrets = true,
): Promise<{ ok: true; value: Prepared } | { ok: false; outcome: CommandOutcome }> {
  // U-17: plan and review run nothing, so their quick form needs no run limits (TaskFormArgs.readOnly).
  const runNotes = notes();
  const ready = await prepareTask(io, runArgsOf(form, cancelFile, quiet), runNotes, { secrets, ...(form.readOnly === true ? { readOnly: true } : {}) });
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
  return { ok: true, value: { prepared: ready.prepared, workspaceRoot, runId: reference.runId, notes: runNotes } };
}

export const LOAD_MESSAGES = {
  run_not_found: "the workspace has no records for that run id",
  run_not_plan: "that run did not end with a stored plan (needs-input/plan_pending); there is nothing to show or apply",
  // R-9c C-1: the plan run ended as plan_pending but its plan.json is gone.
  plan_run_missing: "the plan run ended with a plan, but its plan.json is gone; nothing was shown or changed. Make the plan again",
  invalid_run_record: "the plan run's records cannot be used (plan.json or result.json cannot be read, or they disagree)",
} as const;

const PLAN_SECRETS_DIFFER_MESSAGE =
  "the secrets registered now mask the plan's paths differently from the plan run, or the plan has no masked form; nothing was shown, asked, recorded or moved. Use the plan run's task form (--task), or make the plan again";

/** U-195: the plan of either kind (loadAnyPlan); a test's `loadPlan` alone gives a plan of mode apply, as before. */
export function loadAny(io: PlanViewEnvironment, value: Prepared): Promise<LoadPlanOutcome<AnyStoredPlan>> {
  const load: LoadAnyPlan = io.loadAnyPlan ?? io.loadPlan ?? storeLoadAnyPlan;
  return load({ workspaceRoot: value.workspaceRoot, runId: value.runId });
}

/**
 * U-195 (DR-69 B-4): a run plan's view, U-191's changesPlanOutput with the secrets registered now
 * (DR-28: a path they mask differently from the plan run shows nothing, plan_secrets_differ) and the
 * plan run's records-changed mark.
 */
export async function changesView(
  io: PlanViewEnvironment,
  value: Prepared,
  loaded: LoadedChangesPlan,
): Promise<{ ok: true; output: ChangesPlanOutput } | { ok: false; outcome: CommandOutcome }> {
  const privacy = createPrivacyGateway({ secrets: [...value.prepared.secrets] });
  const marked = await planRunMarked(io, value.workspaceRoot, value.runId);
  const view = changesPlanOutput(loaded, privacy, { recordsChanged: marked });
  if (view.ok) return { ok: true, output: view.output };
  return {
    ok: false,
    outcome: view.code === "plan_secrets_differ" ? cliError("plan_secrets_differ", PLAN_SECRETS_DIFFER_MESSAGE) : cliError("internal_error", "a path of the plan could not be masked; nothing is shown"),
  };
}

/** The plan, masked again, with its digest, applied state and the inventory limit (DR-5, DR-6). */
export async function loadShown(
  io: PlanViewEnvironment,
  value: Prepared,
  /**
   * R-18 L1: whether to list the workspace for `inventoryLimitReached` (DR-6). `plan` does; `apply`
   * does not (false here), and lists it with the apply's cancel signal only when it asks a person.
   */
  listInventory: boolean,
  /** U-195: the plan as loadAny gave it, a plan of mode apply (a run plan is shown by changesView). */
  loaded: LoadPlanOutcome,
): Promise<
  | { ok: true; plan: StoredPlan; digest: ContentHash; output: PlanOutput; privacy: PrivacyGateway }
  | { ok: false; outcome: CommandOutcome }
> {
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
        outcome: cliError("plan_secrets_differ", PLAN_SECRETS_DIFFER_MESSAGE),
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

/** U-1, U-14: whether the plan run has a records-changed mark; one that cannot be read counts (fail closed). */
export async function planRunMarked(io: PlanViewEnvironment, workspaceRoot: string, runId: string): Promise<boolean> {
  try {
    return await (io.hasRecordsChangedMark ?? storeHasRecordsChangedMark)(workspaceRoot, runId);
  } catch {
    return true;
  }
}

export async function readPlanJournal(workspaceRoot: string, runId: string): Promise<string> {
  const file = path.join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, runId, JOURNAL_FILE_NAME);
  const info = await lstat(file);
  if (!info.isFile() || info.size > MAX_REPORT_FILE_BYTES) throw new Error("the journal cannot be read");
  return await readFile(file, "utf8");
}

const PROPOSE_PLAN_TOOL = "propose_plan";
export const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[name] : undefined;

/**
 * U-14 (AXM-15, PlanOutput.summary): the summary the model wrote for this plan. The one thing the
 * view reads from the plan run's journal: the masked args of the propose_plan call whose ok result
 * names this plan's digest, masked again with the current secrets. null when it cannot be found,
 * read or masked; the plan is shown without it.
 */
export async function planSummary(io: PlanViewEnvironment, workspaceRoot: string, runId: string, digest: ContentHash, privacy: PrivacyGateway): Promise<MaskedText | null> {
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

/** The checklist of a run that ended as `needs-input`/`awaiting_review`, from its result.json. */
export async function awaitingReview(
  workspaceRoot: string,
  runId: string,
): Promise<{ ok: true; checklist: readonly MaskedText[]; changedFiles: number } | { ok: false; outcome: CommandOutcome }> {
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
  // U-131 (N3): whether the run changed files (a rejected run then has something to revert).
  const changedFiles = Array.isArray(result.changes) ? result.changes.length : 0;
  return { ok: true, checklist: checklist as MaskedText[], changedFiles };
}
