/**
 * U-116 (P1 bundle C, contract 69feef0): a `file_rules` verifier may list the two Markdown rules,
 * `markdown_headings` and `markdown_links` (MarkdownFileRule). The CLI's task and config parser
 * refused them as unknown rule types. Now it takes them in the contract's shape and limits and
 * refuses everything else before anything runs:
 * - markdown_headings: `path`, `headings` (1 to MAX_MARKDOWN_RULE_HEADINGS entries of `text`, 1 to
 *   MAX_MARKDOWN_HEADING_CHARS code points after trimming, stored trimmed as M-2 compares, and an
 *   optional `level` 1 to 6), an optional `order` ("any" or "in_order"). No other field.
 * - markdown_links: `path` only.
 * - The literal rules are as before; an unknown type names all six.
 * The parser directly (parseTask, parseConfig); nothing is read or run.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { MAX_MARKDOWN_HEADING_CHARS, MAX_MARKDOWN_RULE_HEADINGS } from "../../../src/contracts/index.js";
import type { FileRule } from "../../../src/contracts/index.js";
import { parseConfig } from "../../../src/cli/config.js";
import { parseTask } from "../../../src/cli/task.js";

const TASK_DIR = path.resolve("u116-task-dir");
const LIMITS = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60_000 };

/** A valid task file whose one verifier is file_rules with `rules`. */
function task(rules: readonly unknown[]): object {
  return {
    schemaVersion: 1,
    id: "u116",
    goal: "g",
    workflow: "document",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: "./s.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: [] },
    limits: LIMITS,
    verifiers: [{ id: "docs", kind: "file_rules", rules }],
  };
}

function rulesOf(rules: readonly unknown[]): readonly FileRule[] {
  const parsed = parseTask(task(rules), TASK_DIR);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const [verifier] = parsed.task.verifiers;
  assert.ok(verifier?.kind === "file_rules", JSON.stringify(verifier));
  return verifier.rules;
}

function refusal(rule: unknown): { code: string; message: string } {
  const parsed = parseTask(task([rule]), TASK_DIR);
  assert.ok(!parsed.ok, JSON.stringify(parsed));
  return { code: parsed.code, message: parsed.message };
}

const AT = "verifiers[0].rules[0]";

describe("U-116: the Markdown rules are taken in the contract's shape", () => {
  test("markdown_headings with an order and levels; the texts are kept trimmed", () => {
    assert.deepEqual(
      rulesOf([{ type: "markdown_headings", path: "README.md", headings: [{ text: "Install" }, { text: "  Usage ", level: 2 }], order: "in_order" }]),
      [{ type: "markdown_headings", path: "README.md", headings: [{ text: "Install" }, { text: "Usage", level: 2 }], order: "in_order" }],
    );
  });

  test("markdown_headings without an order, and the limits at their edge", () => {
    const most = Array.from({ length: MAX_MARKDOWN_RULE_HEADINGS }, (_, index) => ({ text: `H${index}`, level: (index % 6) + 1 }));
    const longest = "가".repeat(MAX_MARKDOWN_HEADING_CHARS);
    const [first, second] = rulesOf([
      { type: "markdown_headings", path: "a.md", headings: most, order: "any" },
      { type: "markdown_headings", path: "b.md", headings: [{ text: longest }] },
    ]);
    assert.equal(first?.type === "markdown_headings" && first.headings.length, MAX_MARKDOWN_RULE_HEADINGS);
    assert.deepEqual(second, { type: "markdown_headings", path: "b.md", headings: [{ text: longest }] });
  });

  test("markdown_links with a path; the literal rules as before; all in one list", () => {
    assert.deepEqual(rulesOf([{ type: "markdown_links", path: "docs/guide.md" }, { type: "exists", path: "README.md" }, { type: "contains", path: "README.md", text: "x" }]), [
      { type: "markdown_links", path: "docs/guide.md" },
      { type: "exists", path: "README.md" },
      { type: "contains", path: "README.md", text: "x" },
    ]);
  });

  test("the config's verifiers take them too", () => {
    const parsed = parseConfig({ schemaVersion: 1, verifiers: [{ id: "docs", kind: "file_rules", rules: [{ type: "markdown_links", path: "README.md" }] }] });
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.deepEqual(parsed.config.verifiers, [{ id: "docs", kind: "file_rules", rules: [{ type: "markdown_links", path: "README.md" }] }]);
  });
});

describe("U-116: anything else is refused before the run, by position", () => {
  const headings = (list: unknown, extra: object = {}) => ({ type: "markdown_headings", path: "README.md", headings: list, ...extra });

  for (const [name, list] of [
    ["missing", undefined],
    ["empty", []],
    ["not an array", { text: "Install" }],
    ["one too many", Array.from({ length: MAX_MARKDOWN_RULE_HEADINGS + 1 }, (_, index) => ({ text: `H${index}` }))],
  ] as const) {
    test(`headings ${name}`, () => {
      assert.deepEqual(refusal(headings(list)), { code: "invalid_task", message: `${AT}.headings must be an array of 1 to ${MAX_MARKDOWN_RULE_HEADINGS} headings` });
    });
  }

  for (const [name, text] of [
    ["empty", ""],
    ["blank", " \t "],
    ["one character too long", "a".repeat(MAX_MARKDOWN_HEADING_CHARS + 1)],
    ["not a string", 3],
  ] as const) {
    test(`a heading text ${name}`, () => {
      assert.deepEqual(refusal(headings([{ text: "Install" }, { text }])), {
        code: "invalid_task",
        message: `${AT}.headings[1].text must be a string of 1 to ${MAX_MARKDOWN_HEADING_CHARS} characters after trimming`,
      });
    });
  }

  for (const level of [0, 7, 1.5, "2", null]) {
    test(`a heading level ${JSON.stringify(level)}`, () => {
      assert.deepEqual(refusal(headings([{ text: "Install", level }])), { code: "invalid_task", message: `${AT}.headings[0].level must be an integer from 1 to 6` });
    });
  }

  test("an order other than any or in_order", () => {
    assert.deepEqual(refusal(headings([{ text: "Install" }], { order: "random" })), { code: "invalid_task", message: `${AT}.order must be "any" or "in_order"` });
  });

  test("fields the rule does not have: named by the allowed ones", () => {
    assert.match(refusal(headings([{ text: "Install" }], { text: "x" })).message, new RegExp(`^${escape(AT)} has an unknown field; allowed fields: type, path, headings, order`));
    assert.match(refusal(headings([{ text: "Install", depth: 2 }])).message, new RegExp(`^${escape(AT)}\\.headings\\[0\\] has an unknown field; allowed fields: text, level`));
    assert.match(refusal({ type: "markdown_links", path: "README.md", headings: [] }).message, new RegExp(`^${escape(AT)} has an unknown field; allowed fields: type, path`));
  });

  test("a missing path", () => {
    assert.deepEqual(refusal({ type: "markdown_links" }), { code: "invalid_task", message: `${AT}.path must be a non-empty string` });
  });

  test("an unknown type names all six", () => {
    assert.deepEqual(refusal({ type: "markdown_toc", path: "README.md" }), {
      code: "invalid_task",
      message: `${AT}.type must be one of exists, absent, contains, not_contains, markdown_headings, markdown_links`,
    });
  });

  test("the config refuses them the same way", () => {
    const parsed = parseConfig({ schemaVersion: 1, verifiers: [{ id: "docs", kind: "file_rules", rules: [{ type: "markdown_headings", path: "README.md", headings: [] }] }] });
    assert.ok(!parsed.ok, JSON.stringify(parsed));
    assert.equal(parsed.message, `${AT}.headings must be an array of 1 to ${MAX_MARKDOWN_RULE_HEADINGS} headings`);
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
