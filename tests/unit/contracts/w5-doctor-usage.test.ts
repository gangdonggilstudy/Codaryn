/**
 * W-5: `doctor` takes `--task` or `--workspace`, never both. The contract comment
 * (src/contracts/commands.ts), the contract document (docs/cli-contract.md) and the
 * implementation (usage line and argument parser) must say the same.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DOCTOR_USAGE, parseDoctorArgs } from "../../../src/cli/args.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (relative: string): string => readFileSync(path.join(repoRoot, relative), "utf8");

const EXCLUSIVE = "[--task <task.json> | --workspace <dir>]";
const EXCLUSIVE_KO = "[--task <task.json> | --workspace <디렉터리>]";

test("the usage line and the parser: --task and --workspace exclude each other", () => {
  assert.ok(DOCTOR_USAGE.includes(EXCLUSIVE), DOCTOR_USAGE);
  const both = parseDoctorArgs(["doctor", "--task", "t.json", "--workspace", "w"]);
  assert.ok(!both.ok && both.message.includes("cannot be combined with --workspace"));
  assert.ok(parseDoctorArgs(["doctor", "--task", "t.json"]).ok);
  assert.ok(parseDoctorArgs(["doctor", "--workspace", "w"]).ok);
});

test("the contract comment states the usage line exactly", () => {
  const source = read("src/contracts/commands.ts");
  assert.ok(source.includes(DOCTOR_USAGE), "commands.ts must quote DOCTOR_USAGE");
  assert.equal(source.includes("[--task <task.json>] [--workspace"), false, "no form that allows both");
});

test("the contract document uses the exclusive form everywhere and says why", () => {
  const lines = read("docs/cli-contract.md").split(/\r?\n/);
  const usages = lines.filter((line) => line.includes("doctor [") && line.includes("--task"));
  assert.ok(usages.length >= 2, "the run section and section 15 both show the doctor usage");
  for (const line of usages) assert.ok(line.includes(EXCLUSIVE_KO), line);
  assert.ok(
    lines.some((line) => line.includes("`--task`") && line.includes("`--workspace`") && line.includes("함께 쓸 수 없") && line.includes("invalid_arguments")),
    "the document states that the two cannot be combined and what happens",
  );
});
