/**
 * Workspace implementation over an injectable file layer.
 * Internal to src/workspace. The public entry is `createWorkspace` in index.ts.
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

  async function readText(target: ResolvedPath): Promise<ReadTextOutcome> {
    if (!issued.has(target)) {
      return { ok: false, code: "io_error" };
    }
    let bytes: Uint8Array;
    try {
      const stat = await files.stat(target.absolute);
      if (!stat.isFile()) {
        return { ok: false, code: "not_text" };
      }
      if (stat.size > MAX_READ_BYTES) {
        return { ok: false, code: "too_large" };
      }
      bytes = await files.readFile(target.absolute);
    } catch (error) {
      return { ok: false, code: isMissing(error) ? "not_found" : "io_error" };
    }
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

    let currentHash: ContentHash | null;
    try {
      currentHash = sha256(await files.readFile(target.absolute));
    } catch (error) {
      if (!isMissing(error)) {
        return { ok: false, code: "io_error" };
      }
      currentHash = null;
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
    try {
      if (currentHash === null) {
        await files.mkdirRecursive(directory);
      }
      await files.writeNewFile(temporary, bytes);
      await files.rename(temporary, target.absolute);
    } catch {
      try {
        await files.remove(temporary);
      } catch {
        // Nothing was created, or the rename already moved it.
      }
      return { ok: false, code: "io_error" };
    }
    return {
      ok: true,
      previousHash: currentHash,
      newHash: sha256(bytes),
      created: currentHash === null,
    };
  }

  return { root, resolve, readText, list, writeText };
}
