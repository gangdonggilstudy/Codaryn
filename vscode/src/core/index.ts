/**
 * The VS Code extension's core (vscode-extension 3, V3): everything that does not need the VS Code
 * API. The UI part (`vscode/src/ui`, later, after VX-D4) spawns the CLI child with `spawnPlan`,
 * feeds its output through `LineSplitter`, `parseProtocolLine` and `parseFinalStdout`, and draws
 * the `RunView` that `reduceRun` returns.
 */

export {
  applyArgs,
  changesArgs,
  childEnvironment,
  doctorArgs,
  planArgs,
  REMOVED_CHILD_VARIABLES,
  reportArgs,
  revertArgs,
  reviewArgs,
  runArgs,
  runsArgs,
  spawnPlan,
} from "./args.js";
export type { ArgsOutcome, RunArgsRequest, SpawnPlan, SpawnPlanInput, SpawnPlanOutcome, TaskFormArgs, TaskFormInput } from "./args.js";
export { LineSplitter, MAX_LINE_LENGTH, answerLine, parseFinalStdout, parseProtocolLine } from "./protocol.js";
export type { FinalOutcome, FinalOutput, IgnoredReason, ProtocolLine } from "./protocol.js";
export { INITIAL_RUN_VIEW, canCancel, nextScreenOf, reduceRun, shutdownSteps } from "./state.js";
export type { NextScreen, Phase, RunAction, RunView } from "./state.js";
