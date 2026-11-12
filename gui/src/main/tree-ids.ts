/**
 * GU-2: ids for file tree entries (docs/design/standalone-gui.md 6.5). The window names an entry
 * by an id the main process issued; the relative path behind it stays in the main process. Ids
 * belong to one workspace handle and are dropped with it.
 */

import { isHandle } from "../shared/ipc.js";

const MAX_IDS = 100_000;

export class TreeIds {
  private readonly entries = new Map<string, { readonly workspace: string; readonly relative: string }>();

  constructor(private readonly randomBytes: (size: number) => Uint8Array) {}

  /** A new id for `relative` (`/`-separated, "" never: the root is named by null) in `workspace`. */
  issue(workspace: string, relative: string): string {
    let id: string;
    do {
      id = Array.from(this.randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
    } while (this.entries.has(id));
    if (this.entries.size >= MAX_IDS) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(id, { workspace, relative });
    return id;
  }

  /** The relative path of an id issued for this workspace, or null. */
  resolve(workspace: string, id: unknown): string | null {
    if (!isHandle(id)) return null;
    const entry = this.entries.get(id);
    return entry !== undefined && entry.workspace === workspace ? entry.relative : null;
  }

  /** Drops every id of one workspace. */
  forget(workspace: string): void {
    for (const [id, entry] of this.entries) if (entry.workspace === workspace) this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** A child's relative path from its directory's ("" for the root) and its real name. */
export function childPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}
