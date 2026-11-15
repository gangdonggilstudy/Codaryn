/**
 * U-143 (review R-89b N-1): the Markdown rules' contract says what the verifier does. R-89b found
 * the result's limit sentences and the contract's bounds out of step with src/verify/markdown.ts
 * (a line bound of 10,000 for 100,000, brackets for both rules for the links rule only, HTML blocks
 * read as text). These tests hold the two together: the bounds, the undecided notes (the three reader
 * causes), the HTML blocks and comments skipped, a lone CR as a line end.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  MARKDOWN_EVIDENCE_LEADS,
  MARKDOWN_RULE_LIMITS,
  MAX_MARKDOWN_BRACKET_DEPTH,
  MAX_MARKDOWN_LINE_CHARS,
  markdownBracketsTooDeepNote,
  markdownLineTooLongNote,
} from "../../../src/contracts/index.js";
import type { Workspace } from "../../../src/contracts/index.js";
import * as reader from "../../../src/verify/markdown.js";
import { createWorkspace } from "../../../src/workspace/index.js";

let base = "";
let workspace: Workspace;
before(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u143-md-")));
  const root = path.join(base, "ws");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "doc.md"), Array.from({ length: 50 }, (_, i) => `[a](missing-${i}.md)`).join("\n"));
  workspace = await createWorkspace({ root });
});
after(() => fs.rmSync(base, { recursive: true, force: true }));

const deep = (depth: number): string => `${"[".repeat(depth)}x${"](a.md)".repeat(depth)}`;

describe("U-143: the reader's bounds are the contract's", () => {
  test("the same values: the verifier's own constants equal the contract's", () => {
    assert.equal(reader.MAX_MARKDOWN_LINE_CHARS, MAX_MARKDOWN_LINE_CHARS);
    assert.equal(reader.MAX_MARKDOWN_BRACKET_DEPTH, MAX_MARKDOWN_BRACKET_DEPTH);
  });

  test("a line over the bound: either rule's read gives markdownLineTooLongNote of that line", () => {
    const text = `# Title\n\n${"a".repeat(MAX_MARKDOWN_LINE_CHARS + 1)}\n`;
    assert.equal(reader.readMarkdown(text).unread, markdownLineTooLongNote(3));
    assert.equal(reader.readMarkdown(text, { links: false }).unread, markdownLineTooLongNote(3));
    assert.equal(reader.readMarkdown(`${"a".repeat(MAX_MARKDOWN_LINE_CHARS)}\n`).unread, undefined, "at the bound it is read");
  });

  test("lines of fenced code and of HTML blocks do not count against the line bound", () => {
    const long = "a".repeat(MAX_MARKDOWN_LINE_CHARS + 1);
    assert.equal(reader.readMarkdown(`\`\`\`\n${long}\n\`\`\`\n# After\n`).unread, undefined);
    assert.equal(reader.readMarkdown(`<!--\n${long}\n-->\n# After\n`).unread, undefined);
  });

  test("brackets over the depth bound: the links read gives markdownBracketsTooDeepNote, the headings read is not stopped", () => {
    const text = `# Title\n\n${deep(MAX_MARKDOWN_BRACKET_DEPTH + 1)}\n`;
    assert.equal(reader.readMarkdown(text).unread, markdownBracketsTooDeepNote(3));
    const headingsOnly = reader.readMarkdown(text, { links: false });
    assert.equal(headingsOnly.unread, undefined);
    assert.deepEqual(headingsOnly.headings.map((heading) => heading.text), ["Title"]);
    assert.equal(reader.readMarkdown(deep(MAX_MARKDOWN_BRACKET_DEPTH)).unread, undefined, "at the bound it is read");
  });

  test("the run's signal: the two notes are the contract's leads", async () => {
    const stopped = new AbortController();
    stopped.abort();
    const early = await reader.checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, workspace, { signal: stopped.signal });
    assert.deepEqual(early, { state: "undecided", note: MARKDOWN_EVIDENCE_LEADS.cancelledBeforeReading });
    const headings = await reader.checkMarkdownHeadings({ type: "markdown_headings", path: "doc.md", headings: [{ text: "x" }] }, workspace, { signal: stopped.signal });
    assert.deepEqual(headings, { state: "undecided", note: MARKDOWN_EVIDENCE_LEADS.cancelledBeforeReading });
    // The first resolve is the document's own; the second is the first link target's.
    const midway = new AbortController();
    let resolves = 0;
    const stopping: Workspace = {
      ...workspace,
      resolve: async (...args: Parameters<Workspace["resolve"]>) => {
        resolves += 1;
        if (resolves === 2) midway.abort();
        return workspace.resolve(...args);
      },
    };
    const late = await reader.checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, stopping, { signal: midway.signal });
    assert.deepEqual(late, { state: "undecided", note: MARKDOWN_EVIDENCE_LEADS.cancelledWhileChecking });
  });
});

describe("U-143: HTML and line ends, as the contract now says", () => {
  test("HTML blocks and comments are skipped: neither headings nor links", () => {
    const read = reader.readMarkdown(["<div>", "# In div", "[x](d.md)", "", "<!--", "# In comment", "[y](c.md)", "-->", "# After", "text <!-- [z](i.md) --> [w](ok.md)"].join("\n"));
    assert.deepEqual(read.headings.map((heading) => heading.text), ["After"]);
    assert.deepEqual(read.links.map((link) => link.target), ["ok.md"]);
  });

  test("other inline HTML is text: <a href> is not a link", () => {
    assert.deepEqual(reader.readMarkdown('see <a href="gone.md">x</a>\n').links, []);
  });

  test("a lone CR ends a line, as LF and CR LF do", () => {
    assert.deepEqual(
      reader.readMarkdown("# A\r# B\r\n# C\n# D").headings.map((heading) => heading.text),
      ["A", "B", "C", "D"],
    );
  });

  test("the limit sentences name the bounds' values and scope and the HTML skipped", () => {
    const all = MARKDOWN_RULE_LIMITS.join(" ");
    assert.ok(all.includes(`longer than ${MAX_MARKDOWN_LINE_CHARS} characters`), all);
    assert.ok(all.includes(`the links rule does not check one whose brackets nest deeper than ${MAX_MARKDOWN_BRACKET_DEPTH}`), all);
    assert.ok(all.includes("HTML blocks and HTML comments are not read"), all);
    assert.equal(/\b10000\b/.test(all), false, "no trace of the old bound");
  });
});
