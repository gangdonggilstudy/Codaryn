/**
 * U-166 (the AX midpoint review's CLI share that changes no JSON and no pinned value):
 * - AXM-11: the error codes were told in docs/cli-contract.md sentence by sentence ("… were added"),
 *   with no one table and no word on whether a code may go away; the hints (U-37) were not listed
 *   at all, and section 8.2 said every code but the two lock codes is retryable false, which
 *   config_write_failed (U-82, no `retryable`) is not. The contract now has one table of codes and
 *   one of hints, checked here against the contract's constants.
 * - AXM-17: a run report said nothing of what masking leaves out (privacy.md 13); its "Not checked"
 *   section now says it. No count, value or place is added (DR-52 keeps the counts out of the text).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALL_CLI_ERROR_HINTS,
  CLI_ERROR_CATEGORY,
  CLI_ERROR_EXIT_CODES,
  CLI_ERROR_RETRYABLE,
  DETAILED_CLI_ERROR_HINTS,
} from "../../../src/contracts/index.js";
import type { CliErrorCode, EngineResult } from "../../../src/contracts/index.js";
import { runReport } from "../../../src/cli/report.js";
import { runCli } from "../../../src/cli/run.js";
import { cliIo, setupRun } from "./k-support.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const contract = readFileSync(path.join(repoRoot, "docs", "cli-contract.md"), "utf8").split(/\r?\n/);

/** The lines of the section whose heading includes `marker`, up to the next heading of its level or above. */
function section(marker: string): string[] {
  const start = contract.findIndex((line) => /^#{2,4} /.test(line) && line.includes(marker));
  assert.ok(start >= 0, `no section heading with ${marker}`);
  const level = (contract[start]?.match(/^#+/) ?? [""])[0].length;
  const end = contract.findIndex((line, index) => index > start && /^#+ /.test(line) && (line.match(/^#+/) ?? [""])[0].length <= level);
  return contract.slice(start, end < 0 ? undefined : end);
}

/** The rows of the table whose header row starts with `first`, cells trimmed. */
function table(lines: readonly string[], first: string): string[][] {
  const header = lines.findIndex((line) => line.startsWith(`| ${first} |`));
  assert.ok(header >= 0, `no table starting with ${first}`);
  const rows: string[][] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.slice(1, -1).split("|").map((cell) => cell.trim()));
  }
  return rows;
}

const ticked = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");

describe("U-166 AXM-11: one table of error codes and hints in the contract", () => {
  const lines = (): string[] => section("AXM-11");

  test("every CLI error code once, with its exit code, category and retryable as the contract's constants", () => {
    const rows = table(lines(), "`code`");
    const codes = rows.map((row) => ticked(row[0] ?? "")[0]);
    assert.deepEqual([...codes].sort(), Object.keys(CLI_ERROR_EXIT_CODES).sort(), "each code once");
    for (const row of rows) {
      const code = ticked(row[0] ?? "")[0] as CliErrorCode;
      assert.equal(row[1], String(CLI_ERROR_EXIT_CODES[code]), `${code}: exit code`);
      assert.equal(row[2], `\`${CLI_ERROR_CATEGORY[code]}\``, `${code}: category`);
      const retryable = (CLI_ERROR_RETRYABLE as Partial<Record<CliErrorCode, boolean>>)[code];
      if (retryable === undefined) {
        // model_list_failed (by the listing's failure) and config_write_failed (U-82): can be absent.
        assert.ok(!["`true`", "`false`"].includes(row[3] ?? "") && (row[3] ?? "").includes("없"), `${code}: retryable ${row[3]}`);
      } else {
        assert.equal(row[3], `\`${retryable}\``, `${code}: retryable`);
      }
      assert.ok((row[4] ?? "").length > 0, `${code}: when`);
    }
  });

  test("every hint once, with error codes that exist, and the detailed ones say their value is not in the JSON", () => {
    const rows = table(lines(), "`hint`");
    const hints = rows.map((row) => ticked(row[0] ?? "")[0]);
    assert.deepEqual([...hints].sort(), [...ALL_CLI_ERROR_HINTS].sort(), "each hint once");
    for (const row of rows) {
      const hint = ticked(row[0] ?? "")[0] ?? "";
      const codes = ticked(row[1] ?? "");
      assert.ok(codes.length > 0 && codes.every((code) => Object.hasOwn(CLI_ERROR_EXIT_CODES, code)), `${hint}: codes ${row[1]}`);
      const detailed = (DETAILED_CLI_ERROR_HINTS as readonly string[]).includes(hint);
      assert.equal(row[2] === "—", !detailed, `${hint}: value cell ${row[2]}`);
    }
  });

  test("the codes and hints are only added (DR-48), and programs branch on the fields, not on message", () => {
    const text = lines().join("\n");
    assert.ok(text.includes("DR-48") && text.includes("더하기만"), text);
    assert.ok(text.includes("`message`"), "says what message is for");
  });

  test("section 8.2 names config_write_failed apart from the codes whose retryable is false", () => {
    const text = section("8.2").join("\n");
    assert.ok(text.includes("config_write_failed"), "8.2 must not say every other code is false");
  });
});

describe("U-166 AXM-17: the run report's Not checked section says what masking leaves out", () => {
  test("a finished run's report has the masking line under Not checked, with no count", async () => {
    const base = await setupRun({ "README.md": "# Title\n" }, {}, [{ toolCalls: [{ name: "read_file", args: { path: "README.md" } }] }, { text: "done" }]);
    const outcome = await runCli(cliIo(base));
    assert.equal(outcome.output.kind, "run");
    const result = outcome.output as EngineResult;
    const work = path.join(base, "work");
    const shown = await runReport({ argv: ["report", "--workspace", work, "--run", result.runId], cwd: base, env: {} });
    assert.ok("text" in shown, JSON.stringify(shown));
    const notChecked = shown.text.slice(shown.text.indexOf("## Not checked"));
    assert.ok(shown.text.includes("## Not checked"), shown.text);
    const line = notChecked.split("\n").find((item) => item.startsWith("- Masking "));
    assert.ok(line !== undefined, notChecked);
    for (const part of ["registered", "not registered", "another encoding", "is not masked"]) assert.ok(line.includes(part), line);
    assert.equal(/\d/.test(line.replace("UTF-16", "")), false, `no count in the line: ${line}`);
  });
});
