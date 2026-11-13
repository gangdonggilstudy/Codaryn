/**
 * U-116 (P1 bundle C, PM decisions M-1 to M-5, contract `src/contracts/verify.ts` MarkdownFileRule):
 * the `markdown_headings` and `markdown_links` rules of the `file_rules` verifier.
 *
 * Markdown is read with a small reader of its own (no dependency):
 * - Fenced code (``` or ~~~ with at most three spaces before it, deeper inside a list item; closed by
 *   the same character at least as long, or the end of the file) is skipped whole. Code spans are
 *   skipped inside a block. Indented code blocks are not recognised: their text is read as ordinary
 *   text (MARKDOWN_RULE_LIMITS says so).
 * - Headings: ATX (`#` to `######` then a space, a TAB or the end of the line; at most three spaces
 *   before; a closing `#` run after a space or TAB is dropped) and Setext (the line above a `=`
 *   underline is level 1, above a `-` underline level 2). Lines of block quotes and list items are
 *   not headings.
 * - Links: inline links and images (`[text](target "title")`, `![alt](<target>)`) and one-line
 *   reference definitions (`[label]: target`). Backslash escapes are honoured. HTML is not read.
 *
 * A target is judged on its text before anything on disk is looked at (M-3): one with a scheme
 * (`[A-Za-z][A-Za-z0-9+.-]*:`, a drive letter included), empty, or only an anchor is not checked;
 * the `#...` and `?...` parts are removed, percent escapes decoded (an escape that does not decode is
 * kept as written), `\` read as `/`. One that starts with `/` or `\`, leaves the workspace or names
 * the state directory is "outside" and is never handed to the workspace, so a link cannot be used to
 * probe outside it. The rest is resolved by the workspace (a link inside that leads outside is
 * "outside" too) and must exist, as a file or a directory, else it is "missing".
 */

import * as fs from "node:fs/promises";
import path from "node:path";

import { MARKDOWN_EVIDENCE_LEADS, MAX_MARKDOWN_RULE_FILE_BYTES, markdownEvidenceList } from "../contracts/index.js";
import type { MarkdownEvidenceItem, MarkdownHeading, MarkdownHeadingsRule, MarkdownLinksRule, Workspace } from "../contracts/index.js";

/** A heading of a document. */
export interface DocumentHeading {
  readonly level: number;
  readonly text: string;
  /** 1-based line of the heading (the ATX line, or the line above a Setext underline). */
  readonly line: number;
}

/** A link of a document. */
export interface DocumentLink {
  readonly kind: "link" | "image" | "definition";
  /** The target as written, without angle brackets. */
  readonly target: string;
  /** 1-based line the link starts on. */
  readonly line: number;
}

export interface MarkdownStructure {
  readonly headings: readonly DocumentHeading[];
  readonly links: readonly DocumentLink[];
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
/** In a list a fence may be indented as deep as the item's content. */
const FENCE_OPEN_IN_LIST = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const THEMATIC = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const QUOTE = /^ {0,3}>/;
const DEFINITION = /^ {0,3}\[((?:\\.|[^\\\]])+)\]:[ \t]*(?:<([^<>\n]*)>|(\S+))(?:[ \t]+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\)))?[ \t]*$/;

/** Columns of leading white space, a TAB advancing to the next multiple of four. */
function indentOf(line: string): number {
  let columns = 0;
  for (const char of line) {
    if (char === " ") columns += 1;
    else if (char === "\t") columns += 4 - (columns % 4);
    else break;
  }
  return columns;
}

const isBlank = (line: string): boolean => line.trim().length === 0;

/** An ATX heading's text: trimmed, a closing `#` run (after a space or TAB, or alone) dropped. */
function atxText(raw: string | undefined): string {
  const text = (raw ?? "").trim();
  if (/^#+$/.test(text)) return "";
  return text.replace(/[ \t]+#+$/, "").trim();
}

/**
 * The headings and links of `text`. Lines are split at LF; a CR before it and a leading byte order
 * mark are dropped. The links of a paragraph are read from its lines joined, so a code span or a
 * link that wraps is still one.
 */
export function readMarkdown(text: string): MarkdownStructure {
  const lines = text.replace(/^\uFEFF/, "").split("\n").map((line) => line.replace(/\r$/, ""));
  const headings: DocumentHeading[] = [];
  const links: DocumentLink[] = [];
  /** Lines of the open inline block (paragraph, list item, quote) and the line it started on. */
  let block: string[] = [];
  let blockStart = 0;
  /** Whether the block's last line may be the text of a Setext heading (a plain paragraph line). */
  let setextCandidate = false;
  let fence: { char: string; length: number } | null = null;
  let inList = false;

  const flushBlock = (): void => {
    if (block.length > 0) readInlineLinks(block.join("\n"), blockStart, links);
    block = [];
    setextCandidate = false;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const lineNumber = index + 1;

    if (fence !== null) {
      const indent = inList ? "[ \\t]*" : " {0,3}";
      const close = new RegExp(`^${indent}${fence.char === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
      if (close.test(line)) fence = null;
      continue;
    }
    const open = (inList ? FENCE_OPEN_IN_LIST : FENCE_OPEN).exec(line);
    if (open !== null && !((open[2] as string).startsWith("`") && (open[3] ?? "").includes("`"))) {
      flushBlock();
      fence = { char: (open[2] as string)[0] as string, length: (open[2] as string).length };
      continue;
    }
    if (isBlank(line)) {
      flushBlock();
      continue;
    }
    // A line that is neither indented nor a list item ends the list.
    if (inList && indentOf(line) < 2 && !LIST_ITEM.test(line)) inList = false;

    const atx = ATX.exec(line);
    if (atx !== null) {
      flushBlock();
      const content = atxText(atx[2]);
      headings.push({ level: (atx[1] as string).length, text: content, line: lineNumber });
      readInlineLinks(content, lineNumber, links);
      continue;
    }
    const setext = SETEXT.exec(line);
    if (setext !== null && block.length > 0 && setextCandidate) {
      // The contract's heading is the line above the underline; the lines before it stay a paragraph.
      const above = block.pop() as string;
      const aboveLine = lineNumber - 1;
      flushBlock();
      const content = above.trim();
      headings.push({ level: (setext[1] as string).startsWith("=") ? 1 : 2, text: content, line: aboveLine });
      readInlineLinks(content, aboveLine, links);
      continue;
    }
    if (THEMATIC.test(line)) {
      flushBlock();
      continue;
    }
    // A reference definition cannot interrupt a paragraph.
    if (block.length === 0) {
      const definition = DEFINITION.exec(line);
      if (definition !== null) {
        links.push({ kind: "definition", target: definition[2] ?? definition[3] ?? "", line: lineNumber });
        continue;
      }
    }

    const listItem = LIST_ITEM.test(line);
    if (listItem || QUOTE.test(line)) {
      // A list item or quote line starts its own block; it is never a Setext heading's text.
      if (listItem) inList = true;
      flushBlock();
      block = [line];
      blockStart = lineNumber;
      setextCandidate = false;
    } else {
      if (block.length === 0) {
        blockStart = lineNumber;
        setextCandidate = !inList;
      }
      block.push(line);
    }
  }
  flushBlock();
  return { headings, links };
}

/** The index just past a backtick run's matching closing run, or -1 when it has none. */
function codeSpanEnd(text: string, start: number, length: number): number {
  let index = start + length;
  while (index < text.length) {
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    let run = 0;
    while (text[index + run] === "`") run += 1;
    if (run === length) return index + run;
    index += run;
  }
  return -1;
}

/** The index of the `]` that closes the `[` at `start`, or -1. Brackets nest; escapes and code spans count. */
function closingBracket(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "`") {
      let run = 0;
      while (text[index + run] === "`") run += 1;
      const end = codeSpanEnd(text, index, run);
      index = end > 0 ? end - 1 : index + run - 1;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

const skipSpace = (text: string, from: number): number => {
  let index = from;
  while (text[index] === " " || text[index] === "\t" || text[index] === "\n") index += 1;
  return index;
};

/** An inline link's target after `(` at `start`: the target and the index past `)`, or null. */
function inlineTarget(text: string, start: number): { readonly target: string; readonly end: number } | null {
  let index = skipSpace(text, start);
  let target: string;
  if (text[index] === "<") {
    const close = text.indexOf(">", index + 1);
    if (close < 0) return null;
    target = text.slice(index + 1, close);
    if (target.includes("\n") || target.includes("<")) return null;
    index = close + 1;
  } else {
    let depth = 0;
    const begin = index;
    while (index < text.length) {
      const char = text[index] as string;
      if (char === "\\" && index + 1 < text.length) {
        index += 2;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") {
        if (depth === 0) break;
        depth -= 1;
      } else if (/[\s\u0000-\u001f\u007f]/.test(char)) break;
      index += 1;
    }
    target = text.slice(begin, index);
  }
  index = skipSpace(text, index);
  // An optional title in quotes or parentheses.
  const quote = text[index];
  if (quote === '"' || quote === "'" || quote === "(") {
    const closer = quote === "(" ? ")" : quote;
    index += 1;
    while (index < text.length && text[index] !== closer) index += text[index] === "\\" ? 2 : 1;
    if (index >= text.length) return null;
    index = skipSpace(text, index + 1);
  }
  if (text[index] !== ")") return null;
  return { target, end: index + 1 };
}

/** Inline links and images of one block of text; `firstLine` is the block's first line. */
function readInlineLinks(text: string, firstLine: number, links: DocumentLink[]): void {
  const lineAt = (index: number): number => firstLine + (text.slice(0, index).match(/\n/g)?.length ?? 0);
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "`") {
      let run = 0;
      while (text[index + run] === "`") run += 1;
      const end = codeSpanEnd(text, index, run);
      index = end > 0 ? end - 1 : index + run - 1;
      continue;
    }
    if (char !== "[") continue;
    const close = closingBracket(text, index);
    if (close < 0 || text[close + 1] !== "(") continue;
    const target = inlineTarget(text, close + 2);
    if (target === null) continue;
    const image = index > 0 && text[index - 1] === "!" && (index < 2 || text[index - 2] !== "\\");
    links.push({ kind: image ? "image" : "link", target: target.target, line: lineAt(index) });
    // The link text may hold an image (`[![badge](b.png)](a.md)`).
    readInlineLinks(text.slice(index + 1, close), lineAt(index + 1), links);
    index = target.end - 1;
  }
}

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

/** Reads the document at `rulePath` (after Workspace.resolve), at most `maxBytes` bytes, as UTF-8. */
export async function loadMarkdown(rulePath: string, workspace: Workspace, maxBytes: number): Promise<LoadedMarkdown> {
  const resolved = await workspace.resolve(rulePath, "read");
  if (!resolved.ok) return { ok: false, missing: false, note: `path rejected (${resolved.code})` };
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(resolved.path.absolute, "r");
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
    return { ok: false, missing: false, note: "not UTF-8 text" };
  }
  return { ok: true, text, relative: resolved.path.relative };
}

/** A rule's verdict, as the file_rules runner records it. */
export interface MarkdownVerdict {
  readonly state: "held" | "not_held" | "undecided";
  readonly note: string;
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

export interface MarkdownCheckOptions {
  /** Largest document read. MAX_MARKDOWN_RULE_FILE_BYTES unless given (tests). */
  readonly maxBytes?: number;
}

/** `markdown_headings`: the listed headings are in the document (in the listed order with "in_order"). */
export async function checkMarkdownHeadings(rule: MarkdownHeadingsRule, workspace: Workspace, options: MarkdownCheckOptions = {}): Promise<MarkdownVerdict> {
  const listed = Array.isArray(rule.headings) ? rule.headings : [];
  if (listed.length === 0) return { state: "undecided", note: "no heading is listed, so nothing was checked" };
  const loaded = await loadMarkdown(rule.path, workspace, options.maxBytes ?? MAX_MARKDOWN_RULE_FILE_BYTES);
  if (!loaded.ok) return unreadable(loaded);
  const { headings } = readMarkdown(loaded.text);
  if (rule.order === "in_order") {
    let from = 0;
    for (let index = 0; index < listed.length; index += 1) {
      const at = headings.findIndex((heading, position) => position >= from && matches(listed[index] as MarkdownHeading, heading));
      if (at < 0) {
        // The listed headings left, from the first that could not be matched after the one before.
        return { state: "not_held", note: `${MARKDOWN_EVIDENCE_LEADS.headingsOutOfOrder}: ${markdownEvidenceList(listed.slice(index).map(headingItem))}` };
      }
      from = at + 1;
    }
    return { state: "held", note: MARKDOWN_EVIDENCE_LEADS.held };
  }
  const missing = listed.filter((want) => !headings.some((heading) => matches(want, heading)));
  if (missing.length > 0) return { state: "not_held", note: `${MARKDOWN_EVIDENCE_LEADS.missingHeadings}: ${markdownEvidenceList(missing.map(headingItem))}` };
  return { state: "held", note: MARKDOWN_EVIDENCE_LEADS.held };
}

/** `markdown_links`: every relative target of the document exists in the workspace. */
export async function checkMarkdownLinks(rule: MarkdownLinksRule, workspace: Workspace, options: MarkdownCheckOptions = {}): Promise<MarkdownVerdict> {
  const loaded = await loadMarkdown(rule.path, workspace, options.maxBytes ?? MAX_MARKDOWN_RULE_FILE_BYTES);
  if (!loaded.ok) return unreadable(loaded);
  const { links } = readMarkdown(loaded.text);
  const documentDir = path.posix.dirname(loaded.relative);
  const broken: MarkdownEvidenceItem[] = [];
  const unsure: MarkdownEvidenceItem[] = [];
  for (const link of links) {
    const judged = judgeTarget(link.target, documentDir);
    if (judged.kind === "skip") continue;
    if (judged.kind !== "check") {
      broken.push({ text: link.target, detail: `line ${link.line}, ${judged.kind}` });
      continue;
    }
    const resolved = await workspace.resolve(judged.relative, "read");
    if (!resolved.ok) {
      // A link inside that leads outside, or a name the workspace refuses (it cannot exist there).
      broken.push({ text: link.target, detail: `line ${link.line}, ${resolved.code === "invalid_path" ? "missing" : "outside"}` });
      continue;
    }
    try {
      await fs.stat(resolved.path.absolute);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") broken.push({ text: link.target, detail: `line ${link.line}, missing` });
      else unsure.push({ text: link.target, detail: `line ${link.line}, ${code ?? "unknown error"}` });
    }
  }
  if (broken.length > 0) return { state: "not_held", note: `${MARKDOWN_EVIDENCE_LEADS.brokenLinks}: ${markdownEvidenceList(broken)}` };
  if (unsure.length > 0) return { state: "undecided", note: `targets that could not be looked at: ${markdownEvidenceList(unsure)}` };
  return { state: "held", note: MARKDOWN_EVIDENCE_LEADS.held };
}
