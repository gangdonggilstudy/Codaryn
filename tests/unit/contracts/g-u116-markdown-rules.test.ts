/**
 * U-116 (P1 bundle C, M-1 to M-5): the contract of the two Markdown rules of `file_rules`
 * (`markdown_headings`, `markdown_links`): their types and limits, the shape of their evidence (the
 * lead words, the bounded list, the label) and the limit sentences, and that they are rules of the
 * same `file_rules` list. The verifier that checks them is nd-docs' unit (src/verify); these tests
 * pin what it must write.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MARKDOWN_EVIDENCE_LEADS,
  MARKDOWN_RULE_LIMITS,
  MARKDOWN_RULE_TYPES,
  MAX_EVIDENCE_BYTES,
  MAX_MARKDOWN_EVIDENCE_ITEMS,
  MAX_MARKDOWN_EVIDENCE_ITEM_CHARS,
  MAX_MARKDOWN_HEADING_CHARS,
  MAX_MARKDOWN_RULE_FILE_BYTES,
  MAX_MARKDOWN_RULE_HEADINGS,
  PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE,
  markdownEvidenceList,
  markdownRuleLabel,
} from "../../../src/contracts/index.js";
import type {
  FileRule,
  FileRulesVerifierConfig,
  MarkdownEvidenceItem,
  MarkdownFileRule,
  MarkdownHeadingsRule,
  MarkdownLinksRule,
} from "../../../src/contracts/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";

describe("U-116: the Markdown rules' types and limits (M-1, M-4)", () => {
  test("two rule types, and the limits PM decided", () => {
    assert.deepEqual(MARKDOWN_RULE_TYPES, ["markdown_headings", "markdown_links"]);
    assert.equal(MAX_MARKDOWN_RULE_FILE_BYTES, 1024 * 1024, "1 MiB (M-4)");
    assert.equal(MAX_MARKDOWN_EVIDENCE_ITEMS, 20, "at most 20 missing items (M-5)");
    assert.equal(MAX_MARKDOWN_RULE_HEADINGS, 50);
    assert.equal(MAX_MARKDOWN_HEADING_CHARS, 200);
    assert.equal(MAX_MARKDOWN_EVIDENCE_ITEM_CHARS, 80);
  });

  test("a rule is written as a task file writes it: level and order are optional (M-2)", () => {
    const plain: MarkdownHeadingsRule = { type: "markdown_headings", path: "README.md", headings: [{ text: "Install" }] };
    const ordered: MarkdownHeadingsRule = {
      type: "markdown_headings",
      path: "docs/guide.md",
      headings: [{ text: "Install", level: 2 }, { text: "Usage" }],
      order: "in_order",
    };
    const links: MarkdownLinksRule = { type: "markdown_links", path: "docs/guide.md" };
    const rules: MarkdownFileRule[] = [plain, ordered, links];
    assert.deepEqual(
      rules.map((rule) => rule.type),
      ["markdown_headings", "markdown_headings", "markdown_links"],
    );
    assert.deepEqual(JSON.parse(JSON.stringify(ordered)), ordered, "plain JSON, as a task file holds it");
  });

  test("they are rules of file_rules: one list holds them with the literal rules (M-1)", () => {
    const config: FileRulesVerifierConfig = {
      id: "doc",
      kind: "file_rules",
      rules: [
        { type: "exists", path: "README.md" },
        { type: "markdown_headings", path: "README.md", headings: [{ text: "Install" }] },
        { type: "markdown_links", path: "README.md" },
      ],
    };
    const types: readonly FileRule["type"][] = config.rules.map((rule) => rule.type);
    assert.deepEqual(types, ["exists", "markdown_headings", "markdown_links"]);
    const markdown: readonly string[] = MARKDOWN_RULE_TYPES;
    assert.deepEqual(
      config.rules.filter((rule) => markdown.includes(rule.type)).map((rule) => rule.type),
      ["markdown_headings", "markdown_links"],
    );
  });
});

describe("U-116: the shape of the evidence (M-5)", () => {
  test("items are quoted as JSON, with their detail in brackets, joined with commas", () => {
    const items: MarkdownEvidenceItem[] = [{ text: "img/a.png", detail: "line 12, missing" }, { text: "../x.md", detail: "line 30, outside" }, { text: 'say "hi"' }];
    assert.equal(markdownEvidenceList(items), '"img/a.png" (line 12, missing), "../x.md" (line 30, outside), "say \\"hi\\""');
    assert.equal(markdownEvidenceList([]), "");
  });

  test("at most 20 items; the rest is counted", () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ text: `h${index + 1}` }));
    const list = markdownEvidenceList(items);
    assert.ok(list.endsWith('"h20", and 5 more'), list);
    assert.equal(list.split(", ").length, 21);
    assert.equal(markdownEvidenceList(items.slice(0, 20)).includes("more"), false, "exactly 20: nothing counted");
  });

  test("a long text is cut at 80 code points with an ellipsis, never inside a character", () => {
    const korean = "가".repeat(100);
    assert.equal(markdownEvidenceList([{ text: korean }]), JSON.stringify(`${"가".repeat(79)}…`));
    const astral = "😀".repeat(90);
    const [cut] = JSON.parse(`[${markdownEvidenceList([{ text: astral }])}]`) as string[];
    assert.equal(Array.from(cut ?? "").length, 80);
    assert.ok((cut ?? "").startsWith("😀".repeat(79)) && (cut ?? "").endsWith("…"));
    assert.equal(markdownEvidenceList([{ text: "x".repeat(80) }]), JSON.stringify("x".repeat(80)), "80 code points are kept whole");
  });

  test("labels name the path as the other rules do, and list the headings with their levels", () => {
    assert.equal(markdownRuleLabel({ type: "markdown_links", path: "docs/guide.md" }), '"docs/guide.md" has relative links whose targets exist');
    assert.equal(
      markdownRuleLabel({ type: "markdown_headings", path: "README.md", headings: [{ text: "Install", level: 2 }, { text: "Usage" }] }),
      '"README.md" has the headings "Install" (level 2), "Usage"',
    );
    assert.equal(
      markdownRuleLabel({ type: "markdown_headings", path: "README.md", headings: [{ text: "A" }, { text: "B" }], order: "in_order" }),
      '"README.md" has the headings "A", "B" in this order',
    );
    const many = markdownRuleLabel({ type: "markdown_headings", path: "a.md", headings: Array.from({ length: 30 }, (_, index) => ({ text: `h${index}` })) });
    assert.ok(many.endsWith(", and 10 more"), many);
  });

  test("the lead words and a whole line as the contract's example writes it", () => {
    assert.deepEqual(MARKDOWN_EVIDENCE_LEADS, {
      missingHeadings: "headings not found",
      headingsOutOfOrder: "headings not found in the given order",
      brokenLinks: "targets missing or outside the workspace",
      held: "all found",
    });
    const rule: MarkdownLinksRule = { type: "markdown_links", path: "docs/guide.md" };
    const list = markdownEvidenceList([{ text: "img/a.png", detail: "line 12, missing" }, { text: "../x.md", detail: "line 30, outside" }]);
    const line = `not held: ${markdownRuleLabel(rule)} (${MARKDOWN_EVIDENCE_LEADS.brokenLinks}: ${list})`;
    assert.equal(
      line,
      'not held: "docs/guide.md" has relative links whose targets exist (targets missing or outside the workspace: "img/a.png" (line 12, missing), "../x.md" (line 30, outside))',
    );
  });

  test("a full list of 20 items of 80 code points stays within the evidence limit", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({ text: "가".repeat(100), detail: `line ${100_000 + index}, missing` }));
    const note = `${MARKDOWN_EVIDENCE_LEADS.brokenLinks}: ${markdownEvidenceList(items)}`;
    assert.ok(Buffer.byteLength(note, "utf8") < MAX_EVIDENCE_BYTES, String(Buffer.byteLength(note, "utf8")));
  });
});

describe("U-116: the fixed texts", () => {
  test("the limit sentences and lead words are plain: the real gateway leaves them unchanged and they spell no marker", () => {
    const privacy = createPrivacyGateway({ secrets: ["fake-secret-VALUE-0116"] });
    const marker = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");
    const texts = [...MARKDOWN_RULE_LIMITS, ...Object.values(MARKDOWN_EVIDENCE_LEADS)];
    assert.equal(MARKDOWN_RULE_LIMITS.length, 3);
    for (const text of texts) {
      const masked = privacy.mask(text);
      assert.ok(masked.ok);
      assert.equal(masked.text, text);
      assert.equal(marker.test(text), false, text);
      assert.match(text, /^[\x20-\x7e]+$/, "one line of printable ASCII");
    }
  });

  test("the limits say what is not checked: anchors, schemes, the network, code", () => {
    const all = MARKDOWN_RULE_LIMITS.join(" ");
    for (const words of ["anchors", "scheme", "network", "fenced code blocks", "indented code blocks"]) assert.ok(all.includes(words), words);
  });
});
