/** Workspace, tree and UI IPC callbacks; ipc.ts owns authentication and registration. */
import { isAbsolute, join, relative } from "node:path";
import { dialog } from "electron";
import { copyablePath, hostCodeOf, isNoArgs, parseCopyArgs, parseIdArg, parseRevealArgs, parseSaveUiArgs, parseTextDirtyArgs, parseTreeArgs } from "../shared/ipc.js";
import type { CopyReply, OpenFolderReply, OpenReply, RecentView, TreeReply } from "../shared/ipc.js";
import { SETTINGS_TIMEOUT_MS, TREE_TIMEOUT_MS } from "./ipc-context.js";
import type { IpcHandlerContext } from "./ipc-context.js";

export function createWorkspaceHandlers(context: IpcHandlerContext, treeEpoch: () => number) {
  const { deps, workspaces } = context;

  const openFolder = async (args: unknown[]): Promise<OpenFolderReply> => {
    if (!isNoArgs(args)) return null;
    const window = deps.window();
    if (window === null) return null;
    const chosen = await dialog.showOpenDialog(window, { properties: ["openDirectory", "dontAddToRecent"] });
    const folder = chosen.canceled ? undefined : chosen.filePaths[0];
    if (folder === undefined) return null;
    return workspaces.open(folder);
  };

  const recent = async (args: unknown[]): Promise<RecentView[] | null> => (isNoArgs(args) ? workspaces.recent() : null);

  const openRecent = async (args: unknown[]): Promise<OpenReply> => {
    const id = parseIdArg(args);
    return id === null ? { ok: false, code: "invalid_args" } : workspaces.openRecent(id);
  };

  const forgetRecent = async (args: unknown[]): Promise<boolean> => {
    const id = parseIdArg(args);
    return id === null ? false : workspaces.forgetRecent(id);
  };

  const tree = async (args: unknown[]): Promise<TreeReply> => {
    const parsed = args.length === 1 ? parseTreeArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    const root = workspaces.path(parsed.workspace);
    if (root === null) return { ok: false, code: "unknown_workspace" };
    const dir = workspaces.treeDir(parsed.workspace, parsed.node);
    if (dir === null) return { ok: false, code: "unknown_entry" };
    const epoch = treeEpoch();
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("tree", { workspace: root, dir, offset: parsed.offset }, TREE_TIMEOUT_MS);
    if (treeEpoch() !== epoch || workspaces.path(parsed.workspace) !== root) return { ok: false, code: "unknown_entry" };
    if (!response.ok) return { ok: false, code: response.error.code };
    return workspaces.treeReply(parsed.workspace, dir, response.value);
  };

  // U-184: the text view tells whether it holds an unsaved edit; closing the window asks then.
  const textDirty = async (args: unknown[]): Promise<boolean> => {
    const dirty = args.length === 1 ? parseTextDirtyArgs(args[0]) : null;
    if (dirty === null) return false;
    deps.setTextDirty(dirty);
    return true;
  };

  const reveal = async (args: unknown[]): Promise<boolean> => {
    const parsed = args.length === 1 ? parseRevealArgs(args[0]) : null;
    if (parsed === null) return false;
    const root = workspaces.path(parsed.workspace);
    const rel = root === null ? null : workspaces.treeIds.resolve(parsed.workspace, parsed.node);
    if (root === null || rel === null) return false;
    const target = join(root, ...rel.split("/"));
    const inside = relative(root, target);
    if (inside.length === 0 || inside.startsWith("..") || isAbsolute(inside)) return false;
    // Shows the entry selected in the file manager. Nothing is opened or run.
    deps.showItemInFolder(target);
    return true;
  };

  /**
   * U-62 (6.4; R-73 M1, L1): copies a run id or a digest's first 12 characters only (parseCopyArgs);
   * anything else is invalid_args. Nothing else reaches the clipboard; the page cannot read it.
   */
  const copyText = async (args: unknown[]): Promise<CopyReply> => {
    const text = args.length === 1 ? parseCopyArgs(args[0]) : null;
    if (text === null) return { ok: false, code: "invalid_args" };
    deps.writeClipboard(text);
    return { ok: true };
  };

  /**
   * U-103 (G-list, 3.3): a tree entry's path relative to the workspace, by its id (the page never names
   * a path). Only entries the app layer did not mask have an id; the path is checked again (copyablePath).
   */
  const copyPath = async (args: unknown[]): Promise<CopyReply> => {
    const parsed = args.length === 1 ? parseRevealArgs(args[0]) : null;
    if (parsed === null) return { ok: false, code: "invalid_args" };
    if (workspaces.path(parsed.workspace) === null) return { ok: false, code: "unknown_workspace" };
    const rel = workspaces.treeIds.resolve(parsed.workspace, parsed.node);
    if (rel === null) return { ok: false, code: "unknown_entry" };
    const text = copyablePath(rel);
    if (text === null) return { ok: false, code: "not_copyable" };
    deps.writeClipboard(text);
    return { ok: true };
  };

  /**
   * U-69 (3.10): shows the config file selected in the file manager. Its path comes from the engine
   * host (the settings a run reads) and stays in this process; the page names nothing.
   */
  const revealConfig = async (args: unknown[]): Promise<CopyReply> => {
    if (!isNoArgs(args)) return { ok: false, code: "invalid_args" };
    const state = await deps.host();
    if (!("host" in state)) return { ok: false, code: state.failure };
    const response = await state.host.call("configFile", {}, SETTINGS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, code: response.error.code };
    const value = response.value as Record<string, unknown> | null;
    if (typeof value !== "object" || value === null) return { ok: false, code: "host_error" };
    if (value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
    const path = value["path"];
    if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0") || typeof value["exists"] !== "boolean") return { ok: false, code: "host_error" };
    if (value["exists"] !== true) return { ok: false, code: "config_missing" };
    deps.showItemInFolder(path);
    return { ok: true };
  };

  // U-70 (4.5): the last screen and the file panel's width, checked here, kept in gui-state.json.
  const saveUi = async (args: unknown[]): Promise<boolean> => {
    const parsed = args.length === 1 ? parseSaveUiArgs(args[0]) : null;
    if (parsed === null) return false;
    await deps.saveUi(parsed);
    return true;
  };

  return { openFolder, recent, openRecent, forgetRecent, tree, textDirty, reveal, copyText, copyPath, revealConfig, saveUi };
}
