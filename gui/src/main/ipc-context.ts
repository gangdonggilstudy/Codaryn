/** Main IPC dependencies, timeouts and message lookup; public names pass through ipc.ts. */
import type { BrowserWindow } from "electron";
import type { EngineHost } from "./engine-client.js";
import type { ModelEntries, ModelListLimit } from "./model-entries.js";
import type { RunManager } from "./runs.js";
import type { ConsentRetry, RevertPreview, RunHistory } from "./history.js";
import type { CleanupPreviewRecord, CleanupPreviews } from "./cleanup-previews.js";
import type { SettingsProposal, SettingsProposals } from "./settings-proposals.js";
import type { PlanApproval, PlanApprovals } from "./plans.js";
import type { TextEdits } from "./text-edits.js";
import type { Workspaces } from "./workspaces.js";
import type { RestartReply, SettingsView, UiMemoryView } from "../shared/ipc.js";

export const DOCTOR_TIMEOUT_MS = 60_000;
export const MESSAGES_TIMEOUT_MS = 10_000;
export const TREE_TIMEOUT_MS = 30_000;
/** U-174: one text file (at most 256 KiB) read and masked. */
export const TEXT_TIMEOUT_MS = 30_000;
export const SETTINGS_TIMEOUT_MS = 30_000;
/** Listing and choosing a model ask the provider's API (Y-2): the request time limit and retries fit in this. */
export const MODELS_TIMEOUT_MS = 120_000;
/** startRun answers after its checks (the CLI's order), before the engine works; the run itself has no time limit here. */
export const START_TIMEOUT_MS = 120_000;
export const CANCEL_TIMEOUT_MS = 10_000;
export const RUNS_TIMEOUT_MS = 30_000;
/** U-119: the check hashes the plan's source files; a large plan takes longer than a listing. */
export const PLAN_CHECK_TIMEOUT_MS = 120_000;
/** A revert waits for the workspace lock and moves files back; its preview only reads. */
export const REVERT_TIMEOUT_MS = 120_000;

/** What `startRun` answers the window. */
export type StartRunReply = { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly code: string; readonly hint?: string };

export interface IpcDeps {
  readonly window: () => BrowserWindow | null;
  /** The engine host, or why there is none. */
  readonly host: () => Promise<{ readonly host: EngineHost } | { readonly failure: string }>;
  readonly workspaces: Workspaces;
  readonly osLocale: () => string;
  /** A workspace named on the command line of this start, already opened. */
  readonly initialWorkspace: () => { readonly handle: string; readonly name: string } | null;
  /** GU-6: the models of the last list, by entry id. */
  readonly modelEntries: ModelEntries;
  /** R21-I-3: one model list at a time, a few a minute. */
  readonly modelListLimit: ModelListLimit;
  /** Whether CODARYN_MODEL and CODARYN_LANG are set in the app's environment (never their values). */
  readonly envFacts: () => SettingsView["env"];
  /** GU-3: the one run at a time. */
  readonly runs: RunManager;
  /** The window's language once the engine host chose it (for the main process's own dialogs). */
  readonly onLanguage: (language: "ko" | "en") => void;
  /** GU-4: the run lists and revert previews. */
  readonly history: RunHistory;
  /** GU-4 (6.6): asks the person (an OS dialog) whether to revert as previewed; true only on "revert". */
  readonly confirmRevert: (preview: RevertPreview) => Promise<boolean>;
  /** GU-3 (3.7): the OS save dialog: where a report goes (null: cancelled). */
  readonly chooseSavePath: (name: string) => Promise<string | null>;
  /** GU-4 (3.8), DR-39, DR-44: the cleanup previews shown, and the main process's questions before cleaning. */
  readonly cleanupPreviews: CleanupPreviews;
  /** The plan as shown (counts, sizes, the digest's start); "do not clean" is the default. */
  readonly confirmCleanup: (record: CleanupPreviewRecord) => Promise<boolean>;
  /** DR-44 (a): apart, the records of runs not (or only partly) reverted; "keep them" is the default. */
  readonly confirmCleanupNotReverted: (record: CleanupPreviewRecord) => Promise<boolean>;
  /** DR-9: apart, the discarded-files folders (people's files, deleted for good); "keep them" is the default. */
  readonly confirmCleanupDiscarded: (record: CleanupPreviewRecord) => Promise<boolean>;
  /** GU-6: the settings change proposals shown. */
  readonly settingsProposals: SettingsProposals;
  /** GU-6 (6.6): asks the person (an OS dialog) whether to write a change that widens what runs may do. */
  readonly confirmWidening: (proposal: SettingsProposal) => Promise<boolean>;
  /** DR-25: asks the person (a separate OS dialog) for the consent to move this run's files back unsafely. */
  readonly confirmRevertConsent: (retry: ConsentRetry) => Promise<boolean>;
  /** GU-5: the plans shown and their approval tokens. */
  readonly approvals: PlanApprovals;
  /** GU-5 (3.9, 6.6): asks the person (an OS dialog) whether to apply this plan; true only on "apply". */
  readonly confirmApply: (approval: PlanApproval) => Promise<boolean>;
  /** GU-5 (DR-21): asks the person (a separate OS dialog) for the consent to unsafe moves; true only on "agree". */
  readonly confirmConsent: (approval: PlanApproval) => Promise<boolean>;
  /**
   * U-64 (3.12, 4.4): starts a new engine host when the one before has ended (never while one runs).
   * Only the window's "Restart engine" asks for it; the main process never restarts it on its own.
   */
  readonly restartEngine: () => Promise<RestartReply>;
  /** U-63 (3.5, GUI-D8): the OS open dialog for the task file or the variables file (null: cancelled). Never kept. */
  readonly chooseOpenFile: (kind: "task" | "vars") => Promise<string | null>;
  /** U-62 (6.4): puts checked text on the clipboard (the OS clipboard; smoke tests record it instead). */
  readonly writeClipboard: (text: string) => void;
  /** U-66: shows an entry selected in the file manager (the OS one; smoke tests record it instead). Nothing is opened or run. */
  readonly showItemInFolder: (path: string) => void;
  /** U-184 (DR-72, 3.14): the text view's edit tokens (main/text-edits.ts). */
  readonly textEdits: TextEdits;
  /** U-184 (principle 6, GUI-D22): asks the person, once per opened file, to save to the file the view opened. */
  readonly confirmTextSave: () => Promise<boolean>;
  /** U-184: whether the text view holds an unsaved edit (closing the window asks then). */
  readonly setTextDirty: (dirty: boolean) => void;
  /** U-70 (4.5): what the window remembers of itself, and keeping a change to it. */
  readonly uiMemory: () => Promise<UiMemoryView>;
  readonly saveUi: (change: { readonly screen?: string; readonly treeWidth?: number }) => Promise<void>;
}

export interface IpcHandlerContext {
  readonly deps: IpcDeps;
  readonly workspaces: IpcDeps["workspaces"];
}

function safeLocale(locale: string): string | null {
  return /^[A-Za-z0-9_-]{1,64}$/.test(locale) ? locale : null;
}

/** The language the engine host chooses and the shared catalog's texts for `ids` in it. */
export async function texts(host: EngineHost, osLocale: string, ids: readonly string[]): Promise<{ language: "ko" | "en"; texts: Record<string, string> } | null> {
  const response = await host.call("messages", { osLocale: safeLocale(osLocale), ids }, MESSAGES_TIMEOUT_MS);
  if (!response.ok || typeof response.value !== "object" || response.value === null) return null;
  const { language: lang, texts: table } = response.value as Record<string, unknown>;
  if ((lang !== "ko" && lang !== "en") || typeof table !== "object" || table === null) return null;
  const out: Record<string, string> = {};
  for (const id of ids) {
    const text = (table as Record<string, unknown>)[id];
    if (typeof text === "string") out[id] = text;
  }
  return { language: lang, texts: out };
}
