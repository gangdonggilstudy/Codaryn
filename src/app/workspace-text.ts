/**
 * U-172 (DR-72 (b), text-editing-ux 5, the GUI's study 2.2-2.3): a text file of the workspace for a
 * person to read in an adapter (`readWorkspaceText`), and to edit there when nothing in it is hidden
 * or changed for showing (`writeWorkspaceText`, adapter-contract 5.15).
 *
 * Opening a file (both calls):
 * - The path is plain relative segments (isWorkspaceFile: the listing's rules, not the root);
 *   anything else is `invalid_arguments` before anything is read. The root's `.codaryn` (any case)
 *   is `refused`; then the engine's workspace rules (`Workspace.resolve`: inside the root, not the
 *   state directory, no invalid names), and every segment is looked at with `lstat`: a link or
 *   junction on the way is `refused`, never followed. Only a regular file is opened (`not_file`).
 * - The engine reads it (`Workspace.readText`): at most MAX_READ_BYTES (`too_large`), UTF-8 without
 *   a NUL byte (`not_text`). A file not opened gives no text.
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
 *   state directory when there is none, as a run does). Under it, the file is opened and judged again
 *   with the settings as they are now: `conflict` when its bytes are not the base digest's,
 *   `not_editable` with the reasons otherwise.
 * - The new text must not be one that showing would change (WorkspaceTextProblem): no CR or other
 *   control, line separator or bidirectional character, nothing masking hides, at most
 *   MAX_READ_BYTES once its line ending (CRLF for a CRLF file, else LF) and BOM are put back.
 * - Then the engine's atomic write (`Workspace.writeText`: a temporary file in the same folder,
 *   renamed, the hash checked again right before). The same text is `unchanged`. Nothing goes into
 *   the run records; the lock is taken back (twice at most, `lockLeft` when it could not be).
 * - Limits: the replaced file is a new file, so on POSIX its mode is the default one, as for the
 *   agent's writes (the engine's writeText); a file with more than one name is never written.
 */

import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { MAX_READ_BYTES, STATE_DIR_NAME, asRawText } from "../contracts/index.js";
import type { Clock, ContentHash, LocalSnapshot, MaskedText, PrivacyGateway, ResolvedPath, Workspace } from "../contracts/index.js";
import { cleanText, hideKeys } from "../cli/text-safety.js";
import { createRunId } from "../cli/run-id.js";
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

/** For a write: the clock and random bytes of the lock's id. */
export interface WorkspaceTextWriteSource extends WorkspaceTextSource {
  readonly clock: Clock;
  readonly randomBytes: (size: number) => Uint8Array;
}

/** Tests only: the lock release (one that fails). */
export interface WorkspaceTextOperations {
  readonly releaseLock?: (options: { readonly workspaceRoot: string; readonly runId: string }) => Promise<boolean>;
}

type NotOpened = "not_found" | "not_file" | "refused" | "too_large" | "not_text" | "unreadable";
interface Opened {
  readonly workspace: Workspace;
  readonly resolved: ResolvedPath;
  readonly stat: Stats;
  readonly snapshot: LocalSnapshot;
}

const errorCode = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;
const isStateName = (name: string): boolean => name.toLowerCase() === STATE_DIR_NAME;

/** Opens `file` (checked by isWorkspaceFile) as the engine would read it, never through a link. */
async function open(workspace: Workspace, file: string): Promise<{ readonly ok: true; readonly opened: Opened } | { readonly ok: false; readonly status: NotOpened }> {
  const fail = (status: NotOpened) => ({ ok: false as const, status });
  const segments = file.split("/");
  if (segments[0] !== undefined && isStateName(segments[0])) return fail("refused");
  const resolved = await workspace.resolve(file, "write");
  if (!resolved.ok) return fail("refused");
  let stat: Stats | undefined;
  for (let index = 0; index < segments.length; index += 1) {
    try {
      stat = await lstat(path.join(workspace.root, ...segments.slice(0, index + 1)));
    } catch (error) {
      const code = errorCode(error);
      return fail(code === "ENOENT" || code === "ENOTDIR" ? "not_found" : "unreadable");
    }
    if (stat.isSymbolicLink()) return fail("refused");
    if (index < segments.length - 1 && !stat.isDirectory()) return fail("not_found");
  }
  if (stat === undefined || !stat.isFile()) return fail("not_file");
  if (stat.size > MAX_WORKSPACE_TEXT_BYTES) return fail("too_large");
  const read = await workspace.readText(resolved.path);
  if (!read.ok) return fail(read.code === "io_error" ? "unreadable" : read.code);
  return { ok: true, opened: { workspace, resolved: resolved.path, stat, snapshot: read.snapshot } };
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
  const raw = opened.snapshot.text as string;
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
  const writable = (opened.stat.mode & 0o222) !== 0 && (await access(opened.resolved.absolute, constants.W_OK).then(() => true, () => false));
  if (!writable) reasons.add("read_only");
  if (opened.stat.nlink > 1) reasons.add("hard_link");
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
export async function readWorkspaceTextIn(source: WorkspaceTextSource, file: string): Promise<AppCallOutcome<WorkspaceText>> {
  const ready = await workspaceOf(source);
  if (!ready.ok) return ready;
  const outcome = await open(ready.workspace, file);
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
      digest: outcome.opened.snapshot.hash,
      bytes: outcome.opened.stat.size,
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

/** Writes a person's edit (checked by writeWorkspaceTextArguments) under the workspace lock. */
export async function writeWorkspaceTextIn(
  source: WorkspaceTextWriteSource,
  request: { readonly path: string; readonly text: string; readonly baseDigest: ContentHash },
  operations: WorkspaceTextOperations = {},
): Promise<AppCallOutcome<WorkspaceTextWritten>> {
  const ready = await workspaceOf(source);
  if (!ready.ok) return ready;
  const workspace = ready.workspace;
  const answer = (
    status: WorkspaceTextWritten["status"],
    more: { readonly digest?: ContentHash; readonly readOnlyReasons?: readonly WorkspaceTextReadOnlyReason[]; readonly textProblems?: readonly WorkspaceTextProblem[]; readonly lockLeft?: boolean } = {},
  ): WorkspaceTextWritten => ({
    kind: "workspace_text_write",
    status,
    path: request.path,
    digest: more.digest ?? null,
    readOnlyReasons: more.readOnlyReasons ?? [],
    textProblems: more.textProblems ?? [],
    lockLeft: more.lockLeft ?? false,
  });

  const lockId = createRunId(new Date(source.clock.now()), source.randomBytes);
  const lock = await acquireLock({ workspaceRoot: workspace.root, runId: lockId, clock: source.clock });
  if (!lock.ok) return { ok: true, output: answer("workspace_locked") };
  let result: WorkspaceTextWritten;
  try {
    result = await writeUnderLock(source, workspace, request, answer);
  } catch {
    result = answer("write_failed");
  }
  const release = operations.releaseLock ?? storeReleaseLock;
  let released = false;
  for (let attempt = 0; attempt < 2 && !released; attempt += 1) {
    try {
      await release({ workspaceRoot: workspace.root, runId: lockId });
      released = true;
    } catch {
      // Tried once more; a lock left is told.
    }
  }
  return { ok: true, output: { ...result, lockLeft: !released } };
}

async function writeUnderLock(
  source: WorkspaceTextWriteSource,
  workspace: Workspace,
  request: { readonly path: string; readonly text: string; readonly baseDigest: ContentHash },
  answer: (status: WorkspaceTextWritten["status"], more?: { readonly digest?: ContentHash; readonly readOnlyReasons?: readonly WorkspaceTextReadOnlyReason[]; readonly textProblems?: readonly WorkspaceTextProblem[] }) => WorkspaceTextWritten,
): Promise<WorkspaceTextWritten> {
  const outcome = await open(workspace, request.path);
  if (!outcome.ok) return answer(outcome.status);
  const opened = outcome.opened;
  if (opened.snapshot.hash !== request.baseDigest) return answer("conflict");
  // Judged again with the settings as they are now; this call holds the lock itself.
  const judged = await judge(source, request.path, opened, false);
  if (judged === null) return answer("mask_failed");
  if (judged.reasons.length > 0) return answer("not_editable", { readOnlyReasons: judged.reasons });
  const restored = `${judged.bom ? BOM : ""}${judged.lineEnding === "crlf" ? request.text.replace(/\n/g, "\r\n") : request.text}`;
  const problems = problemsOf(request.text, restored, source);
  if (problems.length > 0) return answer("text_refused", { textProblems: problems });
  if (restored === (opened.snapshot.text as string)) return answer("unchanged", { digest: opened.snapshot.hash });
  const written = await workspace.writeText({ path: opened.resolved, expectedHash: opened.snapshot.hash, text: asRawText(restored) });
  if (!written.ok) return answer(written.code === "conflict" ? "conflict" : "write_failed");
  return answer("written", { digest: written.newHash });
}
