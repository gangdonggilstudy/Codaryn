/**
 * GU-9 D-7 (docs/design/gu9-packaging-proposal.md 1.1, 7 and D-7; user decision 2026-11-24): where a
 * packaged build finds the Node and the engine it carries, and the check of those files against a
 * list inside app.asar before the engine host starts. Development builds never come here; app.ts
 * keeps their paths. No Electron import, so the unit tests run this on plain Node.
 *
 * Layout under `process.resourcesPath`:
 * - `node/node.exe`: the Node 26 the engine host runs on (Windows; other systems are not packaged).
 * - `engine/build/src/engine-host/main.js` with `engine/build/src/shared/**` beside it, so the
 *   host's relative imports are the development build's.
 * - `engine/dist/src/**`: the engine (`app/index.js`), passed as `--engine-dir`.
 *
 * The list is `engine-manifest.json` at the app root (next to package.json, inside app.asar):
 * `{ "version": 1, "files": [{ "path": "node/node.exe", "size": 1, "sha256": "<64 lowercase hex>" }] }`
 * with paths relative to `resourcesPath`, `/` between parts, in ascending order. The packaging
 * script (a later GU-9 unit) writes it; this module only reads and checks it.
 *
 * The check fails closed: on any doubt the host is not started.
 * - The list's form: version, paths (Windows aliases refused too), sizes and hashes, and that it
 *   names the files the start needs.
 * - A walk of `node/` and `engine/` records each folder's and file's identity (volume and file id,
 *   and a file's size). A link, junction or any entry that is neither a regular file nor a folder
 *   fails the check when the walk meets it. The regular files must be exactly the listed ones:
 *   none missing, none extra.
 * - Each file is opened once; the open handle's identity and size must be the walk's, and the hash
 *   is read from that same handle, so the size and the hash are of the same bytes.
 * - After all hashes, a second walk must find the same folders and files with the same identities.
 *
 * What it cannot do:
 * - It is not atomic. On Windows Node has no open that refuses to follow a link, so a path can be
 *   swapped for a link between two steps of the check. The identity comparisons find such a swap
 *   when the opened file is another file, or when the tree still differs at the second walk; a swap
 *   made and undone between the two walks, behind which the same bytes were read, is not seen.
 * - After the check, a file can still change before or while the host reads it (TOCTOU).
 * - Hard links are regular files here and are not told apart; their bytes are checked like any
 *   file's, but another name of the same file can change them later (as above).
 * - The list is only as good as app.asar: it relies on the asar integrity fuse, whose effect on
 *   Windows is not confirmed.
 * - Whoever can change the list and the files together is not stopped. This finds damaged or
 *   swapped files, not a determined attacker who can write to the installation.
 * - Hashing every file (node.exe is the large one) runs at every engine start; its time is not
 *   measured.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";

export const ENGINE_MANIFEST_FILE = "engine-manifest.json";
export const ENGINE_MANIFEST_VERSION = 1;
/** The two folders under `resourcesPath` that the list covers completely. */
export const PACKAGED_ROOTS: readonly string[] = ["node", "engine"];
export const PACKAGED_NODE = "node/node.exe";
export const PACKAGED_HOST_SCRIPT = "engine/build/src/engine-host/main.js";
export const PACKAGED_ENGINE_DIR = "engine/dist/src";
export const PACKAGED_ENGINE_ENTRY = "engine/dist/src/app/index.js";

export interface PackagedEnginePaths {
  /** Null where no Node is packaged (only Windows is). */
  readonly nodePath: string | null;
  readonly hostScript: string;
  readonly engineDir: string;
}

export interface ManifestFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export type EngineCheckFailure =
  | "manifest_missing"
  | "manifest_unreadable"
  | "manifest_invalid"
  | "manifest_incomplete"
  | "file_missing"
  | "file_extra"
  | "file_not_regular"
  | "size_mismatch"
  | "hash_mismatch"
  | "file_changed"
  | "tree_changed"
  | "read_failed";

export type EngineCheck = { readonly ok: true } | { readonly ok: false; readonly reason: EngineCheckFailure };

/** What the check needs to know of an entry: its kind and identity. A link is never followed. */
export interface EntryInfo {
  readonly kind: "file" | "directory" | "link" | "other";
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
}

export interface OpenedFile {
  /** The identity of the open handle (fstat). */
  readonly info: () => Promise<EntryInfo>;
  /** Reads into `buffer` from `position`; resolves the number of bytes read (0 at the end). */
  readonly read: (buffer: Uint8Array, position: number) => Promise<number>;
  readonly close: () => Promise<void>;
}

/** The file operations the check uses. Tests replace some of them; the default is `node:fs`. */
export interface EngineFs {
  /** The list's text. In Electron the patched `readFileSync` reads inside app.asar. */
  readonly readText: (file: string) => string;
  /** lstat: the entry itself, not a link's target. */
  readonly entry: (path: string) => Promise<EntryInfo>;
  readonly list: (dir: string) => Promise<readonly string[]>;
  readonly open: (file: string) => Promise<OpenedFile>;
}

function infoOf(stats: BigIntStats): EntryInfo {
  const kind = stats.isSymbolicLink() ? "link" : stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other";
  return { kind, dev: stats.dev, ino: stats.ino, size: stats.size };
}

export const NODE_ENGINE_FS: EngineFs = {
  readText: (file) => readFileSync(file, "utf8"),
  entry: async (path) => infoOf(await lstat(path, { bigint: true })),
  list: (dir) => readdir(dir),
  open: async (file) => {
    const handle = await open(file, "r");
    return {
      info: async () => infoOf(await handle.stat({ bigint: true })),
      read: async (buffer, position) => (await handle.read(buffer, 0, buffer.length, position)).bytesRead,
      close: () => handle.close(),
    };
  },
};

const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_PATH_LENGTH = 1024;
const READ_CHUNK = 1024 * 1024;
/**
 * Windows device names, with or without an extension. The same rule as `node-path.ts`
 * (`WINDOWS_DEVICE_NAME`, which matches the CLI's `checkLocalPathSyntax`), copied because that
 * module does not export it; the unit test keeps the two equal through `isLocalPathSyntax`.
 */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;
/**
 * The form of an 8.3 short name (`PROGRA~1`, `progra~1.exe`, `AB~12.JS`): a stem of at most 8
 * characters, then at most one extension of 1 to 3 characters. Only such a stem with `~` and a digit
 * in it counts, so long names such as `report~2026-draft.js` stay allowed (review L1).
 */
const SHORT_NAME_FORM = /^([^.]{1,8})(\.[^.]{1,3})?$/i;
const TILDE_DIGIT = /~[0-9]/;

/** Whether a path part has the form of an 8.3 short name. */
export function isShortName(part: string): boolean {
  const form = SHORT_NAME_FORM.exec(part);
  return form !== null && TILDE_DIGIT.test(form[1] ?? "");
}

/** A control character (U+0000 to U+001F, U+007F). A loop, not a regular expression literal (G-5). */
function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Whether a path part names a Windows device (`nul`, `com1.txt`, `con .x`), as `node-path.ts` reads it. */
export function isWindowsDeviceName(part: string): boolean {
  return WINDOWS_DEVICE_NAME.test((part.split(".")[0] ?? "").trimEnd());
}

/**
 * A path part Windows would read as another name: a trailing dot or space (Windows drops them), a
 * device name, or an 8.3 short name. The walk's exact name comparison already refuses these; this
 * refuses them in the list as well.
 */
function isWindowsAlias(part: string): boolean {
  return part.endsWith(".") || part.endsWith(" ") || isWindowsDeviceName(part) || isShortName(part);
}

function fromList(resourcesPath: string, listed: string): string {
  return join(resourcesPath, ...listed.split("/"));
}

export function packagedEnginePaths(resourcesPath: string, platform: NodeJS.Platform): PackagedEnginePaths {
  return {
    nodePath: platform === "win32" ? fromList(resourcesPath, PACKAGED_NODE) : null,
    hostScript: fromList(resourcesPath, PACKAGED_HOST_SCRIPT),
    engineDir: fromList(resourcesPath, PACKAGED_ENGINE_DIR),
  };
}

/** The files the start cannot do without; the list must name them, so they are checked too. */
export function requiredListedFiles(platform: NodeJS.Platform): readonly string[] {
  return platform === "win32" ? [PACKAGED_NODE, PACKAGED_HOST_SCRIPT, PACKAGED_ENGINE_ENTRY] : [PACKAGED_HOST_SCRIPT, PACKAGED_ENGINE_ENTRY];
}

/**
 * A list path: relative, `/` between parts, inside one of the two roots, no empty part, no `.` or
 * `..`, no backslash, no colon (drive letters, alternate data streams), no control character, and
 * no part Windows would read as another name.
 */
export function isListedPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_LENGTH) return false;
  if (value.includes("\\") || value.includes(":") || hasControl(value)) return false;
  const parts = value.split("/");
  if (parts.length < 2 || !PACKAGED_ROOTS.includes(parts[0] ?? "")) return false;
  return parts.every((part) => part !== "" && part !== "." && part !== ".." && !isWindowsAlias(part));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/**
 * Reads the list's text. Unknown fields, a path out of order and two paths that differ only in
 * letter case (one file on Windows) are refused as well.
 */
export function parseEngineManifest(text: string): readonly ManifestFile[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(value) || !hasExactly(value, ["version", "files"])) return null;
  if (value["version"] !== ENGINE_MANIFEST_VERSION || !Array.isArray(value["files"])) return null;
  const files: ManifestFile[] = [];
  const folded = new Set<string>();
  let previous: string | null = null;
  for (const entry of value["files"] as unknown[]) {
    if (!isPlainObject(entry) || !hasExactly(entry, ["path", "size", "sha256"])) return null;
    const { path, size, sha256 } = entry;
    if (!isListedPath(path)) return null;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return null;
    if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) return null;
    if (previous !== null && !(previous < path)) return null;
    const key = path.toLowerCase();
    if (folded.has(key)) return null;
    folded.add(key);
    previous = path;
    files.push({ path, size, sha256 });
  }
  return files;
}

class CheckStop extends Error {
  constructor(readonly reason: EngineCheckFailure) {
    super(reason);
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

interface Tree {
  /** List path → identity, for the folders (the two roots included) and for the regular files. */
  readonly dirs: Map<string, EntryInfo>;
  readonly files: Map<string, EntryInfo>;
}

/** Walks the two roots. A root that does not exist holds no files; any link or special entry stops. */
async function walkTree(fs: EngineFs, resourcesPath: string): Promise<Tree> {
  const tree: Tree = { dirs: new Map(), files: new Map() };
  const visit = async (dir: string, listed: string): Promise<void> => {
    for (const name of await fs.list(dir)) {
      const full = join(dir, name);
      const path = `${listed}/${name}`;
      const info = await fs.entry(full);
      if (info.kind === "directory") {
        tree.dirs.set(path, info);
        await visit(full, path);
      } else if (info.kind === "file") {
        tree.files.set(path, info);
      } else {
        throw new CheckStop("file_not_regular");
      }
    }
  };
  for (const root of PACKAGED_ROOTS) {
    const dir = join(resourcesPath, root);
    let info: EntryInfo;
    try {
      info = await fs.entry(dir);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }
    if (info.kind !== "directory") throw new CheckStop("file_not_regular");
    tree.dirs.set(root, info);
    await visit(dir, root);
  }
  return tree;
}

function sameEntry(a: EntryInfo, b: EntryInfo): boolean {
  return a.kind === b.kind && a.dev === b.dev && a.ino === b.ino && (a.kind !== "file" || a.size === b.size);
}

function sameEntries(a: Map<string, EntryInfo>, b: Map<string, EntryInfo>): boolean {
  if (a.size !== b.size) return false;
  for (const [path, info] of a) {
    const other = b.get(path);
    if (other === undefined || !sameEntry(info, other)) return false;
  }
  return true;
}

/** The SHA-256 of all bytes read from the open handle, or null if their number is not `size`. */
async function hashOpened(file: OpenedFile, size: bigint): Promise<string | null> {
  const hash = createHash("sha256");
  const buffer = new Uint8Array(READ_CHUNK);
  let position = 0;
  for (;;) {
    const read = await file.read(buffer, position);
    if (read === 0) break;
    hash.update(buffer.subarray(0, read));
    position += read;
    if (BigInt(position) > size) return null;
  }
  return BigInt(position) === size ? hash.digest("hex") : null;
}

/**
 * Checks the packaged Node and engine against the list at `manifestFile` (inside app.asar).
 * Resolves `{ ok: true }` only when everything matches; `fs` is for the unit tests.
 */
export async function checkPackagedEngine(
  resourcesPath: string,
  manifestFile: string,
  platform: NodeJS.Platform,
  fs: EngineFs = NODE_ENGINE_FS,
): Promise<EngineCheck> {
  let text: string;
  try {
    text = fs.readText(manifestFile);
  } catch (error) {
    return { ok: false, reason: errorCode(error) === "ENOENT" ? "manifest_missing" : "manifest_unreadable" };
  }
  const files = parseEngineManifest(text);
  if (files === null) return { ok: false, reason: "manifest_invalid" };
  const listed = new Set(files.map((file) => file.path));
  if (!requiredListedFiles(platform).every((path) => listed.has(path))) return { ok: false, reason: "manifest_incomplete" };
  try {
    const before = await walkTree(fs, resourcesPath);
    for (const path of listed) if (!before.files.has(path)) return { ok: false, reason: "file_missing" };
    for (const path of before.files.keys()) if (!listed.has(path)) return { ok: false, reason: "file_extra" };
    for (const file of files) {
      const seen = before.files.get(file.path);
      if (seen === undefined) return { ok: false, reason: "file_missing" };
      if (seen.size !== BigInt(file.size)) return { ok: false, reason: "size_mismatch" };
      const opened = await fs.open(fromList(resourcesPath, file.path));
      try {
        const now = await opened.info();
        if (!sameEntry(now, seen)) return { ok: false, reason: "file_changed" };
        const digest = await hashOpened(opened, now.size);
        if (digest === null) return { ok: false, reason: "file_changed" };
        if (digest !== file.sha256) return { ok: false, reason: "hash_mismatch" };
      } finally {
        await opened.close();
      }
    }
    let after: Tree;
    try {
      after = await walkTree(fs, resourcesPath);
    } catch (error) {
      if (error instanceof CheckStop) return { ok: false, reason: "tree_changed" };
      throw error;
    }
    if (!sameEntries(before.dirs, after.dirs) || !sameEntries(before.files, after.files)) return { ok: false, reason: "tree_changed" };
  } catch (error) {
    return { ok: false, reason: error instanceof CheckStop ? error.reason : "read_failed" };
  }
  return { ok: true };
}
