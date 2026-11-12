/**
 * GU-2: the workspaces the window knows (docs/design/standalone-gui.md 3.2, 3.3, 6.5): handles for
 * opened folders, the recent list in gui-state.json, and ids for file tree entries. No Electron:
 * the dialog and the shell stay in ipc.ts, so this is tested under Node.
 */

import { basename, dirname } from "node:path";
import { isHandle } from "../shared/ipc.js";
import type { OpenReply, RecentView, TreeEntryView, TreeKind, TreeReply } from "../shared/ipc.js";
import { EMPTY_STATE, memoryFor, readGuiState, withOpened, withoutPath, withRunForm, writeGuiState } from "./gui-state.js";
import type { RunForm } from "./gui-state.js";
import type { GuiState } from "./gui-state.js";
import { WorkspaceHandles } from "./handles.js";
import { isLocalPathSyntax } from "./node-path.js";
import { TreeIds, childPath } from "./tree-ids.js";

export interface WorkspacesDeps {
  /** gui-state.json, or null to keep the recent list for this session only. */
  readonly stateFile: string | null;
  readonly platform: NodeJS.Platform;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly now: () => Date;
  readonly isDirectory: (path: string) => Promise<boolean>;
}

/** What the window shows for a folder: its own name, or the whole path for a drive root. */
export function folderName(path: string): string {
  return basename(path) || path;
}

/** R21-I-1: the name of the folder `path` is in, "" when `path` is a drive root. */
export function parentName(path: string): string {
  const parent = dirname(path);
  return parent === path ? "" : folderName(parent);
}

const KINDS: readonly TreeKind[] = ["dir", "file", "link", "state", "other"];

export class Workspaces {
  readonly handles: WorkspaceHandles;
  readonly treeIds: TreeIds;
  private state: GuiState | null = null;
  private readonly recentIds = new Map<string, string>();
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly deps: WorkspacesDeps) {
    this.handles = new WorkspaceHandles(deps.randomBytes);
    this.treeIds = new TreeIds(deps.randomBytes);
  }

  private async load(): Promise<GuiState> {
    if (this.state === null) this.state = this.deps.stateFile === null ? EMPTY_STATE : await readGuiState(this.deps.stateFile, this.deps.platform);
    return this.state;
  }

  /** Saves in order; a failed save keeps the list in memory and is not an error for the window. */
  private save(state: GuiState): Promise<void> {
    this.state = state;
    const file = this.deps.stateFile;
    if (file === null) return Promise.resolve();
    this.writing = this.writing.then(() => writeGuiState(file, state)).catch(() => undefined);
    return this.writing;
  }

  /**
   * Opens a folder the person chose (dialog, recent list, command line): a handle, and first place
   * in the recent list. R10b-L-2: a network, pipe or device path is refused before anything looks
   * at it (no SMB connection, no pipe client), as the CLI refuses it (S-5); the CLI and the engine
   * could not use it either.
   */
  async open(path: string): Promise<OpenReply> {
    if (!isLocalPathSyntax(path, this.deps.platform)) return { ok: false, code: "workspace_not_local" };
    if (!(await this.deps.isDirectory(path))) return { ok: false, code: "workspace_missing" };
    const handle = this.handles.issue(path);
    const state = withOpened(await this.load(), path, this.deps.now(), this.deps.platform);
    await this.save(state);
    return { ok: true, handle, name: folderName(path), lastForm: memoryFor(state, path, this.deps.platform)?.lastForm ?? null };
  }

  /** R21b-L-1: run `runId` was started in the workspace of `handle` with `form`. */
  async rememberRun(handle: string, runId: string, form: RunForm): Promise<void> {
    const path = this.path(handle);
    if (path === null) return;
    await this.save(withRunForm(await this.load(), path, runId, form, this.deps.platform));
  }

  /** The remembered form of each run of the workspace of `handle` (runs started elsewhere are absent). */
  async runForms(handle: string): Promise<ReadonlyMap<string, RunForm>> {
    const path = this.path(handle);
    const memory = path === null ? null : memoryFor(await this.load(), path, this.deps.platform);
    return new Map((memory?.runs ?? []).map((run) => [run.runId, { profile: run.profile, workflow: run.workflow }]));
  }

  /** The recent list with fresh ids (earlier ids stop working) and whether each folder still exists. */
  async recent(): Promise<RecentView[]> {
    this.recentIds.clear();
    const views: RecentView[] = [];
    for (const item of (await this.load()).recentWorkspaces) {
      const id = Array.from(this.deps.randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
      this.recentIds.set(id, item.path);
      const exists = isLocalPathSyntax(item.path, this.deps.platform) && (await this.deps.isDirectory(item.path));
      views.push({ id, name: folderName(item.path), where: parentName(item.path), exists });
    }
    return views;
  }

  async openRecent(id: unknown): Promise<OpenReply> {
    const path = isHandle(id) ? this.recentIds.get(id) : undefined;
    return path === undefined ? { ok: false, code: "unknown_recent" } : this.open(path);
  }

  async forgetRecent(id: unknown): Promise<boolean> {
    const path = isHandle(id) ? this.recentIds.get(id) : undefined;
    if (path === undefined) return false;
    this.recentIds.delete(id as string);
    await this.save(withoutPath(await this.load(), path, this.deps.platform));
    return true;
  }

  /** The folder of a handle. */
  path(handle: unknown): string | null {
    return this.handles.resolve(handle);
  }

  /** The relative directory a tree request names: "" for the root (null), else an issued id's path. */
  treeDir(handle: string, node: string | null): string | null {
    return node === null ? "" : this.treeIds.resolve(handle, node);
  }

  /**
   * The window's view of the engine host's answer for directory `dir`, checked field by field.
   * Directories and files that are not masked get ids; real names stay here.
   */
  treeReply(handle: string, dir: string, value: unknown): TreeReply {
    if (typeof value !== "object" || value === null) return { ok: false, code: "host_error" };
    const result = value as Record<string, unknown>;
    if (result["ok"] === false) {
      const code = result["code"];
      return { ok: false, code: typeof code === "string" && /^[a-z_]{1,40}$/.test(code) ? code : "host_error" };
    }
    const { entries, total, offset, nextOffset } = result;
    const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
    if (result["ok"] !== true || !Array.isArray(entries) || !count(total) || !count(offset) || !(nextOffset === null || count(nextOffset))) {
      return { ok: false, code: "host_error" };
    }
    const views: TreeEntryView[] = [];
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) return { ok: false, code: "host_error" };
      const { name, shown, kind, masked } = entry as Record<string, unknown>;
      if (typeof name !== "string" || typeof shown !== "string" || typeof masked !== "boolean") return { ok: false, code: "host_error" };
      if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) return { ok: false, code: "host_error" };
      const openable = !masked && (kind === "dir" || kind === "file");
      views.push({
        id: openable ? this.treeIds.issue(handle, childPath(dir, name)) : null,
        name: masked && shown === name ? "" : shown,
        kind: kind as TreeKind,
        masked,
      });
    }
    return { ok: true, entries: views, total, offset, nextOffset };
  }

  /** Forgets every handle and id (the window closed). The recent list stays. */
  clear(): void {
    this.handles.clear();
    this.treeIds.clear();
    this.recentIds.clear();
  }
}
