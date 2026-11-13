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
 * - Not closed: listing (`list`, readdir by path), writing (`writeText`) and the plan executor
 *   still use the path string after their checks; Node has no calls relative to a folder handle.
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
import type { FileId, FileLayer, IdStat } from "./file-layer.js";
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

const sameId = (a: FileId | undefined, b: FileId | undefined): boolean => a !== undefined && b !== undefined && a.dev === b.dev && a.ino === b.ino;
const sameIds = (a: readonly FileId[], b: readonly FileId[]): boolean => a.length === b.length && a.every((id, index) => sameId(id, b[index]));

/** U-189: why a guarded read did not happen, in the contract's codes. */
type ReadFailure = "not_found" | "not_text" | "too_large" | "io_error";
type Walk = { readonly ok: true; readonly ids: readonly FileId[]; readonly last: IdStat } | { readonly ok: false; readonly code: ReadFailure };

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
   * U-189: `lstat` of the root and of every prefix of the real path `relative`: the root and each
   * folder a folder, never a link (a link now means a swap: `io_error`). The last is what the path
   * names; its kind is the caller's to judge.
   */
  async function walk(relative: string): Promise<Walk> {
    const segments = relative === "." ? [] : relative.split("/");
    const places = [root, ...segments.map((_segment, index) => path.join(root, ...segments.slice(0, index + 1)))];
    const ids: FileId[] = [];
    let last: IdStat | undefined;
    for (const [index, place] of places.entries()) {
      try {
        last = await files.lstatId(place);
      } catch (error) {
        return { ok: false, code: isMissing(error) ? "not_found" : "io_error" };
      }
      if (last.isSymbolicLink()) return { ok: false, code: "io_error" };
      if (index < places.length - 1 && !last.isDirectory()) return { ok: false, code: index === 0 ? "io_error" : "not_found" };
      ids.push(last.id);
    }
    return last === undefined ? { ok: false, code: "io_error" } : { ok: true, ids, last };
  }

  /** U-189: the bytes of the checked file, read through a handle whose identity is the walked file's. */
  async function readChecked(target: ResolvedPath): Promise<{ readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly code: ReadFailure }> {
    const first = await walk(target.relative);
    if (!first.ok) return first;
    if (!first.last.isFile()) return { ok: false, code: "not_text" };
    if (first.last.size > BigInt(MAX_READ_BYTES)) return { ok: false, code: "too_large" };
    let handle;
    try {
      handle = await files.openRead(target.absolute);
    } catch (error) {
      const code = errorCode(error);
      if (isMissing(error)) return { ok: false, code: "not_found" };
      // ELOOP: the last segment became a link (O_NOFOLLOW).
      return { ok: false, code: code === "EISDIR" ? "not_text" : "io_error" };
    }
    try {
      const held = await handle.stat();
      if (!held.isFile()) return { ok: false, code: "not_text" };
      // The opened file must be the one walked, and the path walked again the same objects.
      if (!sameId(held.id, first.ids.at(-1))) return { ok: false, code: "io_error" };
      const second = await walk(target.relative);
      if (!second.ok || !sameIds(first.ids, second.ids)) return { ok: false, code: "io_error" };
      return { ok: true, bytes: await handle.read(MAX_READ_BYTES + 1) };
    } catch {
      return { ok: false, code: "io_error" };
    } finally {
      await handle.close().catch(() => undefined);
    }
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

  async function list(dir: ResolvedPath): Promise<ListOutcome> {
    if (!issued.has(dir)) {
      return { ok: false, code: "io_error" };
    }
    try {
      if (!(await files.stat(dir.absolute)).isDirectory()) {
        return { ok: false, code: "not_found" };
      }
    } catch (error) {
      return { ok: false, code: isMissing(error) ? "not_found" : "io_error" };
    }

    interface Pending extends ListEntry {
      readonly absolute: string;
    }
    // Kept sorted descending so `pop` yields the smallest relative path. Children of a
    // directory always sort after it, so popping in this order is the global sorted order
    // and the walk can stop at the limit without reading the whole tree.
    const pending: Pending[] = [];

    async function expand(absolute: string, relative: string): Promise<void> {
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
    try {
      await expand(dir.absolute, dir.relative);
      for (;;) {
        const next = pending.pop();
        if (next === undefined) {
          return { ok: true, entries, truncated: false };
        }
        if (entries.length >= MAX_SEARCH_ENTRIES) {
          return { ok: true, entries, truncated: true };
        }
        entries.push({ relative: next.relative, kind: next.kind });
        if (next.kind === "dir") {
          await expand(next.absolute, next.relative);
        }
      }
    } catch {
      return { ok: false, code: "io_error" };
    }
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
