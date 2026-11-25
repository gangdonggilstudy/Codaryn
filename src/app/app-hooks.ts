import type {
  AnthropicProviderDeps,
  ApiProviderDeps,
  ApiProviderName,
  ApplyPlan,
  CreateAnthropicProvider,
  ListAnthropicModels,
  RunApprovedPlan,
  RunTask,
} from "../contracts/index.js";
import type { CleanupOperations } from "../store/index.js";
import type { ReadChangesDeps } from "./changes.js";
import type { ApplyCheckOperations } from "./check-apply.js";
import type { ModelsCommandEnvironment } from "./models-command.js";
import type { WorkspaceTextOperations } from "./workspace-text.js";

/**
 * Replaceable parts, for tests: the Anthropic provider factory and its transport (as the CLI's
 * own tests inject them), and the engine. Leave them out in real use.
 */
export interface AppHooks {
  readonly createAnthropicProvider?: CreateAnthropicProvider;
  readonly anthropicDeps?: AnthropicProviderDeps;
  /**
   * GUI F-2 (R21b-I-1): each API provider's injection points (its `fetch`, its `sleep`), as the CLI's
   * runCli and runModels take them. For anthropic an entry here is used instead of `anthropicDeps`.
   * Absent: the provider uses the global fetch.
   */
  readonly providerDeps?: { readonly [P in ApiProviderName]?: ApiProviderDeps };
  readonly runTask?: RunTask;
  /** U-218: the engine of a run that carries out an approved run plan (runApprovedPlan of src/engine when absent). Tests only. */
  readonly runApprovedPlan?: RunApprovedPlan;
  /** The apply engine (`applyPlan` of src/engine when absent). Tests give a stand-in to see what it was given. */
  readonly applyPlan?: ApplyPlan;
  /** The model listing (`listAnthropicModels` when absent). Tests give a fake so nothing is sent. */
  readonly listModels?: ListAnthropicModels;
  /** The config writer of `selectModel` (`writeConfigAtomic` when absent). */
  readonly writeConfig?: ModelsCommandEnvironment["writeConfig"];
  /** The store's cleanup operations (its removal, its mark writer). Tests give a removal that refuses. */
  readonly cleanupOperations?: CleanupOperations;
  /** U-91: the check's executor file operations, probe removal and lock release. Tests give ones that fail. */
  readonly applyCheck?: ApplyCheckOperations;
  /** U-172: writeWorkspaceText's lock release, and a pause at each check (V-1's races). Tests only. */
  readonly workspaceText?: WorkspaceTextOperations;
  /** U-234: the changes view's reads (a wrapped workspace). Tests only; the signal comes from the call. */
  readonly changesRead?: Pick<ReadChangesDeps, "createWorkspace">;
}
