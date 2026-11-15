import { planApplyStateOf } from "../contracts/index.js";
import type { RunReportOutput, ApplyReportOutput } from "../contracts/index.js";
import type { KnownKeys } from "../app/input/security/index.js";
import { renderRunReportCore, renderApplyReportCore } from "./report-core.js";
import { reportWords } from "./report-words.js";

export const REPORT_FIXED_LIMITS: readonly string[] = [
  "A pass means the configured verifiers passed. It is not a review of the change.",
  "The change list holds file tool writes only. Commands allowed by the policy may have changed other files.",
  "There is no OS isolation: allowed commands ran with the user's rights and could reach the network.",
  "This report reads the run's own records. Commands allowed during the run could have changed them.",
  "Masking hides only the values registered for this run and the forms of them it looks for. A secret that was not registered, another form of a value or text in another encoding (such as UTF-16) is not masked.",
];

export const APPLY_REPORT_FIXED_LIMITS: readonly string[] = [
  "A pass means the inventory check and the configured verifiers passed. It is not a review of the plan.",
  "There is no OS isolation: command verifiers ran with the user's rights and could reach the network.",
  "This report reads the apply run's own records. Commands allowed in other runs could have changed them.",
];

export type ReportPlanApply = ReturnType<typeof planApplyStateOf>;
const ENGLISH = reportWords("en");

export function renderReport(report: RunReportOutput, currentKey: KnownKeys = null, failedToolCalls = 0, planApply: ReportPlanApply = null): string {
  return renderRunReportCore(ENGLISH, REPORT_FIXED_LIMITS, report, currentKey, failedToolCalls, planApply);
}

export function renderApplyReport(report: ApplyReportOutput, currentKey: KnownKeys = null): string {
  return renderApplyReportCore(ENGLISH, APPLY_REPORT_FIXED_LIMITS, report, currentKey);
}
