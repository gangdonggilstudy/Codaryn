/**
 * U-116 (P1 bundle C, M-1 to M-5, contract MarkdownFileRule): the Markdown reader of
 * src/verify/markdown.ts and the markdown_headings and markdown_links rules of the file_rules
 * verifier. Real files in temp folders, the real workspace module, synthetic values only.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { MARKDOWN_RULE_LIMITS, MAX_MARKDOWN_EVIDENCE_ITEMS } from "../../../src/contracts/index.js";
import type { FileRule, Workspace } from "../../../src/contracts/index.js";
import { prepareEvidence } from "../../../src/engine/feedback.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createVerifierRunner } from "../../../src/verify/index.js";
import type { CommandRunner } from "../../../src/verify/index.js";
import { checkMarkdownHeadings, checkMarkdownLinks, judgeTarget, readMarkdown } from "../../../src/verify/markdown.js";
import { createWorkspace } from "../../../src/workspace/index.js";

async function withWorkspace(files: Record<string, string | Buffer>, body: (workspace: Workspace, root: string) => Promise<void>): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "u116-"));
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

async function runRules(workspace: Workspace, rules: FileRule[]) {
  return createVerifierRunner({ workspace, commandRunner: noCommands }).run({ id: "doc", kind: "file_rules", rules }, new AbortController().signal);
}

const headings = (text: string): string[] => readMarkdown(text).headings.map((h) => `${h.level}:${h.text}`);
const targets = (text: string): string[] => readMarkdown(text).links.map((l) => `${l.kind}:${l.target}`);

test("U-116 reader: ATX headings, levels, closing hashes, and what is not a heading", () => {
  const text = [
    "# One",
    "## Two ##",
    "### Three ###   ",
    "   #### Four",
    "##### Five #not closing",
    "###### Six",
    "####### seven is a paragraph",
    "#hashtag is a paragraph",
    "#",
    "    # four spaces is not a heading",
    "## C# is kept",
    "> # a quote line is not a heading",
    "- # a list line is not a heading",
  ].join("\n");
  assert.deepEqual(headings(text), ["1:One", "2:Two", "3:Three", "4:Four", "5:Five #not closing", "6:Six", "1:", "2:C# is kept"]);
});

test("U-116 reader: Setext headings are the line above the underline; thematic breaks and list lines are not", () => {
  const text = ["Title", "=====", "", "Para line", "Sub title", "---", "", "---", "", "- item", "---", "", "***"].join("\n");
  assert.deepEqual(headings(text), ["1:Title", "2:Sub title"]);
  assert.deepEqual(readMarkdown(text).headings.map((h) => h.line), [1, 5]);
});

test("U-116 reader: fenced code and code spans are skipped; indented code is read as text", () => {
  const text = [
    "```md",
    "# not a heading",
    "[no](fenced.md)",
    "```",
    "~~~~",
    "## nor this",
    "~~~",
    "still code",
    "~~~~",
    "",
    "    [read](indented.md)",
    "",
    "Use `[no](span.md)` and ``a `[no](double.md)` b`` here, then [yes](real.md).",
    "",
    "- item",
    "    ```",
    "    [no](list-fence.md)",
    "    ```",
    "",
    "# After",
    "```",
    "# an unclosed fence runs to the end",
  ].join("\n");
  assert.deepEqual(headings(text), ["1:After"]);
  assert.deepEqual(targets(text), ["link:indented.md", "link:real.md"]);
});

test("U-116 reader: inline links, images, titles, angle brackets, nesting, escapes and definitions", () => {
  const text = [
    "See [a](a.md) and ![pic](img/p.png \"Title\") and [b](<docs/b c.md> 'T') and [c](c.md (paren title)).",
    "[![badge](badge.svg)](site.md) \\[not](escaped.md) [x]: not a definition mid-paragraph",
    "",
    "[ref]: refs/target.md \"Ref title\"",
    "[ang]: <with space.md>",
    "",
    "A [link that",
    "wraps](wrapped.md) and [p](path(with)parens.md) and [empty]().",
    "",
    "- item with [list](list.md)",
    "",
    "> quote with [q](quote.md)",
    "",
    "## Heading with [h](heading.md)",
  ].join("\n");
  assert.deepEqual(targets(text), [
    "link:a.md",
    "image:img/p.png",
    "link:docs/b c.md",
    "link:c.md",
    "link:site.md",
    "image:badge.svg",
    "definition:refs/target.md",
    "definition:with space.md",
    "link:wrapped.md",
    "link:path(with)parens.md",
    "link:",
    "link:list.md",
    "link:quote.md",
    "link:heading.md",
  ]);
  assert.equal(readMarkdown(text).links.find((l) => l.target === "wrapped.md")?.line, 7);
});

test("U-116 reader: CRLF and a byte order mark", () => {
  assert.deepEqual(headings("\uFEFF# One\r\n\r\nTwo\r\n---\r\n"), ["1:One", "2:Two"]);
});

test("U-116 targets: judged on the text alone (contract M-3)", () => {
  assert.deepEqual(judgeTarget("https://example.com/x", "."), { kind: "skip" });
  assert.deepEqual(judgeTarget("mailto:someone", "."), { kind: "skip" });
  assert.deepEqual(judgeTarget("C:/Windows/x.md", "."), { kind: "skip" }, "a drive letter is a scheme");
  assert.deepEqual(judgeTarget("#section", "."), { kind: "skip" });
  assert.deepEqual(judgeTarget("", "."), { kind: "skip" });
  assert.deepEqual(judgeTarget("guide.md#install", "docs"), { kind: "check", relative: "docs/guide.md" });
  assert.deepEqual(judgeTarget("guide.md?raw=1", "docs"), { kind: "check", relative: "docs/guide.md" });
  assert.deepEqual(judgeTarget("../README.md", "docs"), { kind: "check", relative: "README.md" });
  assert.deepEqual(judgeTarget("a%20b.md", "."), { kind: "check", relative: "a b.md" });
  assert.deepEqual(judgeTarget("bad%zz.md", "."), { kind: "check", relative: "bad%zz.md" }, "an escape that does not decode is kept");
  assert.deepEqual(judgeTarget("dir\\file.md", "."), { kind: "check", relative: "dir/file.md" });
  assert.deepEqual(judgeTarget("sub/", "."), { kind: "check", relative: "sub" });
  assert.deepEqual(judgeTarget("nul%00.md", "."), { kind: "missing" });
  for (const outside of ["../../outside.md", "/etc/passwd", "\\server\\x.md", "//server/share/x.md", "%2e%2e/x.md", ".codaryn/runs/x/journal.jsonl", "docs/../.CODARYN/lock.json"]) {
    assert.deepEqual(judgeTarget(outside, outside.startsWith("../") ? "docs" : "."), { kind: "outside" }, outside);
  }
  assert.deepEqual(judgeTarget("../x.md", "."), { kind: "outside" });
});

test("U-116 markdown_headings: any order, levels, exact text, the listed order (contract M-2)", async () => {
  const doc = ["# Guide", "", "## Install", "", "```", "## Usage", "```", "", "## Usage", "", "### Notes", "", "## Usage"].join("\n");
  await withWorkspace({ "docs/guide.md": doc }, async (workspace) => {
    const rule = (list: { text: string; level?: number }[], order?: "any" | "in_order") => ({ type: "markdown_headings" as const, path: "docs/guide.md", headings: list, ...(order ? { order } : {}) });
    assert.deepEqual(await checkMarkdownHeadings(rule([{ text: "Usage" }, { text: "Install", level: 2 }]), workspace), { state: "held", note: "all found" });
    assert.deepEqual(await checkMarkdownHeadings(rule([{ text: "Install", level: 3 }, { text: "Missing" }]), workspace), { state: "not_held", note: 'headings not found: "Install" (level 3), "Missing"' });
    assert.equal((await checkMarkdownHeadings(rule([{ text: "Guide" }, { text: "Install" }, { text: "Notes" }], "in_order"), workspace)).state, "held");
    assert.equal((await checkMarkdownHeadings(rule([{ text: "Usage" }, { text: "Usage" }], "in_order"), workspace)).state, "held", "listed twice needs two, and there are two outside code");
    assert.deepEqual(await checkMarkdownHeadings(rule([{ text: "Guide" }, { text: "Notes" }, { text: "Install" }, { text: "Usage", level: 2 }], "in_order"), workspace), {
      state: "not_held",
      note: 'headings not found in the given order: "Install", "Usage" (level 2)',
    });
    assert.equal((await checkMarkdownHeadings(rule([{ text: "install" }]), workspace)).state, "not_held", "case counts");
    assert.equal((await checkMarkdownHeadings(rule([]), workspace)).state, "undecided");
  });
});

test("U-116 markdown_headings: a missing file does not hold; too large or not UTF-8 is undecided; 20 items at most (M-4, M-5)", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ text: `H${i}` }));
  await withWorkspace({ "big.md": `# A\n${"x".repeat(200)}\n`, "bad.md": Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]), "ok.md": "# A\n", "dir/x.md": "x" }, async (workspace) => {
    assert.deepEqual(await checkMarkdownHeadings({ type: "markdown_headings", path: "nope.md", headings: [{ text: "A" }] }, workspace), { state: "not_held", note: "file not found" });
    const large = await checkMarkdownHeadings({ type: "markdown_headings", path: "big.md", headings: [{ text: "A" }] }, workspace, { maxBytes: 100 });
    assert.deepEqual(large, { state: "undecided", note: "larger than 100 bytes, not read" });
    assert.equal((await checkMarkdownHeadings({ type: "markdown_headings", path: "ok.md", headings: [{ text: "A" }] }, workspace, { maxBytes: 4 })).state, "held", "a file of exactly the limit is read");
    assert.equal((await checkMarkdownHeadings({ type: "markdown_headings", path: "bad.md", headings: [{ text: "A" }] }, workspace)).state, "undecided");
    assert.equal((await checkMarkdownHeadings({ type: "markdown_headings", path: "dir", headings: [{ text: "A" }] }, workspace)).state, "undecided");
    const capped = await checkMarkdownHeadings({ type: "markdown_headings", path: "ok.md", headings: many }, workspace);
    assert.equal(capped.state, "not_held");
    assert.match(capped.note, /^headings not found: .*, and 5 more$/);
    assert.equal(capped.note.match(/"H\d+"/g)?.length, MAX_MARKDOWN_EVIDENCE_ITEMS);
  });
});

test("U-116 markdown_links: missing, outside, skipped URLs and anchors, code (contract M-3)", async () => {
  const doc = [
    "[ok](guide.md) [dir](sub/) ![img](img/p.png) [space](a%20b.md#part) [up](../README.md) [drive](C:/x.md)",
    "[gone](missing.md) [out](../../outside.md) [state](../.codaryn/lock.json) [abs](/etc/hosts)",
    "[web](https://example.com) [mail](mailto:x) [anchor](#top) `[code](code.md)`",
    "",
    "[def]: defs/missing-def.md",
  ].join("\n");
  await withWorkspace({ "README.md": "# r\n", "docs/doc.md": doc, "docs/guide.md": "g", "docs/sub/x.md": "x", "docs/img/p.png": "p", "docs/a b.md": "s" }, async (workspace) => {
    assert.deepEqual(await checkMarkdownLinks({ type: "markdown_links", path: "docs/doc.md" }, workspace), {
      state: "not_held",
      note: 'targets missing or outside the workspace: "missing.md" (line 2, missing), "../../outside.md" (line 2, outside), "../.codaryn/lock.json" (line 2, outside), "/etc/hosts" (line 2, outside), "defs/missing-def.md" (line 5, missing)',
    });
  });
  await withWorkspace({ "doc.md": "[a](a.md) ![b](b.png) [web](http://x)\n\nNo more.\n", "a.md": "a", "b.png": "b" }, async (workspace) => {
    assert.deepEqual(await checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, workspace), { state: "held", note: "all found" });
  });
  await withWorkspace({ "doc.md": "No links at all.\n" }, async (workspace) => {
    assert.equal((await checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, workspace)).state, "held");
  });
});

test("U-116 markdown_links: an outside target is never handed to the workspace; a link inside that leads outside is outside", async () => {
  await withWorkspace({ "doc.md": "[out](../secret.md) [state](.codaryn/x) [abs](/x) [in](inside.md) [via](jump/secret.md)\n", "inside.md": "i" }, async (workspace, root) => {
    const outsideDir = join(root, "..", "outside-dir");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "secret.md"), "s");
    let linked = true;
    try {
      await symlink(outsideDir, join(root, "jump"), "junction");
    } catch {
      linked = false;
    }
    const asked: string[] = [];
    const watching: Workspace = { ...workspace, resolve: (p, access) => { asked.push(p); return workspace.resolve(p, access); } };
    const verdict = await checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, watching);
    assert.deepEqual(asked.slice(1).filter((p) => p !== "inside.md" && p !== "jump/secret.md"), [], `asked: ${asked.join(", ")}`);
    assert.equal(verdict.state, "not_held");
    assert.match(verdict.note, /"..\/secret.md" \(line 1, outside\), ".codaryn\/x" \(line 1, outside\), "\/x" \(line 1, outside\)/);
    if (linked) assert.match(verdict.note, /"jump\/secret.md" \(line 1, outside\)$/);
  });
});

test("U-116 markdown_links: more than 20 broken targets are listed 20 at most", async () => {
  const doc = Array.from({ length: 23 }, (_, i) => `[m${i}](missing-${i}.md)`).join("\n\n");
  await withWorkspace({ "doc.md": doc }, async (workspace) => {
    const verdict = await checkMarkdownLinks({ type: "markdown_links", path: "doc.md" }, workspace);
    assert.match(verdict.note, /^targets missing or outside the workspace: .*, and 3 more$/);
    assert.equal(verdict.note.match(/missing-\d+\.md/g)?.length, MAX_MARKDOWN_EVIDENCE_ITEMS);
  });
});

test("U-116 file_rules: a line in the form of the contract's example, the outcome and the limits", async () => {
  const lines = Array.from({ length: 30 }, () => "text");
  lines[11] = "![a](img/a.png)";
  // The contract example's "../x.md" from docs/ lands at x.md in the workspace root (inside, so missing);
  // "../../x.md" is the target that leaves the workspace.
  lines[29] = "[x](../../x.md)";
  await withWorkspace({ "docs/guide.md": lines.join("\n"), "ok.md": "# A\n\n## B\n" }, async (workspace) => {
    const failing = await runRules(workspace, [{ type: "markdown_links", path: "docs/guide.md" }]);
    assert.equal(failing.outcome, "fail");
    assert.equal(
      failing.evidence,
      'not held: "docs/guide.md" has relative links whose targets exist (targets missing or outside the workspace: "img/a.png" (line 12, missing), "../../x.md" (line 30, outside))',
    );
    assert.deepEqual(failing.checked, ['"docs/guide.md" has relative links whose targets exist']);
    assert.deepEqual(failing.limits, [...MARKDOWN_RULE_LIMITS]);

    const passing = await runRules(workspace, [{ type: "exists", path: "ok.md" }, { type: "markdown_headings", path: "ok.md", headings: [{ text: "B", level: 2 }, { text: "A" }], order: "any" }]);
    assert.equal(passing.outcome, "pass");
    assert.equal(passing.evidence, 'held: "ok.md" exists (present)\nheld: "ok.md" has the headings "B" (level 2), "A" (all found)');

    const undecided = await runRules(workspace, [{ type: "markdown_headings", path: "docs", headings: [{ text: "A" }] }]);
    assert.equal(undecided.outcome, "inconclusive");

    const literalOnly = await runRules(workspace, [{ type: "contains", path: "ok.md", text: "A" }]);
    assert.deepEqual(literalOnly.limits, ["text rules are literal substring matches; structure, meaning and link targets are not checked"], "the literal rules' result is as before");
  });
});

test("U-116 file_rules: a listed heading holding a registered value is a token once the engine masks and cuts the evidence", async () => {
  const secret = ["H", "eading", "Value", "77"].join("-");
  await withWorkspace({ "doc.md": "# Present\n" }, async (workspace) => {
    const result = await runRules(workspace, [{ type: "markdown_headings", path: "doc.md", headings: [{ text: `Part ${secret}` }] }]);
    assert.ok(result.evidence.includes(secret), "the verifier gives the raw text");
    // The engine's own steps for every verifier's evidence: the run's gateway, then prepareEvidence.
    const masked = createPrivacyGateway({ secrets: [secret] }).mask(result.evidence);
    assert.ok(masked.ok);
    const prepared = prepareEvidence(masked.text, result.evidenceTruncated === true);
    assert.ok(!prepared.text.includes(secret));
    assert.match(prepared.text, /"Part \[\[CODARYN_SECRET:[0-9a-f]{16}\]\]"/);
  });
});
