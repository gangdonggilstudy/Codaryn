/**
 * GU-2: the GUI's own state file `gui-state.json` (docs/design/standalone-gui.md 4.5) in the
 * settings directory of N-1, next to the CLI's config.json. It holds the recent workspaces only
 * for now. It never holds permissions, keys, secrets, goals or model output, and it has no effect
 * on what a run may do. A file that cannot be read or does not fit is ignored (empty state).
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";

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

export interface GuiState {
  readonly recentWorkspaces: readonly RecentWorkspace[];
}

export const EMPTY_STATE: GuiState = { recentWorkspaces: [] };

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

function isRecent(value: unknown, platform: NodeJS.Platform): value is RecentWorkspace {
  if (typeof value !== "object" || value === null) return false;
  const { path, openedAt } = value as Record<string, unknown>;
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= MAX_PATH_CHARS &&
    !path.includes("\0") &&
    pathModule(platform).isAbsolute(path) &&
    typeof openedAt === "string" &&
    !Number.isNaN(Date.parse(openedAt))
  );
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
  return { recentWorkspaces: kept };
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
  const text = `${JSON.stringify({ schemaVersion: 1, recentWorkspaces: state.recentWorkspaces }, null, 2)}\n`;
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
  return { recentWorkspaces: [{ path, openedAt: now.toISOString() }, ...rest].slice(0, MAX_RECENT) };
}

/** The state without `path`. */
export function withoutPath(state: GuiState, path: string, platform: NodeJS.Platform): GuiState {
  return { recentWorkspaces: state.recentWorkspaces.filter((item) => !samePath(item.path, path, platform)) };
}
