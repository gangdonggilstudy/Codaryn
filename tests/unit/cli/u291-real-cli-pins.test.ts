/**
 * U-291 (before the CLI migration's C-6a, nc-human's report-c6a-human T-3 and T-4): the real CLI's
 * present output, pinned where C-6a's turn of the run into the app layer could change it. Tests only.
 * - T-3: registered values that fall inside closed words of the records: `not_writable` (inside the
 *   code path_not_writable) and `before_verify` (a protected material check's phase). Today the
 *   renderer draws each line from the event as the engine appended it and the CLI masks the drawn
 *   line, so the refused write reads "write file — denied (path/path_<masked>)" (never "(path/?)"), and
 *   the folded checks are all counted (3), the phase being masked nowhere in a drawn line. The end
 *   summary's counts, the writablePaths line and the JSON are pinned too.
 * - T-4: protected material checks over two rounds (a check fails, one repair) and two checks: one
 *   unchanged check drawn and the other four folded (5 in the end summary), the checks' numbers the
 *   same in both rounds.
 * Both languages, the real CLI process, scripted model, temporary folders; no network.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MESSAGE_LANGUAGES } from "../../../src/contracts/index.js";
import type { MessageCatalog, MessageLanguage } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { createFileArgs, sha256Of, textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: null, maxDurationMs: 60_000 };
const VERIFIERS = [
  { id: "has-summary", kind: "file_rules", rules: [{ type: "exists", path: "summary.md" }] },
  { id: "says-done", kind: "file_rules", rules: [{ type: "contains", path: "summary.md", text: "done" }] },
];
/** The privacy gateway's placeholder for a masked value. */
const TOKEN = String.raw`\[\[CODARYN_SECRET:[0-9a-f]+\]\]`;
const say = (catalog: MessageCatalog, id: string, params: object = {}): string => (catalog.format as (id: string, params: object) => string)(id, params);
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
const linesOf = (run: CliRun): string[] => run.stderr.split(/\r?\n/);
const count = (lines: readonly string[], line: string): number => lines.filter((each) => each === line).length;

function workspace(sb: Sandbox): void {
  writeWorkspaceFile(sb, "notes.md", "# Notes\n");
  writeWorkspaceFile(sb, "docs/keep.md", "keep\n");
}

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const progress = (id: string, params: object = {}): string => `codaryn: ${say(catalog, id, params)}`;
  const verifierLine = (number: number, outcome: "pass" | "fail"): string =>
    `${progress("progress.verifier", { number, outcome: say(catalog, `outcome.${outcome}`) })} (${outcome})`;
  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => cliEnv({ extra: { CODARYN_LANG: language as MessageLanguage, ...extra } });

  describe(`U-291 T-3 (${language}): registered values inside closed words of the records`, () => {
    test("the refused write's line, the folded checks, the end summary's counts and the JSON as today", { timeout: 60_000 }, async (t) => {
      const sb = createSandbox(t);
      workspace(sb);
      const steps = [toolStep("write_file", createFileArgs("other.md", "x\n")), toolStep("write_file", createFileArgs("summary.md", "done\n")), textStep("finished")];
      const task = writeGeneralTask(
        sb,
        {
          id: "u291-closed-words",
          goal: "write the summary",
          policy: { writablePaths: ["summary.md"], protectedPaths: ["docs/keep.md"] },
          limits: LIMITS,
          verifiers: VERIFIERS,
          fields: { privacy: { secretEnv: ["U291_A", "U291_B"] } },
        },
        steps,
      );
      const ran = await runGuarded(sb, ["run", "--task", task], env({ U291_A: "not_writable", U291_B: "before_verify" }));
      const lines = linesOf(ran);

      // The refused write: the code drawn by the renderer, then masked in the drawn line.
      const denied = progress("progress.tool_denied", { tool: say(catalog, "tool.write_file"), permission: "path", code: "path_not_writable" });
      const deniedPattern = new RegExp(`^${escape(denied).replace("not_writable", TOKEN)}$`);
      assert.equal(lines.filter((line) => deniedPattern.test(line)).length, 1, ran.stderr);
      assert.equal(lines.some((line) => line.includes("(path/?)")), false, ran.stderr);
      // One unchanged check drawn (run_start), the others folded and counted.
      assert.equal(count(lines, progress("progress.integrity_unchanged", { phase: "run_start" })), 1, ran.stderr);
      assert.equal(lines.filter((line) => line.includes("(before_verify)") || line.includes("(after_verify)")).length, 0, ran.stderr);
      assert.equal(count(lines, say(catalog, "summary.integrity_unchanged", { count: 3 })), 1, ran.stderr);
      // The end summary's counts and the writablePaths line before it.
      assert.equal(count(lines, say(catalog, "summary.denied", { count: 1 })), 1, ran.stderr);
      assert.equal(count(lines, say(catalog, "summary.denied_not_writable", { count: 1 })), 1, ran.stderr);
      assert.equal(count(lines, progress("progress.not_writable_hint", { count: 1 })), 1, ran.stderr);
      assert.equal(count(lines, say(catalog, "summary.verifiers", { passed: 2, total: 2 })), 1, ran.stderr);
      assert.ok(lines.includes(verifierLine(1, "pass")) && lines.includes(verifierLine(2, "pass")), ran.stderr);
      // The JSON.
      const output = json(ran);
      assert.deepEqual([output["status"], output["reason"], ran.exitCode], ["done", "verified", 0], ran.stdout);
      assert.deepEqual((output["verifiers"] as { outcome: string }[]).map((verifier) => verifier.outcome), ["pass", "pass"]);
      assert.deepEqual((output["changes"] as { path: string; created: boolean }[]).map((change) => [change.path, change.created]), [["summary.md", true]]);
      assert.deepEqual((output["usage"] as { modelTurns: number; toolCalls: number; repairAttempts: number }), { ...(output["usage"] as object), modelTurns: 3, toolCalls: 1, repairAttempts: 0 });
      assert.deepEqual(output["masking"], { registeredValues: 2, maskedPlaces: 1 });
      assert.deepEqual(output["protectedChanged"], []);
      assert.equal(ran.stdout.includes("not_writable") || ran.stdout.includes("before_verify"), false, "no registered value in the JSON");
    });
  });

  describe(`U-291 T-4 (${language}): protected material checks over two rounds, two checks`, () => {
    test("one unchanged check drawn, five counted; the checks keep their numbers after the repair", { timeout: 60_000 }, async (t) => {
      const sb = createSandbox(t);
      workspace(sb);
      const repair = { path: "summary.md", expectedHash: sha256Of("draft\n"), change: { kind: "replace_all", content: "done\n" } };
      const steps = [toolStep("write_file", createFileArgs("summary.md", "draft\n")), textStep("first"), toolStep("write_file", repair), textStep("fixed")];
      const task = writeGeneralTask(
        sb,
        { id: "u291-two-rounds", goal: "write the summary", policy: { protectedPaths: ["docs/keep.md"] }, limits: { ...LIMITS, maxRepairAttempts: 1 }, verifiers: VERIFIERS },
        steps,
      );
      const ran = await runGuarded(sb, ["run", "--task", task], env());
      const lines = linesOf(ran);

      assert.equal(count(lines, progress("progress.integrity_unchanged", { phase: "run_start" })), 1, ran.stderr);
      assert.equal(lines.filter((line) => line.includes("(before_verify)") || line.includes("(after_verify)")).length, 0, ran.stderr);
      assert.equal(count(lines, say(catalog, "summary.integrity_unchanged", { count: 5 })), 1, ran.stderr);
      // The checks' lines in order: #1 and #2 in the first round, the repair, #1 and #2 again.
      const checks = lines.filter((line) => line === verifierLine(1, "pass") || line === verifierLine(2, "pass") || line === verifierLine(2, "fail") || line === progress("progress.repair", { attempt: 1, count: 1 }));
      assert.deepEqual(checks, [verifierLine(1, "pass"), verifierLine(2, "fail"), progress("progress.repair", { attempt: 1, count: 1 }), verifierLine(1, "pass"), verifierLine(2, "pass")]);
      assert.equal(count(lines, say(catalog, "summary.verifiers", { passed: 2, total: 2 })), 1, ran.stderr);
      const output = json(ran);
      assert.deepEqual([output["status"], output["reason"], ran.exitCode], ["done", "verified", 0], ran.stdout);
      assert.deepEqual((output["verifiers"] as { outcome: string }[]).map((verifier) => verifier.outcome), ["pass", "pass"]);
      assert.equal((output["usage"] as { repairAttempts: number }).repairAttempts, 1);
      assert.deepEqual(output["protectedChanged"], []);
    });
  });
}
