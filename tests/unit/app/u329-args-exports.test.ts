/** U-329: public parser bindings and both directions of all legacy type exports. */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as legacy from "../../../src/cli/args.js";
import * as canonical from "../../../src/app/input/args.js";
import { RUN_ID_PATTERN } from "../../../src/contracts/index.js";

const names = [
  "APPLY_USAGE", "CURRENT_DIRECTORY", "CURRENT_DIRECTORY_HINT", "DOCTOR_USAGE", "ENV_FILE_REFUSED_MESSAGE",
  "INIT_USAGE", "MODELS_USAGE", "PLAN_USAGE", "REPORT_USAGE", "REVERT_USAGE", "REVIEW_USAGE",
  "RUNS_USAGE", "RUN_ID_PATTERN", "RUN_USAGE", "TASK_FORM_USAGE", "USAGE", "parseApplyArgs", "parseArgs",
  "parseDoctorArgs", "parseInitArgs", "parseModelsArgs", "parsePlanArgs", "parseReportArgs", "parseRevertArgs",
  "parseReviewArgs", "workflowOf",
] as const;

test("U-329: both public namespaces preserve the full legacy value inventory", () => {
  assert.deepEqual(Object.keys(legacy).sort(), [...names].sort());
  assert.deepEqual(Object.keys(canonical).sort(), [...names].sort());
});
for (const name of names) test(`U-329: ${name} is the same legacy/canonical binding`, () => {
  assert.strictEqual(legacy[name], canonical[name]);
});
test("U-329: RUN_ID_PATTERN keeps the contracts binding", () => {
  assert.strictEqual(canonical.RUN_ID_PATTERN, RUN_ID_PATTERN);
});

// Compile-only compatibility of every public type, including the three original type re-exports.
type BothWays<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;
type Pairs = [
  [legacy.RunArgs, canonical.RunArgs], [legacy.RunInput, canonical.RunInput],
  [legacy.TaskFormArgs, canonical.TaskFormArgs], [legacy.ArgsFailure, canonical.ArgsFailure],
  [legacy.ParseArgsOutcome, canonical.ParseArgsOutcome], [legacy.RevertArgs, canonical.RevertArgs],
  [legacy.ParseRevertArgsOutcome, canonical.ParseRevertArgsOutcome], [legacy.ReportArgs, canonical.ReportArgs],
  [legacy.ParseReportArgsOutcome, canonical.ParseReportArgsOutcome], [legacy.DoctorArgs, canonical.DoctorArgs],
  [legacy.ParseDoctorArgsOutcome, canonical.ParseDoctorArgsOutcome], [legacy.ModelsArgs, canonical.ModelsArgs],
  [legacy.ParseModelsArgsOutcome, canonical.ParseModelsArgsOutcome], [legacy.InitArgs, canonical.InitArgs],
  [legacy.ParseInitArgsOutcome, canonical.ParseInitArgsOutcome], [legacy.PlanArgs, canonical.PlanArgs],
  [legacy.ApplyArgs, canonical.ApplyArgs], [legacy.ReviewArgs, canonical.ReviewArgs],
];
type Checks = { [K in keyof Pairs]: Pairs[K] extends [infer A, infer B] ? BothWays<A, B> : never };
type _AllPublicTypesRemainCompatible = Assert<Checks[number]>;
type _OriginalCanonicalTypesRemainCompatible = Assert<
  BothWays<canonical.RunArgs, import("../../../src/app/prepare.js").RunArgs> |
  BothWays<canonical.RunInput, import("../../../src/app/prepare.js").RunInput> |
  BothWays<canonical.TaskFormArgs, import("../../../src/app/plan-view.js").TaskFormArgs>
>;
