/**
 * The narrow channel between the renderer (through the preload) and the main process
 * (docs/design/standalone-gui.md 6.4): the channel names and the checks the main process runs on
 * every argument and on what it passes back. Pure: no Node, Electron or DOM API.
 *
 * The preload repeats the channel names because a sandboxed preload cannot load local modules;
 * a unit test keeps the two lists equal.
 */

export const IPC_CHANNELS = {
  info: "codaryn:app:info",
  openFolder: "codaryn:workspace:open",
  recent: "codaryn:workspace:recent",
  openRecent: "codaryn:workspace:openrecent",
  forgetRecent: "codaryn:workspace:forgetrecent",
  tree: "codaryn:workspace:tree",
  reveal: "codaryn:workspace:reveal",
  doctor: "codaryn:doctor:run",
} as const;

/** Main → renderer: a workspace was opened from outside the window (the command line of a second start). */
export const IPC_EVENTS = {
  workspaceOpened: "codaryn:event:workspaceopened",
} as const;

/** A workspace handle the main process issued: 128 random bits as lowercase hex. */
export const HANDLE_PATTERN = /^[0-9a-f]{32}$/;

export function isHandle(value: unknown): value is string {
  return typeof value === "string" && HANDLE_PATTERN.test(value);
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Obj, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

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
}

export interface DoctorView {
  readonly status: DoctorStatusView;
  readonly checks: readonly DoctorCheckView[];
}

/**
 * The parts of a DoctorOutput (src/contracts/commands.ts) the window shows, checked field by
 * field. Anything else in the output is not passed on. Null when the shape does not fit.
 */
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
    views.push({ id, status: checkStatus as DoctorCheckStatusView, message: message.slice(0, MAX_MESSAGE) });
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

/** What `info` answers. */
export interface InfoView {
  /** "ko" or "en", chosen by the engine host as the CLI chooses (CODARYN_LANG, then the OS). */
  readonly language: "ko" | "en";
  /** "ready", or the code of why the engine host is not available. */
  readonly engine: string;
  /** A workspace named on the command line, already opened by the main process. */
  readonly initialWorkspace: { readonly handle: string; readonly name: string } | null;
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

/** One remembered workspace. `path` is the folder the person chose; it is shown in the recent list only. */
export interface RecentView {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly exists: boolean;
}

/** What opening a remembered or command-line workspace answers. */
export type OpenReply = { readonly ok: true; readonly handle: string; readonly name: string } | { readonly ok: false; readonly code: string };

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
}

export type TreeReply =
  | { readonly ok: true; readonly entries: readonly TreeEntryView[]; readonly total: number; readonly offset: number; readonly nextOffset: number | null }
  | { readonly ok: false; readonly code: string };
