/**
 * Phase 3 contract values (U-1, U-2, U-3, U-5, U-6). K2, K3 and K5 rely on these exact values
 * and shapes; the type-level checks below fail to compile when a shape drifts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CLI_ERROR_EXIT_CODES,
  DOCTOR_CHECK_IDS,
  DOCTOR_CHECK_STATUSES,
  DOCTOR_EXIT_CODES,
  INTEGRITY_PHASES,
  MAX_INTEGRITY_BYTES,
  MAX_INTEGRITY_FILES,
  MAX_INTEGRITY_PATHS,
  MAX_REPORT_FILE_BYTES,
  REPORT_EXIT_CODES,
  asRawText,
} from "../../../src/contracts/index.js";
import type {
  CodarynConfig,
  CommandOutput,
  CreateIntegrityChecker,
  EngineDeps,
  EngineResult,
  IntegrityEntry,
  IntegrityManifest,
  JournalEvent,
  MaskedText,
  RunReasonByStatus,
} from "../../../src/contracts/index.js";

describe("U-1 integrity contract", () => {
  test("caps", () => {
    assert.equal(MAX_INTEGRITY_PATHS, 64);
    assert.equal(MAX_INTEGRITY_FILES, 10_000);
    assert.equal(MAX_INTEGRITY_BYTES, 268_435_456);
  });

  test("phases in check order", () => {
    assert.deepEqual([...INTEGRITY_PHASES], ["run_start", "before_verify", "after_verify"]);
  });

  test("manifest entries, checker signature and the journal record", () => {
    const hash = "0".repeat(64);
    const entries: IntegrityEntry[] = [
      { path: asRawText("a.txt"), kind: "file", sha256: hash },
      { path: asRawText("dist"), kind: "absent" },
      { path: asRawText("fixtures/link"), kind: "link", sha256: hash },
      { path: asRawText("tests"), kind: "unchecked", why: "limit" },
      { path: asRawText("D:/baseline/x.json"), kind: "unchecked", why: "unreadable" },
    ];
    const manifest: IntegrityManifest = { entries };
    const create: CreateIntegrityChecker = () => ({
      capture: async () => manifest,
      compare: () => [],
    });
    assert.equal(typeof create, "function");

    const changed = ["tests" as MaskedText];
    const event: JournalEvent = { type: "integrity_checked", phase: "before_verify", changed };
    assert.equal(event.type, "integrity_checked");
  });

  test("config field, engine dependency and result field are optional", () => {
    const config: CodarynConfig = { schemaVersion: 1, integrity: { paths: ["D:/baseline"] } };
    assert.deepEqual(config.integrity?.paths, ["D:/baseline"]);
    const withoutIntegrity: CodarynConfig = { schemaVersion: 1 };
    assert.equal(withoutIntegrity.integrity, undefined);

    type IntegrityDep = EngineDeps["integrity"];
    const absent: IntegrityDep = undefined;
    assert.equal(absent, undefined);
    type Changed = EngineResult["protectedChanged"];
    const notChecked: Changed = undefined;
    assert.equal(notChecked, undefined);
  });
});

describe("U-2 status and reason", () => {
  test("protected_changed is a needs-input reason", () => {
    const reason: RunReasonByStatus["needs-input"] = "protected_changed";
    assert.equal(reason, "protected_changed");
  });
});

describe("U-3 install directory refusal", () => {
  test("is an input error with exit code 2", () => {
    assert.equal(CLI_ERROR_EXIT_CODES.workspace_is_install_dir, 2);
  });
});

describe("U-5 report and U-6 doctor outputs", () => {
  test("exit codes", () => {
    assert.deepEqual(REPORT_EXIT_CODES, { complete: 0, incomplete: 3 });
    assert.deepEqual(DOCTOR_EXIT_CODES, { ok: 0, warn: 3, fail: 1 });
    assert.equal(MAX_REPORT_FILE_BYTES, 268_435_456);
  });

  test("doctor check ids and statuses", () => {
    assert.deepEqual(
      [...DOCTOR_CHECK_IDS],
      [
        "node_version",
        "config_file",
        "vars_file",
        "task_file",
        "api_key",
        "model",
        "limits",
        "file_locations",
        "commands",
        "workspace",
        "install_dir",
        "integrity_paths",
        // N-20: the language of the human output and where it came from.
        "language",
      ],
    );
    assert.deepEqual([...DOCTOR_CHECK_STATUSES], ["ok", "warn", "fail", "skipped"]);
  });

  test("both objects are command outputs", () => {
    const doctor: CommandOutput = {
      schemaVersion: 1,
      kind: "doctor",
      status: "warn",
      exitCode: DOCTOR_EXIT_CODES.warn,
      checks: [{ id: "api_key", status: "warn", message: "ANTHROPIC_API_KEY is not set" }],
    };
    const report: CommandOutput = {
      schemaVersion: 1,
      kind: "report",
      runId: "20261112T031500Z-9f2c41ab",
      status: "incomplete",
      exitCode: REPORT_EXIT_CODES.incomplete,
      result: null,
      journal: {
        taskId: "t1",
        workflow: "code" as MaskedText,
        provider: "scripted",
        limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1000 },
        records: 1,
        modelRequests: 0,
        deniedToolCalls: 0,
        repairs: 0,
        lastRound: [],
        changes: [],
        integrityChecks: [{ phase: "run_start", changed: [] }],
        finished: null,
      },
    };
    assert.deepEqual([doctor.kind, report.kind], ["doctor", "report"]);
  });
});
