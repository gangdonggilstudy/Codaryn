/**
 * U-313 (the CLI migration's C-7b; plan 6.1, 6.2, 6.4; PM D-2): an apply's life, the app layer's.
 * The CLI's `codaryn apply` and CodarynApp.applyPlan are to call this one function; until na-core's
 * switch neither does, and this file is the CLI's src/cli/plan-commands.ts `runApply` and
 * `applyChangesPlan` (main ab5093d2) moved letter for letter, with what the CLI drew in the middle of
 * it (the questions, the progress lines, the end summaries) given to the contract's hooks instead
 * (ApplyLifeHooks, src/contracts/app.ts, U-309):
 * - before: the plan's mode and kind (run_not_plan, plan_kind_differs), the plan view's checks, a plan
 *   already applied, the records-changed mark (looked at outside the lock; the engine looks again
 *   under it), an adapter's rules (DR-1, DR-21: no consent argument, its consent for this digest only);
 * - `ready` once, after those and before the approval: the plan's kind, whether the plan ran with
 *   another task (U-131: the CLI says so inside its question and right after the apply's start), and
 *   the apply's masking, the plan view's gateway itself, so the drawn lines' tokens are those of now;
 * - the approval: the digest's first characters (cli-flag, or adapter for the app layer), or `approve`
 *   with the view as the question shows it (a plan of moves: listed for the inventory limit with the
 *   apply's cancel first, R-18 L1, and the agent's summary, U-14), true giving cli-tty;
 * - a plan of moves: one apply run (the lock, the cancel source, the workspace, the command runner on
 *   the apply's own parent environment, DR-4, runGuards, the integrity checker, the apply recorders,
 *   the engine, result.json, the lock released), its records given to `observer` as stored and then
 *   masked again as events, and `applyEnded` with its result and whether its lock was left; after an
 *   end as consent_required with no consent given, `consentToUnsafeMoves` and, on true, a second apply
 *   run with the terminal's consent (DR-21);
 * - a run plan: runLife with the approved plan (C-6b), the plan run's goal (planRunGoal), its run's
 *   facts to `runReady` once assembled, its records to `observer` (onStoredRunRecord, onRunEvent), its
 *   permission questions to `observer.confirm`, and the notices the life added to its result.
 * A question hook that throws or answers anything but true is a no; any other hook's throw is ignored.
 * Nothing a hook gets reaches the result, result.json, a record or an error. The refusals' codes and
 * messages are the CLI's, unchanged (the JSON line keeps its keys' order).
 *
 * For the CLI's drawing (na-core): the other-task line of a run plan was written after the approval
 * and before the run (plan-commands.ts applyChangesPlan). After `ready` the only refusal before that
 * run is plan_not_approved, so the CLI keeps that place with `runReady`, or, when the life ends with
 * another error and no `runReady` came, right then.
 */

import path from "node:path";
import { UNSAFE_MOVE_CONSENT_ARGUMENT, workflowSettingsOf } from "../contracts/index.js";
import type {
  ApplyJournal,
  ApplyJournalEntry,
  ApplyJournalRecord,
  ApplyPlan,
  ApplyResult,
  ApprovalChannel,
  EngineResult,
  LoadPlanOutcome,
  MaskedText,
  PlanOutput,
  PrivacyGateway,
  StateUncheckedSince,
  UnsafeMoveConsent,
} from "../contracts/index.js";
import type { ApplyApprovalView, ApplyFacts, ApplyLifeHooks, ApplyObserver, RunFacts, RunObserver } from "../contracts/app.js";
import { applyPlan as engineApplyPlan, runApprovedPlan as engineRunApprovedPlan } from "../engine/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import {
  acquireLock,
  createApplyRecorders,
  listRuns as storeListRuns,
  prepareDiscardedRoot,
  releaseLock,
  stateUncheckedSince as storeStateUncheckedSince,
  writeResult,
} from "../store/index.js";
import { createCommandRunner, createPlanExecutor, envValueFreeOfSecrets } from "../tools/index.js";
import { createIntegrityChecker, createInventoryChecker, createVerifierRunner } from "../verify/index.js";
import { createWorkspace } from "../workspace/index.js";
import { deliverApply } from "./apply.js";
import type { Assemble } from "./assembly.js";
import type { CommandOutcome } from "./command-outcome.js";
import { deliver, journalWithEvents, maskStrings } from "./events.js";
import { createRunId } from "./input/run-id.js";
import { runGuards } from "./input/unreadable.js";
import { confirmThrough } from "./permission.js";
import { LOAD_MESSAGES, changesView, field, loadAny, loadShown, planRunMarked, planSummary, readPlanJournal, runArgsOf } from "./plan-view.js";
import type { PlanViewEnvironment, Prepared, TaskFormArgs } from "./plan-view.js";
import { cliError, withHint } from "./prepare.js";
import type { PreparedTask } from "./prepare.js";
import { withoutEmptyStateChanged } from "./result-fields.js";
import { runLife } from "./run-life.js";
import type { RunLifeEnd, RunLifeEnvironment } from "./run-life.js";

/**
 * DR-1, DR-21: an adapter's apply (the CLI's AdapterApply, the same shape): the approval is recorded
 * as `adapter`, `unsafeMoveConsent` is only what the person gave on screen for this apply (channel
 * adapter, this plan's full digest), and no question is asked: `approve` and `consentToUnsafeMoves`
 * are not called.
 */
export interface ApplyLifeAdapter {
  readonly unsafeMoveConsent: (UnsafeMoveConsent & { readonly channel: "adapter" }) | null;
}

/**
 * What an apply's life works on: the plan view's environment (C-7a) and the CLI's apply environment's
 * fields of the same names and meanings (src/cli/plan-commands.ts ApplyCommandEnvironment).
 */
export interface ApplyLifeEnvironment extends PlanViewEnvironment {
  /** The apply engine (src/engine's applyPlan when absent). */
  readonly applyPlan?: ApplyPlan;
  /** U-29: the store's stateUncheckedSince (the default); passed to the engine as planRecordsUnchecked. */
  readonly stateUncheckedSince?: StateUncheckedSince;
  /** Set by the app layer only. Absent: the CLI's channels (`--digest`, the hooks' questions). */
  readonly adapter?: ApplyLifeAdapter;
  /** DR-4: the verifiers' commands' parent environment (the apply's own copy); `env` when absent. */
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
  /** DR-4: the platform the copy was made for; this process's when absent. */
  readonly platform?: NodeJS.Platform;
  /** The apply's cancel source, made from the cancel file (or none). */
  readonly cancelSignal: (cancelFile: string | null) => { signal: AbortSignal; dispose(): void };
  /**
   * U-195 (DR-69 B-3, B-4): the environment of the run that carries out a run plan (runLife's).
   * Absent: such a plan is not carried out here (internal_error, nothing sent or written).
   */
  readonly run?: RunLifeEnvironment;
}

/**
 * The parsed `codaryn apply` arguments the life uses, with the meanings of the CLI's ApplyArgs
 * (src/cli/args.ts), which has these fields: so this file imports nothing of src/cli (as run-life.ts).
 * The plan run's id is `Prepared.runId`.
 */
export interface ApplyLifeArgs {
  readonly form: TaskFormArgs;
  /** The approved digest's first characters, or null (then only `approve` can approve). */
  readonly digest: string | null;
  /** DR-21: the CLI's consent argument (UNSAFE_MOVE_CONSENT_ARGUMENT), for this apply only. */
  readonly allowUnsafeMove: boolean;
  readonly cancelFile: string | null;
  readonly quiet: boolean;
}

/** How an apply's life ended. */
export type ApplyLifeEnd =
  /** A refusal, or an internal error, as the CLI prints it (its JSON line and exit code). */
  | { readonly kind: "error"; readonly outcome: CommandOutcome }
  /** A plan of moves: the last apply run's result (its lock left only in `applyEnded`, PM D-3). */
  | { readonly kind: "applied"; readonly result: ApplyResult }
  /** A run plan: the end of the run that carried it out (runLife with the approved plan). */
  | { readonly kind: "carried"; readonly end: RunLifeEnd };

/** U-131 (N5): the plan run ran with another task than this apply's (both ids known). */
async function planTaskIdOf(io: PlanViewEnvironment, workspaceRoot: string, planRunId: string): Promise<string | null> {
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
 * U-195 (PM decision 2): the goal a run plan's run is given: the plan run's own goal as its journal
 * recorded it (the first model request's user message, masked by the plan run). null when it cannot
 * be read.
 */
async function planRunGoal(io: PlanViewEnvironment, workspaceRoot: string, planRunId: string): Promise<string | null> {
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

/** A text masked with `privacy`, or null when it cannot be (ApplyFacts.mask, RunFacts.mask). */
function maskWith(privacy: PrivacyGateway): (text: string) => MaskedText | null {
  return (text) => {
    try {
      const masked = privacy.mask(text);
      return masked.ok ? masked.text : null;
    } catch {
      return null;
    }
  };
}

/** Calls a telling hook; its throw cannot change the apply. */
function tell(call: () => void): void {
  try {
    call();
  } catch {
    // A hook cannot change the apply.
  }
}

/** Asks a question hook: only true is a yes; a throw or a rejection is a no. */
async function asked(question: () => Promise<boolean> | boolean): Promise<boolean> {
  try {
    return (await question()) === true;
  } catch {
    return false;
  }
}

/** Gives `observer` an apply record as stored (ApplyObserver.onStoredRecord), a copy. */
function deliverStoredApply(observer: ApplyObserver | undefined, record: ApplyJournalRecord): void {
  if (observer?.onStoredRecord === undefined) return;
  try {
    observer.onStoredRecord(structuredClone(record));
  } catch {
    // An observer cannot change the apply.
  }
}

/**
 * The apply run's journal: each shown record, once stored, to `seen` (the preflight's unsafe moves),
 * then to `observer` as stored, then masked again as an event (as src/app/apply.ts does). A start
 * record (R-9 I-4) is stored only.
 */
function observedApplyJournal(journal: ApplyJournal, observer: ApplyObserver | undefined, privacy: PrivacyGateway, seen: (entry: ApplyJournalEntry) => void): ApplyJournal {
  return {
    async append(entry) {
      const stored = await journal.append(entry);
      if (entry.type === "plan_item_started") return stored;
      seen(entry);
      deliverStoredApply(observer, stored as ApplyJournalRecord);
      if (observer?.onEvent !== undefined) {
        const shown = maskStrings(stored as ApplyJournalRecord, privacy);
        if (shown !== null) deliverApply(observer, { kind: "record", record: shown });
      }
      return stored;
    },
    close: () => journal.close(),
  };
}

/**
 * The life of an apply (`codaryn apply`, CodarynApp.applyPlan): `value` is what prepareFor gave for
 * the apply's task form and plan run (C-7a). See the head of this file.
 */
export async function applyLife(io: ApplyLifeEnvironment, args: ApplyLifeArgs, value: Prepared, hooks: ApplyLifeHooks = {}): Promise<ApplyLifeEnd> {
  const { prepared, workspaceRoot, runId: planRunId } = value;
  const task = prepared.task;
  const mode = workflowSettingsOf(task).plan;
  // U-195 (DR-69 B-3, B-4): a task resolved to plan "run" carries out a run plan with a model run.
  if (mode === "run") return carryRunPlan(io, args, value, hooks);
  const refused = (outcome: CommandOutcome): ApplyLifeEnd => ({ kind: "error", outcome });
  if (mode !== "apply") {
    // U-228: a task with no plan mode. When the run has a plan, the message names its kind and the
    // person is told to give the task the plan run used (plan_kind_differs); else as before.
    const any = await loadAny(io, value);
    if (any.ok) {
      const made = any.plan.kind === "changes" ? 'a plan of files to write (plan "run")' : 'a plan of moves and discards (plan "apply")';
      return refused(
        withHint(
          cliError("run_not_plan", `that run made ${made}, but the task given to apply resolves to no plan mode; give the task the plan run used; nothing was moved or run`),
          "plan_kind_differs",
        ),
      );
    }
    return refused(cliError("run_not_plan", 'the task given to apply resolves to no plan mode (neither plan "apply" nor plan "run"); nothing was moved or run'));
  }
  const loaded = await loadAny(io, value);
  if (loaded.ok && loaded.plan.kind === "changes") {
    // U-228: the run has a plan, of the other kind (plan_kind_differs); the message as before.
    return refused(
      withHint(
        cliError(
          "run_not_plan",
          'that run made a plan of files to write (plan "run"), but the task given to apply resolves to plan "apply"; give the task the plan run used; nothing was moved',
        ),
        "plan_kind_differs",
      ),
    );
  }
  const shown = await loadShown(io, value, false, loaded as LoadPlanOutcome);
  if (!shown.ok) return refused(shown.outcome);
  if (shown.output.appliedBy !== null) {
    return refused(cliError("plan_already_applied", "that plan was already applied; nothing was moved. Revert the apply run to undo it"));
  }
  // U-1 (R-33 R33-L3): refused before anything is asked; a mark that cannot be read counts (fail
  // closed). The engine checks again under the lock (ApplyDeps.planRecordsChanged).
  const planRecordsChanged = (): Promise<boolean> => planRunMarked(io, workspaceRoot, planRunId);
  if (await planRecordsChanged()) {
    return refused(
      cliError(
        "plan_records_changed",
        "the plan run's records were changed by something other than the run (a records-changed mark), so its plan may not be the one shown; nothing was asked, recorded or moved. Make the plan again with a new codaryn run (codaryn plan only shows a plan, it does not make one)",
      ),
    );
  }

  // DR-1, DR-21: an adapter's apply has the adapter's channel only: no question, no consent argument,
  // and a consent only from the person's input on its screen.
  const adapter = io.adapter;
  const approve = adapter === undefined ? hooks.approve : undefined;
  const consentToUnsafeMoves = adapter === undefined ? hooks.consentToUnsafeMoves : undefined;
  if (adapter !== undefined) {
    if (args.allowUnsafeMove) {
      return refused(cliError("invalid_arguments", `an adapter's apply takes the person's consent in its request, not ${UNSAFE_MOVE_CONSENT_ARGUMENT}; nothing was moved`));
    }
    const consent = adapter.unsafeMoveConsent;
    if (consent !== null && (consent.channel !== "adapter" || consent.digest !== shown.digest)) {
      return refused(cliError("invalid_arguments", "the consent to unsafe moves is not the adapter's consent for this plan's digest; nothing was moved"));
    }
  }

  // U-131 (N5, UXM-15): whether the plan was made with another task (told by the CLI before the
  // question and right after the apply's start); the same task id goes to the engine (planTaskId).
  const planTaskId = await planTaskIdOf(io, workspaceRoot, planRunId);
  const privacy = shown.privacy;
  const facts: ApplyFacts = { planKind: "moves", otherTask: planTaskId !== null && planTaskId !== task.id, mask: maskWith(privacy) };
  if (hooks.ready !== undefined) tell(() => hooks.ready!(facts));

  // Approval (6.4 1): the digest's first characters (cli-flag, or adapter), or the question (cli-tty).
  let approval: ApprovalChannel;
  if (args.digest !== null) {
    if (!shown.digest.startsWith(args.digest)) {
      return refused(cliError("plan_not_approved", "--digest does not match the plan's digest; nothing was moved. `codaryn plan` shows it"));
    }
    approval = adapter === undefined ? "cli-flag" : "adapter";
  } else if (approve !== undefined) {
    // R-18 L1: the view lists the workspace (the inventory limit, DR-6) only here, and the apply's
    // cancel stops that listing too. A cancel during it ends with nothing moved.
    const cancel = io.cancelSignal(args.cancelFile === null ? null : path.resolve(io.cwd, args.cancelFile));
    let inventoryLimitReached: boolean;
    try {
      inventoryLimitReached = (await (io.createInventoryChecker ?? createInventoryChecker)({ workspaceRoot, signal: cancel.signal }).capture()).limitReached;
    } catch {
      if (cancel.signal.aborted) return refused(cliError("plan_not_approved", "the apply was cancelled before the plan was shown; nothing was moved"));
      // Any other failure: the plan is shown without the limit line; the engine's own listing checks it.
      inventoryLimitReached = false;
    } finally {
      cancel.dispose();
    }
    // U-14 (AXM-15): the question shows the agent's description too (not part of the digest).
    const summary = await planSummary(io, workspaceRoot, planRunId, shown.digest, privacy);
    const plan: PlanOutput = { ...shown.output, inventoryLimitReached, ...(summary === null ? {} : { summary }) };
    const view: ApplyApprovalView = { kind: "moves", plan };
    if (!(await asked(() => approve(view)))) return refused(cliError("plan_not_approved", "the plan was not approved; nothing was moved"));
    approval = "cli-tty";
  } else {
    return refused(cliError("plan_not_approved", "an apply needs --digest with the plan's digest (codaryn plan shows it); nothing was moved"));
  }

  /** One apply run: lock, engine, result.json, lock released, applyEnded. `unsafeMoves` is from its preflight record. */
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
      // knows them (createApplyRecorders). `runId` is this apply run; `planRunId` the plan run.
      const recorders = createApplyRecorders({ workspaceRoot, runId, clock: io.clock, planRunId });
      const journal = observedApplyJournal(recorders.journal, hooks.observer, privacy, (entry) => {
        if (entry.type === "plan_checked") unsafeMoves = entry.unsafeMoves?.length ?? 0;
      });
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
        // U-182 (DR-69 B-4), U-210 (A-6): the apply's task's writable lists and unreadable paths.
        policy: guards.gate(),
        planActions: task.policy.planActions ?? [],
        // DR-9: discarded files go to .codaryn/discarded/<apply runId>/, outside the run directories.
        discardedRoot: await prepareDiscardedRoot(workspaceRoot, runId),
        privacy,
        // U-210 (R-6; U-223): the apply's checks keep the numbers of unreadable sources out, as a run's do.
        verifiers: createVerifierRunner({ workspace, commandRunner, ...guards.verifiers }),
        // R-13 L-3: the listing stops when the apply is cancelled.
        inventory: (io.createInventoryChecker ?? createInventoryChecker)({ workspaceRoot, signal: cancel.signal }),
        journal,
        clock: io.clock,
        signal: cancel.signal,
        ...(integrity === undefined ? {} : { integrity }),
        markApplied: () => recorders.markApplied(),
        stateGuard: recorders.stateGuard,
        // U-1: the same check under the lock, right after apply_started.
        planRecordsChanged,
        // U-16 (UXM-15): the task the plan run ran with; the engine tells when it is not this one.
        ...(planTaskId === null ? {} : { planTaskId }),
        // U-29, U-33: whether a run since the plan could not check the state directory.
        planRecordsUnchecked: () => (io.stateUncheckedSince ?? storeStateUncheckedSince)({ workspaceRoot, planRunId, applyRunId: runId }),
      });
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
      lockLeft = !(await releaseLock({ workspaceRoot, runId }).then((released) => released === true, () => false));
      cancel.dispose();
    }
    // The CLI writes this apply's end summary here, so DR-21's question comes after it (ApplyRunEnd).
    const ended = { result, lockLeft };
    if (hooks.applyEnded !== undefined) tell(() => hooks.applyEnded!(ended));
    return { ok: true, result, unsafeMoves };
  };

  // DR-21: the consent to unsafe moves holds for one apply and comes only from the person: the CLI's
  // argument, the answer after an apply stopped as consent_required (nothing was moved, so a second
  // apply run makes the moves), or the adapter's request. No task, config, profile, plan or model.
  const givenConsent: UnsafeMoveConsent | null =
    adapter !== undefined ? adapter.unsafeMoveConsent : args.allowUnsafeMove ? { channel: "cli-flag", digest: shown.digest } : null;
  const first = await applyOnce(givenConsent);
  if (!first.ok) return refused(first.outcome);
  let final = first;
  if (first.result.reason === "consent_required" && givenConsent === null && consentToUnsafeMoves !== undefined) {
    if (await asked(() => consentToUnsafeMoves(first.unsafeMoves))) {
      const second = await applyOnce({ channel: "cli-tty", digest: shown.digest });
      if (!second.ok) return refused(second.outcome);
      final = second;
    }
  }
  return { kind: "applied", result: final.result };
}

/**
 * U-195 (DR-69 B-3, B-4, B-7): applying a run plan (the task resolves to plan "run"): refused before
 * anything is asked, sent or written as the CLI refuses it, approved as a plan of moves is (the digest,
 * `approve` with the plan's view, the adapter's), then runLife with the approved plan, whose engine
 * checks every planned file, claims the plan once and writes planned files only.
 */
async function carryRunPlan(io: ApplyLifeEnvironment, args: ApplyLifeArgs, value: Prepared, hooks: ApplyLifeHooks): Promise<ApplyLifeEnd> {
  const refused = (outcome: CommandOutcome): ApplyLifeEnd => ({ kind: "error", outcome });
  const { workspaceRoot, runId: planRunId } = value;
  const loaded = await loadAny(io, value);
  if (!loaded.ok) return refused(cliError(loaded.code, LOAD_MESSAGES[loaded.code]));
  if (loaded.plan.kind !== "changes") {
    // U-228: the run has a plan, of the other kind (plan_kind_differs); the message as before.
    return refused(
      withHint(
        cliError(
          "run_not_plan",
          'that run made a plan of moves and discards (plan "apply"), but the task given to apply resolves to plan "run"; give the task the plan run used; nothing was run',
        ),
        "plan_kind_differs",
      ),
    );
  }
  const plan = loaded.plan;
  if (loaded.applied !== null) {
    return refused(cliError("plan_already_applied", "that plan was already carried out; nothing was run. Revert the run that carried it out to undo it"));
  }
  if (await planRunMarked(io, workspaceRoot, planRunId)) {
    return refused(
      cliError(
        "plan_records_changed",
        "the plan run's records were changed by something other than the run (a records-changed mark), so its plan may not be the one shown; nothing was asked, sent or written. Make the plan again with a new codaryn run",
      ),
    );
  }
  const adapter = io.adapter;
  if (args.allowUnsafeMove || (adapter !== undefined && adapter.unsafeMoveConsent !== null)) {
    return refused(cliError("invalid_arguments", `the consent to unsafe moves (${UNSAFE_MOVE_CONSENT_ARGUMENT}) is for a plan of moves; a run plan moves no file; nothing was run`));
  }
  const view = await changesView(io, value, { plan, digest: loaded.digest, applied: loaded.applied });
  if (!view.ok) return refused(view.outcome);
  const goal = await planRunGoal(io, workspaceRoot, planRunId);
  if (goal === null) {
    return refused(cliError("invalid_run_record", "the plan run's records do not hold the goal it was given, so its plan is not carried out; nothing was asked, sent or written"));
  }
  const runIo = io.run;
  if (runIo === undefined) return refused(cliError("internal_error", "this build cannot carry out a run plan here; nothing was sent or written"));

  // U-131 (N5) as for a plan of moves. The apply's own masking: the view's secrets (the view itself was
  // masked with a gateway of the same secrets); the run masks with its own (RunFacts.mask).
  const planTaskId = await planTaskIdOf(io, workspaceRoot, planRunId);
  const facts: ApplyFacts = {
    planKind: "changes",
    otherTask: planTaskId !== null && planTaskId !== value.prepared.task.id,
    mask: maskWith(createPrivacyGateway({ secrets: [...value.prepared.secrets] })),
  };
  if (hooks.ready !== undefined) tell(() => hooks.ready!(facts));
  const approve = adapter === undefined ? hooks.approve : undefined;
  let approval: ApprovalChannel;
  if (args.digest !== null) {
    if (!loaded.digest.startsWith(args.digest)) return refused(cliError("plan_not_approved", "--digest does not match the plan's digest; nothing was run. `codaryn plan` shows it"));
    approval = adapter === undefined ? "cli-flag" : "adapter";
  } else if (approve !== undefined) {
    // U-228 (U-198's texts): the view, and whether the task allows commands (the note the CLI adds).
    const shownView: ApplyApprovalView = { kind: "changes", plan: view.output, commandsAllowed: value.prepared.task.policy.commands.length > 0 };
    if (!(await asked(() => approve(shownView)))) return refused(cliError("plan_not_approved", "the plan was not approved; nothing was run"));
    approval = "cli-tty";
  } else {
    return refused(cliError("plan_not_approved", "an apply needs --digest with the plan's digest (codaryn plan shows it); nothing was run"));
  }

  const prepared: PreparedTask = { ...value.prepared, task: { ...value.prepared.task, goal } };
  const carrying = carryingEnvironment(runIo, value, hooks);
  const end = await runLife(carrying.io, runArgsOf(args.form, args.cancelFile, args.quiet), value.notes, prepared, {
    planRunId,
    digest: loaded.digest,
    approval,
    plan,
  });
  if (end.kind === "ended") carrying.addedNotices(end.result);
  return { kind: "carried", end };
}

/**
 * The carrying run's environment: `runIo` with its assembly wrapped so that, once assembled, the run's
 * facts go to `runReady`, its records to the apply's observer (as stored: onStoredRunRecord; masked
 * again: onRunEvent) and its permission questions to `observer.confirm` when it has one; and its engine
 * wrapped to count the engine's own notices, so that `addedNotices` gives onRunEvent the ones runLife
 * added to the result afterwards (Y-4's hint, the default location's notice), as the app's run delivers
 * them now (app.ts appRunHooks' `ended`). An app that calls this life gives its run hooks no observer
 * of their own, so nothing reaches the observer twice.
 */
function carryingEnvironment(runIo: RunLifeEnvironment, value: Prepared, hooks: ApplyLifeHooks): { readonly io: RunLifeEnvironment; readonly addedNotices: (result: EngineResult) => void } {
  const observer = hooks.observer;
  const runObserver: RunObserver = {
    ...(typeof observer?.onRunEvent === "function" ? { onEvent: (event) => observer.onRunEvent!.call(observer, event) } : {}),
    ...(typeof observer?.onStoredRunRecord === "function" ? { onStoredRecord: (record) => observer.onStoredRunRecord!.call(observer, record) } : {}),
    ...(typeof observer?.confirm === "function" ? { confirm: (request, signal) => observer.confirm!.call(observer, request, signal) } : {}),
  };
  let engineNotices: number | null = null;
  const assemble: Assemble = async (input) => {
    const assembled = await runIo.assemble(input);
    if (!assembled.ok) return assembled;
    const privacy = assembled.deps.privacy;
    const facts: RunFacts = { runId: input.runId, configLanguage: value.notes.configLanguage, defaultConfig: value.notes.configDefault, mask: maskWith(privacy) };
    if (hooks.runReady !== undefined) tell(() => hooks.runReady!(facts));
    const journal = journalWithEvents(assembled.deps.journal, runObserver, privacy);
    return { ...assembled, deps: { ...assembled.deps, journal, ...(runObserver.confirm === undefined ? {} : { confirm: confirmThrough(runObserver) }) } };
  };
  const io: RunLifeEnvironment = {
    ...runIo,
    assemble,
    runApprovedPlan: async (deps) => {
      const ended = await (runIo.runApprovedPlan ?? engineRunApprovedPlan)(deps);
      engineNotices = ended.notices.length;
      return ended;
    },
  };
  return {
    io,
    addedNotices: (result) => {
      if (engineNotices === null || runObserver.onEvent === undefined) return;
      for (const text of result.notices.slice(engineNotices)) deliver(runObserver, { kind: "notice", text });
    },
  };
}
