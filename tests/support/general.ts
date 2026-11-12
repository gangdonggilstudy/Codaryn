/**
 * General task commands from the test side (G-G; src/contracts/plan.ts and workflow.ts):
 * `plan`, `apply` and `review` take the task form (DR-12, DR-17), their JSON outputs are read with
 * the contract's invariants, and the apply run's journal and discarded files are found by run id.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTENT_HASH_PATTERN_SOURCE,
  DISCARDED_DIR_NAME,
  JOURNAL_FILE_NAME,
  MIN_PLAN_DIGEST_PREFIX,
  RUN_EXIT_CODES,
  RUNS_DIR_NAME,
  STATE_DIR_NAME,
} from "../../src/contracts/index.js";
import type { ApplyJournalRecord, ApplyResult, EngineResult, PlanOutput, ReviewOutput } from "../../src/contracts/index.js";
import type { CliRun } from "./cli.js";
import { parseCommandOutput } from "./repair-check.js";

/** `plan --task <task> --run <id> [--json]` */
export function planArgs(task: string, runId: string, json = true): string[] {
  return ["plan", "--task", task, "--run", runId, ...(json ? ["--json"] : [])];
}

/** `apply --task <task> --run <plan run id> --digest <digest>`; the digest as given (cut it to test prefixes). */
export function applyArgs(task: string, planRunId: string, digest: string): string[] {
  return ["apply", "--task", task, "--run", planRunId, "--digest", digest];
}

/** `review --task <task> --run <id> --accept|--reject [--note <text>] [--json]` */
export function reviewArgs(task: string, runId: string, verdict: "accept" | "reject", note?: string, json = true): string[] {
  return ["review", "--task", task, "--run", runId, `--${verdict}`, ...(note === undefined ? [] : ["--note", note]), ...(json ? ["--json"] : [])];
}

/** The digest of a run that ended as `needs-input`/`plan_pending`, checked for its shape. */
export function planDigestOf(result: EngineResult): string {
  assert.equal(result.status, "needs-input");
  assert.equal(result.reason, "plan_pending");
  const digest = result.plan?.digest ?? "";
  assert.match(digest, new RegExp(CONTENT_HASH_PATTERN_SOURCE), "the plan digest is a SHA-256");
  return digest;
}

/** The shortest prefix `apply --digest` accepts. */
export function shortDigest(digest: string): string {
  return digest.slice(0, MIN_PLAN_DIGEST_PREFIX);
}

export function expectPlanOutput(run: CliRun, runId: string): PlanOutput {
  const output = parseCommandOutput(run);
  if (output.kind !== "plan") assert.fail(`expected a plan, got ${JSON.stringify(output).slice(0, 500)}`);
  assert.equal(output.runId, runId);
  assert.equal(output.exitCode, 0);
  return output;
}

/** An apply result: kind, the plan run it names, and the exit code of its status (RUN_EXIT_CODES). */
export function expectApplyResult(run: CliRun, planRunId: string): ApplyResult {
  const output = parseCommandOutput(run);
  if (output.kind !== "apply") assert.fail(`expected an apply result, got ${JSON.stringify(output).slice(0, 500)}`);
  assert.equal(output.planRunId, planRunId);
  assert.equal(output.exitCode, RUN_EXIT_CODES[output.status]);
  assert.notEqual(output.runId, planRunId, "an apply run has its own id (GT-D13)");
  return output;
}

export function expectReviewOutput(run: CliRun, runId: string): ReviewOutput {
  const output = parseCommandOutput(run);
  if (output.kind !== "review") assert.fail(`expected a review, got ${JSON.stringify(output).slice(0, 500)}`);
  assert.equal(output.runId, runId);
  return output;
}

export function runDirPath(workspace: string, runId: string): string {
  return join(workspace, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
}

/** `.codaryn/discarded/<apply run id>/` (DR-9). */
export function discardedDirOf(workspace: string, applyRunId: string): string {
  return join(workspace, STATE_DIR_NAME, DISCARDED_DIR_NAME, applyRunId);
}

/** The apply run's journal, checked to start with `apply_started` and to belong to that run. */
export function readApplyJournal(workspace: string, applyRunId: string): ApplyJournalRecord[] {
  const text = readFileSync(join(runDirPath(workspace, applyRunId), JOURNAL_FILE_NAME), "utf8");
  const records = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ApplyJournalRecord);
  assert.equal(records[0]?.type, "apply_started", "an apply journal starts with apply_started (DR-12)");
  records.forEach((record, index) => {
    assert.equal(record.runId, applyRunId);
    assert.equal(record.seq, index + 1);
  });
  return records;
}

/** Records of one type, typed. */
export function recordsOf<T extends ApplyJournalRecord["type"]>(records: readonly ApplyJournalRecord[], type: T): Extract<ApplyJournalRecord, { type: T }>[] {
  return records.filter((record): record is Extract<ApplyJournalRecord, { type: T }> => record.type === type);
}
