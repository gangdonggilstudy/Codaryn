/**
 * GU-2, U-103 (G-list; docs/design/standalone-gui.md 3.3, adapter-contract 5.12): one directory of
 * the workspace for the read-only file tree, from the app layer's `listWorkspaceDir` (U-89). The
 * engine host reads no directory itself any more (GU-2's interim listing is gone).
 *
 * - The app layer checks the directory (plain relative segments), resolves it by the engine's
 *   workspace rules, looks at every segment with lstat and follows no link or junction; the root's
 *   `.codaryn` is `state`. It shows names masked: control characters, key shapes, every key value set
 *   now and the values the settings register now (`secretEnv`). A masked entry has no real name
 *   (`name: null`): the main process never learns it, so it cannot be opened, listed or copied.
 * - The form is the open workspace with the config file's defaults (no profile, no task type), as a
 *   quick run without a profile: its registered values mask, its protected paths mark `protected`.
 * - Only the fields below are passed on, each checked; a value that does not fit is host_error.
 *   A status other than `listed` comes back as its own code (not_found, not_dir, too_large, refused,
 *   unreadable); an app error as its code.
 */

import type { HostTaskForm } from "./runs.js";

/** At most this many entries come in one page (the app layer's WORKSPACE_PAGE_SIZE). */
export const TREE_PAGE_SIZE = 500;
const MAX_SHOWN_CHARS = 4096;
const KINDS = ["dir", "file", "link", "state", "other"] as const;
const STATUSES = ["not_found", "not_dir", "too_large", "refused", "unreadable"] as const;
const CODE = /^[a-z][a-z0-9_]{0,63}$/;

export type TreeEntryKind = (typeof KINDS)[number];

export interface TreeEntry {
  /** The real name, for the main process's child paths only; null for a masked entry (never known here). */
  readonly name: string | null;
  /** The name as shown; "" when it cannot be shown at all. */
  readonly shown: string;
  readonly kind: TreeEntryKind;
  readonly masked: boolean;
  /** The effective policy's protected paths cover it (U-65 shows it). */
  readonly protected: boolean;
}

export type TreeResult =
  | { readonly ok: true; readonly entries: readonly TreeEntry[]; readonly total: number; readonly offset: number; readonly nextOffset: number | null }
  | { readonly ok: false; readonly code: string };

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const HOST_ERROR = { ok: false, code: "host_error" } as const;

/** One entry of the app layer's listing, or null when it does not fit (masked ⇔ no name; a plain entry's name is what is shown). */
function entryOf(value: unknown): TreeEntry | null {
  if (!isObj(value)) return null;
  const { name, shown, kind, masked } = value;
  const marked = value["protected"];
  if (typeof shown !== "string" || shown.length > MAX_SHOWN_CHARS || typeof masked !== "boolean" || typeof marked !== "boolean") return null;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) return null;
  if (masked ? name !== null : typeof name !== "string" || name === "" || name !== shown) return null;
  return { name: masked ? null : (name as string), shown, kind: kind as TreeEntryKind, masked, protected: marked };
}

/** `listWorkspaceDir`'s outcome as the host's tree value. */
export function treeValue(outcome: unknown): TreeResult {
  if (!isObj(outcome)) return HOST_ERROR;
  if (outcome["ok"] !== true) {
    const code = isObj(outcome["error"]) ? outcome["error"]["code"] : undefined;
    return { ok: false, code: typeof code === "string" && CODE.test(code) ? code : "host_error" };
  }
  const output = outcome["output"];
  if (!isObj(output) || output["kind"] !== "workspace_dir") return HOST_ERROR;
  const status = output["status"];
  if (typeof status === "string" && (STATUSES as readonly string[]).includes(status)) return { ok: false, code: status };
  if (status !== "listed" || output["masking"] !== "current_secrets") return HOST_ERROR;
  const { entries, total, offset, nextOffset } = output;
  if (!Array.isArray(entries) || entries.length > TREE_PAGE_SIZE || !count(total) || !count(offset) || !(nextOffset === null || count(nextOffset))) return HOST_ERROR;
  const out: TreeEntry[] = [];
  for (const item of entries) {
    const entry = entryOf(item);
    if (entry === null) return HOST_ERROR;
    out.push(entry);
  }
  return { ok: true, entries: out, total, offset, nextOffset };
}

/** The part of the app layer the tree calls. */
export interface TreeApp {
  listWorkspaceDir(request: { readonly settings: HostTaskForm; readonly dir: string; readonly offset: number }): Promise<unknown>;
}

/** The host's tree call: the app layer lists `dir` of the workspace with the form `formOf` gives. */
export function createTreeLister(
  app: TreeApp,
  formOf: (workspace: string) => HostTaskForm,
): (request: { readonly workspace: string; readonly dir: string; readonly offset: number }) => Promise<TreeResult> {
  return async (request) => {
    try {
      return treeValue(await app.listWorkspaceDir({ settings: formOf(request.workspace), dir: request.dir, offset: request.offset }));
    } catch {
      return HOST_ERROR;
    }
  };
}
