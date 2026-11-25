/** Plan viewing and review commands; the environment and reading context are used per call. */
import type { AnyPlanOutput, ChangesPlanOutput, DefaultConfigLocation, ReviewOutput } from "../contracts/index.js";
import { createPrivacyGateway } from "../privacy/index.js";
import { listRuns as storeListRuns } from "../store/index.js";
import { changesPlanViewIn, storedPlanKindOf } from "./changes-plan.js";
import type { CommandOutcome } from "./command-outcome.js";
import { copyEnvironment, loadVarsInto } from "./environment.js";
import { INTERNAL_ERROR, fromCliError } from "./errors.js";
import { parsePlanArgs, parseReviewArgs } from "./input/args.js";
import { recordReview, showPlan } from "./plan-view.js";
import type { PlanViewEnvironment } from "./plan-view.js";
import { planArguments, reviewArguments } from "./plans.js";
import { argumentsError } from "./prepare.js";
import type { PrepareEnvironment } from "./prepare.js";
import type { createReadingContext } from "./reading-context.js";
import { runIdOf, workspaceRootOf } from "./runs.js";
import type { AppCallOutcome, AppEnvironment, AppError, PlanRequest, ReviewRequest } from "./types.js";

export function createPlanCommands(
  environment: AppEnvironment,
  platform: NodeJS.Platform,
  locate: PrepareEnvironment["locateInWorkspace"],
  relate: NonNullable<PrepareEnvironment["relatePaths"]>,
  defaultConfigOf: () => DefaultConfigLocation | null,
  readingSecrets: ReturnType<typeof createReadingContext>["readingSecrets"],
  commandError: (outcome: CommandOutcome) => AppError,
) {
  /**
   * The task form's environment for `plan`, `apply` and `review` (G-F), as main.ts builds it, with
   * this call's own environment copy: the variables file is loaded into it, never into the
   * caller's object or `process.env`.
   */
  function planCommandEnvironment(argv: readonly string[]): PlanViewEnvironment & { readonly argv: readonly string[]; readonly env: Record<string, string | undefined> } {
    const env = copyEnvironment(environment.env, platform);
    return {
      argv,
      env,
      cwd: environment.cwd,
      readFile: environment.readFile,
      isDirectory: environment.isDirectory,
      loadEnvFile: (file) => loadVarsInto(env, file, environment.readVarsFile),
      locateInWorkspace: locate,
      relatePaths: relate,
      installDir: environment.installDir,
      defaultConfig: defaultConfigOf(),
      clock: environment.clock,
      randomBytes: environment.randomBytes,
      listRuns: storeListRuns,
    };
  }

  /** DR-5, DR-17: `codaryn plan --json`: the stored plan masked again with this task form's secrets. Reads only. */
  async function plan(request: PlanRequest): Promise<AppCallOutcome<AnyPlanOutput>> {
    try {
      // U-196: a run plan is shown by the app until the CLI's plan view chooses by kind (U-195).
      const changes = await runPlanView(request);
      if (changes !== null) return changes;
      // U-308 (C-7a's app side): the plan view's rules are the app layer's (showPlan, plan-view.ts), no
      // longer the CLI's runPlan around them; the request is still judged by the CLI's parser, as before.
      const argv = planArguments(request);
      const parsed = parsePlanArgs(argv);
      if (!parsed.ok) return { ok: false, error: fromCliError(argumentsError(parsed).output) };
      const shown = await showPlan(planCommandEnvironment(argv), parsed.args.form, parsed.args.runId);
      if (!shown.ok) return { ok: false, error: commandError(shown.outcome) };
      // As jsonOutcome judged runPlan's JSON line: only a plan of mode apply is this call's output here.
      return shown.kind === "plan" ? { ok: true, output: shown.output } : { ok: false, error: INTERNAL_ERROR };
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /** GT-D6, R-4 L-4: `codaryn review --json`: the person's verdict, the note masked before it is stored. */
  async function review(request: ReviewRequest): Promise<AppCallOutcome<ReviewOutput>> {
    const args = reviewArguments(request);
    if (!args.ok) return args;
    try {
      // U-308 (C-7a's app side): the review's rules are the app layer's (recordReview, plan-view.ts), no
      // longer the CLI's runReview around them; the request is still judged by the CLI's parser, as before.
      const parsed = parseReviewArgs(args.argv);
      if (!parsed.ok) return { ok: false, error: fromCliError(argumentsError(parsed).output) };
      const review = parsed.args;
      const recorded = await recordReview(planCommandEnvironment(args.argv), { form: review.form, run: review.runId, verdict: review.verdict, note: review.note, revertLine: !review.json });
      if (!recorded.ok) return { ok: false, error: commandError(recorded.outcome) };
      return { ok: true, output: recorded.output };
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /** U-196: a run plan's view (changes-plan.ts), or null for any other request (the CLI's plan view then). */
  async function runPlanView(request: PlanRequest): Promise<AppCallOutcome<ChangesPlanOutput> | null> {
    if (typeof request !== "object" || request === null || typeof request.runId !== "string") return null;
    const probe = await readingSecrets(request.settings);
    if (!probe.ok) return null;
    const root = await workspaceRootOf(probe.workspaceRoot, environment.cwd);
    if (!root.ok) return null;
    const runId = await runIdOf(root.value, request.runId);
    if (!runId.ok) return null;
    const stored = await storedPlanKindOf(root.value, runId.value);
    // Not a run plan, or none that can be read: the CLI's plan view, which gives the store's code.
    if (!stored.ok || stored.kind !== "changes") return null;
    const view = await changesPlanViewIn({ workspaceRoot: root.value, privacy: createPrivacyGateway({ secrets: probe.secrets }), keys: probe.keys }, runId.value);
    return view.ok ? { ok: true, output: view.output.output } : view;
  }

  return { plan, review, planCommandEnvironment };
}
