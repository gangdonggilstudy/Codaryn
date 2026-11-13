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

/** The contract's reader bounds (R-89 M-1, U-143), exported here as well for this module's readers. */
export { MAX_MARKDOWN_BRACKET_DEPTH, MAX_MARKDOWN_LINE_CHARS };

/** CommonMark's (and cmark's) bound on nested unescaped parentheses in a link destination. */
const MAX_DESTINATION_PARENS = 32;

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
  /**
   * R-89 M-1: why the document was not read (a line longer than MAX_MARKDOWN_LINE_CHARS; brackets
   * nested deeper than MAX_MARKDOWN_BRACKET_DEPTH when links are read). Headings and links are then
   * empty and a rule on the document is undecided with this as its note.
   */
  readonly unread?: string;
}

export interface MarkdownReadOptions {
  /** Read links as well (the default). The headings rule does not, so brackets do not limit it. */
  readonly links?: boolean;
}

const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const QUOTE = /^ {0,3}>/;
const DEFINITION = /^ {0,3}\[((?:\\.|[^\\\]])+)\]:[ \t]*(?:<([^<>\n]*)>|(\S+))(?:[ \t]+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\)))?[ \t]*$/;

const isSpaceOrTab = (char: string | undefined): boolean => char === " " || char === "\t";
const isBlank = (line: string): boolean => line.trim().length === 0;

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

/** The index after the indentation a block marker may have: at most three spaces, any in a list item. */
function afterIndent(line: string, inList: boolean): number {
  let index = 0;
  if (inList) {
    while (isSpaceOrTab(line[index])) index += 1;
    return index;
  }
  while (index < 3 && line[index] === " ") index += 1;
  return index;
}

/**
 * U-149 (R-89b N-2, contract MarkdownFileRule): the content column of the list item `line` starts
 * (LIST_ITEM matched it). The text starts after the marker and the 1 to 4 columns of white space
 * that follow it, or one column after the marker when the text is empty or starts 5 or more columns
 * after it. A TAB advances to the next multiple of four.
 */
function listItemContentColumn(line: string): number {
  let index = 0;
  while (index < 3 && line[index] === " ") index += 1;
  let markerEnd = index + 1;
  if (!/[-+*]/.test(line[index] ?? "")) {
    markerEnd = index;
    while (/[0-9]/.test(line[markerEnd] ?? "")) markerEnd += 1;
    markerEnd += 1;
  }
  const afterMarker = markerEnd;
  let column = afterMarker;
  let at = markerEnd;
  while (isSpaceOrTab(line[at])) {
    column = line[at] === "\t" ? column + 4 - (column % 4) : column + 1;
    at += 1;
  }
  return at >= line.length || column - afterMarker >= 5 ? afterMarker + 1 : column;
}

/** How many `char` follow from `from`. */
function runLength(text: string, from: number, char: string): number {
  let index = from;
  while (text[index] === char) index += 1;
  return index - from;
}

/** Whether `line` holds only spaces and TABs from `from` on. */
function onlySpaceOrTab(line: string, from: number): boolean {
  for (let index = from; index < line.length; index += 1) if (!isSpaceOrTab(line[index])) return false;
  return true;
}

interface Fence {
  readonly char: string;
  readonly length: number;
}

/** A fence opening on `line`: three or more backticks or tildes; a backtick fence's info has no backtick. */
function fenceOpen(line: string, inList: boolean): Fence | null {
  const start = afterIndent(line, inList);
  const char = line[start];
  if (char !== "`" && char !== "~") return null;
  const length = runLength(line, start, char);
  if (length < 3) return null;
  if (char === "`" && line.indexOf("`", start + length) >= 0) return null;
  return { char, length };
}

/** Whether `line` closes `fence`: the same character, at least as many, then only spaces and TABs. */
function fenceCloses(line: string, fence: Fence, inList: boolean): boolean {
  const start = afterIndent(line, inList);
  const length = runLength(line, start, fence.char);
  return length >= fence.length && onlySpaceOrTab(line, start + length);
}

/** An ATX heading's text: trimmed, a closing `#` run (after a space or TAB, or alone) dropped. */
function atxText(raw: string): string {
  const text = raw.trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end === 0) return "";
  return end < text.length && isSpaceOrTab(text[end - 1]) ? text.slice(0, end).trim() : text;
}

/** An ATX heading: at most three spaces, one to six `#`, then a space, a TAB or the end of the line. */
function atxHeading(line: string): { readonly level: number; readonly text: string } | null {
  const start = afterIndent(line, false);
  const level = runLength(line, start, "#");
  if (level < 1 || level > 6) return null;
  const after = start + level;
  if (after < line.length && !isSpaceOrTab(line[after])) return null;
  return { level, text: atxText(line.slice(after)) };
}

/** A Setext underline's level: a run of `=` (1) or `-` (2), then only spaces and TABs; 0 when it is not one. */
function setextLevel(line: string): 0 | 1 | 2 {
  const start = afterIndent(line, false);
  const char = line[start];
  if (char !== "=" && char !== "-") return 0;
  if (!onlySpaceOrTab(line, start + runLength(line, start, char))) return 0;
  return char === "=" ? 1 : 2;
}

/** A thematic break: three or more of one of `*`, `-`, `_`, with spaces and TABs between them. */
function isThematicBreak(line: string): boolean {
  const start = afterIndent(line, false);
  const char = line[start];
  if (char !== "*" && char !== "-" && char !== "_") return false;
  let count = 0;
  for (let index = start; index < line.length; index += 1) {
    if (line[index] === char) count += 1;
    else if (!isSpaceOrTab(line[index])) return false;
  }
  return count >= 3;
}

/** How an HTML block ends: on the line holding one of `ends` (kinds 1 to 5), or at a blank line (6, 7). */
type HtmlBlockEnd = { readonly ends: readonly string[]; readonly caseless: boolean } | "blank";

const HTML_RAW_TAGS: readonly string[] = ["script", "pre", "style", "textarea"];
/** CommonMark 0.31's block-level tag names (HTML block kind 6). */
const HTML_BLOCK_TAGS: ReadonlySet<string> = new Set([
  "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption", "center", "col", "colgroup", "dd",
  "details", "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "frame",
  "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hr", "html", "iframe", "legend", "li", "link",
  "main", "menu", "menuitem", "nav", "noframes", "ol", "optgroup", "option", "p", "param", "search", "section",
  "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title", "tr", "track", "ul",
]);
const HTML_KIND_1 = /^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i;
const HTML_KIND_4 = /^<![A-Za-z]/;
const HTML_KIND_6 = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t>]|\/>|$)/;

/** The index past a complete open or closing tag at the start of `text` (CommonMark raw HTML), or -1. */
function completeTagEnd(text: string): number {
  let index = 1;
  const closing = text[index] === "/";
  if (closing) index += 1;
  const nameStart = index;
  if (!/[A-Za-z]/.test(text[index] ?? "")) return -1;
  while (index < text.length && /[A-Za-z0-9-]/.test(text[index] as string)) index += 1;
  if (HTML_RAW_TAGS.includes(text.slice(nameStart, index).toLowerCase())) return -1;
  if (closing) {
    while (isSpaceOrTab(text[index])) index += 1;
    return text[index] === ">" ? index + 1 : -1;
  }
  for (;;) {
    const beforeSpace = index;
    while (isSpaceOrTab(text[index])) index += 1;
    if (text[index] === ">") return index + 1;
    if (text[index] === "/" && text[index + 1] === ">") return index + 2;
    // An attribute: white space, a name, and an optional value.
    if (index === beforeSpace || !/[A-Za-z_:]/.test(text[index] ?? "")) return -1;
    while (index < text.length && /[A-Za-z0-9_.:-]/.test(text[index] as string)) index += 1;
    let next = index;
    while (isSpaceOrTab(text[next])) next += 1;
    if (text[next] !== "=") continue;
    next += 1;
    while (isSpaceOrTab(text[next])) next += 1;
    const quote = text[next];
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, next + 1);
      if (close < 0) return -1;
      index = close + 1;
    } else {
      const valueStart = next;
      while (next < text.length && !/[\s"'=<>`]/.test(text[next] as string)) next += 1;
      if (next === valueStart) return -1;
      index = next;
    }
  }
}

/** The HTML block `line` starts (CommonMark kinds 1 to 7), or null. Kind 7 cannot interrupt a paragraph. */
function htmlBlockStart(line: string, inList: boolean, inParagraph: boolean): HtmlBlockEnd | null {
  const start = afterIndent(line, inList);
  if (line[start] !== "<") return null;
  const rest = line.slice(start);
  if (HTML_KIND_1.test(rest)) return { ends: HTML_RAW_TAGS.map((name) => `</${name}>`), caseless: true };
  if (rest.startsWith("<!--")) return { ends: ["-->"], caseless: false };
  if (rest.startsWith("<?")) return { ends: ["?>"], caseless: false };
  if (rest.startsWith("<![CDATA[")) return { ends: ["]]>"], caseless: false };
  if (HTML_KIND_4.test(rest)) return { ends: [">"], caseless: false };
  const kind6 = HTML_KIND_6.exec(rest);
  if (kind6 !== null && HTML_BLOCK_TAGS.has((kind6[1] as string).toLowerCase())) return "blank";
  if (!inParagraph) {
    const end = completeTagEnd(rest);
    if (end > 0 && onlySpaceOrTab(rest, end)) return "blank";
  }
  return null;
}

/** Whether `line` ends an HTML block of kinds 1 to 5. */
function htmlBlockEnds(line: string, end: Exclude<HtmlBlockEnd, "blank">): boolean {
  const text = end.caseless ? line.toLowerCase() : line;
  return end.ends.some((mark) => text.includes(mark));
}

/**
 * The headings and links of `text` (links unless `options.links` is false). The links of a paragraph
 * are read from its lines joined, so a code span or a link that wraps is still one.
 */
export function readMarkdown(text: string, options: MarkdownReadOptions = {}): MarkdownStructure {
  const withLinks = options.links !== false;
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const headings: DocumentHeading[] = [];
  const links: DocumentLink[] = [];
  const state: { unread: string | null } = { unread: null };
  /** Lines of the open inline block (paragraph, list item, quote) and the line it started on. */
  let block: string[] = [];
  let blockStart = 0;
  /** Whether the block's last line may be the text of a Setext heading (a plain paragraph line). */
  let setextCandidate = false;
  let fence: Fence | null = null;
  let html: HtmlBlockEnd | null = null;
  let inList = false;
  /** U-149: the content column of the list's current top-level item (listItemContentColumn). */
  let contentColumn = 0;

  const readLinks = (inline: string, firstLine: number): void => {
    if (!withLinks || state.unread !== null) return;
    state.unread = readInlineLinks(inline, firstLine, links);
  };
  const flushBlock = (): void => {
    if (block.length > 0) readLinks(block.join("\n"), blockStart);
    block = [];
    setextCandidate = false;
  };

  for (let index = 0; index < lines.length && state.unread === null; index += 1) {
    const line = lines[index] as string;
    const lineNumber = index + 1;

    if (html !== null) {
      if (html === "blank" ? isBlank(line) : htmlBlockEnds(line, html)) html = null;
      continue;
    }
    if (fence !== null) {
      if (fenceCloses(line, fence, inList)) fence = null;
      continue;
    }
    if (line.length > MAX_MARKDOWN_LINE_CHARS) {
      state.unread = markdownLineTooLongNote(lineNumber);
      break;
    }
    const open = fenceOpen(line, inList);
    if (open !== null) {
      flushBlock();
      fence = open;
      continue;
    }
    const htmlStart = htmlBlockStart(line, inList, block.length > 0);
    if (htmlStart !== null) {
      flushBlock();
      // A block of kinds 1 to 5 may end on its first line.
      if (htmlStart === "blank" || !htmlBlockEnds(line, htmlStart)) html = htmlStart;
      continue;
    }
    if (isBlank(line)) {
      flushBlock();
      continue;
    }
    // U-149 (R-89b N-2): a line indented less than the item's content column ends the list unless it
    // starts another item. A line indented at least that far is a line of the item: not a heading.
    if (inList && indentOf(line) < contentColumn && !LIST_ITEM.test(line)) inList = false;
    const itemLine = inList && !LIST_ITEM.test(line);

    const atx = itemLine ? null : atxHeading(line);
    if (atx !== null) {
      flushBlock();
      headings.push({ level: atx.level, text: atx.text, line: lineNumber });
      readLinks(atx.text, lineNumber);
      continue;
    }
    const setext = setextLevel(line);
    if (setext !== 0 && block.length > 0 && setextCandidate) {
      // The contract's heading is the line above the underline; the lines before it stay a paragraph.
      const above = block.pop() as string;
      const aboveLine = lineNumber - 1;
      flushBlock();
      const content = above.trim();
      headings.push({ level: setext, text: content, line: aboveLine });
      readLinks(content, aboveLine);
      continue;
    }
    if (isThematicBreak(line)) {
      flushBlock();
      continue;
    }
    // A reference definition cannot interrupt a paragraph.
    if (block.length === 0) {
      const definition = DEFINITION.exec(line);
      if (definition !== null) {
        if (withLinks) links.push({ kind: "definition", target: definition[2] ?? definition[3] ?? "", line: lineNumber });
        continue;
      }
    }

    const listItem = LIST_ITEM.test(line);
    if (listItem || QUOTE.test(line)) {
      // A list item or quote line starts its own block; it is never a Setext heading's text.
      if (listItem) {
        // A nested item (indented to the content column) stays a line of the top-level item.
        if (!inList || indentOf(line) < contentColumn) contentColumn = listItemContentColumn(line);
        inList = true;
      }
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
  if (state.unread !== null) return { headings: [], links: [], unread: state.unread };
  return { headings, links };
}

/**
 * The backtick runs of a block, to find a code span's closing run in logarithmic time: the first run
 * of the same length that starts after the opening run (CommonMark).
 */
function backtickRuns(text: string): (from: number, length: number) => number {
  const starts: number[] = [];
  const byLength = new Map<number, number[]>();
  for (let index = 0; index < text.length; ) {
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    const length = runLength(text, index, "`");
    const list = byLength.get(length);
    if (list === undefined) byLength.set(length, [starts.length]);
    else list.push(starts.length);
    starts.push(index);
    index += length;
  }
  return (from, length) => {
    const list = byLength.get(length);
    if (list === undefined) return -1;
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((starts[list[middle] as number] as number) > from) high = middle;
      else low = middle + 1;
    }
    return low < list.length ? (starts[list[low] as number] as number) + length : -1;
  };
}

const isDestinationStop = (char: string): boolean => /[\s\u0000-\u001f\u007f]/.test(char);

/**
 * An inline link's target after `(` at `start`, read no further than `end`: the target and the index
 * past `)`, or null.
 */
function inlineTarget(text: string, start: number, end: number): { readonly target: string; readonly end: number } | null {
  const skipSpace = (from: number): number => {
    let index = from;
    while (index < end && (text[index] === " " || text[index] === "\t" || text[index] === "\n")) index += 1;
    return index;
  };
  let index = skipSpace(start);
  let target: string;
  if (index < end && text[index] === "<") {
    // The first `>` closes it; a line end or another `<` before it means it is not a link.
    let close = index + 1;
    while (close < end && text[close] !== ">") {
      if (text[close] === "\n" || text[close] === "<") return null;
      close += 1;
    }
    if (close >= end) return null;
    target = text.slice(index + 1, close);
    index = close + 1;
  } else {
    let depth = 0;
    const begin = index;
    while (index < end) {
      const char = text[index] as string;
      if (char === "\\" && index + 1 < end) {
        index += 2;
        continue;
      }
      if (char === "(") {
        depth += 1;
        if (depth > MAX_DESTINATION_PARENS) return null;
      } else if (char === ")") {
        if (depth === 0) break;
        depth -= 1;
      } else if (isDestinationStop(char)) break;
      index += 1;
    }
    target = text.slice(begin, index);
  }
  index = skipSpace(index);
  // An optional title in quotes or parentheses; one in parentheses holds no unescaped `(`.
  const quote = text[index];
  if (index < end && (quote === '"' || quote === "'" || quote === "(")) {
    const closer = quote === "(" ? ")" : quote;
    index += 1;
    while (index < end && text[index] !== closer) {
      if (quote === "(" && text[index] === "(") return null;
      index += text[index] === "\\" ? 2 : 1;
    }
    if (index >= end) return null;
    index = skipSpace(index + 1);
  }
  if (index >= end || text[index] !== ")") return null;
  return { target, end: index + 1 };
}

/**
 * Inline links and images of one block of text; `firstLine` is the block's first line. Returns why
 * the block was not read (brackets nested deeper than MAX_MARKDOWN_BRACKET_DEPTH), or null.
 *
 * First pass: backslash escapes, code spans and HTML comments are literal; every other `]` closes the
 * nearest open `[`. Second pass, over the `[` in order: one whose `]` is followed by `(` and a target
 * is a link; the `[` inside its text are read on (an image in a link), those inside its target are not.
 */
function readInlineLinks(text: string, firstLine: number, links: DocumentLink[]): string | null {
  const closingRun = backtickRuns(text);
  const closeOf = new Map<number, number>();
  const openers: number[] = [];
  const open: number[] = [];
  /** The next `-->` at or after the last search, or -1 when there is none left. */
  let commentClose = -2;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "`") {
      const length = runLength(text, index, "`");
      const end = closingRun(index, length);
      index = end > 0 ? end - 1 : index + length - 1;
      continue;
    }
    if (char === "<" && text.startsWith("<!--", index)) {
      // CommonMark 0.31: `<!-->` and `<!--->` are comments; otherwise one runs to the next `-->`.
      let end = -1;
      if (text.startsWith("<!-->", index)) end = index + 5;
      else if (text.startsWith("<!--->", index)) end = index + 6;
      else {
        if (commentClose !== -1 && commentClose < index + 4) commentClose = text.indexOf("-->", index + 4);
        if (commentClose >= 0) end = commentClose + 3;
      }
      if (end > 0) index = end - 1;
      continue;
    }
    if (char === "[") {
      open.push(index);
      openers.push(index);
    } else if (char === "]" && open.length > 0) {
      closeOf.set(open.pop() as number, index);
    }
  }

  let line = firstLine;
  let counted = 0;
  const lineAt = (position: number): number => {
    for (; counted < position; counted += 1) if (text[counted] === "\n") line += 1;
    return line;
  };

  // Nesting of the matched pairs (an unmatched `[` is text and does not count).
  const enclosingPairs: number[] = [];
  for (const opener of openers) {
    const close = closeOf.get(opener);
    if (close === undefined) continue;
    while (enclosingPairs.length > 0 && (enclosingPairs[enclosingPairs.length - 1] as number) < opener) enclosingPairs.pop();
    enclosingPairs.push(close);
    if (enclosingPairs.length > MAX_MARKDOWN_BRACKET_DEPTH) {
      return markdownBracketsTooDeepNote(lineAt(opener));
    }
  }

  line = firstLine;
  counted = 0;
  /** The links whose text is being read: where the text closes and where the link ends. */
  const enclosing: { readonly close: number; readonly end: number }[] = [];
  let skipUntil = -1;
  for (const opener of openers) {
    while (enclosing.length > 0 && (enclosing[enclosing.length - 1] as { readonly close: number }).close < opener) {
      skipUntil = Math.max(skipUntil, (enclosing.pop() as { readonly end: number }).end);
    }
    if (opener < skipUntil) continue;
    const close = closeOf.get(opener);
    if (close === undefined || text[close + 1] !== "(") continue;
    const limit = enclosing.length > 0 ? (enclosing[enclosing.length - 1] as { readonly close: number }).close : text.length;
    const target = inlineTarget(text, close + 2, limit);
    if (target === null) continue;
    const image = opener > 0 && text[opener - 1] === "!" && (opener < 2 || text[opener - 2] !== "\\");
    links.push({ kind: image ? "image" : "link", target: target.target, line: lineAt(opener) });
    enclosing.push({ close, end: target.end });
  }
  return null;
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
