/**
 * G-sec (U-274): the main process's real IPC handlers (src/main/ipc.ts registerIpc) in plain Node.
 * `electron` resolves to the stand-in gsec-electron.ts (gsec-hooks.ts, registered here before the
 * main process's modules load). The state the handlers keep is the main process's own (Workspaces,
 * PlanApprovals, SettingsProposals, CleanupPreviews, TextEdits, RunManager, RunHistory, model
 * entries); what reaches outside is recorded instead of done: every engine host call, every OS
 * dialog or question, the clipboard, the file manager, and what is sent to the window.
 * Temporary folders only; nothing is sent anywhere.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IpcDeps } from "../../src/main/ipc.js";
import type { HostCall, HostResponse } from "../../src/shared/protocol.js";

register(new URL("./gsec-hooks.js", import.meta.url));
// Loaded after the hook: these modules (and what they import) find `electron` as the stand-in.
const electron = await import("./gsec-electron.js");
const { registerIpc } = await import("../../src/main/ipc.js");
const { IPC_CHANNELS } = await import("../../src/shared/ipc.js");
const { Workspaces } = await import("../../src/main/workspaces.js");
const { PlanApprovals } = await import("../../src/main/plans.js");
const { SettingsProposals } = await import("../../src/main/settings-proposals.js");
const { CleanupPreviews } = await import("../../src/main/cleanup-previews.js");
const { TextEdits } = await import("../../src/main/text-edits.js");
const { RunManager } = await import("../../src/main/runs.js");
const { RunHistory } = await import("../../src/main/history.js");
const { ModelEntries, ModelListLimit } = await import("../../src/main/model-entries.js");

export { IPC_CHANNELS };
export const CHANNELS: readonly string[] = Object.values(IPC_CHANNELS);

const WINDOW_ID = 7;
/** The app window's main frame on the app's own origin. */
const APP_FRAME = { url: "app://codaryn/index.html" };

/** An IPC event from the app window's main frame: the only sender a handler answers. */
export function appEvent(): unknown {
  return { sender: { id: WINDOW_ID, mainFrame: APP_FRAME }, senderFrame: APP_FRAME };
}

/** Senders a handler must not answer, by what is wrong with them. */
export const FOREIGN_EVENTS: readonly { readonly why: string; readonly event: unknown }[] = [
  { why: "another web contents", event: { sender: { id: WINDOW_ID + 1, mainFrame: APP_FRAME }, senderFrame: APP_FRAME } },
  { why: "a frame inside the window (not its main frame)", event: { sender: { id: WINDOW_ID, mainFrame: APP_FRAME }, senderFrame: { url: "app://codaryn/index.html" } } },
  { why: "the main frame on another origin", event: (() => { const frame = { url: "file:///C:/index.html" }; return { sender: { id: WINDOW_ID, mainFrame: frame }, senderFrame: frame }; })() },
  { why: "the main frame on a look-alike origin", event: (() => { const frame = { url: "app://codaryn.evil/index.html" }; return { sender: { id: WINDOW_ID, mainFrame: frame }, senderFrame: frame }; })() },
  { why: "a frame already gone", event: { sender: { id: WINDOW_ID, mainFrame: APP_FRAME }, senderFrame: null } },
];

export interface HostCallRecord {
  readonly call: HostCall;
  readonly args: unknown;
}

export interface Ipc {
  /** Calls a channel's handler as the window would (`appEvent()` unless another event is given). */
  call(channel: string, args: readonly unknown[], event?: unknown): Promise<unknown>;
  /** Every engine host call the handlers made. */
  readonly hostCalls: HostCallRecord[];
  /** Everything else that reaches outside: OS dialogs and questions, clipboard, file manager, restarts, file choices. */
  readonly effects: string[];
  /** What was sent to the window. */
  readonly sent: { readonly channel: string; readonly payload: unknown }[];
  /** The main process's state the handlers use (tokens are issued and checked there). */
  readonly deps: IpcDeps;
  /** How the fake engine host answers a call (default: an error response). */
  answer: (call: HostCall, args: unknown) => HostResponse;
  /** What the OS questions answer (default: no, cancelled). */
  confirm: boolean;
  /** No window (null), or a destroyed one. */
  windowState: "open" | "none" | "destroyed";
  /** Opens a fresh temporary folder as a workspace; its handle. */
  openWorkspace(): Promise<{ readonly handle: string; readonly root: string }>;
}

const temporaryRoot = mkdtempSync(path.join(tmpdir(), "codaryn-gsec-"));
let folders = 0;

/** A fresh registration of every handler with recording dependencies. */
export async function createIpc(): Promise<Ipc> {
  electron.handlers.clear();
  electron.dialogCalls.length = 0;
  const hostCalls: HostCallRecord[] = [];
  const effects: string[] = [];
  const sent: { channel: string; payload: unknown }[] = [];
  const bytes = (size: number): Uint8Array => randomBytes(size);
  const now = (): number => Date.now();
  const window = {
    isDestroyed: (): boolean => ipc.windowState === "destroyed",
    webContents: { id: WINDOW_ID, send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
  };
  const host = {
    nodeVersion: "v26.0.0",
    pid: 1,
    exited: false,
    async call(call: HostCall, args: unknown): Promise<HostResponse> {
      hostCalls.push({ call, args });
      return ipc.answer(call, args);
    },
    async close(): Promise<void> {},
    onExit(): void {},
    onRunMessage(): void {},
  };
  const asked = (name: string) => async (): Promise<boolean> => {
    effects.push(name);
    return ipc.confirm;
  };
  const workspaces = new Workspaces({ stateFile: null, platform: process.platform, randomBytes: bytes, now: () => new Date(), isDirectory: async () => true });
  const deps = {
    window: () => (ipc.windowState === "none" ? null : window),
    host: async () => ({ host }),
    workspaces,
    osLocale: () => "en-US",
    initialWorkspace: () => null,
    modelEntries: new ModelEntries(bytes),
    modelListLimit: new ModelListLimit(now),
    envFacts: () => ({ model: false, language: false }),
    runs: new RunManager({ send: (channel: string, payload: unknown) => sent.push({ channel, payload }), labels: async (status: string, reason: string) => ({ status, reason }) }),
    onLanguage: () => undefined,
    history: new RunHistory(bytes, now),
    confirmRevert: asked("confirmRevert"),
    chooseSavePath: async () => (effects.push("chooseSavePath"), null),
    cleanupPreviews: new CleanupPreviews(bytes, now),
    confirmCleanup: asked("confirmCleanup"),
    confirmCleanupNotReverted: asked("confirmCleanupNotReverted"),
    confirmCleanupDiscarded: asked("confirmCleanupDiscarded"),
    settingsProposals: new SettingsProposals(bytes, now),
    confirmWidening: asked("confirmWidening"),
    confirmRevertConsent: asked("confirmRevertConsent"),
    approvals: new PlanApprovals(bytes, now),
    confirmApply: asked("confirmApply"),
    confirmConsent: asked("confirmConsent"),
    restartEngine: async () => (effects.push("restartEngine"), { ok: false, code: "gsec" }),
    chooseOpenFile: async () => (effects.push("chooseOpenFile"), null),
    writeClipboard: () => void effects.push("writeClipboard"),
    showItemInFolder: () => void effects.push("showItemInFolder"),
    textEdits: new TextEdits(bytes),
    confirmTextSave: asked("confirmTextSave"),
    setTextDirty: () => void effects.push("setTextDirty"),
    uiMemory: async () => ({ screen: null, treeWidth: null }),
    saveUi: async () => void effects.push("saveUi"),
  } as unknown as IpcDeps;
  const ipc: Ipc = {
    async call(channel, args, event = appEvent()) {
      const handler = electron.handlers.get(channel);
      if (handler === undefined) throw new Error(`gsec: no handler for ${channel}`);
      const result = await handler(event, ...args);
      for (const name of electron.dialogCalls.splice(0)) effects.push(`dialog.${name}`);
      return result;
    },
    hostCalls,
    effects,
    sent,
    deps,
    answer: (call) => ({ v: 1, id: 0, ok: false, error: { code: "gsec_no_answer", message: `no answer for ${call}` } }),
    confirm: false,
    windowState: "open",
    async openWorkspace() {
      folders += 1;
      const root = mkdtempSync(path.join(temporaryRoot, `w${folders}-`));
      const opened = await workspaces.open(root);
      if (!opened.ok) throw new Error(`gsec: the workspace did not open: ${JSON.stringify(opened)}`);
      return { handle: (opened as { handle: string }).handle, root };
    },
  };
  registerIpc(deps);
  return ipc;
}

/** The registered channels, as the stand-in saw them. */
export function registeredChannels(): string[] {
  return [...electron.handlers.keys()].sort();
}

/** Whether a handler's answer refuses: nothing, false, or a reply with ok false. */
export function refused(reply: unknown): boolean {
  return reply === null || reply === false || (typeof reply === "object" && reply !== null && (reply as { ok?: unknown }).ok === false);
}
