/**
 * U-28 (DR-50): one word for one thing, in the comments and texts of the contracts, the engine and
 * the model providers too: task type (not workflow, task kind), discarded files (not discard box,
 * run archive, "discarded files folder"); 동작, 작업 종류, 가릴 값, 폐기 보관함 (not 행동, 워크플로,
 * 비밀, 보관함 alone). Names stay as they are (DR-50): identifiers, option and field names, text
 * ids, file names, one-word strings and code spans (`…`) in comments.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { INSTRUCTIONS_LABEL } from "../../../src/engine/index.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const FOLDERS = ["src/contracts", "src/engine", "src/model"];

function sourceFiles(folder: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(repoRoot, folder))) {
    const relative = `${folder}/${name}`;
    if (statSync(path.join(repoRoot, relative)).isDirectory()) out.push(...sourceFiles(relative));
    else if (name.endsWith(".ts")) out.push(relative);
  }
  return out;
}

type Segment = { readonly kind: "comment" | "string"; readonly line: number; readonly text: string };

/** The comments and string literals of a source file, each with the line it starts on. */
function segmentsOf(source: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  let line = 1;
  const take = (kind: Segment["kind"], start: number, end: number, at: number) => out.push({ kind, line: at, text: source.slice(start, end) });
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (c === "\n") {
      line++;
      i++;
    } else if (c === "/" && n === "/") {
      const end = source.indexOf("\n", i);
      take("comment", i, end === -1 ? source.length : end, line);
      i = end === -1 ? source.length : end;
    } else if (c === "/" && n === "*") {
      const end = source.indexOf("*/", i + 2) + 2;
      const at = line;
      for (const ch of source.slice(i, end)) if (ch === "\n") line++;
      take("comment", i, end, at);
      i = end;
    } else if (c === '"' || c === "'" || c === "`") {
      const at = line;
      let j = i + 1;
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") j++;
        else if (source[j] === "\n") line++;
        j++;
      }
      take("string", i, j + 1, at);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out;
}

/** A comment's or a text's words: code spans and one-word strings are names. */
function wordsOf(segment: Segment): string {
  if (segment.kind === "comment") return segment.text.replace(/`[^`]*`/g, "``");
  return /^["'`][A-Za-z0-9_.$\/-]*["'`]$/.test(segment.text) ? "" : segment.text;
}

/** "workflow" as a word: not in an identifier, an option, a path, a file name or a property. */
const WORKFLOW_WORD = /(?<![A-Za-z0-9_$\-./])[Ww]orkflows?(?![A-Za-z0-9_$]|\.(?:ts|js)\b)/;
const OLD_ENGLISH = /task kinds?|discard box|run archives?|discarded files folder/i;
const OLD_KOREAN = /행동|워크플로|비밀|(?<!폐기 )보관함/;

/** The one text kept on purpose: the model reads it, not a person (src/engine/index.ts). */
const MODEL_TEXT = JSON.stringify(INSTRUCTIONS_LABEL);

describe("U-28 (DR-50): the old words are gone from the contracts, the engine and the providers", () => {
  test("no comment or text uses an old word for what people read", () => {
    const found: string[] = [];
    for (const file of FOLDERS.flatMap(sourceFiles)) {
      for (const segment of segmentsOf(readFileSync(path.join(repoRoot, file), "utf8"))) {
        if (segment.kind === "string" && segment.text === MODEL_TEXT) continue;
        const words = wordsOf(segment);
        for (const old of [WORKFLOW_WORD, OLD_ENGLISH, OLD_KOREAN]) {
          const match = old.exec(words);
          if (match !== null) found.push(`${file}:${segment.line + (words.slice(0, match.index).match(/\n/g)?.length ?? 0)} ${match[0]}`);
        }
      }
    }
    assert.deepEqual(found, []);
  });

  test("the label before a task type's instructions is the model's and keeps its words", () => {
    // Changing it would change the requests of every run whose task type has instructions
    // (g-workflow-engine.test.ts builds the expected system text on it).
    assert.equal(INSTRUCTIONS_LABEL, "Workflow instructions:");
  });

  test("the names stay (DR-50): option, field and file names are not words of prose", () => {
    const names = [
      "`--workflow <id>`",
      "the config file's `workflows`",
      "(workflow.ts)",
      "WorkflowSettings, workflowRef, WORKFLOW_TOOL_NAMES",
      "task.workflow",
      "src/workflows",
    ];
    for (const text of names) assert.equal(WORKFLOW_WORD.test(wordsOf({ kind: "comment", line: 1, text })), false, text);
    assert.equal(WORKFLOW_WORD.test("the workflow's own rules"), true);
    assert.equal(wordsOf({ kind: "string", line: 1, text: '"workflow"' }), "");
  });
});
