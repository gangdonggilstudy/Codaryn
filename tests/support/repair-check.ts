/**
 * Readers for phase 2 runs: repair records, the repair messages the engine sent, verification
 * rounds, snapshots and the `codaryn revert` command. Public CLI and contract types only.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  PRIVACY_TOKEN_PATTERN_SOURCE,
  PRIVACY_TOKEN_PREFIX,
  SNAPSHOTS_DIR_NAME,
  STATE_DIR_NAME,
} from "../../src/contracts/index.js";
import type {
  CommandOutput,
  JournalRecord,
  ModelMessage,
  RevertOutput,
  VerifierResult,
} from "../../src/contracts/index.js";
import { runDirOf, startCli } from "./cli.js";
import type { CliRun, StartOptions } from "./cli.js";

export type RepairStartedRecord = Extract<JournalRecord, { type: "repair_started" }>;
export type ModelRequestRecord = Extract<JournalRecord, { type: "model_request" }>;

export function repairStarts(records: readonly JournalRecord[]): RepairStartedRecord[] {
  return records.filter((record): record is RepairStartedRecord => record.type === "repair_started");
}

export function modelRequests(records: readonly JournalRecord[]): ModelRequestRecord[] {
  return records.filter((record): record is ModelRequestRecord => record.type === "model_request");
}

/** All text of one message as recorded (masked). */
export function messageText(message: ModelMessage): string {
  if (message.role === "user") return message.content;
  if (message.role === "assistant") return [message.text, ...message.toolCalls.map((call) => call.argsJson)].join("\n");
  return message.results.map((result) => result.content).join("\n");
}

/** Everything the model was sent in this run, as the journal recorded it. */
export function allRequestText(records: readonly JournalRecord[]): string {
  return modelRequests(records)
    .map((record) => [record.system ?? "", ...record.newMessages.map(messageText)].join("\n"))
    .join("\n");
}

/**
 * The user text of the first model request after each `repair_started` record, in order.
 * Fails when a repair was started but no request followed it.
 */
export function repairMessages(records: readonly JournalRecord[]): string[] {
  const messages: string[] = [];
  records.forEach((record, index) => {
    if (record.type !== "repair_started") return;
    const next = records.slice(index + 1).find((later): later is ModelRequestRecord => later.type === "model_request");
    if (next === undefined) assert.fail(`repair ${record.attempt} has no model request after it`);
    const users = next.newMessages.filter((message) => message.role === "user").map(messageText);
    assert.ok(users.length > 0, `the request after repair ${record.attempt} has no user message`);
    messages.push(users.join("\n"));
  });
  return messages;
}

export type IntegrityCheckedRecord = Extract<JournalRecord, { type: "integrity_checked" }>;

/** `integrity_checked` records (U-1) as `phase` and `changed`, in order. */
export function integrityChecks(records: readonly JournalRecord[]): { phase: string; changed: readonly string[] }[] {
  return records
    .filter((record): record is IntegrityCheckedRecord => record.type === "integrity_checked")
    .map((record) => ({ phase: record.phase, changed: record.changed }));
}

export function verifierResults(records: readonly JournalRecord[]): VerifierResult[] {
  const results: VerifierResult[] = [];
  for (const record of records) if (record.type === "verifier_result") results.push(record.result);
  return results;
}

/** Outcomes per verification round, for a task with `verifierCount` verifiers. */
export function roundOutcomes(records: readonly JournalRecord[], verifierCount: number): string[][] {
  const results = verifierResults(records);
  assert.equal(results.length % verifierCount, 0, "every round must record every verifier");
  const rounds: string[][] = [];
  for (let i = 0; i < results.length; i += verifierCount) {
    rounds.push(results.slice(i, i + verifierCount).map((result) => `${result.id}:${result.outcome}`));
  }
  return rounds;
}

/** Every occurrence of the token prefix starts a whole privacy token: no token was cut. */
export function assertWholeTokens(text: string, label: string): void {
  const prefixes = text.split(PRIVACY_TOKEN_PREFIX).length - 1;
  const whole = [...text.matchAll(new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g"))].length;
  assert.equal(whole, prefixes, `${label}: ${prefixes - whole} privacy token(s) were cut`);
}

export function countTokens(text: string): number {
  return [...text.matchAll(new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g"))].length;
}

export function snapshotsDirOf(workspace: string, runId: string): string {
  return join(runDirOf(workspace, runId), SNAPSHOTS_DIR_NAME);
}

/** Every file under `dir` as bytes, keyed by its `/` separated path relative to `dir`. */
export function treeBytes(dir: string, skipStateDir = false): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  if (!existsSync(dir)) return files;
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (skipStateDir && current === dir && name === STATE_DIR_NAME) continue;
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) files.set(relative(dir, full).split(sep).join("/"), readFileSync(full));
    }
  };
  walk(dir);
  return files;
}

/** Workspace files outside the state directory. */
export function workspaceBytes(workspace: string): Map<string, Buffer> {
  return treeBytes(workspace, true);
}

/** Like parseCliOutput, for any command: one JSON line whose exitCode equals the process exit code. */
export function parseCommandOutput(run: CliRun): CommandOutput {
  assert.equal(run.timedOut, false, `CLI did not finish in time. stderr: ${run.stderr.slice(0, 2000)}`);
  const lines = run.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  assert.equal(lines.length, 1, `stdout must be one JSON line, got: ${JSON.stringify(run.stdout.slice(0, 2000))}`);
  const parsed = JSON.parse(lines[0] ?? "") as CommandOutput;
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.exitCode, run.exitCode, "exitCode in stdout must equal the process exit code");
  return parsed;
}

/** `node dist/src/cli/main.js revert --workspace <workspace> --run <runId>` */
export function runRevert(workspace: string, runId: string, options: StartOptions): Promise<CliRun> {
  return startCli(["revert", "--workspace", workspace, "--run", runId], options).done;
}

export function expectRevertOutput(run: CliRun, runId: string): RevertOutput {
  const output = parseCommandOutput(run);
  if (output.kind !== "revert") {
    assert.fail(`expected a revert result, got ${JSON.stringify(output)}; stderr: ${run.stderr.slice(0, 2000)}`);
  }
  assert.equal(output.runId, runId);
  return output;
}

/** Sorted `path:action` and `path:reason` lists, for exact comparison. */
export function revertSummary(output: RevertOutput): { reverted: string[]; skipped: string[] } {
  return {
    reverted: output.reverted.map((file) => `${file.path}:${file.action}`).sort(),
    skipped: output.skipped.map((file) => `${file.path}:${file.reason}`).sort(),
  };
}
