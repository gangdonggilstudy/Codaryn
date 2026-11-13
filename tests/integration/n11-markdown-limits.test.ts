/**
 * U-151 (U-116, review R-89 M-1 and L-2, nd-docs' proposal in report-U116-fix.md): the Markdown rules
 * of `file_rules` in the real CLI. Scripted model, no key, every run behind the network guard.
 * - A: a document of about 1 MB whose lines are all under the reader's line limit (one paragraph of
 *   `[`, the shape that took minutes before the fix) is read in linear time: the run ends `done`
 *   long before its duration limit.
 * - B: a document of about 70,000 links to distinct missing targets. While the targets are looked
 *   at, the run keeps its duration limit (B1) and its cancel file (B2).
 *
 * Timing: the bounds are generous on purpose (seconds where the fixed CLI takes milliseconds; the
 * CLI before the fix took 25 s to many minutes on these shapes). How long the targets take depends
 * on the file system: where they are all looked at before the limit or the cancel, the rule
 * finishes and fails on the missing targets, and the case checks only that the run ended in time
 * (a diagnostic says which way it went).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MARKDOWN_EVIDENCE_LEADS, MAX_MARKDOWN_LINE_CHARS, MAX_MARKDOWN_RULE_FILE_BYTES } from "../../src/contracts/index.js";
import type { EngineResult, FileRule, ScriptStep } from "../../src/contracts/index.js";
import { createSandbox, writeTask } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { expectRunResult, readLiveRecords, startTask, waitFor } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";

/** How far past its duration limit, or past the cancel file, a run may end (generous, see above). */
const LATE_MS = 15_000;
/** The note of a rule the run's signal stopped (src/verify: "cancelled while the link targets were checked", "... before ..."). */
const SIGNAL_STOP = /cancelled (while|before)/;

/**
 * A: a level-1 heading, then one paragraph of 110 lines of 9,000 `[` each, then a level-2 heading
 * and one link to an existing target. The lines stay under MAX_MARKDOWN_LINE_CHARS (100,000 since
 * U-143; the contract said 10,000 before it, review R-89b), so the case does not hang on that bound.
 */
const BRACKET_LINE = "[".repeat(9_000);
const DOC_A = ["# 큰 문서", "", ...Array.from({ length: 110 }, () => BRACKET_LINE), "", "## 끝", "", "[처음으로](doc.md)", ""].join("\n");

/** B: 70,000 lines `[x](m<i>)`, each target a different file that does not exist. */
const MISSING_TARGETS = 70_000;
const DOC_B = `${Array.from({ length: MISSING_TARGETS }, (_, i) => `[x](m${i})`).join("\n")}\n`;

const HEADINGS_RULE: FileRule = { type: "markdown_headings", path: "doc.md", headings: [{ text: "큰 문서", level: 1 }, { text: "끝", level: 2 }], order: "in_order" };
const LINKS_RULE: FileRule = { type: "markdown_links", path: "doc.md" };

/** The model writes doc.md, then finishes; the verifier runs the given rules on it. */
function markdownTask(sb: Sandbox, id: string, doc: string, rules: readonly FileRule[], maxDurationMs: number): string {
  const steps: ScriptStep[] = [
    { toolCalls: [{ id: "w1", name: "write_file", args: { path: "doc.md", expectedHash: null, change: { kind: "replace_all", content: doc } } }] },
    { text: "문서를 썼다." },
  ];
  return writeTask(sb, { id, workflow: "document", limits: { maxDurationMs, maxRepairAttempts: 0 }, verifiers: [{ id: "md", kind: "file_rules", rules }] }, steps);
}

/** Starts the run behind the network guard; the guard's log must stay empty. */
function startGuarded(sb: Sandbox, taskPath: string, cancel: boolean): { readonly done: Promise<CliRun> } {
  const log = join(sb.base, "net-guard.log");
  const started = startTask(taskPath, { cwd: sb.base, netGuardLog: log, timeoutMs: 180_000, ...(cancel ? { cancelFile: sb.cancelFile } : {}) });
  return {
    done: started.done.then((run) => {
      const blocked = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((line) => line !== "") : [];
      assert.deepEqual(blocked, [], "the CLI tried to reach the network");
      return run;
    }),
  };
}

function verifierOf(result: EngineResult): { readonly outcome: string; readonly evidence: string } {
  const verifier = result.verifiers.find((item) => item.id === "md");
  assert.ok(verifier !== undefined, `no verifier md in ${JSON.stringify(result.verifiers)}`);
  return verifier;
}

/** The document fits the rules' bounds: under the file limit, every line under the contract's line limit. */
function assertWithinBounds(doc: string): void {
  assert.ok(Buffer.byteLength(doc, "utf8") < MAX_MARKDOWN_RULE_FILE_BYTES, "the document is under the file limit");
  assert.ok(Math.max(...doc.split("\n").map((line) => line.length)) < MAX_MARKDOWN_LINE_CHARS, "every line is under the line limit");
}

test("U-151 A: a 1 MB paragraph of [ under the line limit is read in linear time; the run is done long before its limit", { timeout: 180_000 }, async (t) => {
  assertWithinBounds(DOC_A);
  const sb = createSandbox(t);
  const limitMs = 120_000;
  const run = await startGuarded(sb, markdownTask(sb, "u151-big-paragraph", DOC_A, [HEADINGS_RULE, LINKS_RULE], limitMs), false).done;
  const result = expectRunResult(run);
  t.diagnostic(`A: wall ${run.durationMs} ms, run ${result.usage.durationMs} ms, ${result.status}/${result.reason}`);
  assert.deepEqual([result.status, result.reason, run.exitCode], ["done", "verified", 0], JSON.stringify(result.verifiers));
  const verifier = verifierOf(result);
  assert.equal(verifier.outcome, "pass");
  assert.ok(verifier.evidence.includes(MARKDOWN_EVIDENCE_LEADS.held), verifier.evidence);
  // Linear reading takes well under a second here; the bound only has to tell it from the minutes before the fix.
  assert.ok(result.usage.durationMs < 60_000, `the run took ${result.usage.durationMs} ms`);
  assert.equal(readFileSync(join(sb.workspace, "doc.md"), "utf8"), DOC_A);
});

test("U-151 B1: many missing link targets: the run keeps its duration limit while they are looked at", { timeout: 180_000 }, async (t) => {
  assertWithinBounds(DOC_B);
  const sb = createSandbox(t);
  const limitMs = 3_000;
  const run = await startGuarded(sb, markdownTask(sb, "u151-missing-limit", DOC_B, [LINKS_RULE], limitMs), false).done;
  const result = expectRunResult(run);
  const verifier = verifierOf(result);
  t.diagnostic(`B1: wall ${run.durationMs} ms, run ${result.usage.durationMs} ms, ${result.status}/${result.reason}, verifier ${verifier.outcome}: ${verifier.evidence.slice(0, 120)}`);
  assert.ok(result.usage.durationMs < limitMs + LATE_MS, `the run went on ${result.usage.durationMs - limitMs} ms past its ${limitMs} ms limit`);
  if (result.reason === "max_duration") {
    // Stopped by the limit while the targets were looked at: the rule is undecided, never held or failed on a partial look.
    assert.deepEqual([result.status, run.exitCode], ["budget-exhausted", 4]);
    assert.equal(verifier.outcome, "inconclusive", verifier.evidence);
    assert.match(verifier.evidence, SIGNAL_STOP);
  } else {
    // Every target was looked at before the limit: the rule fails on them.
    t.diagnostic("B1: the targets were all looked at before the limit; only the end time is checked");
    assert.deepEqual([result.status, result.reason], ["failed", "verifier_failed"]);
    assert.equal(verifier.outcome, "fail");
    assert.ok(verifier.evidence.includes(MARKDOWN_EVIDENCE_LEADS.brokenLinks), verifier.evidence);
  }
});

test("U-151 B2: many missing link targets: the cancel file stops the run while they are looked at", { timeout: 180_000 }, async (t) => {
  const sb = createSandbox(t);
  const started = startGuarded(sb, markdownTask(sb, "u151-missing-cancel", DOC_B, [LINKS_RULE], 600_000), true);
  // The model's last answer (no tool call) is recorded just before the verifiers start.
  await waitFor(
    () => readLiveRecords(sb.workspace).some((record) => record.type === "model_response" && record.toolCalls.length === 0),
    60_000,
    "the model's last answer in the journal",
  );
  writeFileSync(sb.cancelFile, "cancel");
  const cancelAt = Date.now();
  const run = await started.done;
  const lateMs = Date.now() - cancelAt;
  const result = expectRunResult(run);
  // A cancel read before the verifier started leaves no verifier result; one read during it leaves an undecided rule.
  const verifier = result.verifiers.find((item) => item.id === "md") ?? null;
  t.diagnostic(`B2: ended ${lateMs} ms after the cancel file, ${result.status}/${result.reason}, verifier ${verifier === null ? "none" : `${verifier.outcome}: ${verifier.evidence.slice(0, 120)}`}`);
  assert.ok(lateMs < LATE_MS, `the run ended ${lateMs} ms after the cancel file`);
  if (result.status === "cancelled") {
    assert.deepEqual([result.reason, run.exitCode], ["cancelled", 5]);
    if (verifier !== null) {
      assert.equal(verifier.outcome, "inconclusive", verifier.evidence);
      assert.match(verifier.evidence, SIGNAL_STOP);
    }
  } else {
    t.diagnostic("B2: the targets were all looked at before the cancel file was read; only the end time is checked");
    assert.deepEqual([result.status, result.reason], ["failed", "verifier_failed"]);
    assert.equal(verifier?.outcome, "fail");
  }
});
