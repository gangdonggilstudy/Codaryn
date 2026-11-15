/**
 * `codaryn report` (U-5) and `codaryn doctor` (U-6) from the test side: start them, read their
 * JSON output (`--json`) and check the shapes and invariants the contract states
 * (src/contracts/commands.ts). Text output is checked only for leaks, never parsed.
 */

import assert from "node:assert/strict";
import { DOCTOR_CHECK_IDS, DOCTOR_EXIT_CODES, REPORT_EXIT_CODES } from "../../src/contracts/index.js";
import type { DoctorOutput, DoctorStatus, ReportOutput } from "../../src/contracts/index.js";
import { startCli } from "./cli.js";
import type { CliRun, StartOptions } from "./cli.js";
import { parseCommandOutput } from "./repair-check.js";

/** `report --workspace <workspace> --run <runId> [--json]` */
export function runReport(workspace: string, runId: string, options: StartOptions & { readonly json?: boolean }): Promise<CliRun> {
  const args = ["report", "--workspace", workspace, "--run", runId];
  if (options.json !== false) args.push("--json");
  return startCli(args, options).done;
}

export function expectReportOutput(run: CliRun, runId: string): ReportOutput {
  const output = parseCommandOutput(run);
  if (output.kind !== "report") assert.fail(`expected a report, got ${JSON.stringify(output).slice(0, 500)}`);
  assert.equal(output.runId, runId);
  assert.equal(output.exitCode, REPORT_EXIT_CODES[output.status]);
  return output;
}

export interface DoctorArgs {
  readonly config?: string;
  readonly varsFile?: string;
  readonly task?: string;
  readonly workspace?: string;
  /** Defaults to true. */
  readonly json?: boolean;
}

export function doctorArgs(args: DoctorArgs): string[] {
  const out = ["doctor"];
  if (args.config !== undefined) out.push("--config", args.config);
  if (args.varsFile !== undefined) out.push("--vars-file", args.varsFile);
  if (args.task !== undefined) out.push("--task", args.task);
  if (args.workspace !== undefined) out.push("--workspace", args.workspace);
  if (args.json !== false) out.push("--json");
  return out;
}

const RANK: { readonly [S in DoctorStatus]: number } = { ok: 0, warn: 1, fail: 2 };

/**
 * A doctor result that keeps the contract's invariants: one check per id in DOCTOR_CHECK_IDS
 * order, status = the worst check (`skipped` counts as `ok`), exitCode = DOCTOR_EXIT_CODES[status].
 */
export function expectDoctorOutput(run: CliRun): DoctorOutput {
  const output = parseCommandOutput(run);
  if (output.kind !== "doctor") assert.fail(`expected a doctor result, got ${JSON.stringify(output).slice(0, 500)}`);
  assert.deepEqual(
    output.checks.map((check) => check.id),
    [...DOCTOR_CHECK_IDS],
    "one check per id, in DOCTOR_CHECK_IDS order",
  );
  const worst = output.checks.reduce<DoctorStatus>((acc, check) => {
    const status: DoctorStatus = check.status === "skipped" ? "ok" : check.status;
    return RANK[status] > RANK[acc] ? status : acc;
  }, "ok");
  assert.equal(output.status, worst, "status is the worst check");
  assert.equal(output.exitCode, DOCTOR_EXIT_CODES[output.status]);
  for (const check of output.checks) {
    assert.ok(!check.message.includes("\n"), `${check.id}: a message is one line`);
  }
  return output;
}

export function checkOf(output: DoctorOutput, id: (typeof DOCTOR_CHECK_IDS)[number]): DoctorOutput["checks"][number] {
  const check = output.checks.find((item) => item.id === id);
  if (check === undefined) assert.fail(`doctor has no ${id} check`);
  return check;
}
