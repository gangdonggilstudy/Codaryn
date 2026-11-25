/** Report, revert and run lookup commands for the app; the environment is read only on a call. */
import type { ReportOutput, RunsOutput } from "../contracts/index.js";
import { inspectRun, listRuns as storeListRuns, readRevertRecord, revertRun, writeRevertRecord } from "../store/index.js";
import { renderLocalizedApplyReport, renderLocalizedReport } from "../presentation/report-localized.js";
import { jsonLine } from "../presentation/json.js";
import type { CommandOutcome } from "./command-outcome.js";
import { revertConsentOf } from "./consent.js";
import { copyEnvironment } from "./environment.js";
import { INTERNAL_ERROR, appError, fromCliError } from "./errors.js";
import { parseReportArgs, parseRevertArgs } from "./input/args.js";
import { knownKeyValues } from "./input/settings.js";
import { hideKeys, hideKeysInStrings } from "./input/text-safety.js";
import { argumentsError, cliError } from "./prepare.js";
import { readReport } from "./report-read.js";
import { createRevertCommand, revertOnce, revertOutput, startRevert } from "./revert-command.js";
import { listRunsIn, resolveRunIn } from "./runs.js";
import type {
  AppCallOutcome,
  AppEnvironment,
  AppError,
  ListRunsRequest,
  ReportMarkdown,
  ReportRequest,
  ResolvedRun,
  ResolveRunRequest,
  RevertCallOutcome,
  RevertRequest,
} from "./types.js";

export function createReportCommands(
  environment: AppEnvironment,
  platform: NodeJS.Platform,
  jsonOutcome: <T extends { readonly kind: string }>(outcome: CommandOutcome, kind: T["kind"]) => AppCallOutcome<T>,
  commandError: (outcome: CommandOutcome) => AppError,
) {
  async function report(request: ReportRequest): Promise<AppCallOutcome<ReportOutput>> {
    try {
      // U-316: keep parsing and final masking, while the app reader owns the stored-record rules.
      const io = {
        argv: ["report", "--workspace", request.workspace, "--run", request.runId, "--json"],
        cwd: environment.cwd,
        env: copyEnvironment(environment.env, platform),
        platform,
        listRuns: storeListRuns,
      };
      const parsed = parseReportArgs(io.argv);
      if (!parsed.ok) return { ok: false, error: fromCliError(argumentsError(parsed).output) };
      const read = await readReport(io, { workspace: parsed.args.workspace, run: parsed.args.runId, planApplyLine: false });
      if (!read.ok) return { ok: false, error: commandError(read.outcome) };
      const currentKey = knownKeyValues(io.env);
      let text: string;
      try {
        text = jsonLine(hideKeysInStrings(read.report, currentKey));
      } catch {
        return { ok: false, error: fromCliError(cliError("invalid_run_record", "the run's records cannot be shown").output) };
      }
      // Preserve the second, whole-text masking pass and JSON parsing failure behavior.
      return jsonOutcome<ReportOutput>({ text: hideKeys(text, currentKey), exitCode: read.report.exitCode }, "report");
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /** GU-3: `codaryn report` without `--json`, as main.ts prints it. */
  async function reportMarkdown(request: ReportRequest): Promise<AppCallOutcome<ReportMarkdown>> {
    // The values go after their flags; one that starts with "-" could be read as a flag instead.
    if (request.workspace.startsWith("-") || request.runId.startsWith("-")) {
      return { ok: false, error: appError("invalid_arguments", "the workspace and the run id cannot start with '-'") };
    }
    try {
      const io = {
        argv: ["report", "--workspace", request.workspace, "--run", request.runId],
        cwd: environment.cwd,
        env: copyEnvironment(environment.env, platform),
        platform,
        listRuns: storeListRuns,
      };
      const parsed = parseReportArgs(io.argv);
      if (!parsed.ok) return { ok: false, error: fromCliError(argumentsError(parsed).output) };
      const read = await readReport(io, { workspace: parsed.args.workspace, run: parsed.args.runId, planApplyLine: true });
      if (!read.ok) return { ok: false, error: commandError(read.outcome) };
      const currentKey = knownKeyValues(io.env);
      let text: string;
      try {
        text = "runKind" in read.report
          ? renderLocalizedApplyReport(request.language ?? "en", read.report, currentKey)
          : renderLocalizedReport(request.language ?? "en", read.report, currentKey, read.failedToolCalls, read.planApply);
      } catch {
        return { ok: false, error: fromCliError(cliError("invalid_run_record", "the run's records cannot be shown").output) };
      }
      return { ok: true, output: { kind: "report_markdown", markdown: hideKeys(text, currentKey), exitCode: read.report.exitCode } };
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async function revert(request: RevertRequest): Promise<RevertCallOutcome> {
    // DR-25: only the consent the person gave on screen for this run, as the adapter's consent.
    const consent = revertConsentOf(request);
    if (!consent.ok) return consent;
    try {
      // U-322: keep the request/parser order and app-specific store options. The app rules own
      // one revert; an adapter never asks at a terminal or starts the CLI's second attempt.
      const io = {
        argv: ["revert", "--workspace", request.workspace, "--run", request.runId, ...(request.dryRun === true ? ["--dry-run"] : [])],
        cwd: environment.cwd,
        isDirectory: environment.isDirectory,
        clock: environment.clock,
        randomBytes: environment.randomBytes,
        revert: createRevertCommand(revertRun, {
          dryRun: revertRun,
          listRuns: storeListRuns,
          readRecord: readRevertRecord,
          writeRecord: writeRevertRecord,
          inspect: inspectRun,
        }),
        adapter: { unsafeMoveConsent: consent.consent },
      };
      const parsed = parseRevertArgs(io.argv);
      if (!parsed.ok) return { ok: false, error: fromCliError(argumentsError(parsed).output) };
      const { runId, dryRun, allowUnsafeMove, workspace } = parsed.args;
      const start = await startRevert(io, { workspace, dryRun, allowUnsafeMove });
      if (!start.ok) return { ok: false, error: fromCliError(start.outcome.output) };
      const result = await revertOnce(io, start.started, runId, dryRun, start.started.consent);
      if (result === null) return { ok: false, error: fromCliError(cliError("internal_error", "the revert stopped because of an internal error").output) };
      if (!result.ok) return { ok: false, error: fromCliError(cliError(result.code, result.message).output) };
      const { output } = revertOutput(result, dryRun);
      // U-229 (R-106 L-1, after U-220): a lock the revert could not release is told beside its output.
      return result.lockLeft === true ? { ok: true, output, lockLeft: true } : { ok: true, output };
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async function listRuns(request: ListRunsRequest): Promise<AppCallOutcome<RunsOutput>> {
    try {
      return await listRunsIn(environment, request);
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async function resolveRun(request: ResolveRunRequest): Promise<AppCallOutcome<ResolvedRun>> {
    try {
      return await resolveRunIn(environment, request);
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  return { report, reportMarkdown, revert, listRuns, resolveRun };
}
