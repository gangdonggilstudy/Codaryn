/**
 * `codaryn report --workspace <dir> --run <runId> [--json]` (U-5): a summary of one run for a
 * person, built from `<root>/.codaryn/runs/<runId>/result.json` and `journal.jsonl` only.
 * Those files hold masked text; nothing else is read and nothing is changed. The run directory
 * must be the workspace's own (not a link), every record must belong to the run, and every field
 * the report uses is checked. Printed text has control characters replaced and key-shaped text
 * hidden (`./text-safety.ts`), because commands allowed during the run could have written into
 * the records.
 */

import { REPORT_FIXED_LIMITS as reportFixedLimits, APPLY_REPORT_FIXED_LIMITS as applyReportFixedLimits } from "../presentation/report.js";
import { renderLocalizedApplyReport, renderLocalizedReport } from "../presentation/report-localized.js";
import type { MessageLanguage } from "../contracts/index.js";
export { renderReport, renderApplyReport } from "../presentation/report.js";
export const REPORT_FIXED_LIMITS = reportFixedLimits;
export const APPLY_REPORT_FIXED_LIMITS = applyReportFixedLimits;
export type { ReportPlanApply } from "../presentation/report.js";
import { parseReportArgs } from "./args.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { argumentsError, cliError } from "../app/prepare.js";
import { knownKeyValues } from "../app/input/settings.js";
import type { SettingsEnvironment } from "../app/input/settings.js";
import { hideKeys, hideKeysInStrings } from "../app/input/text-safety.js";
import type { ReportReadEnvironment } from "../app/report-read.js";
import { readReport } from "../app/report-read.js";

// U-311 (CLI migration C-8): the report's reading and checks are the app layer's (src/app/report-read.ts);
// these names stay for the tests and the app layer's app.ts and run-events.ts (plan A).
export { failedCallsIn, readApplyResult, readResult, summarizeApplyJournal, summarizeJournal } from "../app/report-read.js";
export type { ReportReadEnvironment } from "../app/report-read.js";

export interface ReportEnvironment extends ReportReadEnvironment {
  readonly argv: readonly string[];
  /** Read only to keep the current key out of the printed report. */
  readonly env: SettingsEnvironment;
  /** DR-77: chosen by CLI main; direct callers default to English. Ignored for JSON. */
  readonly language?: MessageLanguage;
}

// ---------------------------------------------------------------------------------------------
// Files

export async function runReport(io: ReportEnvironment): Promise<CommandOutcome> {
  const parsed = parseReportArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const { json } = parsed.args;

  // U-311 (C-8): the report's rules are the app layer's (readReport); the JSON line and the text are the CLI's.
  const read = await readReport(io, { workspace: parsed.args.workspace, run: parsed.args.runId, planApplyLine: !json });
  if (!read.ok) return read.outcome;
  const { report, failedToolCalls, planApply } = read;

  const currentKey = knownKeyValues(io.env);
  let text: string;
  try {
    // N-27 (c): keys are hidden in the strings before the JSON is written, as in the text.
    text = json
      ? jsonLine(hideKeysInStrings(report, currentKey))
      : "runKind" in report
        ? renderLocalizedApplyReport(io.language ?? "en", report, currentKey)
        : renderLocalizedReport(io.language ?? "en", report, currentKey, failedToolCalls, planApply);
  } catch {
    // X-2: everything printed comes from the records, so a failure here means records a run
    // would not write (changed or broken after the run), not an internal error.
    return cliError("invalid_run_record", "the run's records cannot be shown");
  }
  return { text: hideKeys(text, currentKey), exitCode: report.exitCode };
}
