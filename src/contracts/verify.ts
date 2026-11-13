/**
 * Verifiers decide the final status. A model's "done" never does.
 * Nothing here assumes Git or a test runner.
 */

import type { AppliedPlanAction } from "./plan.js";
import type { MaskedText, RawText } from "./text.js";

/** Runs a user-configured command without a shell. It is task configuration, not a model request. */
export interface CommandVerifierConfig {
  readonly id: string;
  readonly kind: "command";
  readonly executable: string;
  readonly args: readonly string[];
  /** Relative to the workspace root. Defaults to ".". */
  readonly cwd?: string;
  /** Defaults to DEFAULT_COMMAND_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Defaults to 0. */
  readonly expectExitCode?: number;
}

/** U-116: the Markdown rules (MarkdownFileRule) are rules of the same list. */
export type FileRule =
  | { readonly type: "exists"; readonly path: string }
  | { readonly type: "absent"; readonly path: string }
  | { readonly type: "contains"; readonly path: string; readonly text: string }
  | { readonly type: "not_contains"; readonly path: string; readonly text: string }
  | MarkdownFileRule;

/**
 * U-116 (P1 bundle C, proposal M-1 to M-5, docs/reviews/2026-11-13-p1-bundle-proposal.md): two
 * Markdown rules of `file_rules`. They read the UTF-8 file at `path` (at most
 * MAX_MARKDOWN_RULE_FILE_BYTES) and nothing from the network.
 * - Outcomes, as the other rules: a file that is missing does not hold the rule (a document that is
 *   not there has neither the headings nor working links); a file that cannot be read, is not UTF-8
 *   text or is larger than the limit leaves the rule undecided (inconclusive). So do the three
 *   reader causes below (U-143, R-89b N-1): a line over the line bound, brackets over the depth bound
 *   (the links rule only), and the run's signal (cancelled, or its time limit) during the check.
 * - Lines end at LF, CR LF or a lone CR (as CommonMark); a leading byte order mark is dropped.
 * - Code: lines inside a fenced code block (``` or ~~~, closed by the same fence or the end of the
 *   file) and text inside a code span are neither headings nor links. Indented code blocks are not
 *   recognised (their text is read as ordinary text; MARKDOWN_RULE_LIMITS says so).
 * - HTML (R-89 L-1; U-143, R-89b N-1: as the verifier reads it): the seven kinds of CommonMark HTML
 *   block are skipped as fenced code is, neither headings nor links. Each starts at a line that
 *   begins, after at most three spaces, with:
 *   1. `<script`, `<pre`, `<style` or `<textarea`, to the line holding its closing tag;
 *   2. `<!--`, to the line holding the next `-->`;
 *   3. `<?`, to the line holding `?>`;
 *   4. `<!` and a letter, to the line holding `>`;
 *   5. `<![CDATA[`, to the line holding `]]>`;
 *   6. a block-level tag (as `<div>`, `<table>`, `<p>`), to the next blank line;
 *   7. a whole open or closing tag alone on its line, to the next blank line.
 *   The closing line belongs to the block, and a block not closed runs to the end of the file. Inside
 *   another block a comment (`<!--` to the next `-->`) hides the links in it from `markdown_links`;
 *   in a heading's text it stays, as other inline markup does. Other inline HTML (tags, `<a href>`) is
 *   not read as HTML: it is ordinary text.
 * - Only top-level headings count (PM, R-89 I-1: the skeleton of a document is its top-level
 *   headings). A heading on a line of a block quote or of a list item does not count for
 *   `markdown_headings`:
 *   - a block quote line starts, after at most three spaces, with `>`;
 *   - a list item starts at a line that begins, after at most three spaces, with `-`, `+`, `*`, or
 *     1 to 9 digits and `.` or `)`, followed by a space, a TAB or the end of the line. Its content
 *     column is where its text starts: after the marker and the 1 to 4 spaces that follow it, or
 *     one column after the marker when the text is empty or starts 5 or more spaces after it. The
 *     later lines indented at least to that column, and the blank lines between them, are lines of
 *     the item. A line indented less ends the item (and the list) unless it starts another item.
 *   Links in block quotes and list items are read as everywhere else.
 * - Reader bounds (R-89 M-1; U-143, R-89b N-1: the values and scope PM accepted):
 *   - a line longer than MAX_MARKDOWN_LINE_CHARS leaves either rule undecided with
 *     markdownLineTooLongNote(the line). Lines of fenced code and of HTML blocks do not count (they
 *     are only looked at for their end). A file of one line of exactly 1 MiB is undecided so (PM);
 *   - brackets nested deeper than MAX_MARKDOWN_BRACKET_DEPTH leave `markdown_links` undecided with
 *     markdownBracketsTooDeepNote(the line of the outer `[`). `markdown_headings` does not read
 *     brackets, so the same file can still be judged by it.
 *   The bounds are a safety net: the reader takes time in proportion to the file, whatever its
 *   lines, so that the run's duration limit and its cancel are kept.
 * - The run's signal (R-89 L-2): the rules look at it between their long steps. Stopped before the
 *   document was read: MARKDOWN_EVIDENCE_LEADS.cancelledBeforeReading; while link targets were
 *   looked at: MARKDOWN_EVIDENCE_LEADS.cancelledWhileChecking. Both undecided, never a failure.
 * - Evidence (the note of the rule's line, after the verifier's "<state>: <label> (" as for every
 *   rule): MARKDOWN_EVIDENCE_LEADS' text, then markdownEvidenceList of what is missing, at most
 *   MAX_MARKDOWN_EVIDENCE_ITEMS items. The engine masks it as any evidence before it is recorded or
 *   sent (registered values become tokens), and cuts it at MAX_EVIDENCE_BYTES.
 */
export const MARKDOWN_RULE_TYPES = ["markdown_headings", "markdown_links"] as const;
export type MarkdownRuleType = (typeof MARKDOWN_RULE_TYPES)[number];

/** Largest file a Markdown rule reads (1 MiB). A larger file leaves the rule undecided. */
export const MAX_MARKDOWN_RULE_FILE_BYTES = 1_048_576;
/** Most headings one `markdown_headings` rule lists. More is `invalid_task` / `invalid_config`. */
export const MAX_MARKDOWN_RULE_HEADINGS = 50;
/** Most code points of one listed heading text (after trimming); it may not be empty. */
export const MAX_MARKDOWN_HEADING_CHARS = 200;
/** Most items one rule's evidence lists; the rest is counted ("and N more"). */
export const MAX_MARKDOWN_EVIDENCE_ITEMS = 20;
/** Most code points of one evidence item's text before it is cut with "…" (as long texts are). */
export const MAX_MARKDOWN_EVIDENCE_ITEM_CHARS = 80;
/**
 * R-89 M-1 (U-143, R-89b N-1: the value PM accepted, 100,000): the longest line a Markdown rule
 * reads, in UTF-16 code units (a JavaScript string's `length`), not counting its line break. A longer
 * line, outside fenced code and HTML blocks, leaves the rule undecided. High enough for an image
 * given as a `data:` URI on one line.
 */
export const MAX_MARKDOWN_LINE_CHARS = 100_000;
/**
 * R-89 M-1 (U-143, R-89b N-1: the scope PM accepted, the links rule only): the deepest nesting of
 * matched `[` `]` pairs within one block of text (a paragraph, a heading, a list item's or a block
 * quote's text). An unmatched `[` (as in the interval `[0, 1)`) is text and is not counted; escaped
 * brackets (a backslash before `[` or `]`) and code spans are not counted either. Deeper nesting
 * leaves `markdown_links` undecided.
 */
export const MAX_MARKDOWN_BRACKET_DEPTH = 32;

/** U-143 (R-89b N-1): the note of a rule undecided by a line over MAX_MARKDOWN_LINE_CHARS (1-based line). */
export function markdownLineTooLongNote(line: number): string {
  return `line ${line} is longer than ${MAX_MARKDOWN_LINE_CHARS} characters, not read`;
}

/** U-143 (R-89b N-1): the note of a links rule undecided by brackets over MAX_MARKDOWN_BRACKET_DEPTH. */
export function markdownBracketsTooDeepNote(line: number): string {
  return `brackets nested deeper than ${MAX_MARKDOWN_BRACKET_DEPTH} levels at line ${line}, not read`;
}

/** M-2: one heading a document must have. */
export interface MarkdownHeading {
  /**
   * Compared exactly with a heading's text as written: the text after the ATX marker (`#` to
   * `######` then a space, a TAB or the end of the line; at most three spaces before the marker) or
   * the line above a Setext underline (`=` level 1, `-` level 2), with white space at both ends
   * and a closing run of `#` (preceded by a space or a TAB) removed. Case counts; inline markup
   * (`**`, `` ` ``, links, an HTML comment) is part of the text.
   * R-89 I-4: a Setext heading's text is that one line only. When the paragraph above the underline
   * has several lines, the lines before the last are not part of it (CommonMark takes the whole
   * paragraph), so a heading written over several lines matches by its last line.
   */
  readonly text: string;
  /** 1 to 6. Absent: a heading of any level matches. */
  readonly level?: number;
}

/**
 * M-2: the document has these headings. `order` "any" (the default): each listed heading matches at
 * least one heading of the document. "in_order": they match headings of the document in the listed
 * order, each after the one matched before (other headings may come between, and a heading listed
 * twice needs two).
 */
export interface MarkdownHeadingsRule {
  readonly type: "markdown_headings";
  readonly path: string;
  /** 1 to MAX_MARKDOWN_RULE_HEADINGS. */
  readonly headings: readonly MarkdownHeading[];
  readonly order?: "any" | "in_order";
}

/**
 * M-3: every relative link of the document points at something that exists in the workspace.
 * - Links read: inline links and images (`[text](target)`, `![alt](target)`, the target optionally
 *   in `<...>` and followed by a title) and reference definitions (`[label]: target`).
 * - Not checked: a target with a scheme (`[A-Za-z][A-Za-z0-9+.-]*:`, as http:, mailto: or a drive
 *   letter), a target that is only an anchor (`#...`) or empty, and every anchor (the `#...` part
 *   is removed before resolving; anchors are not compared with headings).
 * - A target's `?...` part is removed and percent escapes are decoded. It is resolved against the
 *   document's directory. One that starts with `/` or `\`, or lands outside the workspace root or
 *   in the state directory, is "outside": it fails without being looked for (the rule never probes
 *   outside the workspace). Otherwise it must exist (a file or a directory), else it is "missing".
 * - R-89 I-3: whether a target exists follows the file system. Letter case counts where the volume
 *   counts it (most Linux volumes) and not where it does not (Windows, macOS by default): `Guide.md`
 *   finds `guide.md` on the second kind only. The rule compares no case itself.
 * - A target that cannot be looked at (an error other than "not there") leaves the rule undecided
 *   when nothing else fails: MARKDOWN_EVIDENCE_LEADS.targetsUnchecked, then the list with
 *   `line N, <error code>`.
 */
export interface MarkdownLinksRule {
  readonly type: "markdown_links";
  readonly path: string;
}

export type MarkdownFileRule = MarkdownHeadingsRule | MarkdownLinksRule;

/**
 * The leading words of a Markdown rule's note.
 * When it does not hold, before the list (`<lead>: <markdownEvidenceList>`):
 * - missingHeadings ("any"): the listed headings no heading of the document matches;
 * - headingsOutOfOrder ("in_order"): the listed headings left when the document is read in order,
 *   from the first that could not be matched after the one before;
 * - brokenLinks: the targets that are missing or outside, each with its line and reason.
 * When it holds: held, alone.
 * When it is undecided (R-89 I-5, M-1, L-2):
 * - targetsUnchecked: `<lead>: <list>`, each target with `line N, <error code>` (and nothing failed);
 * - fileTooLarge, notUtf8, cancelledBeforeReading, cancelledWhileChecking: alone;
 * - a reader bound: markdownLineTooLongNote, markdownBracketsTooDeepNote (U-143: these replace the
 *   leads lineTooLong and bracketsTooDeep of ba2e949, which no verifier wrote).
 * Other undecided notes (a path the workspace refuses, a file that cannot be opened or read, not a
 * regular file) and "file not found" (not held) are the verifier's own, as for the literal rules.
 * Example of a whole line:
 * `not held: "docs/guide.md" has relative links whose targets exist (targets missing or outside the
 * workspace: "img/a.png" (line 12, missing), "../x.md" (line 30, outside))`.
 */
export const MARKDOWN_EVIDENCE_LEADS = {
  missingHeadings: "headings not found",
  headingsOutOfOrder: "headings not found in the given order",
  brokenLinks: "targets missing or outside the workspace",
  held: "all found",
  targetsUnchecked: "targets that could not be looked at",
  fileTooLarge: `larger than ${MAX_MARKDOWN_RULE_FILE_BYTES} bytes, not read`,
  notUtf8: "not UTF-8 text",
  cancelledBeforeReading: "cancelled before the document was read",
  cancelledWhileChecking: "cancelled while the link targets were checked",
} as const;

/** One item of a Markdown rule's evidence: a heading text or a link target, and what to add in brackets. */
export interface MarkdownEvidenceItem {
  readonly text: string;
  /**
   * For a heading: `level N` when the rule gave a level. For a link: `line N, missing` or
   * `line N, outside`; for a target that could not be looked at, `line N, <error code>`.
   */
  readonly detail?: string;
}

function cutEvidenceText(text: string): string {
  const points = Array.from(text);
  return points.length <= MAX_MARKDOWN_EVIDENCE_ITEM_CHARS ? text : `${points.slice(0, MAX_MARKDOWN_EVIDENCE_ITEM_CHARS - 1).join("")}…`;
}

/**
 * The list of a Markdown rule's note (and of the headings in its label): each item's text cut at
 * MAX_MARKDOWN_EVIDENCE_ITEM_CHARS code points and quoted as JSON, then ` (detail)`; joined with
 * ", "; at most MAX_MARKDOWN_EVIDENCE_ITEMS items, then ", and N more". Pure.
 */
export function markdownEvidenceList(items: readonly MarkdownEvidenceItem[]): string {
  const shown = items.slice(0, MAX_MARKDOWN_EVIDENCE_ITEMS).map((item) => {
    const quoted = JSON.stringify(cutEvidenceText(item.text));
    return item.detail === undefined ? quoted : `${quoted} (${item.detail})`;
  });
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(", ")}, and ${rest} more` : shown.join(", ");
}

/**
 * The label of a Markdown rule (its `checked` entry and the middle of its evidence line). The path
 * is quoted as the other rules quote it.
 */
export function markdownRuleLabel(rule: MarkdownFileRule): string {
  if (rule.type === "markdown_links") return `"${rule.path}" has relative links whose targets exist`;
  const headings = markdownEvidenceList(rule.headings.map((heading) => ({ text: heading.text, ...(heading.level === undefined ? {} : { detail: `level ${heading.level}` }) })));
  return rule.order === "in_order" ? `"${rule.path}" has the headings ${headings} in this order` : `"${rule.path}" has the headings ${headings}`;
}

/**
 * The limits a `file_rules` result lists when it has a Markdown rule (RawVerifierResult.limits),
 * besides the literal rules' own. Fixed text: it reaches the model after masking unchanged.
 */
export const MARKDOWN_RULE_LIMITS: readonly string[] = [
  "Markdown rules check only the listed headings and that relative link targets exist in the workspace; wording, the rest of the structure and the rendering are not checked",
  "links with a scheme (http:, mailto: and others) and anchors (#...) are not checked, and nothing is fetched from the network",
  "headings and links inside fenced code blocks, code spans, HTML blocks and HTML comments are not read; indented code blocks and other inline HTML are read as ordinary text",
  "only top-level headings count: headings inside list items and block quotes do not, and a Setext heading's text is the one line above its underline",
  "whether a link target exists follows the file system's rule for letter case",
  `a file with a line longer than ${MAX_MARKDOWN_LINE_CHARS} characters is not checked, and the links rule does not check one whose brackets nest deeper than ${MAX_MARKDOWN_BRACKET_DEPTH} (inconclusive)`,
];

/** Checks files under the workspace root with literal rules. */
export interface FileRulesVerifierConfig {
  readonly id: string;
  readonly kind: "file_rules";
  /** At least one rule. */
  readonly rules: readonly FileRule[];
}

/**
 * G-A (VF-04): literal checks on tables in the workspace, for data analysis. Tables are UTF-8
 * text: `csv` and `tsv` with a header row (RFC 4180 quoting for csv), `jsonl` with one JSON object
 * per line (its keys are the columns). A number is `-?digits[.digits][e|E[+|-]digits]`; anything
 * else in a column that needs numbers is not a number. Empty cells are skipped by every op.
 * - table_shape: the columns (`exact`: the same names in the same order; `includes`: at least
 *   these) and the number of data rows.
 * - aggregate_match: `op` over the source table's `column` (count: non-empty cells), grouped by
 *   `groupBy` when given, compared with the target table's `targetColumn`. With `groupBy` the
 *   target needs `targetKeyColumn` and exactly one row per group, and no other row. Without it the
 *   target has exactly one data row. Values agree when |a - b| <= max(absolute, relative * max(|a|, |b|)).
 * Outcomes: a source table that cannot be read or parsed, or a source value that is not a number,
 * is `inconclusive` (the model cannot fix the input); a target that cannot be parsed, a missing
 * column or row, or a disagreeing value is `fail` (the model can fix its output). Evidence names
 * columns, row numbers and the two numbers compared; it carries no other cell value.
 * Limits: only the listed shapes and aggregates are checked, not the method, the interpretation or
 * any number written in prose.
 */
export interface DataChecksVerifierConfig {
  readonly id: string;
  readonly kind: "data_checks";
  /** At least one rule. */
  readonly rules: readonly DataRule[];
}

export const TABLE_FORMATS = ["csv", "tsv", "jsonl"] as const;
export type TableFormat = (typeof TABLE_FORMATS)[number];

/** A table file, relative to the workspace root. */
export interface TableRef {
  readonly path: string;
  readonly format: TableFormat;
}

export const AGGREGATE_OPS = ["sum", "count", "min", "max", "mean"] as const;
export type AggregateOp = (typeof AGGREGATE_OPS)[number];

/** Number of data rows (the header row not counted). */
export type RowCountRule =
  | { readonly equals: number }
  | { readonly min?: number; readonly max?: number }
  /** The same number of data rows as another table. */
  | { readonly sameAs: TableRef };

export type DataRule =
  | {
      readonly type: "table_shape";
      readonly table: TableRef;
      readonly columns?: readonly string[];
      /** Default "exact". */
      readonly columnsMatch?: "exact" | "includes";
      readonly rows?: RowCountRule;
    }
  | {
      readonly type: "aggregate_match";
      readonly source: TableRef;
      readonly column: string;
      readonly op: AggregateOp;
      readonly groupBy?: string;
      readonly target: TableRef;
      readonly targetColumn: string;
      /** Required with `groupBy`, not allowed without it. */
      readonly targetKeyColumn?: string;
      /** Defaults DEFAULT_DATA_TOLERANCE. Both non-negative. */
      readonly tolerance?: { readonly absolute?: number; readonly relative?: number };
    };

/** Largest table a data check reads (16 MiB). A larger source is `inconclusive`, a larger target `fail`. */
export const MAX_DATA_TABLE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_DATA_TOLERANCE = { absolute: 1e-9, relative: 1e-9 } as const;

export type VerifierConfig = CommandVerifierConfig | FileRulesVerifierConfig | DataChecksVerifierConfig;

/**
 * Verifier kinds. `inventory` (G-A, VF-05) is not configurable: every apply run makes one
 * (plan.ts, InventoryChecker) and records it like any verifier result.
 */
export const VERIFIER_KINDS = ["command", "file_rules", "data_checks", "inventory"] as const;
export type VerifierKind = (typeof VERIFIER_KINDS)[number];
/** The kinds a task or config file may list in `verifiers`. */
export const CONFIGURABLE_VERIFIER_KINDS = ["command", "file_rules", "data_checks"] as const satisfies readonly VerifierConfig["kind"][];

/**
 * pass: every check held. fail: at least one check did not hold.
 * inconclusive: the verifier could not decide (timeout, could not start, unreadable file).
 */
export type VerifierOutcome = "pass" | "fail" | "inconclusive";

/**
 * Upper bound, in UTF-8 bytes, for the evidence of one verifier result as recorded and printed
 * (T-6). The engine cuts after masking, never the verifier on raw text.
 */
export const MAX_EVIDENCE_BYTES = 8192;

/** Local result. It must be masked before it is recorded or printed. */
export interface RawVerifierResult {
  readonly id: string;
  readonly kind: VerifierKind;
  readonly outcome: VerifierOutcome;
  /**
   * Raw evidence. A verifier does not cut it (T-6): command output is passed on as the command
   * runner captured it, up to MAX_COMMAND_OUTPUT_BYTES plus the runner's capture slack per stream.
   */
  readonly evidence: RawText;
  /**
   * True when the command runner dropped output beyond its capture, so `evidence` ends at an
   * arbitrary byte. The engine then masks, drops the trailing slack where a cut secret variant
   * could remain, and only then cuts to MAX_EVIDENCE_BYTES. Absent means false.
   */
  readonly evidenceTruncated?: boolean;
  /** What was checked. Required, at least one entry. */
  readonly checked: readonly string[];
  /** What this verifier does not check. Required. An empty list states "no known limits". */
  readonly limits: readonly string[];
}

export interface VerifierResult {
  readonly id: string;
  readonly kind: VerifierKind;
  readonly outcome: VerifierOutcome;
  readonly evidence: MaskedText;
  readonly checked: readonly MaskedText[];
  readonly limits: readonly MaskedText[];
}

export interface VerifierRunner {
  /** Runs one configured verifier. Never throws for verifier-level failures. */
  run(config: VerifierConfig, signal: AbortSignal): Promise<RawVerifierResult>;
}

/** Id of the inventory result in an apply run's verifiers. */
export const INVENTORY_VERIFIER_ID = "inventory";

/**
 * G-A (VF-05, DR-6): most files and links one inventory lists, over the whole workspace. It reads
 * no content for them (paths and sizes only), so it is independent of MAX_INTEGRITY_FILES and
 * MAX_INTEGRITY_BYTES. Reaching it is found before an apply moves anything (`plan_checked`), and
 * `codaryn plan` reports it.
 */
export const MAX_INVENTORY_FILES = 100_000;

/**
 * One path of an inventory. `path` is local text (relative to the workspace root, `/` separated),
 * masked before it is recorded. `file` and `link` carry their size in bytes (a link: the length of
 * its stored target, not followed); `unchecked` is a path that could not be listed or measured.
 */
export type InventoryEntry =
  | { readonly path: RawText; readonly kind: "file" | "link"; readonly size: number }
  | { readonly path: RawText; readonly kind: "unchecked" };

/** Local-only, never recorded or sent. Directories have no entry of their own. */
export interface InventoryManifest {
  /** Sorted by `path` in code unit order, at most MAX_INVENTORY_FILES. */
  readonly entries: readonly InventoryEntry[];
  /** True when the listing stopped at MAX_INVENTORY_FILES: the manifest is incomplete. */
  readonly limitReached: boolean;
}

/**
 * G-A (VF-05): what the apply run hands the inventory check. `before` is taken in the preflight,
 * `after` once the actions are done.
 */
export interface InventoryCheckInput {
  readonly before: InventoryManifest;
  readonly after: InventoryManifest;
  /** The actions carried out, in order. */
  readonly applied: readonly AppliedPlanAction[];
  /** Real absolute path of the apply run's `.codaryn/discarded/<runId>/`. */
  readonly discardedRoot: string;
}

/**
 * G-A (VF-05, DR-6): the apply run's file inventory (`src/verify`, G-D).
 * - capture: every file and link outside the state directory with its size, links not followed,
 *   up to MAX_INVENTORY_FILES. No content is read.
 * - check: `pass` when `after` equals `before` with exactly the applied actions done, and the plan
 *   targets have their recorded SHA-256: each moved file at its new path (hashed now) with the
 *   plan's SHA-256, each discarded file gone from the workspace and present at
 *   `discardedRoot/<stored>` with the plan's SHA-256, and every other path present with the same
 *   kind and size, nothing added or removed. A difference is `fail`. An `unchecked` entry, a
 *   manifest with `limitReached`, or a target that cannot be read is `inconclusive`. Only the
 *   targets are hashed: a file outside the plan whose content changed but kept its size is not
 *   detected (stated in the result's limits). The result has `id` INVENTORY_VERIFIER_ID and kind
 *   `inventory`; evidence names paths (masked by the engine) and counts.
 */
export interface InventoryChecker {
  capture(): Promise<InventoryManifest>;
  check(input: InventoryCheckInput): Promise<RawVerifierResult>;
}
