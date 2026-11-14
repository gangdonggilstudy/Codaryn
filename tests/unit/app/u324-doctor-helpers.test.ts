/** U-324: keep the public doctor's decisions, injected ports and legacy bindings during extraction. */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { DOCTOR_CHECK_IDS } from "../../../src/contracts/index.js";
import type { DoctorOutput } from "../../../src/contracts/index.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import type { DoctorEnvironment } from "../../../src/cli/doctor.js";
import * as legacy from "../../../src/cli/doctor.js";
import * as checks from "../../../src/app/doctor-checks.js";
import type { DoctorCheckEnvironment, LockState } from "../../../src/app/doctor-types.js";
import type { LockState as LegacyLockState } from "../../../src/cli/doctor.js";

function environment(extra: Partial<DoctorEnvironment> = {}): DoctorEnvironment {
  return {
    argv: ["doctor", "--json"], env: {}, cwd: path.resolve("u324-synthetic"), nodeVersion: "26.0.0",
    readFile: async () => { throw new Error("no file expected"); }, isDirectory: async () => true,
    isFile: async () => false, locateInWorkspace: async () => "outside", relatePaths: async () => "separate",
    inspectLock: async () => "none", listParkedFiles: async () => [], ...extra,
  };
}

test("U-324: legacy constants and lock inspector are the new module's exact bindings", async () => {
  assert.equal(legacy.MODELS_HINT, checks.MODELS_HINT);
  assert.equal(legacy.MODEL_EXISTENCE_NOT_CHECKED, checks.MODEL_EXISTENCE_NOT_CHECKED);
  assert.equal(legacy.REQUIRED_NODE_MAJOR, checks.REQUIRED_NODE_MAJOR);
  assert.equal(checks.REQUIRED_NODE_MAJOR, 26);
  assert.strictEqual(legacy.inspectLockFile, checks.inspectLockFile);
  const io: DoctorCheckEnvironment = environment();
  const state: LockState = await legacy.inspectLockFile(io.cwd, async () => { throw Object.assign(new Error("synthetic missing"), { code: "ENOENT" }); });
  const oldState: LegacyLockState = state;
  assert.equal(oldState, "none");
});

test("U-324: public doctor retains config failure over missing profile, without echoing input", async () => {
  const reads: string[] = [];
  const io = environment({ argv: ["doctor", "--config", "config.json", "--profile", "missing", "--json"],
    readFile: async (file) => { reads.push(file); return '{"u324-private-cell": '; },
  });
  const result = await runDoctor(io); assert.ok("text" in result);
  const output = JSON.parse(result.text) as DoctorOutput;
  assert.equal(result.exitCode, 1); assert.equal(output.status, "fail");
  assert.deepEqual(output.checks.map((check) => check.id), [...DOCTOR_CHECK_IDS]);
  const config = output.checks.find((check) => check.id === "config_file")!;
  assert.equal(config.status, "fail"); assert.equal(config.text?.id, "doctor.config_file.json_syntax");
  assert.deepEqual(reads, [path.join(io.cwd, "config.json")]);
  assert.equal(result.text.includes("u324-private-cell"), false);
  assert.ok(result.text.endsWith("\n"));
});

test("U-324: public doctor preserves workspace, lock then parked observation and typed warning", async () => {
  const calls: string[] = [];
  const root = path.resolve("u324-synthetic", "work");
  const result = await runDoctor(environment({ argv: ["doctor", "--workspace", "work", "--json"],
    isDirectory: async (dir) => { calls.push(`directory:${dir}`); return true; },
    inspectLock: async (dir) => { calls.push(`lock:${dir}`); return "held"; },
    listParkedFiles: async (dir) => { calls.push(`parked:${dir}`); return []; },
  }));
  assert.ok("text" in result);
  const output = JSON.parse(result.text) as DoctorOutput;
  assert.deepEqual(calls, [`directory:${root}`, `lock:${root}`, `parked:${root}`]);
  const lock = output.checks.find((check) => check.id === "lock")!;
  assert.equal(lock.status, "warn"); assert.equal(lock.text?.id, "doctor.lock.held");
});

test("U-324: remote argument refusal precedes readFile getter access", async () => {
  let touched = 0;
  const io = environment({ argv: ["doctor", "--config", "//127.0.0.1/share/config.json", "--json"] });
  Object.defineProperty(io, "readFile", { get() { touched++; throw new Error("must not be read"); } });
  const result = await runDoctor(io);
  assert.ok("output" in result); assert.equal(result.output.kind, "error");
  if (result.output.kind === "error") assert.equal(result.output.code, "invalid_arguments");
  assert.equal(touched, 0);
});

test("U-324: injected lock exception propagates unchanged and does not observe parked files", async () => {
  const failure = new Error("synthetic lock failure"); let parked = false;
  await assert.rejects(runDoctor(environment({ argv: ["doctor", "--workspace", "work", "--json"],
    inspectLock: async () => { throw failure; }, listParkedFiles: async () => { parked = true; return []; },
  })), (error) => error === failure);
  assert.equal(parked, false);
});
