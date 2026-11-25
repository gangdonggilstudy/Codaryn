/** Apply and preflight commands; each call keeps its own gates, observer and reading context. */
import { workflowSettingsOf } from "../contracts/index.js";
import type { ApplyPlan, ResolvedTaskSpec, RunApprovedPlan, RunTask } from "../contracts/index.js";
import { applyPlan as engineApplyPlan } from "../engine/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import { applyLife } from "./apply-life.js";
import type { ApplyLifeEnd } from "./apply-life.js";
import { applyArguments, deliverApply } from "./apply.js";
import type { AppHooks } from "./app-hooks.js";
import { checkApplyArguments, checkApplyIn } from "./check-apply.js";
import { changesPlanViewIn, checkChangesPlanFiles, storedPlanKindOf } from "./changes-plan.js";
import type { CommandOutcome } from "./command-outcome.js";
import { unsafeMoveConsentOf } from "./consent.js";
import { INTERNAL_ERROR, appError, fromCliError } from "./errors.js";
import { parseApplyArgs } from "./input/args.js";
import type { createPlanCommands } from "./plan-commands.js";
import { prepareFor } from "./plan-view.js";
import { argumentsError } from "./prepare.js";
import type { PrepareEnvironment } from "./prepare.js";
import type { createReadingContext } from "./reading-context.js";
import type { appRunHooks as AppRunHooks } from "./run-hooks.js";
import type { RunLifeEnvironment } from "./run-life.js";
import { workspaceRootOf } from "./runs.js";
import type { AppCallOutcome, AppEnvironment, AppError, ApplyHandle, ApplyObserver, ApplyOutcome, ApplyPlanRequest, CheckApplyRequest, PlanCheck } from "./types.js";

export function createApplyCommands(
  environment: AppEnvironment,
  platform: NodeJS.Platform,
  hooks: Pick<AppHooks, "applyPlan" | "applyCheck" | "runTask" | "runApprovedPlan">,
  appRunHooks: typeof AppRunHooks,
  nextMacrotask: () => Promise<void>,
  cliEnvironmentOf: (
    argv: readonly string[],
    env: Record<string, string | undefined>,
    parts: Pick<RunLifeEnvironment, "assemble" | "cancelSignal"> & { readonly runTask?: RunTask; readonly runApprovedPlan?: RunApprovedPlan },
  ) => PrepareEnvironment & RunLifeEnvironment & { readonly argv: readonly string[] },
  planCommandEnvironment: ReturnType<typeof createPlanCommands>["planCommandEnvironment"],
  plan: ReturnType<typeof createPlanCommands>["plan"],
  readingSecrets: ReturnType<typeof createReadingContext>["readingSecrets"],
  commandError: (outcome: CommandOutcome) => AppError,
) {

  /**
   * DR-1, DR-2, DR-21, U-323: applyLife as an adapter: approval is recorded as `adapter`, consent
   * comes only from the request, and the app lifetime chooses by the task's plan setting.
   * - A plan of moves (plan "apply"): the engine is the same `applyPlan`; only its journal is
   *   observed by the lifetime so masked events reach `observer.onEvent` (start records left out).
   * - U-218 (DR-69 B-4, after U-195): a run plan (plan "run") is carried out by a model run, the
   *   lifetime's carrying run with the hooks of a run through the app
   *   (appRunHooks), whose events reach `observer.onRunEvent` and permission questions
   *   `observer.confirm`. The outcome is that run's EngineResult (planRunId, planDigest) with
   *   lockLeft as a run's.
   * Either way the handle, with the id of the run that applies, comes before the first event, and
   * handle.cancel() is the one cancel channel.
   */
  async function applyPlan(
    request: ApplyPlanRequest,
    observer?: ApplyObserver,
  ): Promise<{ readonly ok: true; readonly handle: ApplyHandle } | { readonly ok: false; readonly error: AppError }> {
    const consent = unsafeMoveConsentOf(request);
    if (!consent.ok) return consent;
    const argv = applyArguments(request);
    const io = planCommandEnvironment(argv);
    // U-323: the lifetime alone delivers masked events. Do not pass or inspect the consumer's
    // raw callbacks. Moves subscribe at the original engine boundary; changes look up each call.
    let movesSubscribed = false;
    const movesEventErrors = new Map<number, { readonly value: unknown }>();
    const movesEvent: NonNullable<ApplyObserver["onEvent"]> = (event) => {
      const seq = event.kind === "record" ? event.record.seq : null;
      try { deliverApply(observer, event); }
      catch (value) { if (seq !== null) movesEventErrors.set(seq, { value }); }
    };
    const forwarding: ApplyObserver | undefined =
      observer === undefined
        ? undefined
        : {
            get onEvent() { return movesSubscribed ? movesEvent : undefined; },
            onRunEvent: (event) => observer.onRunEvent?.(event),
            confirm: (question, signal) => {
              const ask = observer.confirm;
              return typeof ask === "function" ? ask.call(observer, question, signal) : Promise.resolve({ decision: "dismissed" });
            },
          };
    const run = appRunHooks(io.env, undefined, environment, platform, hooks, nextMacrotask);
    let reportMoves: (runId: string) => void = () => {};
    const movesStarted = new Promise<string>((resolve) => {
      reportMoves = resolve;
    });
    let openMoves: () => void = () => {};
    const movesGate = new Promise<void>((resolve) => {
      openMoves = resolve;
    });
    const wrapped: ApplyPlan = async (deps) => {
      // Match the old subscription lookup before reporting the run id or waiting on the gate.
      movesSubscribed = observer?.onEvent !== undefined;
      // deliverApply's first getter used to be outside its callback catch. Preserve that failure
      // after the lifetime's single event delivery, without adding another event/masking wrapper.
      const journal: typeof deps.journal = {
        async append(entry) {
          const stored = await deps.journal.append(entry);
          const error = movesEventErrors.get(stored.seq);
          if (error !== undefined) {
            movesEventErrors.delete(stored.seq);
            const { value } = error;
            throw value;
          }
          return stored;
        },
        close: () => deps.journal.close(),
      };
      reportMoves(deps.runId);
      await movesGate;
      await nextMacrotask();
      return (hooks.applyPlan ?? engineApplyPlan)({ ...deps, journal });
    };
    const applying = {
      ...io,
      applyPlan: wrapped,
      adapter: { unsafeMoveConsent: consent.consent },
      cancelSignal: run.parts.cancelSignal,
      run: cliEnvironmentOf(argv, io.env, run.parts),
    };
    const running = (async (): Promise<ApplyLifeEnd> => {
      const parsed = parseApplyArgs(argv);
      if (!parsed.ok) return { kind: "error", outcome: argumentsError(parsed) };
      const args = parsed.args;
      const ready = await prepareFor(applying, args.form, args.runId, args.cancelFile, args.quiet);
      if (!ready.ok) return { kind: "error", outcome: ready.outcome };
      return applyLife(applying, args, ready.value, { observer: forwarding });
    })().catch(() => null);
    const failure = (end: ApplyLifeEnd | null): AppError => {
      if (end?.kind === "error") return commandError(end.outcome);
      if (end?.kind === "carried" && end.end.kind === "refused") return fromCliError(end.end.output);
      return INTERNAL_ERROR;
    };

    const first = await Promise.race([
      movesStarted.then((runId) => ({ kind: "started" as const, runId })),
      run.started.then((info) => ({ kind: "started" as const, runId: info.runId })),
      running.then((outcome) => ({ kind: "ended" as const, outcome })),
    ]);
    if (first.kind === "ended") {
      return { ok: false, error: failure(first.outcome) };
    }
    const done: Promise<ApplyOutcome> = running.then((outcome): ApplyOutcome => {
      if (outcome?.kind === "applied") return { ok: true, output: outcome.result };
      if (outcome?.kind === "carried" && outcome.end.kind === "ended") {
        const result = outcome.end.result;
        return run.ended(result).lockLeft ? { ok: true, output: result, lockLeft: true } : { ok: true, output: result };
      }
      return { ok: false, error: failure(outcome) };
    });
    const handle: ApplyHandle = {
      runId: first.runId,
      cancel: run.cancel,
      done,
    };
    openMoves();
    run.open();
    return { ok: true, handle };
  }

  /**
   * U-91 (GUI 3.9, DR-21, adapter-contract 5.14): the apply's preflight for a pending plan, under
   * the workspace lock, with nothing moved or recorded (check-apply.ts). The refusals first, as
   * `apply` makes them: the apply task's plan setting, the plan view's own (run, plan, DR-28), the
   * plan already applied, a records-changed mark, the digest.
   */
  async function checkApply(request: CheckApplyRequest): Promise<AppCallOutcome<PlanCheck>> {
    const checked = checkApplyArguments(request);
    if (!checked.ok) return checked;
    try {
      const probe = await readingSecrets(request.settings);
      if (!probe.ok) return probe;
      const planRoot = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
      if (!planRoot.ok) return planRoot;
      // Review R-103 L-1: a plan that cannot be read is refused with the store's code first, as the
      // plan view refuses it (the same store, the same codes), not taken for a plan of mode apply.
      const stored = await storedPlanKindOf(planRoot.value, checked.planRunId);
      if (!stored.ok) return { ok: false, error: appError(stored.code, `run ${checked.planRunId} has no plan that can be checked (${stored.code}); nothing was checked`) };
      // U-196 (DR-69 B-3, B-4): a run plan is checked as its run will judge it (changes-plan.ts).
      if (stored.kind === "changes") return await checkRunPlan(probe, planRoot.value, checked.planRunId, checked.digest);
      if (workflowSettingsOf(probe.task).plan !== "apply") {
        return { ok: false, error: appError("run_not_plan", 'the task given to the check does not resolve to a workflow with plan "apply"; nothing was checked') };
      }
      const shown = await plan({ settings: request.settings, runId: checked.planRunId });
      if (!shown.ok) return shown;
      if ("planKind" in shown.output) return { ok: false, error: appError("internal_error", "the plan changed its kind while it was checked; nothing was checked") };
      const view = { output: shown.output };
      if (view.output.appliedBy !== null) return { ok: false, error: appError("plan_already_applied", "that plan was already applied; nothing was checked") };
      if (view.output.recordsChanged === true) {
        return { ok: false, error: appError("plan_records_changed", "the plan run's records were changed by something other than the run, so its plan may not be the one shown; nothing was checked") };
      }
      if (!view.output.digest.startsWith(checked.digest)) {
        return { ok: false, error: appError("plan_not_approved", "the digest does not match the plan's digest; nothing was checked") };
      }
      return await checkApplyIn(
        {
          workspaceRoot: planRoot.value,
          task: probe.task,
          planRunId: checked.planRunId,
          digest: view.output.digest,
          inventoryLimitReached: view.output.inventoryLimitReached,
          clock: environment.clock,
          randomBytes: environment.randomBytes,
        },
        hooks.applyCheck,
      );
    } catch {
      return { ok: false, error: appError("internal_error", "the plan could not be checked; nothing was moved") };
    }
  }

  /**
   * U-196 (DR-69 B-3, B-4): checkApply on a run plan. The apply task must resolve to plan "run" (no
   * setting can before B-4, U-177); then the view's refusals as for a plan of mode apply (DR-28,
   * already carried out, records-changed mark, digest), then each planned file judged by the gate
   * the run will have (checkChangesPlanFiles). No lock, no probe, no move: those fields are empty.
   */
  async function checkRunPlan(
    probe: { readonly secrets: readonly string[]; readonly keys: readonly string[]; readonly task: ResolvedTaskSpec },
    workspaceRoot: string,
    planRunId: string,
    digest: string,
  ): Promise<AppCallOutcome<PlanCheck>> {
    if (workflowSettingsOf(probe.task).plan !== "run") {
      return { ok: false, error: appError("run_not_plan", 'the plan is a run plan: the task given to the check must resolve to a workflow with plan "run"; nothing was checked') };
    }
    const view = await changesPlanViewIn({ workspaceRoot, privacy: createPrivacyGateway({ secrets: probe.secrets }), keys: probe.keys }, planRunId);
    if (!view.ok) return view;
    const shown = view.output.output;
    if (shown.appliedBy !== null) return { ok: false, error: appError("plan_already_applied", "that plan was already carried out; nothing was checked") };
    if (shown.recordsChanged === true) {
      return { ok: false, error: appError("plan_records_changed", "the plan run's records were changed by something other than the run, so its plan may not be the one shown; nothing was checked") };
    }
    if (!shown.digest.startsWith(digest)) return { ok: false, error: appError("plan_not_approved", "the digest does not match the plan's digest; nothing was checked") };
    const problems = await checkChangesPlanFiles(
      {
        workspaceRoot,
        policy: probe.task.policy,
        ...(probe.task.writablePathSets === undefined ? {} : { writablePathSets: probe.task.writablePathSets }),
        // U-237 (R-108 H-2): the run's unreadable paths, as the carried-out run's gate has them.
        ...(probe.task.unreadablePaths === undefined ? {} : { unreadablePaths: probe.task.unreadablePaths }),
      },
      view.output.files,
    );
    return {
      ok: true,
      output: {
        kind: "plan_check",
        planKind: "changes",
        planRunId,
        digest: shown.digest,
        checkedAt: new Date(environment.clock.now()).toISOString(),
        problems: problems.map((item) => ({ index: item.index, problem: item.problem })),
        unsafeMoves: [],
        inventoryLimitReached: false,
        probesLeft: 0,
        probesRemoved: 0,
        lockLeft: false,
      },
    };
  }

  return { applyPlan, checkApply };
}
