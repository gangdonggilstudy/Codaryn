/**
 * U-116, review R-89: the Markdown reader of src/verify/markdown.ts after the fixes.
 * - M-1: reading is linear. Each worst input of the review, at 1 MiB, is read within a bound; the
 *   measured times are printed as diagnostics. A line longer than MAX_MARKDOWN_LINE_CHARS, and
 *   brackets nested deeper than MAX_MARKDOWN_BRACKET_DEPTH (links rule), leave the rule undecided.
 * - M-1, L-2: the rules look at the run's signal between the long steps; each distinct target once.
 * - L-1: HTML comments and HTML blocks hold neither headings nor links.
 * - I-2: a lone CR ends a line.
 * - L-3: only a regular file is opened (a named pipe is POSIX only; on Windows that case is skipped).
 * Real files in temp folders, the real workspace module, synthetic values only.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { MAX_MARKDOWN_RULE_FILE_BYTES } from "../../../src/contracts/index.js";
import type { Workspace } from "../../../src/contracts/index.js";
import { createVerifierRunner } from "../../../src/verify/index.js";
import type { CommandRunner } from "../../../src/verify/index.js";
import {
  MAX_MARKDOWN_BRACKET_DEPTH,
  MAX_MARKDOWN_LINE_CHARS,
  checkMarkdownHeadings,
  checkMarkdownLinks,
  readMarkdown,
} from "../../../src/verify/markdown.js";
import { createWorkspace } from "../../../src/workspace/index.js";

async function withWorkspace(files: Record<string, string>, body: (workspace: Workspace, root: string) => Promise<void>): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "u116-r89-"));
  const root = join(base, "ws");
  await mkdir(root, { recursive: true });
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = join(root, name);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, content);
    }
    await body(await createWorkspace({ root }), root);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

const noCommands: CommandRunner = {
  async run() {
    throw new Error("no command in these tests");
  },
};

const headings = (text: string): string[] => readMarkdown(text).headings.map((h) => `${h.line}:${h.level}:${h.text}`);
const targets = (text: string): string[] => readMarkdown(text).links.map((l) => `${l.line}:${l.target}`);

/** `line` repeated, one per line, as long as the text stays within the rule's 1 MiB. */
function fill(line: string, separator = "\n"): string {
  const lineBytes = Buffer.byteLength(line, "utf8") + Buffer.byteLength(separator, "utf8");
  const count = Math.floor((MAX_MARKDOWN_RULE_FILE_BYTES + Buffer.byteLength(separator, "utf8")) / lineBytes);
  return Array.from({ length: Math.max(1, count) }, () => line).join(separator);
}
/** `unit` repeated to at most `chars` characters. */
const upTo = (unit: string, chars: number): string => unit.repeat(Math.max(1, Math.floor(chars / unit.length)));

/** A line just under the reader's limit. */
const LINE = MAX_MARKDOWN_LINE_CHARS - 16;
/** A whole time bound for 1 MiB; the reader takes milliseconds on a desktop (see the diagnostics). */
const BOUND_MS = 3000;

const nested = (depth: number): string => `${"[".repeat(depth)}x${"](a)".repeat(depth)}`;

/** The review's worst inputs (R-89 (5)) and the other shapes found with them, each filling 1 MiB. */
const WORST: readonly { readonly name: string; readonly text: () => string }[] = [
  { name: "ATX: # then spaces then U+2028", text: () => fill(`#${" ".repeat(LINE - 2)} `) },
  { name: "ATX: # a, spaces, #x (the closing run)", text: () => fill(`# a${" ".repeat(LINE - 5)}#x`) },
  { name: "fence: backticks then U+2028", text: () => fill(`${"`".repeat(LINE - 1)} `) },
  { name: "fence in a list: spaces, backticks, U+2028", text: () => fill(`  ${" ".repeat(LINE / 2)}${"`".repeat(LINE / 2 - 4)} `).replace(/^[^\n]*/, "- item") },
  { name: "unclosed [ (one paragraph of 1 MiB)", text: () => fill("[".repeat(LINE)) },
  { name: "links [a](b) in one paragraph", text: () => fill(upTo("[a](b) ", LINE)) },
  { name: `links nested ${MAX_MARKDOWN_BRACKET_DEPTH} deep`, text: () => fill(upTo(`${nested(MAX_MARKDOWN_BRACKET_DEPTH)} `, LINE)) },
  { name: "backtick runs of growing length", text: () => { let line = ""; for (let k = 1; line.length + k + 1 < LINE; k += 1) line += `${"`".repeat(k)} `; return fill(line); } },
  { name: "unclosed <!-- in a paragraph", text: () => fill(`a ${upTo("<!--", LINE - 2)}`) },
  { name: "unclosed angle targets [a](<", text: () => fill(upTo("[a](<", LINE)) },
  { name: "unclosed parenthesised titles [a](b (", text: () => fill(upTo("[a](b (", LINE)) },
  { name: "unclosed quoted titles [a](b \"", text: () => fill(upTo('[a](b "', LINE)) },
  { name: "destination parentheses [a](b(", text: () => fill(upTo("[a](b(", LINE)) },
  { name: "balanced links inside an unclosed destination", text: () => fill(`[a](${upTo("[b](q)", LINE - 4)}`) },
  { name: "definition: unclosed label", text: () => fill(`[${"a".repeat(LINE - 1)}`, "\n\n") },
  { name: "definition: long target then junk", text: () => fill(`[a]: ${"x".repeat(LINE - 10)} junk`, "\n\n") },
  { name: "Setext underline then junk", text: () => fill(`para\n${"=".repeat(LINE - 1)}x`) },
  { name: "thematic break then junk", text: () => fill(`${"* ".repeat(LINE / 2 - 1)}x`) },
  { name: "HTML tag with attributes, never closed", text: () => fill(`<a${upTo(" b=c", LINE - 2)}`, "\n\n") },
  { name: "HTML tag with an unclosed quoted value", text: () => fill(`<a b="${"x".repeat(LINE - 6)}`, "\n\n") },
  { name: "short headings, one per line", text: () => fill("# h") },
  { name: "lone CR line ends", text: () => fill(upTo("# a\r[x](y)\r", LINE)) },
];

for (const worst of WORST) {
  test(`R-89 M-1: 1 MiB worst input is read in linear time: ${worst.name}`, (t) => {
    const text = worst.text();
    assert.ok(Buffer.byteLength(text, "utf8") <= MAX_MARKDOWN_RULE_FILE_BYTES);
    const started = performance.now();
    const read = readMarkdown(text);
    const headingsOnly = readMarkdown(text, { links: false });
    const ms = performance.now() - started;
    t.diagnostic(`${worst.name}: ${Buffer.byteLength(text, "utf8")} bytes, read twice (links, headings) in ${ms.toFixed(1)} ms; ${read.headings.length} headings, ${read.links.length} links${read.unread === undefined ? "" : `, ${read.unread}`}`);
    assert.ok(ms < BOUND_MS, `${worst.name}: ${ms.toFixed(1)} ms`);
    assert.equal(read.unread, undefined, "every line is under the limit and no bracket nesting is over it");
    assert.equal(headingsOnly.unread, undefined);
  });
}

test("R-89 M-1: through the rules, a 1 MiB worst document leaves the event loop free (a timer keeps ticking)", async (t) => {
  const document = fill("[".repeat(LINE));
  await withWorkspace({ "doc.md": document, "heads.md": fill("# h") }, async (workspace) => {
    let last = performance.now();
    let longest = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 5);
    try {
      const started = performance.now();
      const links = await checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, workspace);
      const heads = await checkMarkdownHeadings({ type: "markdown_headings", path: "heads.md", headings: [{ text: "h", level: 1 }, { text: "h" }], order: "in_order" }, workspace);
      t.diagnostic(`two rules on 1 MiB documents: ${(performance.now() - started).toFixed(1)} ms; the longest gap between timer ticks ${longest.toFixed(1)} ms`);
      assert.deepEqual(links, { state: "held", note: "all found" });
      assert.deepEqual(heads, { state: "held", note: "all found" });
      assert.ok(longest < 1000, `the event loop was held for ${longest.toFixed(1)} ms`);
    } finally {
      clearInterval(timer);
    }
  });
});

test("R-89 M-1: a line longer than the limit leaves both rules undecided, with the reason; at the limit it is read", async () => {
  const long = `${"#".repeat(1)} A\n\n${"x".repeat(MAX_MARKDOWN_LINE_CHARS + 1)}\n`;
  assert.deepEqual(readMarkdown(long), { headings: [], links: [], unread: `line 3 is longer than ${MAX_MARKDOWN_LINE_CHARS} characters, not read` });
  assert.deepEqual(headings(`# A\n\n${"x".repeat(MAX_MARKDOWN_LINE_CHARS)}\n`), ["1:1:A"]);
  // Lines inside fenced code and HTML blocks are skipped, not interpreted, so they are not limited.
  assert.deepEqual(headings(`\`\`\`\n${"x".repeat(MAX_MARKDOWN_LINE_CHARS + 5)}\n\`\`\`\n<!--\n${"y".repeat(MAX_MARKDOWN_LINE_CHARS + 5)}\n-->\n# After`), ["7:1:After"]);
  await withWorkspace({ "doc.md": long }, async (workspace) => {
    const note = `line 3 is longer than ${MAX_MARKDOWN_LINE_CHARS} characters, not read`;
    assert.deepEqual(await checkMarkdownHeadings({ type: "markdown_headings", path: "doc.md", headings: [{ text: "A" }] }, workspace), { state: "undecided", note });
    assert.deepEqual(await checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, workspace), { state: "undecided", note });
    const result = await createVerifierRunner({ workspace, commandRunner: noCommands }).run(
      { id: "doc", kind: "file_rules", rules: [{ type: "markdown_links", path: "doc.md" }] },
      new AbortController().signal,
    );
    assert.equal(result.outcome, "inconclusive");
    assert.equal(result.evidence, `undecided: "doc.md" has relative links whose targets exist (${note})`);
  });
});

test("R-89 M-1: brackets nested deeper than the limit leave the links rule undecided; at the limit they are read; headings do not read brackets", async () => {
  const deep = `# Title\n\nText ${nested(MAX_MARKDOWN_BRACKET_DEPTH + 1)} end.\n`;
  const note = `brackets nested deeper than ${MAX_MARKDOWN_BRACKET_DEPTH} levels at line 3, not read`;
  assert.deepEqual(readMarkdown(deep), { headings: [], links: [], unread: note });
  assert.equal(readMarkdown(nested(MAX_MARKDOWN_BRACKET_DEPTH)).links.length, MAX_MARKDOWN_BRACKET_DEPTH);
  // An unmatched `[` is text: many of them do not nest.
  assert.equal(readMarkdown(`${"[".repeat(500)} [a](a.md)`).unread, undefined);
  await withWorkspace({ "doc.md": deep, "a": "" }, async (workspace) => {
    assert.deepEqual(await checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, workspace), { state: "undecided", note });
    assert.deepEqual(await checkMarkdownHeadings({ type: "markdown_headings", path: "doc.md", headings: [{ text: "Title", level: 1 }] }, workspace), { state: "held", note: "all found" });
  });
});

test("R-89 M-1: a destination holds at most 32 nested parentheses, and a parenthesised title no unescaped (", () => {
  assert.deepEqual(targets(`[x](a${"(".repeat(32)}${")".repeat(32)})`), [`1:a${"(".repeat(32)}${")".repeat(32)}`]);
  assert.deepEqual(targets(`[x](a${"(".repeat(33)}${")".repeat(33)})`), []);
  assert.deepEqual(targets("[x](a (ti\\(tle)) [y](b (title))"), ["1:a", "1:b"]);
  assert.deepEqual(targets("[x](a (ti(tle))"), []);
});

test("R-89 L-2: the links rule stops at the run's signal between targets, and looks at each distinct target once", async () => {
  const many = Array.from({ length: 2000 }, (_, i) => `[x](missing-${i}.md)`).join("\n\n");
  await withWorkspace({ "doc.md": many }, async (workspace) => {
    const controller = new AbortController();
    let resolved = 0;
    const watched: Workspace = {
      ...workspace,
      resolve: async (...args: Parameters<Workspace["resolve"]>) => {
        resolved += 1;
        // The document is the first; stop after five targets.
        if (resolved === 6) controller.abort();
        return workspace.resolve(...args);
      },
    };
    assert.deepEqual(await checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, watched, { signal: controller.signal }), {
      state: "undecided",
      note: "cancelled while the link targets were checked",
    });
    assert.equal(resolved, 6);
    assert.deepEqual(await checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, workspace, { signal: controller.signal }), {
      state: "undecided",
      note: "cancelled before the document was read",
    });

    // Through the verifier: the rule's line says it, and the outcome is inconclusive, not a failure.
    const second = new AbortController();
    let count = 0;
    const stopping: Workspace = {
      ...workspace,
      resolve: async (...args: Parameters<Workspace["resolve"]>) => {
        count += 1;
        if (count === 3) second.abort();
        return workspace.resolve(...args);
      },
    };
    const result = await createVerifierRunner({ workspace: stopping, commandRunner: noCommands }).run(
      { id: "doc", kind: "file_rules", rules: [{ type: "markdown_links", path: "doc.md" }, { type: "exists", path: "doc.md" }] },
      second.signal,
    );
    assert.equal(result.outcome, "inconclusive");
    assert.equal(
      result.evidence,
      [
        'undecided: "doc.md" has relative links whose targets exist (cancelled while the link targets were checked)',
        'undecided: "doc.md" exists (cancelled before this rule was checked)',
      ].join("\n"),
    );
  });

  const repeated = Array.from({ length: 900 }, (_, i) => `[x](${["a.md", "gone.md", "./a.md#top"][i % 3]})`).join("\n\n");
  await withWorkspace({ "doc.md": repeated, "a.md": "" }, async (workspace) => {
    let resolved = 0;
    const counting: Workspace = {
      ...workspace,
      resolve: async (...args: Parameters<Workspace["resolve"]>) => {
        resolved += 1;
        return workspace.resolve(...args);
      },
    };
    const verdict = await checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, counting);
    // The document, then "a.md" and "gone.md" once each ("./a.md#top" is "a.md").
    assert.equal(resolved, 3);
    assert.equal(verdict.state, "not_held");
    assert.match(verdict.note, /^targets missing or outside the workspace: "gone\.md" \(line 3, missing\), "gone\.md" \(line 9, missing\), /);
    assert.match(verdict.note, /, and 280 more$/);
  });
});

test("R-89 L-1: HTML comments and HTML blocks hold neither headings nor links", () => {
  const text = [
    "<!--",
    "# Hidden",
    "[x](gone.md)",
    "-->",
    "# One",
    "",
    "<div>",
    "# Inside div",
    "[d](div.md)",
    "</div>",
    "",
    "# Two",
    "See <!-- [c](comment.md) --> and [r](real.md); <!--> [e](empty-comment.md).",
    "",
    "<script>",
    "",
    "# in script",
    "</script>",
    "# Three",
    "",
    "<custom-tag attr=\"v\">",
    "# hidden by a lone tag",
    "",
    "Para line",
    "<custom-tag>",
    "# Four",
    "",
    "<!-- one line --> # not a heading after it",
    "# Five <!-- kept in the text -->",
    "</section>",
    "# hidden by a closing block tag",
    "",
    "<h2>An HTML heading</h2>",
    "",
    "<?php echo '# x'; ?>",
    "<!DOCTYPE html>",
    "<![CDATA[",
    "# in cdata",
    "]]>",
    "# Six",
    "<!-- never closed",
    "# hidden to the end",
  ].join("\n");
  assert.deepEqual(readMarkdown(text).headings.map((h) => h.text), ["One", "Two", "Three", "Four", "Five <!-- kept in the text -->", "Six"]);
  assert.deepEqual(targets(text), ["13:real.md", "13:empty-comment.md"]);
  // A comment that wraps inside a paragraph hides its links too; one never closed is text.
  assert.deepEqual(targets("Text <!-- a\n[x](hidden.md)\n--> [y](shown.md)"), ["3:shown.md"]);
  assert.deepEqual(targets("Text <!-- open [x](shown.md)"), ["1:shown.md"]);
  // In a code span the comment is text, and a comment hides a code span's backticks.
  assert.deepEqual(targets("`<!--` [a](a.md) `-->` <!-- ` --> [b](b.md)"), ["1:a.md", "1:b.md"]);
});

test("R-89 L-1: the rules on a document whose hidden parts would have decided them", async () => {
  const text = ["# Shown", "<!--", "# Hidden", "[x](gone.md)", "-->", "<div>", "# Inside div", "</div>"].join("\n");
  await withWorkspace({ "doc.md": text }, async (workspace) => {
    assert.deepEqual(await checkMarkdownHeadings({ type: "markdown_headings", path: "doc.md", headings: [{ text: "Shown" }, { text: "Hidden" }, { text: "Inside div" }] }, workspace), {
      state: "not_held",
      note: 'headings not found: "Hidden", "Inside div"',
    });
    assert.deepEqual(await checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, workspace), { state: "held", note: "all found" });
  });
});

test("R-89 I-2: a lone CR ends a line, as LF and CR LF do", () => {
  assert.deepEqual(headings("# A\r# B\rText\r[x](x.md)\r\n## C\n"), ["1:1:A", "2:1:B", "5:2:C"]);
  assert.deepEqual(targets("# A\r# B\rText\r[x](x.md)\r\n## C\n"), ["4:x.md"]);
  assert.deepEqual(headings("Title\r===\r"), ["1:1:Title"]);
});

test("R-89 L-3: only a regular file is opened; a directory at the path is undecided", async () => {
  await withWorkspace({ "dir/inner.md": "# x" }, async (workspace) => {
    assert.deepEqual(await checkMarkdownHeadings({ type: "markdown_headings", path: "dir", headings: [{ text: "x" }] }, workspace), { state: "undecided", note: "not a regular file" });
    assert.deepEqual(await checkMarkdownLinks({ type: "markdown_links", path: "dir" }, workspace), { state: "undecided", note: "not a regular file" });
  });
});

test(
  "R-89 L-3: a named pipe at the document path is not opened (POSIX)",
  { skip: process.platform === "win32" ? "named pipes in the file system are POSIX only; not reproducible on Windows" : false },
  async (t) => {
    await withWorkspace({}, async (workspace, root) => {
      const fifo = join(root, "doc.md");
      const made = spawnSync("mkfifo", [fifo]);
      if (made.error !== undefined || made.status !== 0) {
        t.skip("mkfifo is not available");
        return;
      }
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<"timed out">((resolve) => {
        timer = setTimeout(() => resolve("timed out"), 3000);
      });
      try {
        const verdict = await Promise.race([checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, workspace), late]);
        assert.deepEqual(verdict, { state: "undecided", note: "not a regular file" });
      } finally {
        clearTimeout(timer);
        // Should a reader be waiting on the pipe, a writer that opens without waiting releases it.
        await open(fifo, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK).then((handle) => handle.close()).catch(() => undefined);
      }
    });
  },
);
