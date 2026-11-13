/**
 * The file system calls the workspace needs. Unit tests replace this layer only to inject
 * failures (WS-02). Product code always uses `nodeFileLayer`.
 */

import { constants, realpath as realpathCallback } from "node:fs";
import type { BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const realpathNative = promisify(realpathCallback.native);

export interface FileStat {
  readonly size: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

/** U-189: a file system object's identity, its device and file id (64-bit, read as bigint). */
export interface FileId {
  readonly dev: bigint;
  readonly ino: bigint;
}

/** U-189: an lstat or fstat with the identity; `isSymbolicLink` is true for links and junctions. */
export interface IdStat {
  readonly id: FileId;
  readonly size: bigint;
  /**
   * Change time in nanoseconds. A folder's changes when an entry in it is added, removed or renamed
   * (a junction swapped in and back out included), so two walks that see the same folders unchanged
   * saw no swap in between.
   */
  readonly ctime: bigint;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** U-189: a file opened for reading: its own identity, and its bytes up to a limit. */
export interface ReadHandle {
  stat(): Promise<IdStat>;
  /** Up to `limit` bytes from the start (one more than a size limit tells a larger file). */
  read(limit: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface DirEntry {
  readonly name: string;
  /** False for links, including links and junctions that point to a directory. */
  isDirectory(): boolean;
  /**
   * U-242: true for a plain file, false for a link (to a file too) or another special entry.
   * Optional for layers that do not tell; then every entry that is not a folder counts as a link
   * where ListOptions.leaveOut asks.
   */
  isFile?(): boolean;
}

export interface FileLayer {
  /** Resolves every link. Rejects with ENOENT when the path does not exist. */
  realpath(path: string): Promise<string>;
  /** Does not follow a link in the last segment. */
  lstat(path: string): Promise<FileStat>;
  stat(path: string): Promise<FileStat>;
  readFile(path: string): Promise<Uint8Array>;
  readdir(path: string): Promise<readonly DirEntry[]>;
  mkdirRecursive(path: string): Promise<void>;
  /**
   * Creates a new file with exactly these bytes. Fails with EEXIST when the path already exists.
   * When writing fails after the file was created, the created file is removed before rejecting.
   */
  writeNewFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Adds the name `to` for the file `existing`. Fails with EEXIST when `to` already exists. */
  link(existing: string, to: string): Promise<void>;
  /** Replaces `to` with `from`. */
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** U-189: `lstat` with the identity (a link in the last segment is not followed). */
  lstatId(path: string): Promise<IdStat>;
  /**
   * U-189: opens a file for reading, not following a link in the last segment where the platform can
   * (O_NOFOLLOW; Windows has none, the handle's identity tells it instead), and never waiting on a FIFO.
   */
  openRead(path: string): Promise<ReadHandle>;
}

const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

function idStat(stat: BigIntStats): IdStat {
  return {
    id: { dev: stat.dev, ino: stat.ino },
    size: stat.size,
    ctime: stat.ctimeNs,
    isFile: () => stat.isFile(),
    isDirectory: () => stat.isDirectory(),
    isSymbolicLink: () => stat.isSymbolicLink(),
  };
}

export const nodeFileLayer: FileLayer = {
  // The native call expands Windows 8.3 short names (`CODARY~1` -> `.codaryn`); the JS one does not.
  realpath: (path) => realpathNative(path),
  lstat: (path) => fs.lstat(path),
  stat: (path) => fs.stat(path),
  readFile: (path) => fs.readFile(path),
  readdir: (path) => fs.readdir(path, { withFileTypes: true }),
  mkdirRecursive: async (path) => {
    await fs.mkdir(path, { recursive: true });
  },
  writeNewFile: async (path, bytes) => {
    const handle = await fs.open(path, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      // This call created the file, so removing it cannot touch anyone else's data.
      await fs.unlink(path).catch(() => undefined);
      throw error;
    }
    await handle.close();
  },
  link: (existing, to) => fs.link(existing, to),
  rename: (from, to) => fs.rename(from, to),
  remove: (path) => fs.unlink(path),
  lstatId: async (path) => idStat(await fs.lstat(path, { bigint: true })),
  openRead: async (path) => {
    const handle = await fs.open(path, READ_FLAGS);
    return {
      stat: async () => idStat(await handle.stat({ bigint: true })),
      read: async (limit) => {
        const chunks: Buffer[] = [];
        let total = 0;
        while (total < limit) {
          const chunk = Buffer.alloc(Math.min(65_536, limit - total));
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
          if (bytesRead === 0) break;
          chunks.push(chunk.subarray(0, bytesRead));
          total += bytesRead;
        }
        return Buffer.concat(chunks);
      },
      close: () => handle.close(),
    };
  },
};
