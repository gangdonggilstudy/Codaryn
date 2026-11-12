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
  doctor: "codaryn:doctor:run",
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
}

/** What `doctor` answers. Errors carry a code only; the window turns it into its own text. */
export type DoctorReply =
  | { readonly ok: true; readonly view: DoctorView; readonly labels: Readonly<Record<string, string>>; readonly workspaceName: string | null }
  | { readonly ok: false; readonly code: string };

/** What `openFolder` answers: a handle and the folder's own name, or null when nothing was chosen. */
export type OpenFolderReply = { readonly handle: string; readonly name: string } | null;
