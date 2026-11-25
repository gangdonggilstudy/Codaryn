/**
 * What the page may call (the preload's `window.codaryn`) and checks on what comes back. The page
 * trusts nothing it receives: every reply is checked before use, and text goes in as textContent.
 * Types only come from src/shared (erased at build time); the page loads nothing outside its own
 * directory.
 */

// Preserve module evaluation order.
import "./api-core.js";
export { asForm, asWorkspace } from "./api-core.js";
export type { Workspace } from "./api-core.js";
export { asInfo, asOpen, asRecent, asTree, asText, asSaveText, asDoctor, asRestart, asEngineState, asCopy } from "./api-workspace.js";
export { asSettings, asProposal, asWritten, asModels, asSelectModel, asCreateSettings, asSuggestions } from "./api-settings.js";
export { asStartRun, asRunEvents, asRunDone, asRuns, asRevert, asPlan, asReview, asChanges, asPlanCheck, asRunEventsPage, asReport, asStateSummary, asCleanupPreview, asCleanupResult, asSaveReport } from "./api-runs.js";

export interface CodarynApi {
  info(): Promise<unknown>;
  openFolder(): Promise<unknown>;
  recent(): Promise<unknown>;
  openRecent(id: string): Promise<unknown>;
  forgetRecent(id: string): Promise<unknown>;
  tree(workspace: string, node: string | null, offset: number): Promise<unknown>;
  reveal(workspace: string, node: string): Promise<unknown>;
  /** U-174 (DR-72, 3.14): the text view of a tree or changes entry, by its id (the main process resolves and checks it). */
  openText(workspace: string, node: string): Promise<unknown>;
  /** U-184 (DR-72, 3.14): saves the text view's text with its edit token (the main process asks once per opened file and the app layer judges). */
  saveText(token: string, text: string): Promise<unknown>;
  /** U-184: tells the main process whether the text view holds an unsaved edit (closing the window asks then). */
  textDirty(dirty: boolean): Promise<unknown>;
  /** U-62: copies a run id or a digest's first 12 characters (the main process takes nothing else). */
  copyText(text: string): Promise<unknown>;
  /** U-103 (3.3): copies a tree entry's relative path, by its id (the main process resolves and checks it). */
  copyPath(workspace: string, node: string): Promise<unknown>;
  /** U-69 (3.10): shows the config file in the file manager (the main process has its path; the page does not). */
  revealConfig(): Promise<unknown>;
  /** U-70 (4.5): keeps the screen shown or the file panel's width (the main process checks both). */
  saveUi(change: { readonly screen?: string; readonly treeWidth?: number }): Promise<unknown>;
  doctor(workspace: string | null): Promise<unknown>;
  settings(): Promise<unknown>;
  listModels(provider: string): Promise<unknown>;
  selectModel(entry: string): Promise<unknown>;
  proposeSettings(edit: Readonly<Record<string, unknown>>): Promise<unknown>;
  applySettings(token: string): Promise<unknown>;
  stateSummary(workspace: string): Promise<unknown>;
  previewCleanup(workspace: string, selection: Readonly<Record<string, unknown>>): Promise<unknown>;
  applyCleanup(token: string): Promise<unknown>;
  startRun(workspace: string, goal: string, profile: string | null, workflow: string | null): Promise<unknown>;
  /** U-63: a run of a task file the main process's OS dialog chooses (and a variables file when `withVars`). */
  startTaskRun(workspace: string, withVars: boolean): Promise<unknown>;
  cancelRun(): Promise<unknown>;
  onRunEvents(listener: (payload: unknown) => void): void;
  onRunDone(listener: (payload: unknown) => void): void;
  /** U-64: starts the engine again after it ended. */
  restartEngine(): Promise<unknown>;
  /** U-64: the engine's state when it changes ("ready", or an error code). */
  onEngineState(listener: (payload: unknown) => void): void;
  /** U-123: the main process dropped the tree's ids (settings written). */
  onTreeReset(listener: () => void): void;
  listRuns(workspace: string): Promise<unknown>;
  previewRevert(workspace: string, runId: string): Promise<unknown>;
  revert(preview: string): Promise<unknown>;
  revertConsent(retry: string): Promise<unknown>;
  report(workspace: string, runId: string): Promise<unknown>;
  saveReport(workspace: string, runId: string): Promise<unknown>;
  createSettings(workspace: string | null): Promise<unknown>;
  settingsSuggestions(workspace: string): Promise<unknown>;
  plan(workspace: string, runId: string, profile: string | null, workflow: string | null): Promise<unknown>;
  applyPlan(approval: string, askConsent: boolean): Promise<unknown>;
  review(workspace: string, runId: string, profile: string | null, workflow: string | null, decision: "accept" | "reject", note: string | null): Promise<unknown>;
  changes(workspace: string, runId: string, profile: string | null, workflow: string | null): Promise<unknown>;
  /** U-119 (3.9): the check before an apply of the plan a view showed, by its approval token. */
  checkPlan(approval: string): Promise<unknown>;
  /** U-118 (3.7): one page of a run's records as the progress list's lines. */
  runEvents(workspace: string, runId: string, profile: string | null, workflow: string | null, offset: number): Promise<unknown>;
  onWorkspaceOpened(listener: (payload: unknown) => void): void;
}

declare global {
  interface Window {
    readonly codaryn: CodarynApi;
  }
}
