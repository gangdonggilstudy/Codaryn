/** Language-explicit core entrypoints. CLI/app/GUI integration belongs to the next unit. */
import type { ApplyReportOutput, MessageLanguage, RunReportOutput } from "../contracts/index.js";
import type { KnownKeys } from "../app/input/security/index.js";
import type { ReportPlanApply } from "./report.js";
import { APPLY_REPORT_FIXED_LIMITS, REPORT_FIXED_LIMITS } from "./report.js";
import { renderApplyReportCore, renderRunReportCore } from "./report-core.js";
import { reportWords } from "./report-words.js";

const WORDS = { en: reportWords("en"), ko: reportWords("ko") };
export function renderLocalizedReport(language: MessageLanguage, report: RunReportOutput, currentKey: KnownKeys = null, failedToolCalls = 0, planApply: ReportPlanApply = null): string {
  return renderRunReportCore(WORDS[language], REPORT_FIXED_LIMITS, report, currentKey, failedToolCalls, planApply);
}
export function renderLocalizedApplyReport(language: MessageLanguage, report: ApplyReportOutput, currentKey: KnownKeys = null): string {
  return renderApplyReportCore(WORDS[language], APPLY_REPORT_FIXED_LIMITS, report, currentKey);
}
