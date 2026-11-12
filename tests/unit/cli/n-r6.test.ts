/**
 * Review R-6 (usability CLI connection, e702b41), low 1 and low 2. Each test reproduces the
 * review's input and failed before the fix.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import type { EngineResult } from "../../../src/contracts/index.js";
import { inspectLockFile } from "../../../src/cli/doctor.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import { lexicalLocate } from "./locate.js";

describe("R-6 low 1: doctor judges the lock as a run does (N-25 b)", () => {
  const lock = (processStartedAt?: string): string =>
    JSON.stringify({ pid: 4242, runId: "r", startedAt: "2026-11-12T03:00:00.000Z", ...(processStartedAt === undefined ? {} : { processStartedAt }) });

  test("a live pid whose process started at another time is a lock the next run reclaims", async () => {
    // The pid was given to another process after the holder ended (Z-2).
    const state = await inspectLockFile("/w", async () => lock("2026-11-12T03:00:00.000Z"), () => true, async () => Date.parse("2026-11-12T05:00:00.000Z"));
    assert.equal(state, "stale");
  });

  test("the same start time, within the tolerance, is held; an unknown start time is held", async () => {
    const started = Date.parse("2026-11-12T03:00:00.000Z");
    assert.equal(await inspectLockFile("/w", async () => lock("2026-11-12T03:00:00.000Z"), () => true, async () => started + 1000), "held");
    assert.equal(await inspectLockFile("/w", async () => lock("2026-11-12T03:00:00.000Z"), () => true, async () => null), "held");
  });

  test("an old lock without a start time is judged by its pid alone; a bad start time is not understood", async () => {
    assert.equal(await inspectLockFile("/w", async () => lock(), () => true, async () => 0), "held");
    assert.equal(await inspectLockFile("/w", async () => lock(), () => false, async () => 0), "stale");
    assert.equal(await inspectLockFile("/w", async () => lock("yesterday"), () => true, async () => 0), "unreadable");
  });
});

describe("R-6 low 2: a one-line run in the install directory is refused first", () => {
  test("without a config file the reason is the install directory, not the missing limits", async () => {
    const base = path.resolve("/tmp/codaryn-r6");
    const assembled: unknown[] = [];
    const read: string[] = [];
    const io: CliEnvironment = {
      argv: ["run", "fix it"],
      env: {},
      cwd: base,
      readFile: async (file) => {
        read.push(file);
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      isDirectory: async () => true,
      loadEnvFile: () => {},
      locateInWorkspace: lexicalLocate,
      clock: { now: () => 0 },
      randomBytes: (size) => new Uint8Array(size),
      assemble: async (input) => {
        assembled.push(input);
        return { ok: false, code: "internal_error", message: "x" };
      },
      runTask: async () => ({}) as EngineResult,
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
      installDir: base,
      relatePaths: async (target, other) => (path.resolve(target) === path.resolve(other) ? "same" : "separate"),
      defaultConfig: null,
    };
    const outcome = await runCli(io);
    assert.ok(outcome.output.kind === "error");
    assert.equal(outcome.output.code, "workspace_is_install_dir");
    assert.deepEqual(assembled, []);
    assert.deepEqual(read, [], "nothing is read before the install directory is refused");
  });
});
