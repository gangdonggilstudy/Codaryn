/** Core IPC arguments and views. Public callers use ../ipc.js. */

import { hasOnlyKeys, isHandle, isObj, isRunId, shortText, UNSAFE_IN_MESSAGE, count } from "./primitives.js";

/** `doctor` arguments: `{workspace: handle | null}` and nothing else. Null when they do not fit. */
export function parseDoctorArgs(value: unknown): { readonly workspace: string | null } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace"])) return null;
  const workspace = value["workspace"];
  if (workspace === null || workspace === undefined) return { workspace: null };
  return isHandle(workspace) ? { workspace } : null;
}

/** `openRecent`, `forgetRecent`: one id the recent list gave out. */
export function parseIdArg(args: readonly unknown[]): string | null {
  return args.length === 1 && isHandle(args[0]) ? args[0] : null;
}

/** Largest offset a tree page may start at (MAX_TREE_ENTRIES in the engine host). */
export const MAX_TREE_OFFSET = 100_000;

/** `tree` arguments: `{workspace, node, offset}`; `node` null is the workspace root. */
export function parseTreeArgs(value: unknown): { readonly workspace: string; readonly node: string | null; readonly offset: number } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "node", "offset"])) return null;
  const { workspace, node, offset } = value;
  if (!isHandle(workspace)) return null;
  if (node !== null && node !== undefined && !isHandle(node)) return null;
  const start = offset ?? 0;
  if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 0 || start > MAX_TREE_OFFSET) return null;
  return { workspace, node: (node ?? null) as string | null, offset: start };
}

/** `reveal` arguments: `{workspace, node}`. */
export function parseRevealArgs(value: unknown): { readonly workspace: string; readonly node: string } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["workspace", "node"])) return null;
  const { workspace, node } = value;
  return isHandle(workspace) && isHandle(node) ? { workspace, node } : null;
}

/**
 * U-62 (6.4, 2 principle 4; review R-73 M1, L1, PM decision): the main process copies only the two
 * things the window copies: a run id, or a digest's first 12 characters (lowercase hexadecimal, what
 * the CLI's apply --digest takes). Anything else is refused (invalid_args), so the page cannot put
 * other text on the clipboard. A tree entry's path is copied by its own call (copyPath, U-103).
 */
const DIGEST_START = /^[0-9a-f]{12}$/;

/** The value to copy, or null when it is neither a run id nor a digest's first 12 characters. */
export function copyableValue(value: unknown): string | null {
  return isRunId(value) || (typeof value === "string" && DIGEST_START.test(value)) ? value : null;
}

/** `copyText` arguments: `{text}` only. */
export function parseCopyArgs(value: unknown): string | null {
  return isObj(value) && hasOnlyKeys(value, ["text"]) ? copyableValue(value["text"]) : null;
}

export type CopyReply = { readonly ok: true } | { readonly ok: false; readonly code: string };

/**
 * U-103 (G-list, 3.3): the longest relative path copyPath copies, and the characters it refuses (any
 * control, line, format, direction or invisible character): a pasted path is what the tree shows.
 */
export const MAX_COPY_PATH_CHARS = 4096;
const NOT_COPYABLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/;

/**
 * U-103: a tree entry's path as the main process resolved it from the entry's id, or null. The path
 * is made of the names the app layer's listWorkspaceDir gave for entries it did not mask (a masked
 * entry has no name and no id), so it holds no key shape, key value or registered value it saw.
 * It is checked again here: "/"-separated plain segments, the length, no hidden character.
 */
export function copyablePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_COPY_PATH_CHARS || NOT_COPYABLE.test(value)) return null;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && !/[\\:]/.test(segment)) ? value : null;
}

/** U-64 (3.12, 4.4): the answer to restartEngine: the new engine host is ready, or why not. */
export type RestartReply = { readonly ok: true } | { readonly ok: false; readonly code: string };


/** A call that takes no arguments gets `undefined` from `ipcRenderer.invoke(channel)`. */
export function isNoArgs(args: readonly unknown[]): boolean {
  return args.length === 0 || (args.length === 1 && args[0] === undefined);
}

export const DOCTOR_CHECK_STATUSES = ["ok", "warn", "fail", "skipped"] as const;
export type DoctorCheckStatusView = (typeof DOCTOR_CHECK_STATUSES)[number];
export const DOCTOR_STATUSES = ["ok", "warn", "fail"] as const;
export type DoctorStatusView = (typeof DOCTOR_STATUSES)[number];

const CHECK_ID = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_CHECKS = 64;
const MAX_MESSAGE = 1000;

export interface DoctorCheckView {
  readonly id: string;
  readonly status: DoctorCheckStatusView;
  /** Fixed English text from the engine (DoctorCheck.message): never a value from a file or the environment. */
  readonly message: string;
  /** U-68: the check's catalog message id (DoctorCheck.text.id, e.g. "doctor.lock.held"), when it has one; never its parameters. */
  readonly textId?: string;
}

export interface DoctorView {
  readonly status: DoctorStatusView;
  readonly checks: readonly DoctorCheckView[];
}

/**
 * The parts of a DoctorOutput (src/contracts/commands.ts) the window shows, checked field by
 * field. Anything else in the output is not passed on. Null when the shape does not fit.
 */
/** U-68: a doctor check's message id, as the catalog names them (doctor.<check>.<outcome>). */
const DOCTOR_TEXT_ID = /^doctor(\.[a-z0-9_]{1,40}){1,3}$/;

export function toDoctorView(output: unknown): DoctorView | null {
  if (!isObj(output) || output["kind"] !== "doctor") return null;
  const status = output["status"];
  if (typeof status !== "string" || !(DOCTOR_STATUSES as readonly string[]).includes(status)) return null;
  const checks = output["checks"];
  if (!Array.isArray(checks) || checks.length > MAX_CHECKS) return null;
  const views: DoctorCheckView[] = [];
  for (const check of checks) {
    if (!isObj(check)) return null;
    const { id, status: checkStatus, message } = check;
    if (typeof id !== "string" || !CHECK_ID.test(id)) return null;
    if (typeof checkStatus !== "string" || !(DOCTOR_CHECK_STATUSES as readonly string[]).includes(checkStatus)) return null;
    if (typeof message !== "string") return null;
    const text = check["text"];
    const textId = isObj(text) && typeof text["id"] === "string" && DOCTOR_TEXT_ID.test(text["id"]) ? text["id"] : null;
    views.push({ id, status: checkStatus as DoctorCheckStatusView, message: message.slice(0, MAX_MESSAGE), ...(textId === null ? {} : { textId }) });
  }
  return { status: status as DoctorStatusView, checks: views };
}

/** Message ids of the shared catalog (src/i18n) the doctor view needs, for the given checks. */
export function doctorMessageIds(view: DoctorView): string[] {
  const ids = new Set<string>();
  for (const check of view.checks) {
    ids.add(`doctor.check.${check.id}`);
    ids.add(`doctor.status.${check.status}`);
  }
  return [...ids];
}

/** U-70 (4.5): the file panel's width range in CSS pixels, and the shape of a screen id the window keeps. */
export const TREE_WIDTH_MIN = 160;
export const TREE_WIDTH_MAX = 800;
export const SCREEN_ID = /^[a-z]{1,20}$/;

/** U-70: what the window remembers of itself (the main process keeps it in gui-state.json). */
export interface UiMemoryView {
  readonly screen: string | null;
  readonly treeWidth: number | null;
}

/** `saveUi` arguments: a screen id, a width in range, or both; nothing else. */
export function parseSaveUiArgs(value: unknown): { readonly screen?: string; readonly treeWidth?: number } | null {
  if (!isObj(value) || !hasOnlyKeys(value, ["screen", "treeWidth"])) return null;
  const { screen, treeWidth } = value;
  if (screen !== undefined && !(typeof screen === "string" && SCREEN_ID.test(screen))) return null;
  if (treeWidth !== undefined && !(typeof treeWidth === "number" && Number.isSafeInteger(treeWidth) && treeWidth >= TREE_WIDTH_MIN && treeWidth <= TREE_WIDTH_MAX)) return null;
  if (screen === undefined && treeWidth === undefined) return null;
  return { ...(screen === undefined ? {} : { screen: screen as string }), ...(treeWidth === undefined ? {} : { treeWidth: treeWidth as number }) };
}

/** What `info` answers. */
export interface InfoView {
  /** "ko" or "en", chosen by the engine host as the CLI chooses (CODARYN_LANG, then the OS). */
  readonly language: "ko" | "en";
  /** "ready", or the code of why the engine host is not available. */
  readonly engine: string;
  /** A workspace named on the command line, already opened by the main process. */
  readonly initialWorkspace: { readonly handle: string; readonly name: string } | null;
  /** U-70 (4.5): the last screen and the file panel's width. */
  readonly ui?: UiMemoryView;
}

/** What `doctor` answers. Errors carry a code only; the window turns it into its own text. */
export type DoctorReply =
  | { readonly ok: true; readonly view: DoctorView; readonly labels: Readonly<Record<string, string>>; readonly workspaceName: string | null }
  | { readonly ok: false; readonly code: string };

/**
 * What `openFolder` answers: null when nothing was chosen, else what opening the chosen folder
 * answers (OpenReply), so the window can say why a folder was refused (R10b-L-2: a network
 * location is `workspace_not_local`).
 */
export type OpenFolderReply = OpenReply | null;

/**
 * One remembered workspace: the folder's own name and (R21-I-1, R-10b I-2) the name of the folder it
 * is in, "" for a drive root, so two folders of the same name can be told apart. Never the full
 * path: a folder from a second start's command line was not chosen in this window's dialog.
 */
export interface RecentView {
  readonly id: string;
  readonly name: string;
  readonly where: string;
  readonly exists: boolean;
}

/** What opening a remembered or command-line workspace answers. */
/** A run's task form as the GUI started it (profile and task kind names; null: the config's). */
export interface RunFormView {
  readonly profile: string | null;
  readonly workflow: string | null;
}

/** `lastForm`: the form of the last run started in this workspace from this app (R21b-L-1), or null. */
export type OpenReply =
  | { readonly ok: true; readonly handle: string; readonly name: string; readonly lastForm?: RunFormView | null }
  | { readonly ok: false; readonly code: string };

/**
 * dir, file: a plain directory or file. link: a link or junction, never followed. state: the
 * workspace's own `.codaryn`. other: anything else. A masked entry's name hid something (a key
 * shape or control characters); it has no id and cannot be opened.
 */
export const TREE_KINDS = ["dir", "file", "link", "state", "other"] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

export interface TreeEntryView {
  /** Present for directories that can be expanded and files that can be shown in the file manager. */
  readonly id: string | null;
  /** The name as shown: control characters replaced and key shapes hidden. */
  readonly name: string;
  readonly kind: TreeKind;
  readonly masked: boolean;
  /** U-65: the config file's protected paths cover it (a guide; the engine checks every write). */
  readonly protected?: boolean;
}

export type TreeReply =
  | { readonly ok: true; readonly entries: readonly TreeEntryView[]; readonly total: number; readonly offset: number; readonly nextOffset: number | null }
  | { readonly ok: false; readonly code: string };

/**
 * U-21 (DR-47): the longest agent's last message, in characters (code points): the contract's
 * MAX_FINAL_MESSAGE_CHARS (src/contracts/engine.ts), repeated here as the window does not load the
 * engine; a unit test compares the two.
 */
export const MAX_FINAL_MESSAGE_CHARS = 2000;

/**
 * U-21 (DR-47, AXM-1): the agent's last message (EngineResult.finalMessage), the model's own words
 * and not a verified fact: every screen shows it after a label that says so. Masked; line breaks
 * (LF) and tabs kept; `truncated` when it was cut at MAX_FINAL_MESSAGE_CHARS.
 */
export interface FinalMessageView {
  readonly text: string;
  readonly truncated: boolean;
}

/** A final message as the engine host gives it: null when there is none, "bad" when it does not fit. */
function toFinalMessage(value: unknown): FinalMessageView | null | "bad" {
  if (value === undefined || value === null) return null;
  if (!isObj(value) || typeof value["text"] !== "string" || typeof value["truncated"] !== "boolean") return "bad";
  const text = value["text"];
  if (text.length > MAX_FINAL_MESSAGE_CHARS * 2 || [...text].length > MAX_FINAL_MESSAGE_CHARS || UNSAFE_IN_MESSAGE.test(text)) return "bad";
  return { text, truncated: value["truncated"] };
}

/** A plan action as the window shows it: a move from → to, or a discard of `from` (to the discard box). */
export interface PlanActionView {
  readonly kind: "move" | "discard";
  readonly from: string;
  readonly to: string | null;
  readonly unsafe?: boolean;
}

function toPlanActions(value: unknown, limit: number): PlanActionView[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const actions: PlanActionView[] = [];
  for (const action of value) {
    if (!isObj(action) || !shortText(action["from"])) return null;
    if (action["kind"] === "move" && shortText(action["to"])) actions.push({ kind: "move", from: action["from"], to: action["to"], ...(action["unsafe"] === true ? { unsafe: true } : {}) });
    else if (action["kind"] === "discard" && action["to"] === null) actions.push({ kind: "discard", from: action["from"], to: null, ...(action["unsafe"] === true ? { unsafe: true } : {}) });
    else return null;
  }
  return actions;
}

export interface RunItemView {
  /** ISO time of the record, or null. */
  readonly at: string | null;
  /** The record type, "notice", or "gap" (items went missing: the report has them all). */
  readonly kind: string;
  readonly text: string;
}

export const RUN_STATUSES = ["done", "failed", "needs-input", "cancelled", "budget-exhausted"] as const;

/**
 * U-40 (DR-52, AXM-17): whether masking worked, in counts only (EngineResult.masking): the values
 * registered for masking, and the places masked in what was sent to the model. Never a value, a
 * place or a length. The screens show it as the CLI's end summary does (`summary.masking`).
 */
export interface MaskingView {
  readonly registeredValues: number;
  readonly maskedPlaces: number;
}

/**
 * The two counts rebuilt from `value`, or null: when there is none (nothing registered, a result
 * written before DR-52), and when either is not a count (a whole number from 0), as the CLI's end
 * summary shows no line then. Nothing else the field holds is carried. The engine host and the
 * main process both use it.
 */
export function maskingOf(value: unknown): MaskingView | null {
  if (!isObj(value)) return null;
  const { registeredValues, maskedPlaces } = value;
  return count(registeredValues) && count(maskedPlaces) ? { registeredValues, maskedPlaces } : null;
}

/** GU-3 (3.7 summary): what the window shows of a finished run. Texts are masked and cleaned. */
export interface RunResultView {
  readonly runId: string;
  readonly status: (typeof RUN_STATUSES)[number];
  readonly reason: string;
  readonly exitCode: number | null;
  readonly changes: readonly { readonly path: string; readonly created: boolean }[];
  readonly verifiers: readonly { readonly number: number; readonly outcome: string }[];
  readonly usage: {
    readonly turns: number | null;
    readonly tools: number | null;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly durationMs: number | null;
  };
  readonly notices: readonly string[];
  /** U-226 (U-221): `kind` "changes" for a run plan, whose `actions` is its number of files. */
  readonly plan: { readonly digest: string; readonly actions: number | null; readonly kind?: "changes" } | null;
  readonly review: { readonly checklist: readonly string[] } | null;
  readonly protectedChanged: number | null;
  /** GU-5: "apply" for an apply run (DR-2), with its plan run, its done actions and the unsafe moves its check found. */
  readonly kind: "run" | "apply";
  readonly planRunId: string | null;
  readonly unsafeMoves: number | null;
  readonly applied: readonly PlanActionView[];
  /** U-21 (DR-47): the agent's last message; null when there is none (a plan or apply run, an older result). */
  readonly finalMessage?: FinalMessageView | null;
  /** U-40 (DR-52): the masking counts; null when there are none or they are not counts. */
  readonly masking?: MaskingView | null;
  /** U-124: how the run's permission questions ended (counts), or null/absent when none was asked. */
  readonly confirmations?: ConfirmationsView | null;
  /**
   * U-226 (U-218): a run that carried out a run plan (kind "run" with `planRunId`): its writes
   * refused because the approved plan does not name the file (path_not_writable). Absent otherwise.
   */
  readonly deniedNotPlanned?: number;
  /** U-226 (R-109, U-193): the run's (or apply's) workspace lock could not be released at its end. */
  readonly lockLeft?: true;
}

/**
 * U-124 (3.6, DR-3, DR-10): how a run's permission questions ended, from its own records: allowed
 * for one call, and denied by the person, by default (no answer: the dialog could not be shown, or
 * the time limit ended the wait) or because the run was cancelled while it waited.
 */
export interface ConfirmationsView {
  readonly allowed: number;
  readonly user: number;
  readonly default: number;
  readonly cancelled: number;
}

// Internal view conversions shared by run, plan and report checks.
export { toFinalMessage, toPlanActions };
