/**
 * U-285 (CLI migration C-4): the run's assembly is the app layer's (src/app/assembly.ts); U-314 (C-9a):
 * so is the revert command (src/app/revert-command.ts). This file keeps the old names for the tests,
 * the pinned file (tests/unit/cli/sp0-pins.ts takes assembleRun), main.ts, revert.ts and the app layer
 * until they import from there (plan A).
 */

export { assembleRun, createAssemble } from "../app/assembly.js";
export type { ApprovedPlanParts, Assemble, AssembleHooks, AssemblyInput, AssemblyOutcome } from "../app/assembly.js";
export { createRevertCommand, revertStatus } from "../app/revert-command.js";
export type { PlanApply, RevertCommand, RevertCommandInput, RevertCommandOptions, RevertCommandOutcome } from "../app/revert-command.js";
