/**
 * Workspace handles (docs/design/standalone-gui.md 6.5). The renderer never passes a path: the
 * main process issues a random handle for a folder it got from an OS dialog (or later the recent
 * list or the command line) and keeps the path itself.
 */

import { isHandle } from "../shared/ipc.js";

const MAX_HANDLES = 1000;

export class WorkspaceHandles {
  private readonly paths = new Map<string, string>();

  constructor(private readonly randomBytes: (size: number) => Uint8Array) {}

  /** A new handle for an absolute folder path. The oldest handle is dropped past the limit. */
  issue(path: string): string {
    let handle: string;
    do {
      handle = Array.from(this.randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
    } while (this.paths.has(handle));
    if (this.paths.size >= MAX_HANDLES) {
      const oldest = this.paths.keys().next().value;
      if (oldest !== undefined) this.paths.delete(oldest);
    }
    this.paths.set(handle, path);
    return handle;
  }

  /** The path of a handle this registry issued, or null. */
  resolve(handle: unknown): string | null {
    return isHandle(handle) ? (this.paths.get(handle) ?? null) : null;
  }

  clear(): void {
    this.paths.clear();
  }
}
