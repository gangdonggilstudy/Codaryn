/**
 * Workspace implementation over an injectable file layer.
 * Internal to src/workspace. The public entry is `createWorkspace` in index.ts.
 *
 * U-189 (W-2 of the tool path race study): `readText` reads only the file `resolve` checked.
 * `resolve` gives the real path (links resolved, so a link inside the root is still accepted). The
 * read walks that real path from the root with `lstat` (the root, every folder, the file) and keeps
 * each identity (device, file id); a link anywhere on it now means a folder was swapped. It opens the
 * file (never following a link in the last segment where the platform can), the handle's identity
 * must be the walked file's, the path walked again must be the same objects, and only then are the
 * bytes read through that handle. A swap seen is `io_error` (the contract's codes stay); nothing
 * read through the swapped path is given.
 * - Codex V-10: folders are compared on their change time too (guard.ts), so a folder swapped and
 *   swapped back between the two walks is seen. `list` (W-3) is guarded the same way: every folder it
 *   reads is looked at before and checked at the end. A change seen is tried again, then io_error.
 * - Not closed: writing (`writeText`) and the plan executor still use the path string after their
 *   checks; Node has no calls relative to a folder handle (see guard.ts for what stays open).
 */

import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

import { MAX_READ_BYTES, MAX_SEARCH_ENTRIES, asRawText } from "../contracts/index.js";
import type {
  ContentHash,
  ListEntry,
  ListOutcome,
  PathAccess,
  ReadTextOutcome,
  ResolvePathOutcome,
  ResolvedPath,
  Workspace,
  WorkspaceOptions,
  WriteTextOutcome,
  WriteTextRequest,
} from "../contracts/index.js";
import type { FileLayer } from "./file-layer.js";
import { FolderWatch, retried, sameChain, sameId, walkChain } from "./guard.js";
import { classifyAgainstRoot, isStateDirName, isValidPathInput } from "./lexical.js";

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

/** U-189: why a guarded read did not happen, in the contract's codes. */
type ReadFailure = "not_found" | "not_text" | "too_large" | "io_error";

function sha256(bytes: Uint8Array): ContentHash {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export async function createWorkspaceWithFileLayer(
  options: WorkspaceOptions,
  files: FileLayer,
): Promise<Workspace> {
  if (typeof options.root !== "string" || !path.isAbsolute(options.root)) {
    throw new Error("workspace root must be an absolute path");
  }
  const root = await files.realpath(options.root);
  if (!(await files.stat(root)).isDirectory()) {
    throw new Error("workspace root is not a directory");
  }

  /** Only paths issued by `resolve` are accepted by the other methods. */
  const issued = new WeakSet<ResolvedPath>();

  async function resolve(input: string, _access: PathAccess): Promise<ResolvePathOutcome> {
    if (!isValidPathInput(input)) {
      return { ok: false, code: "invalid_path" };
    }

    // Real path of the deepest existing ancestor, then the not yet existing rest.
    let current = path.resolve(root, input);
    const rest: string[] = [];
    let realBase: string;
    for (;;) {
      try {
        realBase = await files.realpath(current);
        break;
      } catch (error) {
        if (!isMissing(error)) {
          return { ok: false, code: "invalid_path" };
        }
      }
      try {
        // The name exists but its target does not: a dangling link. A write would follow it.
        await files.lstat(current);
        return { ok: false, code: "outside_root" };
      } catch (error) {
        if (!isMissing(error)) {
          return { ok: false, code: "invalid_path" };
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return { ok: false, code: "invalid_path" };
      }
      rest.unshift(path.basename(current));
      current = parent;
    }

    const absolute = rest.length > 0 ? path.join(realBase, ...rest) : realBase;
    const outcome = classifyAgainstRoot(root, absolute);
    if (!outcome.ok) {
      return outcome;
    }
    const resolved = { absolute, relative: outcome.relative } as unknown as ResolvedPath;
    issued.add(resolved);
    return { ok: true, path: resolved };
  }

  /**
   * U-189: the bytes of the checked file, read through a handle whose identity is the walked file's,
   * the real path walked again the same (guard.ts: folders unchanged too, so a swap undone is seen).
   * A change seen is tried again (retried); still seen, it is io_error.
   */
  async function readChecked(target: ResolvedPath): Promise<{ readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly code: ReadFailure }> {
    const attempt = async (): Promise<{ readonly bytes: Uint8Array } | ReadFailure | "changed"> => {
      const first = await walkChain(files.lstatId, root, target.relative);
      if (!first.ok) return first.code;
      if (!first.last.isFile()) return "not_text";
      if (first.last.size > BigInt(MAX_READ_BYTES)) return "too_large";
      let handle;
      try {
        handle = await files.openRead(target.absolute);
      } catch (error) {
        const code = errorCode(error);
        if (isMissing(error)) return "not_found";
        // ELOOP: the last segment became a link (O_NOFOLLOW).
        return code === "EISDIR" ? "not_text" : code === "ELOOP" ? "changed" : "io_error";
      }
      try {
        const held = await handle.stat();
        if (!held.isFile()) return "not_text";
        // The opened file must be the one walked, and the path walked again the same objects, folders unchanged.
        if (!sameId(held.id, first.seen.at(-1)?.id)) return "changed";
        const second = await walkChain(files.lstatId, root, target.relative);
        if (!second.ok || !sameChain(first.seen, second.seen)) return "changed";
        return { bytes: await handle.read(MAX_READ_BYTES + 1) };
      } catch {
        return "io_error";
      } finally {
        await handle.close().catch(() => undefined);
      }
    };
    const outcome = await retried(attempt);
    if (outcome === "changed") return { ok: false, code: "io_error" };
    return typeof outcome === "string" ? { ok: false, code: outcome } : { ok: true, bytes: outcome.bytes };
  }

  async function readText(target: ResolvedPath): Promise<ReadTextOutcome> {
    if (!issued.has(target)) {
      return { ok: false, code: "io_error" };
    }
    const read = await readChecked(target);
    if (!read.ok) {
      return { ok: false, code: read.code };
    }
    const bytes = read.bytes;
    if (bytes.byteLength > MAX_READ_BYTES) {
      return { ok: false, code: "too_large" };
    }
    if (bytes.includes(0)) {
      return { ok: false, code: "not_text" };
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return { ok: false, code: "not_text" };
    }
    return {
      ok: true,
      snapshot: { path: target, hash: sha256(bytes), text: asRawText(text) },
    };
  }

  /**
   * U-189 (W-3, Codex V-10): the listing reads only the folders the checked path leads to. The real
   * path is walked first; each folder read is looked at before its readdir (a folder, not a link);
   * at the end the path is walked again and every folder read must be the same object, unchanged
   * (guard.ts). A change seen is tried again (retried); still seen, it is io_error, and no name read
   * through a swapped folder is given.
   */
  async function list(dir: ResolvedPath): Promise<ListOutcome> {
    if (!issued.has(dir)) {
      return { ok: false, code: "io_error" };
    }
    const outcome = await retried(() => listOnce(dir));
    return outcome === "changed" ? { ok: false, code: "io_error" } : outcome;
  }

  async function listOnce(dir: ResolvedPath): Promise<ListOutcome | "changed"> {
    const first = await walkChain(files.lstatId, root, dir.relative);
    if (!first.ok) return first.code === "changed" ? "changed" : { ok: false, code: first.code === "not_found" ? "not_found" : "io_error" };
    if (!first.last.isDirectory()) return { ok: false, code: "not_found" };
    const watch = new FolderWatch(files.lstatId);
    const CHANGED = new Error("changed");

    interface Pending extends ListEntry {
      readonly absolute: string;
    }
    // Kept sorted descending so `pop` yields the smallest relative path. Children of a
    // directory always sort after it, so popping in this order is the global sorted order
    // and the walk can stop at the limit without reading the whole tree.
    const pending: Pending[] = [];

    async function expand(absolute: string, relative: string): Promise<void> {
      if (!(await watch.enter(absolute))) throw CHANGED;
      for (const entry of await files.readdir(absolute)) {
        if (relative === "." && isStateDirName(entry.name)) {
          continue;
        }
        pending.push({
          absolute: path.join(absolute, entry.name),
          relative: relative === "." ? entry.name : `${relative}/${entry.name}`,
          kind: entry.isDirectory() ? "dir" : "file",
        });
      }
      pending.sort((a, b) => compareCodeUnits(b.relative, a.relative));
    }

    const entries: ListEntry[] = [];
    let truncated = false;
    try {
      await expand(dir.absolute, dir.relative);
      for (;;) {
        const next = pending.pop();
        if (next === undefined) break;
        if (entries.length >= MAX_SEARCH_ENTRIES) {
          truncated = true;
          break;
        }
        entries.push({ relative: next.relative, kind: next.kind });
        if (next.kind === "dir") {
          await expand(next.absolute, next.relative);
        }
      }
    } catch (error) {
      return error === CHANGED ? "changed" : { ok: false, code: "io_error" };
    }
    // Every folder read still the one checked, unchanged; the path to it too.
    const second = await walkChain(files.lstatId, root, dir.relative);
    if (!second.ok || !sameChain(first.seen, second.seen) || !(await watch.unchanged())) return "changed";
    return { ok: true, entries, truncated };
  }

  async function writeText(request: WriteTextRequest): Promise<WriteTextOutcome> {
    const target = request.path;
    if (!issued.has(target) || target.relative === "." || !request.text.isWellFormed()) {
      return { ok: false, code: "io_error" };
    }

    /** Conflict with the current hash, or io_error when the current state cannot be read. */
    const conflictNow = async (): Promise<WriteTextOutcome> => {
      const now = await hashOf(target.absolute);
      return now === undefined ? { ok: false, code: "io_error" } : { ok: false, code: "conflict", currentHash: now };
    };

    const currentHash = await hashOf(target.absolute);
    if (currentHash === undefined) {
      return { ok: false, code: "io_error" };
    }
    if (currentHash !== request.expectedHash) {
      return { ok: false, code: "conflict", currentHash };
    }

    const bytes = Buffer.from(request.text, "utf8");
    const directory = path.dirname(target.absolute);
    const temporary = path.join(
      directory,
      `.${path.basename(target.absolute)}.${randomBytes(8).toString("hex")}.codaryn-tmp`,
    );
    const removeTemporary = async (): Promise<void> => {
      try {
        await files.remove(temporary);
      } catch {
        // Nothing was created, or the rename already moved it.
      }
    };

    try {
      if (currentHash === null) {
        await files.mkdirRecursive(directory);
      }
      await files.writeNewFile(temporary, bytes);
    } catch {
      await removeTemporary();
      return { ok: false, code: "io_error" };
    }

    if (currentHash === null) {
      // The file must not exist: publish with an operation that fails when the name is taken,
      // so a file created by someone else in the meantime is never overwritten.
      const placed = await placeNewFile(temporary, target.absolute, bytes);
      await removeTemporary();
      if (placed === "exists") {
        return conflictNow();
      }
      if (placed === "failed") {
        return { ok: false, code: "io_error" };
      }
    } else {
      // Check again right before replacing. This narrows the window; it is not a lock.
      const latest = await hashOf(target.absolute);
      if (latest !== currentHash) {
        await removeTemporary();
        return latest === undefined ? { ok: false, code: "io_error" } : { ok: false, code: "conflict", currentHash: latest };
      }
      try {
        await files.rename(temporary, target.absolute);
      } catch {
        await removeTemporary();
        return { ok: false, code: "io_error" };
      }
    }
    return {
      ok: true,
      previousHash: currentHash,
      newHash: sha256(bytes),
      created: currentHash === null,
    };
  }

  /** SHA-256 of the file, `null` when it does not exist, `undefined` when it cannot be read. */
  async function hashOf(file: string): Promise<ContentHash | null | undefined> {
    try {
      return sha256(await files.readFile(file));
    } catch (error) {
      return isMissing(error) ? null : undefined;
    }
  }

  /**
   * Gives the complete temporary file the target name only when that name is free.
   * A hard link publishes all bytes at once. File systems without hard links (FAT, exFAT,
   * some network shares) fall back to an exclusive create, which is not atomic.
   */
  async function placeNewFile(
    temporary: string,
    target: string,
    bytes: Uint8Array,
  ): Promise<"placed" | "exists" | "failed"> {
    try {
      await files.link(temporary, target);
      return "placed";
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        return "exists";
      }
    }
    try {
      await files.writeNewFile(target, bytes);
      return "placed";
    } catch (error) {
      return errorCode(error) === "EEXIST" ? "exists" : "failed";
    }
  }

  return { root, resolve, readText, list, writeText };
}
