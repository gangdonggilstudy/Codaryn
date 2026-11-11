/**
 * Integrity list of protected material (U-1, K2). See `IntegrityChecker` in the contracts.
 *
 * - Protected entries come from `policy.protectedPaths` (relative to the workspace root) and the
 *   config file's `integrity.paths` (absolute, outside the workspace).
 * - An entry is followed to its real path (T-13); links below an entry are recorded as `link`
 *   with the SHA-256 of their stored target text and never followed.
 * - The state directory at the workspace root is never entered.
 * - Nothing here rejects for a file-level problem: such a path becomes `unchecked`.
 * - The manifest stays local. Its paths are raw text; the engine masks what it records.
 *
 * Paths are read with `node:fs` directly, not through `Workspace.resolve`/`list`: the list must
 * see links without following them, read any file type as bytes and reach paths outside the root.
 */

import { createHash } from "node:crypto";
import { createReadStream, realpath as realpathCallback } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { asRawText, MAX_INTEGRITY_BYTES, MAX_INTEGRITY_FILES, STATE_DIR_NAME } from "../contracts/index.js";
import type {
  ContentHash,
  CreateIntegrityChecker,
  IntegrityChecker,
  IntegrityCheckerOptions,
  IntegrityEntry,
  IntegrityManifest,
  RawText,
} from "../contracts/index.js";

/** What the checker needs from `lstat`. */
export interface IntegrityStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  readonly size: number;
}

/** The file access the checker uses. Tests inject failures here. */
export interface IntegrityFileSystem {
  /** Resolves every link (and 8.3 short names on Windows). */
  realpath(target: string): Promise<string>;
  /** Does not follow a link in the last segment. */
  lstat(target: string): Promise<IntegrityStat>;
  /** Names of the entries of a directory. */
  readdir(dir: string): Promise<string[]>;
  /** The target text a link stores. */
  readlink(link: string): Promise<string>;
  /**
   * SHA-256 of the file's bytes, or "too_large" as soon as more than `maxBytes` bytes were read
   * (the file may have grown after `lstat`).
   */
  hashFile(file: string, maxBytes: number): Promise<{ readonly sha256: ContentHash; readonly bytes: number } | "too_large">;
}

/** Files at most this large are read in one call; larger ones are streamed. */
const WHOLE_READ_BYTES = 1024 * 1024;

const realpathNative = promisify(realpathCallback.native);

async function hashFile(file: string, maxBytes: number): Promise<{ sha256: ContentHash; bytes: number } | "too_large"> {
  const hash = createHash("sha256");
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    if (size <= WHOLE_READ_BYTES && size <= maxBytes) {
      const bytes = await handle.readFile();
      if (bytes.length > maxBytes) return "too_large";
      return { sha256: hash.update(bytes).digest("hex"), bytes: bytes.length };
    }
  } finally {
    await handle.close();
  }
  let total = 0;
  const stream = createReadStream(file);
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) {
      stream.destroy();
      return "too_large";
    }
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), bytes: total };
}

/** The real file system: native realpath, so 8.3 names cannot hide a path. */
export const nodeIntegrityFileSystem: IntegrityFileSystem = {
  realpath: (target) => realpathNative(target),
  lstat: (target) => fs.lstat(target),
  readdir: (dir) => fs.readdir(dir),
  readlink: (link) => fs.readlink(link),
  hashFile,
};

export interface IntegrityLimits {
  /** Most files and links over one capture. */
  readonly maxFiles: number;
  /** Most file bytes over one capture. */
  readonly maxBytes: number;
}

export const DEFAULT_INTEGRITY_LIMITS: IntegrityLimits = {
  maxFiles: MAX_INTEGRITY_FILES,
  maxBytes: MAX_INTEGRITY_BYTES,
};

const IS_WINDOWS = process.platform === "win32";

function fold(text: string): string {
  return IS_WINDOWS ? text.toLowerCase() : text;
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `/` separated display path of a child. */
function childDisplay(parent: string, name: string): string {
  if (parent === ".") return name;
  return parent.endsWith("/") ? `${parent}${name}` : `${parent}/${name}`;
}

/** One protected entry to list: where it is shown and where it is on disk (before links). */
interface Root {
  readonly display: string;
  readonly absolute: string;
}

/** The entry's display path, or null when it is at or under the state directory. */
function protectedRoot(workspaceRoot: string, entry: string): Root | null {
  const segments = entry.split(/[\\/]/).filter((segment) => segment !== "" && segment !== ".");
  if (segments.length > 0 && fold(segments[0] ?? "") === fold(STATE_DIR_NAME)) return null;
  return {
    display: segments.length === 0 ? "." : segments.join("/"),
    absolute: path.resolve(workspaceRoot, ...segments),
  };
}

function externalRoot(entry: string): Root {
  const absolute = path.resolve(entry);
  return { display: absolute.replace(/\\/g, "/"), absolute };
}

/** Raised inside a capture when the file or byte limit is reached. */
class LimitReached extends Error {}

/** Higher wins when two entries share a display path (overlapping protected entries). */
const KIND_RANK: { readonly [K in IntegrityEntry["kind"]]: number } = { absent: 0, link: 1, file: 2, unchecked: 3 };

/** Builds a checker with explicit limits and file system. `createIntegrityChecker` uses the contract's. */
export function buildIntegrityChecker(
  options: IntegrityCheckerOptions,
  limits: IntegrityLimits = DEFAULT_INTEGRITY_LIMITS,
  files: IntegrityFileSystem = nodeIntegrityFileSystem,
): IntegrityChecker {
  const workspaceRoot = options.workspace.root;
  const stateDir = fold(path.join(workspaceRoot, STATE_DIR_NAME));
  const roots: Root[] = [];
  for (const entry of options.protectedPaths) {
    const root = protectedRoot(workspaceRoot, entry);
    if (root !== null) roots.push(root);
  }
  for (const entry of options.externalPaths) roots.push(externalRoot(entry));

  const isStateDir = (absolute: string): boolean => {
    const folded = fold(absolute);
    return folded === stateDir || folded.startsWith(`${stateDir}${path.sep}`);
  };

  async function capture(): Promise<IntegrityManifest> {
    const found = new Map<string, IntegrityEntry>();
    const add = (entry: IntegrityEntry): void => {
      const earlier = found.get(entry.path);
      if (earlier === undefined || KIND_RANK[entry.kind] > KIND_RANK[earlier.kind]) found.set(entry.path, entry);
    };
    let fileCount = 0;
    let byteCount = 0;
    let limited = false;

    const unreadable = (display: string): IntegrityEntry => ({ path: asRawText(display), kind: "unchecked", why: "unreadable" });
    const countFile = (): void => {
      fileCount += 1;
      if (fileCount > limits.maxFiles) throw new LimitReached();
    };

    /** One file, link or other leaf at `absolute`, shown as `display`. Directories are queued. */
    async function visit(absolute: string, display: string, listed: IntegrityEntry[], queue: [string, string][]): Promise<void> {
      let info: IntegrityStat;
      try {
        info = await files.lstat(absolute);
      } catch {
        countFile();
        listed.push(unreadable(display));
        return;
      }
      if (info.isDirectory()) {
        queue.push([absolute, display]);
        return;
      }
      countFile();
      if (info.isSymbolicLink()) {
        try {
          const target = await files.readlink(absolute);
          listed.push({ path: asRawText(display), kind: "link", sha256: createHash("sha256").update(target, "utf8").digest("hex") });
        } catch {
          listed.push(unreadable(display));
        }
        return;
      }
      if (!info.isFile()) {
        listed.push(unreadable(display));
        return;
      }
      if (byteCount + info.size > limits.maxBytes) throw new LimitReached();
      let hashed: Awaited<ReturnType<IntegrityFileSystem["hashFile"]>>;
      try {
        hashed = await files.hashFile(absolute, limits.maxBytes - byteCount);
      } catch {
        listed.push(unreadable(display));
        return;
      }
      if (hashed === "too_large") throw new LimitReached();
      byteCount += hashed.bytes;
      listed.push({ path: asRawText(display), kind: "file", sha256: hashed.sha256 });
    }

    /** Everything one protected entry adds. Throws LimitReached. */
    async function listRoot(root: Root): Promise<IntegrityEntry[]> {
      const absent: IntegrityEntry[] = [{ path: asRawText(root.display), kind: "absent" }];
      let real: string;
      try {
        real = await files.realpath(root.absolute);
      } catch (error) {
        if (!isMissing(error)) return [unreadable(root.display)];
        // Missing, or a link whose target is missing: nothing protected exists there now.
        return absent;
      }
      if (isStateDir(real)) return [];
      const listed: IntegrityEntry[] = [];
      const queue: [string, string][] = [];
      await visit(real, root.display, listed, queue);
      while (queue.length > 0) {
        const [dir, display] = queue.pop() as [string, string];
        let names: string[];
        try {
          names = await files.readdir(dir);
        } catch {
          countFile();
          listed.push(unreadable(display));
          continue;
        }
        for (const name of names) {
          const child = path.join(dir, name);
          if (isStateDir(child)) continue;
          await visit(child, childDisplay(display, name), listed, queue);
        }
      }
      return listed;
    }

    for (const root of roots) {
      if (!limited) {
        try {
          for (const entry of await listRoot(root)) add(entry);
          continue;
        } catch (error) {
          if (!(error instanceof LimitReached)) throw error;
          limited = true;
        }
      }
      add({ path: asRawText(root.display), kind: "unchecked", why: "limit" });
    }
    return { entries: [...found.values()].sort((a, b) => compareCodeUnits(a.path, b.path)) };
  }

  function compare(before: IntegrityManifest, after: IntegrityManifest): readonly RawText[] {
    const old = new Map(before.entries.map((entry) => [entry.path as string, entry]));
    const now = new Map(after.entries.map((entry) => [entry.path as string, entry]));
    const changed = new Set<string>();
    for (const [key, entry] of old) {
      const other = now.get(key);
      if (other === undefined || differs(entry, other)) changed.add(key);
    }
    for (const [key, entry] of now) {
      const other = old.get(key);
      if (other === undefined || differs(other, entry)) changed.add(key);
    }
    return [...changed].sort(compareCodeUnits).map((key) => asRawText(key));
  }

  return { capture, compare };
}

/** True when the two entries of one path cannot be shown to be the same. */
function differs(a: IntegrityEntry, b: IntegrityEntry): boolean {
  if (a.kind === "unchecked" || b.kind === "unchecked") return true;
  if (a.kind !== b.kind) return true;
  if (a.kind === "absent") return false;
  return a.sha256 !== (b as { readonly sha256: ContentHash }).sha256;
}

/** K2: the checker with the contract's limits and the real file system. */
export const createIntegrityChecker: CreateIntegrityChecker = (options) => buildIntegrityChecker(options);
