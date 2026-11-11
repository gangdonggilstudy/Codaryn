/**
 * The file system calls the workspace needs. Unit tests replace this layer only to inject
 * failures (WS-02). Product code always uses `nodeFileLayer`.
 */

import { realpath as realpathCallback } from "node:fs";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const realpathNative = promisify(realpathCallback.native);

export interface FileStat {
  readonly size: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface DirEntry {
  readonly name: string;
  /** False for links, including links and junctions that point to a directory. */
  isDirectory(): boolean;
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
  /** Creates a new file with exactly these bytes. Fails when the path already exists. */
  writeNewFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Replaces `to` with `from`. */
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
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
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => fs.rename(from, to),
  remove: (path) => fs.unlink(path),
};
