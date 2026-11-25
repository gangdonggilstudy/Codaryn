/**
 * U-116 (P1 bundle C, PM decisions M-1 to M-5, contract `src/contracts/verify.ts` MarkdownFileRule):
 * the `markdown_headings` and `markdown_links` rules of the `file_rules` verifier.
 *
 * Markdown is read with a small reader of its own (no dependency):
 * - Lines end at LF, CR LF or a lone CR (CommonMark); a leading byte order mark is dropped.
 * - Fenced code (``` or ~~~ with at most three spaces before it, deeper inside a list item; closed by
 *   the same character at least as long, or the end of the file) is skipped whole. Code spans are
 *   skipped inside a block. Indented code blocks are not recognised: their text is read as ordinary
 *   text (MARKDOWN_RULE_LIMITS says so).
 * - HTML (R-89 L-1): the seven kinds of CommonMark HTML block (`<script`, `<pre`, `<style`,
 *   `<textarea` to their closing tag; `<!--` to `-->`; `<?` to `?>`; `<!X` to `>`; `<![CDATA[` to
 *   `]]>`; a block-level tag, or a whole open or closing tag alone on a line, to the next blank line)
 *   and HTML comments inside a block are skipped: neither headings nor links. Other inline HTML is
 *   read as text.
 * - Headings: ATX (`#` to `######` then a space, a TAB or the end of the line; at most three spaces
 *   before; a closing `#` run after a space or TAB is dropped) and Setext (the line above a `=`
 *   underline is level 1, above a `-` underline level 2). Lines of block quotes and list items are
 *   not headings (U-149, R-89b N-2): a list item's later lines indented at least to its content
 *   column, and the blank lines between them, are lines of the item; a line indented less ends the
 *   list unless it starts another item.
 * - Links: inline links and images (`[text](target "title")`, `![alt](<target>)`) and one-line
 *   reference definitions (`[label]: target`). Backslash escapes are honoured.
 *
 * Reading is linear in the text's length (R-89 M-1): lines are classified by one pass each, the
 * brackets of a block are matched once with a stack, and a link's destination and title are read
 * within CommonMark's own bounds (at most 32 nested parentheses; no `(` inside a parenthesised
 * title). Beyond that, a line longer than MAX_MARKDOWN_LINE_CHARS, or (for the links rule) brackets
 * nested deeper than MAX_MARKDOWN_BRACKET_DEPTH, leave the rule undecided with the reason in its
 * evidence; it does not fail. Between the long steps the rules look at the run's signal.
 * U-160: the two bounds and every note the contract names (markdownLineTooLongNote,
 * markdownBracketsTooDeepNote, MARKDOWN_EVIDENCE_LEADS) come from src/contracts/verify.ts; this
 * module has no copy of its own.
 *
 * A target is judged on its text before anything on disk is looked at (M-3): one with a scheme
 * (`[A-Za-z][A-Za-z0-9+.-]*:`, a drive letter included), empty, or only an anchor is not checked;
 * the `#...` and `?...` parts are removed, percent escapes decoded (an escape that does not decode is
 * kept as written), `\` read as `/`. One that starts with `/` or `\`, leaves the workspace or names
 * the state directory is "outside" and is never handed to the workspace, so a link cannot be used to
 * probe outside it. The rest is resolved by the workspace (a link inside that leads outside is
 * "outside" too) and must exist, as a file or a directory, else it is "missing". Each distinct
 * target is looked at once.
 */

import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";

import {
  MARKDOWN_EVIDENCE_LEADS,
  MAX_MARKDOWN_BRACKET_DEPTH,
  MAX_MARKDOWN_LINE_CHARS,
  MAX_MARKDOWN_RULE_FILE_BYTES,
  markdownBracketsTooDeepNote,
  markdownEvidenceList,
  markdownLineTooLongNote,
} from "../contracts/index.js";
import type { MarkdownEvidenceItem, MarkdownHeading, MarkdownHeadingsRule, MarkdownLinksRule, Workspace } from "../contracts/index.js";
import { FILE_NOT_JUDGED_NOTE } from "./unreadable.js";
import { readMarkdown } from "./markdown-reader.js";
import type { DocumentHeading } from "./markdown-reader.js";

/** The contract's reader bounds (R-89 M-1, U-143), exported here as well for this module's readers. */
export { MAX_MARKDOWN_BRACKET_DEPTH, MAX_MARKDOWN_LINE_CHARS };

// IR-26 step 3 (M1): the reader is in markdown-reader.ts; this path exports it as before.
export { readMarkdown };
export type { DocumentHeading, DocumentLink, MarkdownStructure, MarkdownReadOptions } from "./markdown-reader.js";

/** What one link target needs (M-3), judged on its text alone. */
export type TargetJudgement =
  | { readonly kind: "skip" }
  | { readonly kind: "check"; readonly relative: string }
  | { readonly kind: "outside" }
  | { readonly kind: "missing" };

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const STATE_DIR = ".codaryn";

/**
 * Judges `target` relative to `documentDir` (the document's directory relative to the workspace
 * root, `/` separated, "." for the root). Nothing on disk is looked at.
 */
export function judgeTarget(target: string, documentDir: string): TargetJudgement {
  // Backslash escapes of punctuation, as in CommonMark (`\(` is `(`).
  const raw = target.replace(/\\([!-/:-@[-`{-~])/g, "$1");
  if (raw.length === 0 || raw.startsWith("#") || SCHEME.test(raw)) return { kind: "skip" };
  const cut = raw.search(/[?#]/);
  const pathPart = cut >= 0 ? raw.slice(0, cut) : raw;
  if (pathPart.length === 0) return { kind: "skip" };
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }
  if (decoded.startsWith("/") || decoded.startsWith("\\")) return { kind: "outside" };
  // A name holding a control character cannot exist; it is not handed to the workspace.
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return { kind: "missing" };
  const slashed = decoded.replace(/\\/g, "/");
  const joined = path.posix.normalize(path.posix.join(documentDir === "." ? "" : documentDir, slashed));
  if (joined === ".." || joined.startsWith("../") || joined.startsWith("/")) return { kind: "outside" };
  const relative = joined === "" || joined === "." || joined === "./" ? "." : joined.replace(/\/$/, "");
  if ((relative.split("/")[0] ?? "").toLowerCase() === STATE_DIR) return { kind: "outside" };
  return { kind: "check", relative };
}

/** A document read for a rule, or why it was not. */
export type LoadedMarkdown =
  | { readonly ok: true; readonly text: string; readonly relative: string }
  | { readonly ok: false; readonly missing: boolean; readonly note: string };

/** Opening without waiting where the platform can (POSIX); Windows has no O_NONBLOCK. */
const OPEN_FLAGS = fsConstants.O_RDONLY | ((fsConstants as { readonly O_NONBLOCK?: number }).O_NONBLOCK ?? 0);

/**
 * Reads the document at `rulePath` (after Workspace.resolve), at most `maxBytes` bytes, as UTF-8.
 * R-89 L-3: only a regular file is opened. Opening a named pipe for reading waits for a writer
 * (POSIX), a wait no signal ends, so the path is looked at first; the open does not block where the
 * platform allows, and the opened file is looked at again (it may have changed in between).
 */
export async function loadMarkdown(rulePath: string, workspace: Workspace, maxBytes: number): Promise<LoadedMarkdown> {
  const resolved = await workspace.resolve(rulePath, "read");
  if (!resolved.ok) return { ok: false, missing: false, note: `path rejected (${resolved.code})` };
  try {
    const before = await fs.stat(resolved.path.absolute);
    if (!before.isFile()) return { ok: false, missing: false, note: "not a regular file" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, missing: true, note: "file not found" };
    return { ok: false, missing: false, note: `could not inspect the file (${code ?? "unknown error"})` };
  }
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(resolved.path.absolute, OPEN_FLAGS);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, missing: true, note: "file not found" };
    return { ok: false, missing: false, note: `file could not be opened (${code ?? "unknown error"})` };
  }
  let bytes: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { ok: false, missing: false, note: "not a regular file" };
    if (info.size > maxBytes) return { ok: false, missing: false, note: `larger than ${maxBytes} bytes, not read` };
    // One byte more than allowed tells a file that grew after stat.
    const buffer = Buffer.alloc(Math.min(info.size, maxBytes) + 1);
    let filled = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
      if (filled === buffer.length) break;
    }
    if (filled > maxBytes) return { ok: false, missing: false, note: `larger than ${maxBytes} bytes, not read` };
    bytes = buffer.subarray(0, filled);
  } catch (error) {
    return { ok: false, missing: false, note: `file could not be read (${(error as NodeJS.ErrnoException).code ?? "unknown error"})` };
  } finally {
    await handle.close().catch(() => undefined);
  }
  let text: string;
  try {
    // The decoder drops a leading byte order mark.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, missing: false, note: MARKDOWN_EVIDENCE_LEADS.notUtf8 };
  }
  return { ok: true, text, relative: resolved.path.relative };
}

/** A rule's verdict, as the file_rules runner records it. */
export interface MarkdownVerdict {
  readonly state: "held" | "not_held" | "undecided";
  readonly note: string;
  /** U-276: not compared, since a file it looks at is under unreadable paths. */
  readonly notCompared?: true;
}

/** M-2: whether a document heading is the listed one. */
function matches(listed: MarkdownHeading, heading: DocumentHeading): boolean {
  return heading.text === listed.text && (listed.level === undefined || heading.level === listed.level);
}

const headingItem = (listed: MarkdownHeading): MarkdownEvidenceItem =>
  listed.level === undefined ? { text: listed.text } : { text: listed.text, detail: `level ${listed.level}` };

const unreadable = (loaded: Extract<LoadedMarkdown, { ok: false }>): MarkdownVerdict =>
  // A missing document has neither the headings nor working links; anything else is undecided.
  loaded.missing ? { state: "not_held", note: loaded.note } : { state: "undecided", note: loaded.note };

/** The notes of a rule the run's signal stopped (undecided, as the runner's "cancelled before ..."). */
const CANCELLED_BEFORE_READING: MarkdownVerdict = { state: "undecided", note: MARKDOWN_EVIDENCE_LEADS.cancelledBeforeReading };
const CANCELLED_WHILE_CHECKING: MarkdownVerdict = { state: "undecided", note: MARKDOWN_EVIDENCE_LEADS.cancelledWhileChecking };
/** Read each time: the signal changes while the rule waits. */
const stopped = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

export interface MarkdownCheckOptions {
  /** Largest document read. MAX_MARKDOWN_RULE_FILE_BYTES unless given (tests). */
  readonly maxBytes?: number;
  /** The run's signal (cancellation, time limit), looked at between the long steps (R-89 M-1, L-2). */
  readonly signal?: AbortSignal;
  /**
   * U-276 (V-28 H1): whether a real path relative to the root is under the run's unreadable paths. A
   * links rule with a target there is not compared, whether the target is there or not.
   */
  readonly isUnreadable?: (relative: string) => Promise<boolean>;
}

/** `markdown_headings`: the listed headings are in the document (in the listed order with "in_order"). */
export async function checkMarkdownHeadings(rule: MarkdownHeadingsRule, workspace: Workspace, options: MarkdownCheckOptions = {}): Promise<MarkdownVerdict> {
  const listed = Array.isArray(rule.headings) ? rule.headings : [];
  if (listed.length === 0) return { state: "undecided", note: "no heading is listed, so nothing was checked" };
  const loaded = await loadMarkdown(rule.path, workspace, options.maxBytes ?? MAX_MARKDOWN_RULE_FILE_BYTES);
  if (!loaded.ok) return unreadable(loaded);
  if (stopped(options.signal)) return CANCELLED_BEFORE_READING;
  const read = readMarkdown(loaded.text, { links: false });
  if (read.unread !== undefined) return { state: "undecided", note: read.unread };
  const { headings } = read;
  if (rule.order === "in_order") {
    let from = 0;
    for (let index = 0; index < listed.length; index += 1) {
      const want = listed[index] as MarkdownHeading;
      while (from < headings.length && !matches(want, headings[from] as DocumentHeading)) from += 1;
      if (from >= headings.length) {
        // The listed headings left, from the first that could not be matched after the one before.
        return { state: "not_held", note: `${MARKDOWN_EVIDENCE_LEADS.headingsOutOfOrder}: ${markdownEvidenceList(listed.slice(index).map(headingItem))}` };
      }
      from += 1;
    }
    return { state: "held", note: MARKDOWN_EVIDENCE_LEADS.held };
  }
  const levelsOf = new Map<string, Set<number>>();
  for (const heading of headings) {
    const levels = levelsOf.get(heading.text);
    if (levels === undefined) levelsOf.set(heading.text, new Set([heading.level]));
    else levels.add(heading.level);
  }
  const missing = listed.filter((want) => {
    const levels = levelsOf.get(want.text);
    return levels === undefined || (want.level !== undefined && !levels.has(want.level));
  });
  if (missing.length > 0) return { state: "not_held", note: `${MARKDOWN_EVIDENCE_LEADS.missingHeadings}: ${markdownEvidenceList(missing.map(headingItem))}` };
  return { state: "held", note: MARKDOWN_EVIDENCE_LEADS.held };
}

/** What looking at one target found. */
type TargetLook = { readonly kind: "exists" | "missing" | "outside" | "unreadable" } | { readonly kind: "unsure"; readonly code: string };

async function lookAtTarget(relative: string, workspace: Workspace, isUnreadable?: (relative: string) => Promise<boolean>): Promise<TargetLook> {
  const resolved = await workspace.resolve(relative, "read");
  // A link inside that leads outside, or a name the workspace refuses (it cannot exist there).
  if (!resolved.ok) return { kind: resolved.code === "invalid_path" ? "missing" : "outside" };
  // U-276: before anything is looked at there.
  if (isUnreadable !== undefined && (await isUnreadable(resolved.path.relative))) return { kind: "unreadable" };
  try {
    await fs.stat(resolved.path.absolute);
    return { kind: "exists" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? { kind: "missing" } : { kind: "unsure", code: code ?? "unknown error" };
  }
}

/** `markdown_links`: every relative target of the document exists in the workspace. */
export async function checkMarkdownLinks(rule: MarkdownLinksRule, workspace: Workspace, options: MarkdownCheckOptions = {}): Promise<MarkdownVerdict> {
  const loaded = await loadMarkdown(rule.path, workspace, options.maxBytes ?? MAX_MARKDOWN_RULE_FILE_BYTES);
  if (!loaded.ok) return unreadable(loaded);
  if (stopped(options.signal)) return CANCELLED_BEFORE_READING;
  const read = readMarkdown(loaded.text);
  if (read.unread !== undefined) return { state: "undecided", note: read.unread };
  const documentDir = path.posix.dirname(loaded.relative);
  const broken: MarkdownEvidenceItem[] = [];
  const unsure: MarkdownEvidenceItem[] = [];
  /** R-89 L-2: each distinct target is looked at once. */
  const looked = new Map<string, TargetLook>();
  for (const link of read.links) {
    const judged = judgeTarget(link.target, documentDir);
    if (judged.kind === "skip") continue;
    if (judged.kind !== "check") {
      broken.push({ text: link.target, detail: `line ${link.line}, ${judged.kind}` });
      continue;
    }
    let look = looked.get(judged.relative);
    if (look === undefined) {
      if (stopped(options.signal)) return CANCELLED_WHILE_CHECKING;
      look = await lookAtTarget(judged.relative, workspace, options.isUnreadable);
      looked.set(judged.relative, look);
    }
    // U-276: one target under unreadable paths and the rule is not compared, nothing of it said.
    if (look.kind === "unreadable") return { state: "undecided", note: FILE_NOT_JUDGED_NOTE, notCompared: true };
    if (look.kind === "missing" || look.kind === "outside") broken.push({ text: link.target, detail: `line ${link.line}, ${look.kind}` });
    else if (look.kind === "unsure") unsure.push({ text: link.target, detail: `line ${link.line}, ${look.code}` });
  }
  if (broken.length > 0) return { state: "not_held", note: `${MARKDOWN_EVIDENCE_LEADS.brokenLinks}: ${markdownEvidenceList(broken)}` };
  if (unsure.length > 0) return { state: "undecided", note: `${MARKDOWN_EVIDENCE_LEADS.targetsUnchecked}: ${markdownEvidenceList(unsure)}` };
  return { state: "held", note: MARKDOWN_EVIDENCE_LEADS.held };
}
