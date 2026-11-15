/**
 * U-172 (DR-72 (b), text-editing-ux 5, the GUI's study 2.2-2.3): a text file of the workspace for a
 * person to read in an adapter (`readWorkspaceText`), and to edit there when nothing in it is hidden
 * or changed for showing (`writeWorkspaceText`, adapter-contract 5.15).
 *
 * Opening a file (both calls):
 * - The path is plain relative segments (isWorkspaceFile: the listing's rules, not the root);
 *   anything else is `invalid_arguments` before anything is read. The root's `.codaryn` (any case)
 *   is `refused`; then the engine's workspace rules (`Workspace.resolve`: inside the root, not the
 *   state directory, no invalid names).
 * - V-1 H-1, R-100 L-1 (a folder swapped for a junction after the checks): the path is walked with
 *   `lstat` (the root, every folder, the file; a link or junction anywhere is `refused`, only a
 *   regular file is opened, `not_file`), and each one's identity (device, file id) is kept. The file
 *   is then opened, and the open handle's own identity (`fstat`) must be the walked file's; then the
 *   path is walked again and every identity must be the same. Only then are the bytes read, through
 *   that handle. A swap before the open makes the handle another file; a swap after it makes the
 *   second walk differ: either is `refused`, and nothing read through a swapped path is given.
 * - At most MAX_READ_BYTES (`too_large`), UTF-8 without a NUL byte (`not_text`), as the engine's
 *   readText. A file not opened gives no text.
 *
 * What a read gives (judge):
 * - The text as shown: the BOM taken off, every CRLF as LF, then key values and key shapes hidden
 *   (`hideKeys`) and the values the settings register now masked (the gateway's `mask`, AC-D14), both
 *   on the text as it is (a value split by an invisible character is still found), then
 *   `cleanText` with LF and TAB kept. `masked`: masking changed it.
 * - Editable only when nothing keeps it (WorkspaceTextReadOnlyReason, in that order): the shown text
 *   is the file's (`masked`, `control_characters`), one line ending (`mixed_line_endings`: a CR
 *   alone counts too), not protected (the policy gate's write check by letters and by real path, as
 *   the listing; a check that cannot be made counts as protected), not a file the settings name
 *   (config, task, variables file: their real paths), writable (`read_only`), one name only
 *   (`hard_link`: an atomic write would part the names), and no live lock now (`workspace_locked`,
 *   inspectLock: a run, apply or revert in this process or another).
 * - The digest of the bytes read is the base a write needs. A read takes no lock and makes nothing
 *   (no state directory).
 *
 * A write (the window is not trusted):
 * - Its arguments first: the path as above, a well-formed string, a 64-hex digest; nothing is read
 *   for a request that does not fit.
 * - Under the workspace lock a run takes (`workspace_locked` when it is held; acquireLock makes the
 *   state directory when there is none, as a run does). Under it, the file is opened as above and
 *   judged again with the settings as they are now: `conflict` when its bytes are not the base
 *   digest's, `not_editable` with the reasons otherwise.
 * - The new text must not be one that showing would change (WorkspaceTextProblem): no CR or other
 *   control, line separator or bidirectional character, nothing masking hides, at most
 *   MAX_READ_BYTES once its line ending (CRLF for a CRLF file, else LF) and BOM are put back. The
 *   same text is `unchanged`.
 * - Then an atomic write of its own, checked at each step (V-1 H-1): the path walked again (every
 *   identity as opened, else `refused`); a new temporary file (exclusive create) in the file's
 *   folder; the path walked again with the temporary file in its place (a folder that changed:
 *   `refused` and the temporary file removed; the file replaced: `conflict`); the file read again
 *   through a handle of the opened identity (its bytes changed in place: `conflict`); the rename;
 *   and after it, the folders walked once more and the file must be the temporary file (else
 *   `path_changed`).
 * - Nothing goes into the run records; the lock is taken back (twice at most; a release that fails
 *   or answers false is `lockLeft`, V-1 L-1).
 * - What cannot be closed: Node has no rename relative to a folder handle (renameat, or a rename by
 *   handle on Windows), so the rename goes by path. A folder swapped in the instant between the last
 *   check and the rename, by someone who also moves the temporary file there, makes the rename land
 *   where the swap points; the check right after it sees that and the write is `path_changed`
 *   (told, not prevented). What is written is the person's own text, never a registered value or a
 *   key (text_refused). A swap in the instant between the walk and the temporary file's creation
 *   can create that file (exclusively: never over an existing one) where the swap points; it is
 *   found by the next walk and removed, unless the swap was undone in between.
 * - Limits: the replaced file is a new file, so on POSIX its mode is the default one, as for the
 *   agent's writes (the engine's writeText); a file with more than one name is never written.
 */

import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { access, lstat, open as openFile, realpath, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { MAX_READ_BYTES, STATE_DIR_NAME } from "../contracts/index.js";
import type { Clock, ContentHash, MaskedText, PrivacyGateway, ResolvedPath, Workspace } from "../contracts/index.js";
import { cleanText, hideKeys } from "./input/text-safety.js";
import { createRunId } from "./input/run-id.js";
import { compileProtectedPaths } from "../policy/index.js";
import { acquireLock, inspectLock, releaseLock as storeReleaseLock } from "../store/index.js";
import { createWorkspace } from "../workspace/index.js";
import { appError } from "./errors.js";
import { isWorkspaceDir } from "./workspace-dir.js";
import type {
  AppCallOutcome,
  AppError,
  WorkspaceText,
  WorkspaceTextLineEnding,
  WorkspaceTextProblem,
  WorkspaceTextReadOnlyReason,
  WorkspaceTextWritten,
} from "./types.js";

/** The largest file opened, and the largest text written back (the engine's read limit). */
export const MAX_WORKSPACE_TEXT_BYTES = MAX_READ_BYTES;
const DIGEST = /^[0-9a-f]{64}$/;
const BOM = "﻿";
const REASON_ORDER: readonly WorkspaceTextReadOnlyReason[] = ["masked", "control_characters", "mixed_line_endings", "protected", "settings_file", "read_only", "hard_link", "workspace_locked"];
/** Read only; on POSIX never through a final link and never waiting on a FIFO (both 0 on Windows). */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
/** A new file only: never over an existing one, never through a final link. */
const CREATE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);

/** A file of the workspace: the listing's plain relative segments (isWorkspaceDir), not the root. */
export function isWorkspaceFile(value: unknown): value is string {
  return typeof value === "string" && value !== "" && isWorkspaceDir(value);
}

type Refusal = { readonly ok: false; readonly error: AppError };
const refuse = (message: string): Refusal => ({ ok: false, error: appError("invalid_arguments", message) });
const PATH_MESSAGE = 'path must be relative segments joined by "/" (no empty, ".", ".." or "\\", ":", control or invisible characters; at most 255 characters each, 64 deep)';

/** readWorkspaceText's path, checked before anything is read. */
export function readWorkspaceTextArguments(request: unknown): { readonly ok: true; readonly path: string } | Refusal {
  if (typeof request !== "object" || request === null) return refuse("the request must be an object");
  const { path: file } = request as { path?: unknown };
  if (!isWorkspaceFile(file)) return refuse(PATH_MESSAGE);
  return { ok: true, path: file };
}

/** writeWorkspaceText's path, text and base digest, checked before anything is read or locked. */
export function writeWorkspaceTextArguments(request: unknown): { readonly ok: true; readonly path: string; readonly text: string; readonly baseDigest: ContentHash } | Refusal {
  if (typeof request !== "object" || request === null) return refuse("the request must be an object");
  const { path: file, text, baseDigest } = request as { path?: unknown; text?: unknown; baseDigest?: unknown };
  if (!isWorkspaceFile(file)) return refuse(PATH_MESSAGE);
  if (typeof text !== "string" || !text.isWellFormed()) return refuse("text must be a well-formed string");
  if (typeof baseDigest !== "string" || !DIGEST.test(baseDigest)) return refuse("baseDigest must be the digest readWorkspaceText gave (64 lowercase hex characters)");
  return { ok: true, path: file, text, baseDigest };
}

/** What the settings resolved to: the workspace, the masking, the protected paths and the files they name. */
export interface WorkspaceTextSource {
  readonly workspaceRoot: string;
  /** The gateway of the values the settings register now. */
  readonly privacy: PrivacyGateway;
  /** Every API key value set now (knownKeyValues). */
  readonly keys: readonly string[];
  /** The effective policy's protected paths; absent protects nothing. */
  readonly protectedPaths: readonly string[] | undefined;
  /** The config, task and variables files these settings name, absolute (never editable here). */
  readonly settingsFiles: readonly string[];
}

/** For a write: the clock and random bytes of the lock's id and the temporary file's name. */
export interface WorkspaceTextWriteSource extends WorkspaceTextSource {
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
}

/**
 * The points between the checks where tests stop to change the file system (V-1's races):
 * `walking` in the first walk before the file's own lstat, `checked` after the first walk, `opened`
 * once the handle is open and before the second walk, `judged` after a write's judgement and before
 * its own steps, `before_temp` after their first check and before the temporary file is made,
 * `before_rename` after the last check.
 */
export type WorkspaceTextStage = "walking" | "checked" | "opened" | "judged" | "before_temp" | "before_rename";

/** Tests only: the lock release (one that fails), and a pause at each stage. */
export interface WorkspaceTextOperations {
  readonly releaseLock?: (options: { readonly workspaceRoot: string; readonly runId: string }) => Promise<boolean>;
  readonly pause?: (stage: WorkspaceTextStage) => Promise<void>;
}

type NotOpened = "not_found" | "not_file" | "refused" | "too_large" | "not_text" | "unreadable";
/** A file system object's identity: its device and its file id (64-bit, so read as bigint). */
interface Identity {
  readonly dev: bigint;
  readonly ino: bigint;
}
interface Opened {
  readonly workspace: Workspace;
  readonly resolved: ResolvedPath;
  /** The root, every folder and the file, as walked: the same at every later check. */
  readonly ids: readonly Identity[];
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
  readonly bytes: Buffer;
  readonly text: string;
  readonly hash: ContentHash;
}

const errorCode = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;
const isStateName = (name: string): boolean => name.toLowerCase() === STATE_DIR_NAME;
const idOf = (stat: BigIntStats): Identity => ({ dev: stat.dev, ino: stat.ino });
const same = (a: Identity | undefined, b: Identity | undefined): boolean => a !== undefined && b !== undefined && a.dev === b.dev && a.ino === b.ino;
const sameAll = (a: readonly Identity[], b: readonly Identity[]): boolean => a.length === b.length && a.every((id, index) => same(id, b[index]));
const sha256 = (bytes: Uint8Array): ContentHash => createHash("sha256").update(bytes).digest("hex");

type Walked = { readonly ok: true; readonly ids: readonly Identity[]; readonly last: BigIntStats } | { readonly ok: false; readonly status: NotOpened };

/**
 * `lstat` of the root and every prefix of `segments`: the root and each folder a folder, never a
 * link; the last a regular file when `file`. `beforeLast` runs before the last one (tests' pause).
 */
async function walk(root: string, segments: readonly string[], file = true, beforeLast?: () => Promise<void>): Promise<Walked> {
  const ids: Identity[] = [];
  let last: BigIntStats | undefined;
  const places = [root, ...segments.map((_, index) => path.join(root, ...segments.slice(0, index + 1)))];
  for (const [index, place] of places.entries()) {
    if (index === places.length - 1) await beforeLast?.();
    try {
      last = await lstat(place, { bigint: true });
    } catch (error) {
      const code = errorCode(error);
      return { ok: false, status: code === "ENOENT" || code === "ENOTDIR" ? "not_found" : "unreadable" };
    }
    if (last.isSymbolicLink()) return { ok: false, status: "refused" };
    const isFile = file && index === places.length - 1;
    if (!isFile && !last.isDirectory()) return { ok: false, status: index === 0 ? "refused" : "not_found" };
    ids.push(idOf(last));
  }
  if (last === undefined || (file && !last.isFile())) return { ok: false, status: "not_file" };
  return { ok: true, ids, last };
}

/** Everything `handle` gives, up to `limit` bytes (one more than the limit tells a larger file). */
async function readAll(handle: FileHandle, limit: number): Promise<Buffer> {
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
}

type Read = { readonly ok: true; readonly bytes: Buffer } | { readonly ok: false; readonly status: NotOpened };

/** The bytes of the file at `segments` through a handle whose identity is `expected` (the walked file's), else why not. */
async function readThrough(root: string, segments: readonly string[], expected: Identity | undefined, between?: () => Promise<boolean>): Promise<Read> {
  let handle: FileHandle;
  try {
    handle = await openFile(path.join(root, ...segments), READ_FLAGS);
  } catch (error) {
    const code = errorCode(error);
    return { ok: false, status: code === "ENOENT" ? "not_found" : code === "ELOOP" ? "refused" : code === "EISDIR" ? "not_file" : "unreadable" };
  }
  try {
    const held = await handle.stat({ bigint: true });
    if (!held.isFile()) return { ok: false, status: "not_file" };
    if (!same(idOf(held), expected)) return { ok: false, status: "refused" };
    if (between !== undefined && !(await between())) return { ok: false, status: "refused" };
    const bytes = await readAll(handle, MAX_WORKSPACE_TEXT_BYTES + 1);
    return bytes.length > MAX_WORKSPACE_TEXT_BYTES ? { ok: false, status: "too_large" } : { ok: true, bytes };
  } catch {
    return { ok: false, status: "unreadable" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Opens `file` (checked by isWorkspaceFile): never through a link, and only the file the checks saw. */
async function open(workspace: Workspace, file: string, operations: WorkspaceTextOperations): Promise<{ readonly ok: true; readonly opened: Opened } | { readonly ok: false; readonly status: NotOpened }> {
  const fail = (status: NotOpened) => ({ ok: false as const, status });
  const segments = file.split("/");
  if (segments[0] !== undefined && isStateName(segments[0])) return fail("refused");
  // The engine's rules: inside the root, not the state directory (8.3 and other aliases too), no invalid names.
  const resolved = await workspace.resolve(file, "write");
  if (!resolved.ok) return fail("refused");
  // A swap in the middle of this walk makes its last lstat see through the new link: the second walk finds it.
  const first = await walk(workspace.root, segments, true, async () => operations.pause?.("walking"));
  if (!first.ok) return fail(first.status);
  if (first.last.size > BigInt(MAX_WORKSPACE_TEXT_BYTES)) return fail("too_large");
  await operations.pause?.("checked");
  // The handle must be the walked file; then the path, walked again, must be the same objects.
  const read = await readThrough(workspace.root, segments, first.ids.at(-1), async () => {
    await operations.pause?.("opened");
    const second = await walk(workspace.root, segments);
    return second.ok && sameAll(first.ids, second.ids);
  });
  if (!read.ok) return fail(read.status);
  const bytes = read.bytes;
  if (bytes.includes(0)) return fail("not_text");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail("not_text");
  }
  return {
    ok: true,
    opened: { workspace, resolved: resolved.path, ids: first.ids, mode: Number(first.last.mode), nlink: Number(first.last.nlink), size: bytes.length, bytes, text, hash: sha256(bytes) },
  };
}

/** The line ending of `body` (without the BOM). */
function lineEndingOf(body: string): WorkspaceTextLineEnding {
  const crlf = (body.match(/\r\n/g) ?? []).length;
  const cr = (body.match(/\r/g) ?? []).length - crlf;
  const lf = (body.match(/\n/g) ?? []).length - crlf;
  if (cr > 0 || (crlf > 0 && lf > 0)) return "mixed";
  if (crlf > 0) return "crlf";
  return lf > 0 ? "lf" : "none";
}

/** `text` shown: key values and shapes hidden and the registered values masked, on the text as it is; then cleaned (LF, TAB kept). Null when masking failed. */
function showText(text: string, source: WorkspaceTextSource): { readonly masked: string; readonly shown: string } | null {
  let masked;
  try {
    masked = source.privacy.mask(hideKeys(text, source.keys));
  } catch {
    return null;
  }
  return masked.ok ? { masked: masked.text, shown: cleanText(masked.text, true) } : null;
}

const fold = (file: string): string => (process.platform === "win32" ? file.toLowerCase() : file);
async function realOrGiven(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch {
    return path.resolve(file);
  }
}

interface Judged {
  readonly text: string;
  readonly masked: boolean;
  readonly protected: boolean;
  readonly lineEnding: WorkspaceTextLineEnding;
  readonly bom: boolean;
  readonly reasons: readonly WorkspaceTextReadOnlyReason[];
}

/** What a read gives of an opened file; `locked`: a live lock holds the workspace (not checked under the write's own lock). */
async function judge(source: WorkspaceTextSource, file: string, opened: Opened, locked: boolean): Promise<Judged | null> {
  const raw = opened.text;
  const bom = raw.startsWith(BOM);
  const body = bom ? raw.slice(1) : raw;
  const lineEnding = lineEndingOf(body);
  const plain = body.replace(/\r\n/g, "\n");
  const shown = showText(plain, source);
  if (shown === null) return null;
  const reasons = new Set<WorkspaceTextReadOnlyReason>();
  const masked = shown.masked !== plain;
  if (masked) reasons.add("masked");
  if (shown.shown !== shown.masked) reasons.add("control_characters");
  if (lineEnding === "mixed") reasons.add("mixed_line_endings");
  let isProtected: boolean;
  try {
    const covered = compileProtectedPaths(source.protectedPaths);
    isProtected = covered.covers(file) || (await covered.coversEffective(opened.resolved.relative, opened.workspace));
  } catch {
    isProtected = true;
  }
  if (isProtected) reasons.add("protected");
  const real = fold(opened.resolved.absolute);
  for (const named of source.settingsFiles) {
    if (fold(await realOrGiven(named)) === real) reasons.add("settings_file");
  }
  const writable = (opened.mode & 0o222) !== 0 && (await access(opened.resolved.absolute, constants.W_OK).then(() => true, () => false));
  if (!writable) reasons.add("read_only");
  if (opened.nlink > 1) reasons.add("hard_link");
  if (locked) reasons.add("workspace_locked");
  return { text: shown.shown, masked, protected: isProtected, lineEnding, bom, reasons: REASON_ORDER.filter((reason) => reasons.has(reason)) };
}

async function workspaceOf(source: WorkspaceTextSource): Promise<{ readonly ok: true; readonly workspace: Workspace } | Refusal> {
  try {
    return { ok: true, workspace: await createWorkspace({ root: source.workspaceRoot }) };
  } catch {
    return { ok: false, error: appError("workspace_not_found", "the workspace is not an existing directory") };
  }
}

/** Reads `file` (checked by readWorkspaceTextArguments) of the workspace the settings resolved to. */
export async function readWorkspaceTextIn(source: WorkspaceTextSource, file: string, operations: WorkspaceTextOperations = {}): Promise<AppCallOutcome<WorkspaceText>> {
  const ready = await workspaceOf(source);
  if (!ready.ok) return ready;
  const outcome = await open(ready.workspace, file, operations);
  if (!outcome.ok) return { ok: true, output: { kind: "workspace_text", status: outcome.status, path: file } };
  const lock = await inspectLock(ready.workspace.root);
  const locked = lock.state === "held" || lock.state === "reclaim_left" || lock.state === "unreadable";
  const judged = await judge(source, file, outcome.opened, locked);
  if (judged === null) return { ok: true, output: { kind: "workspace_text", status: "mask_failed", path: file } };
  return {
    ok: true,
    output: {
      kind: "workspace_text",
      status: "opened",
      path: file,
      text: judged.text as MaskedText,
      masking: "current_secrets",
      masked: judged.masked,
      protected: judged.protected,
      lineEnding: judged.lineEnding,
      bom: judged.bom,
      digest: outcome.opened.hash,
      bytes: outcome.opened.size,
      editable: judged.reasons.length === 0,
      readOnlyReasons: judged.reasons,
    },
  };
}

/** What in `text` (LF line breaks, no BOM) keeps it from being written, put back as `restored`. */
function problemsOf(text: string, restored: string, source: WorkspaceTextSource): readonly WorkspaceTextProblem[] {
  // The size first: a text too large is not masked at all.
  if (Buffer.byteLength(restored, "utf8") > MAX_WORKSPACE_TEXT_BYTES) return ["too_large"];
  const problems: WorkspaceTextProblem[] = [];
  const shown = showText(text, source);
  if (shown === null || shown.masked !== text) problems.push("masked");
  if (cleanText(text, true) !== text) problems.push("control_characters");
  return problems;
}

type Answer = (
  status: WorkspaceTextWritten["status"],
  more?: { readonly digest?: ContentHash; readonly readOnlyReasons?: readonly WorkspaceTextReadOnlyReason[]; readonly textProblems?: readonly WorkspaceTextProblem[] },
) => WorkspaceTextWritten;

/** Writes a person's edit (checked by writeWorkspaceTextArguments) under the workspace lock. */
export async function writeWorkspaceTextIn(
  source: WorkspaceTextWriteSource,
  request: { readonly path: string; readonly text: string; readonly baseDigest: ContentHash },
  operations: WorkspaceTextOperations = {},
): Promise<AppCallOutcome<WorkspaceTextWritten>> {
  const ready = await workspaceOf(source);
  if (!ready.ok) return ready;
  const workspace = ready.workspace;
  const answer: Answer = (status, more = {}) => ({
    kind: "workspace_text_write",
    status,
    path: request.path,
    digest: more.digest ?? null,
    readOnlyReasons: more.readOnlyReasons ?? [],
    textProblems: more.textProblems ?? [],
    lockLeft: false,
  });

  const lockId = createRunId(new Date(source.clock.now()), source.randomBytes);
  const lock = await acquireLock({ workspaceRoot: workspace.root, runId: lockId, clock: source.clock });
  if (!lock.ok) return { ok: true, output: answer("workspace_locked") };
  let result: WorkspaceTextWritten;
  try {
    result = await writeUnderLock(source, workspace, request, answer, operations);
  } catch {
    result = answer("write_failed");
  }
  // V-1 L-1: the store answers false when the lock is not this call's any more; that is not taken back either.
  const release = operations.releaseLock ?? storeReleaseLock;
  let released = false;
  for (let attempt = 0; attempt < 2 && !released; attempt += 1) {
    try {
      released = (await release({ workspaceRoot: workspace.root, runId: lockId })) === true;
    } catch {
      released = false;
    }
  }
  return { ok: true, output: { ...result, lockLeft: !released } };
}

async function writeUnderLock(
  source: WorkspaceTextWriteSource,
  workspace: Workspace,
  request: { readonly path: string; readonly text: string; readonly baseDigest: ContentHash },
  answer: Answer,
  operations: WorkspaceTextOperations,
): Promise<WorkspaceTextWritten> {
  const outcome = await open(workspace, request.path, operations);
  if (!outcome.ok) return answer(outcome.status);
  const opened = outcome.opened;
  if (opened.hash !== request.baseDigest) return answer("conflict");
  // Judged again with the settings as they are now; this call holds the lock itself.
  const judged = await judge(source, request.path, opened, false);
  if (judged === null) return answer("mask_failed");
  if (judged.reasons.length > 0) return answer("not_editable", { readOnlyReasons: judged.reasons });
  const restored = `${judged.bom ? BOM : ""}${judged.lineEnding === "crlf" ? request.text.replace(/\n/g, "\r\n") : request.text}`;
  const problems = problemsOf(request.text, restored, source);
  if (problems.length > 0) return answer("text_refused", { textProblems: problems });
  if (restored === opened.text) return answer("unchanged", { digest: opened.hash });
  const bytes = Buffer.from(restored, "utf8");
  const status = await replaceChecked(workspace.root, request.path.split("/"), opened, bytes, source.randomBytes, operations);
  return status === "written" ? answer("written", { digest: sha256(bytes) }) : answer(status);
}

/**
 * V-1 H-1: replaces the opened file with `bytes` atomically (a temporary file renamed), checking the
 * path's identities before the temporary file, after it, and after the rename.
 */
async function replaceChecked(
  root: string,
  segments: readonly string[],
  opened: Opened,
  bytes: Buffer,
  randomBytes: (size: number) => Uint8Array,
  operations: WorkspaceTextOperations,
): Promise<"written" | "conflict" | "refused" | "path_changed" | "write_failed"> {
  const folders = opened.ids.slice(0, -1);
  const fileId = opened.ids.at(-1);
  const name = segments.at(-1) ?? "";
  const target = path.join(root, ...segments);
  const temporary = path.join(root, ...segments.slice(0, -1), `.${name}.${Buffer.from(randomBytes(8)).toString("hex")}.codaryn-tmp`);
  const removeTemporary = async (): Promise<void> => {
    await unlink(temporary).catch(() => undefined);
  };

  /** The folders as opened (else `refused`), then the file not replaced (else `conflict`). */
  const check = async (): Promise<"refused" | "conflict" | null> => {
    const walked = await walk(root, segments.slice(0, -1), false);
    if (!walked.ok || !sameAll(walked.ids, folders)) return "refused";
    const now = await lstat(target, { bigint: true }).then(idOf, () => undefined);
    return same(now, fileId) ? null : "conflict";
  };

  await operations.pause?.("judged");
  const before = await check();
  if (before !== null) return before;
  await operations.pause?.("before_temp");
  let temporaryId: Identity;
  let handle: FileHandle | undefined;
  try {
    handle = await openFile(temporary, CREATE_FLAGS);
    await handle.writeFile(bytes);
    temporaryId = idOf(await handle.stat({ bigint: true }));
  } catch {
    await handle?.close().catch(() => undefined);
    await removeTemporary();
    return "write_failed";
  }
  await handle.close().catch(() => undefined);

  // The folders still the opened ones, the temporary file in its place, the file not replaced.
  const placed = await check();
  const temporaryNow = await lstat(temporary, { bigint: true }).then(idOf, () => undefined);
  if (placed !== null || !same(temporaryNow, temporaryId)) {
    await removeTemporary();
    return placed ?? "refused";
  }
  // Its bytes as opened (an edit in place keeps the identity), read through a handle of that identity.
  const again = await readThrough(root, segments, fileId);
  if (!again.ok || sha256(again.bytes) !== opened.hash) {
    await removeTemporary();
    return !again.ok && again.status === "refused" ? "refused" : "conflict";
  }

  await operations.pause?.("before_rename");
  try {
    await rename(temporary, target);
  } catch {
    await removeTemporary();
    return "write_failed";
  }
  // Told, not prevented: a swap between the last check and the rename (see the module's note).
  const after = await walk(root, segments.slice(0, -1), false);
  const written = await lstat(target, { bigint: true }).then(idOf, () => undefined);
  return after.ok && sameAll(after.ids, folders) && same(written, temporaryId) ? "written" : "path_changed";
}
