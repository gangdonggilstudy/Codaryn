/**
 * U-149 (review R-89b N-2): a heading on a line of a list item does not count. The contract
 * (src/contracts/verify.ts, MarkdownFileRule): a list item's content column is where its text starts,
 * after the marker and the 1 to 4 spaces that follow it, or one column after the marker when the
 * text is empty or starts 5 or more spaces after it; later lines indented at least to that column,
 * and the blank lines between them, are lines of the item; a line indented less ends the item (and
 * the list) unless it starts another item. Links in list items are read as everywhere else.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkMarkdownHeadings, readMarkdown } from "../../../src/verify/markdown.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const headings = (text: string): string[] => readMarkdown(text).headings.map((h) => `${h.line}:${h.text}`);

test("U-149: an indented # line inside a list item is a line of the item, not a heading (R-89b N-2)", () => {
  assert.deepEqual(headings("- item\n\n  # Inner"), []);
  assert.deepEqual(headings("- item\n  # Inner"), []);
  assert.deepEqual(headings("* item\n\n  # Star\n+ item\n\n  # Plus"), []);
  assert.deepEqual(headings("- a\n\n- b\n\n  # in b"), []);
  assert.deepEqual(headings("- a\n  - b\n    # deep\n  # mid\n# Top"), ["5:Top"]);
});

test("U-149: the content column follows the marker and the spaces after it", () => {
  // An ordered marker is wider: "1. " puts the text at column 3, "10. " at column 4.
  assert.deepEqual(headings("1. item\n\n   # Inside"), []);
  assert.deepEqual(headings("1. item\n\n  # Outside"), ["3:Outside"]);
  assert.deepEqual(headings("10. ten\n\n    # Inside ten"), []);
  assert.deepEqual(headings("10. ten\n\n   # Outside ten"), ["3:Outside ten"]);
  // Two to four spaces after the marker move the column with them.
  assert.deepEqual(headings("-   item\n\n    # Inside"), []);
  assert.deepEqual(headings("-   item\n\n  # Outside"), ["3:Outside"]);
  // Empty text, or five or more spaces: one column after the marker.
  assert.deepEqual(headings("-\n  # Inside empty"), []);
  assert.deepEqual(headings("-      code-like\n\n  # Inside"), []);
  // A TAB after the marker advances to the next multiple of four.
  assert.deepEqual(headings("-\titem\n\n    # Inside"), []);
  assert.deepEqual(headings("-\titem\n\n  # Outside"), ["3:Outside"]);
});

test("U-149: a line indented less ends the list; top-level headings still count", () => {
  assert.deepEqual(headings("- item\n\n# Top"), ["3:Top"]);
  assert.deepEqual(headings("- item\npara\n  # After the list"), ["3:After the list"]);
  assert.deepEqual(headings("# One\n- item\n\n  # Inner\n\n## Two\n- # In list\n> # In quote"), ["1:One", "6:Two"]);
  // A Setext heading inside an item does not count either.
  assert.deepEqual(headings("- item\n\n  Para\n  ---\n\nTop\n==="), ["6:Top"]);
});

test("U-149: links on the lines of a list item are read as everywhere else", () => {
  assert.deepEqual(
    readMarkdown("- item\n\n  # Inner [h](heading.md)\n  [x](inner.md)").links.map((l) => `${l.line}:${l.target}`),
    ["3:heading.md", "4:inner.md"],
  );
});

test("U-149: markdown_headings on a document whose only match is inside a list item does not hold", async () => {
  const base = await mkdtemp(join(tmpdir(), "u149-"));
  try {
    const root = join(base, "ws");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "doc.md"), "# Guide\n\n- step one\n\n  # Install\n");
    const workspace = await createWorkspace({ root });
    assert.deepEqual(await checkMarkdownHeadings({ type: "markdown_headings", path: "doc.md", headings: [{ text: "Guide" }, { text: "Install" }] }, workspace), {
      state: "not_held",
      note: 'headings not found: "Install"',
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
