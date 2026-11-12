/**
 * GU-2: the GUI's own state file `gui-state.json` (docs/design/standalone-gui.md 4.5) in the
 * settings directory of N-1, next to the CLI's config.json. It holds the recent workspaces and,
 * per workspace, the task form (profile and task kind names) of the runs started in this app and
 * the last one used (R21b-L-1: a plan opened from the run list is applied with the form it was
 * made with). It never holds permissions, keys, secrets, goals or model output, and it has no
 * effect on what a run may do. A file that cannot be read or does not fit is ignored (empty state);
 * an entry that does not fit is dropped.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";
import { isLocalPathSyntax } from "./node-path.js";

export const GUI_STATE_FILE_NAME = "gui-state.json";
export const MAX_RECENT = 20;
const MAX_PATH_CHARS = 4096;
const MAX_FILE_BYTES = 256 * 1024;

export interface RecentWorkspace {
  /** Absolute path of the folder the person opened. */
  readonly path: string;
  /** ISO time it was last opened. */
  readonly openedAt: string;
}

/** A run's task form as the GUI started it: the profile and the task kind (null: the config's). */
export interface RunForm {
  readonly profile: string | null;
  readonly workflow: string | null;
}

export interface RememberedRun extends RunForm {
  readonly runId: string;
}

export interface WorkspaceMemory {
  readonly path: string;
  /** The form of the last run started here; the new task screen starts from it. */
  readonly lastForm: RunForm | null;
  /** The runs started here from this app, newest first. */
  readonly runs: readonly RememberedRun[];
}

export interface GuiState {
  readonly recentWorkspaces: readonly RecentWorkspace[];
  readonly workspaceMemory: readonly WorkspaceMemory[];
}

export const EMPTY_STATE: GuiState = { recentWorkspaces: [], workspaceMemory: [] };
export const MAX_REMEMBERED_WORKSPACES = 20;
export const MAX_REMEMBERED_RUNS = 200;
/** A profile or task kind name as the engine host takes it (no control characters, at most 200). */
const FORM_NAME = /^[^\u0000-\u001f\u007f]{1,200}$/;
const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;

function pathModule(platform: NodeJS.Platform): typeof win32 {
  return platform === "win32" ? win32 : posix;
}

/**
 * The settings directory of N-1 (src/contracts/config.ts DefaultConfigLocation, without the file
 * name): `%APPDATA%\Codaryn` on Windows when APPDATA is a drive path; elsewhere
 * `$XDG_CONFIG_HOME/codaryn` when it is absolute, else `<home>/.config/codaryn`. Null when there
 * is none; the GUI then keeps its state for this session only.
 */
export function settingsDir(platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>, home: string | null): string | null {
  if (platform === "win32") {
    const appData = Object.entries(env).find(([name]) => name.toUpperCase() === "APPDATA")?.[1]?.trim();
    return appData !== undefined && /^[A-Za-z]:[\\/]/.test(appData) ? win32.join(appData, "Codaryn") : null;
  }
  const xdg = env["XDG_CONFIG_HOME"]?.trim();
  if (xdg !== undefined && xdg.startsWith("/")) return posix.join(xdg, "codaryn");
  return home !== null && home.startsWith("/") ? posix.join(home, ".config", "codaryn") : null;
}

/** An absolute local path (R10b-L-2: no network, pipe or device path). */
function isLocalAbsolute(path: unknown, platform: NodeJS.Platform): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= MAX_PATH_CHARS && !path.includes("\0") && pathModule(platform).isAbsolute(path) && isLocalPathSyntax(path, platform);
}

/** A recent entry: an absolute local path and a time. */
function isRecent(value: unknown, platform: NodeJS.Platform): value is RecentWorkspace {
  if (typeof value !== "object" || value === null) return false;
  const { path, openedAt } = value as Record<string, unknown>;
  return isLocalAbsolute(path, platform) && typeof openedAt === "string" && !Number.isNaN(Date.parse(openedAt));
}

const formName = (value: unknown): value is string | null => value === null || (typeof value === "string" && FORM_NAME.test(value));

/** A form from the file, or null when it does not fit. */
function formOf(value: unknown): RunForm | null {
  if (typeof value !== "object" || value === null) return null;
  const { profile, workflow } = value as Record<string, unknown>;
  return formName(profile) && formName(workflow) ? { profile, workflow } : null;
}

function memoryOf(value: unknown, platform: NodeJS.Platform): WorkspaceMemory | null {
  if (typeof value !== "object" || value === null) return null;
  const { path, lastForm, runs } = value as Record<string, unknown>;
  if (!isLocalAbsolute(path, platform) || !Array.isArray(runs)) return null;
  const kept: RememberedRun[] = [];
  for (const run of runs) {
    const form = formOf(run);
    const runId = typeof run === "object" && run !== null ? (run as Record<string, unknown>)["runId"] : undefined;
    if (form === null || typeof runId !== "string" || !RUN_ID.test(runId) || kept.some((other) => other.runId === runId)) continue;
    kept.push({ runId, ...form });
    if (kept.length >= MAX_REMEMBERED_RUNS) break;
  }
  return { path, lastForm: lastForm === null ? null : formOf(lastForm), runs: kept };
}

/** Same folder: compared without case on Windows, where paths are. */
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const normalize = (p: string): string => pathModule(platform).normalize(p);
  return platform === "win32" ? normalize(a).toLowerCase() === normalize(b).toLowerCase() : normalize(a) === normalize(b);
}

/** Parses the file's text. Entries that do not fit are dropped; anything else gives the empty state. */
export function parseGuiState(text: string, platform: NodeJS.Platform): GuiState {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return EMPTY_STATE;
  }
  if (typeof value !== "object" || value === null || (value as Record<string, unknown>)["schemaVersion"] !== 1) return EMPTY_STATE;
  const list = (value as Record<string, unknown>)["recentWorkspaces"];
  if (!Array.isArray(list)) return EMPTY_STATE;
  const kept: RecentWorkspace[] = [];
  for (const item of list) {
    if (!isRecent(item, platform) || kept.some((other) => samePath(other.path, item.path, platform))) continue;
    kept.push({ path: item.path, openedAt: item.openedAt });
    if (kept.length >= MAX_RECENT) break;
  }
  const memory: WorkspaceMemory[] = [];
  const given = (value as Record<string, unknown>)["workspaceMemory"];
  for (const item of Array.isArray(given) ? given : []) {
    const entry = memoryOf(item, platform);
    if (entry === null || memory.some((other) => samePath(other.path, entry.path, platform))) continue;
    memory.push(entry);
    if (memory.length >= MAX_REMEMBERED_WORKSPACES) break;
  }
  return { recentWorkspaces: kept, workspaceMemory: memory };
}

export async function readGuiState(file: string, platform: NodeJS.Platform): Promise<GuiState> {
  try {
    const text = await readFile(file, "utf8");
    return text.length > MAX_FILE_BYTES ? EMPTY_STATE : parseGuiState(text, platform);
  } catch {
    return EMPTY_STATE;
  }
}

/** Writes the whole state through a temporary file and a rename, so a reader never sees half of it. */
export async function writeGuiState(file: string, state: GuiState): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  const text = `${JSON.stringify({ schemaVersion: 1, recentWorkspaces: state.recentWorkspaces, workspaceMemory: state.workspaceMemory }, null, 2)}\n`;
  try {
    await writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** The state with `path` opened now: first in the list, once, at most MAX_RECENT entries. */
export function withOpened(state: GuiState, path: string, now: Date, platform: NodeJS.Platform): GuiState {
  const rest = state.recentWorkspaces.filter((item) => !samePath(item.path, path, platform));
  return { ...state, recentWorkspaces: [{ path, openedAt: now.toISOString() }, ...rest].slice(0, MAX_RECENT) };
}

/** The state without `path` in the recent list (what was remembered about it stays). */
export function withoutPath(state: GuiState, path: string, platform: NodeJS.Platform): GuiState {
  return { ...state, recentWorkspaces: state.recentWorkspaces.filter((item) => !samePath(item.path, path, platform)) };
}

/** The state with run `runId` started in `path` with `form`: remembered first, and the workspace's last form. */
export function withRunForm(state: GuiState, path: string, runId: string, form: RunForm, platform: NodeJS.Platform): GuiState {
  if (!RUN_ID.test(runId) || !formName(form.profile) || !formName(form.workflow)) return state;
  const before = state.workspaceMemory.find((item) => samePath(item.path, path, platform));
  const runs = [{ runId, profile: form.profile, workflow: form.workflow }, ...(before?.runs ?? []).filter((run) => run.runId !== runId)].slice(0, MAX_REMEMBERED_RUNS);
  const entry: WorkspaceMemory = { path, lastForm: { profile: form.profile, workflow: form.workflow }, runs };
  const rest = state.workspaceMemory.filter((item) => !samePath(item.path, path, platform));
  return { ...state, workspaceMemory: [entry, ...rest].slice(0, MAX_REMEMBERED_WORKSPACES) };
}

/** What `path` remembers: the last form and the form of each remembered run. */
export function memoryFor(state: GuiState, path: string, platform: NodeJS.Platform): WorkspaceMemory | null {
  return state.workspaceMemory.find((item) => samePath(item.path, path, platform)) ?? null;
}
