/**
 * Phase 2 in the CLI: the repair limits in task and config files (R-2, R-3), `policy.protectedPaths`
 * (R-5) and `codaryn revert` (R-7). The store's revertRun is a fake here; the lock and the journal
 * check run for real on a temporary directory. Fake values only, no network.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  CLI_ERROR_EXIT_CODES,
  DEFAULT_MAX_REPAIR_ATTEMPTS,
  DEFAULT_MAX_SAME_FAILURES,
  REVERT_EXIT_CODES,
} from "../../../src/contracts/index.js";
import type { EngineResult, RevertOutcome, RevertRequest, RevertRun, RunTask } from "../../../src/contracts/index.js";
import { parseArgs, parseRevertArgs } from "../../../src/cli/args.js";
import { createRevertCommand } from "../../../src/cli/assemble.js";
import type { Assemble, AssemblyInput, RevertCommand, RevertCommandInput } from "../../../src/cli/assemble.js";
import { parseConfig } from "../../../src/cli/config.js";
import { runRevert } from "../../../src/cli/revert.js";
import type { RevertEnvironment } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import { buildQuickTask, parseTask } from "../../../src/cli/task.js";
import { lexicalLocate } from "./locate.js";

const BASE = path.resolve("/tmp/codaryn-repair-cli-unit");
/** A numeric token limit: the quick form is anthropic, which needs one (S-7). */
const BUDGET = { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: 10_000, maxDurationMs: 10_000 };
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const temporaryDirs: string[] = [];

after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

function taskFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "repair-1",
    goal: "fix the failing check",
    workflow: "code",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: POLICY,
    privacy: { secretEnv: [] },
    limits: BUDGET,
    verifiers: [],
    ...overrides,
  };
}

function parsed(value: unknown, configLimits?: unknown) {
  const defaults = configLimits === undefined ? {} : { limits: configLimits as never };
  return parseTask(value, BASE, defaults);
}

describe("R-2, R-3 repair limits in task and config files", () => {
  test("left out everywhere, the resolved task has the defaults 0 and 2", () => {
    const outcome = parsed(taskFile());
    assert.ok(outcome.ok);
    assert.equal(outcome.task.limits.maxRepairAttempts, DEFAULT_MAX_REPAIR_ATTEMPTS);
    assert.equal(outcome.task.limits.maxSameFailures, DEFAULT_MAX_SAME_FAILURES);
    assert.equal(DEFAULT_MAX_REPAIR_ATTEMPTS, 0);
    assert.equal(DEFAULT_MAX_SAME_FAILURES, 2);
  });

  test("the task wins per field, the config file fills the rest", () => {
    const config = parseConfig({ schemaVersion: 1, limits: { maxRepairAttempts: 3, maxSameFailures: 4 } });
    assert.ok(config.ok);
    assert.deepEqual(config.config.limits, { maxRepairAttempts: 3, maxSameFailures: 4 });

    const both = parsed(taskFile({ limits: { ...BUDGET, maxRepairAttempts: 1 } }), config.config.limits);
    assert.ok(both.ok);
    assert.equal(both.task.limits.maxRepairAttempts, 1);
    assert.equal(both.task.limits.maxSameFailures, 4);

    const zero = parsed(taskFile({ limits: { ...BUDGET, maxRepairAttempts: 0, maxSameFailures: 1 } }), config.config.limits);
    assert.ok(zero.ok);
    assert.equal(zero.task.limits.maxRepairAttempts, 0);
    assert.equal(zero.task.limits.maxSameFailures, 1);
  });

  test("the quick form takes them from the config file", () => {
    const config = parseConfig({ schemaVersion: 1, limits: { ...BUDGET, maxRepairAttempts: 2 } });
    assert.ok(config.ok);
    const quick = buildQuickTask({ workspace: "work", goal: "fix", cwd: BASE, config: config.config });
    assert.ok(quick.ok);
    assert.equal(quick.task.limits.maxRepairAttempts, 2);
    assert.equal(quick.task.limits.maxSameFailures, DEFAULT_MAX_SAME_FAILURES);
  });

  test("invalid values are rejected and the message names the field, not the value", () => {
    const bad: [string, unknown][] = [
      ["maxRepairAttempts", -1],
      ["maxRepairAttempts", 1.5],
      ["maxRepairAttempts", "2"],
      ["maxRepairAttempts", null],
      ["maxSameFailures", 0],
      ["maxSameFailures", -2],
      ["maxSameFailures", 2.5],
      ["maxSameFailures", null],
    ];
    for (const [field, value] of bad) {
      const outcome = parsed(taskFile({ limits: { ...BUDGET, [field]: value } }));
      assert.equal(outcome.ok, false, `${field}=${String(value)} in the task`);
      assert.ok(!outcome.ok && outcome.message.includes(`limits.${field}`));
      assert.ok(!outcome.ok && !outcome.message.includes(JSON.stringify(value)), "the value is not echoed");
      const config = parseConfig({ schemaVersion: 1, limits: { [field]: value } });
      assert.equal(config.ok, false, `${field}=${String(value)} in the config file`);
    }
  });
});

describe("R-5 policy.protectedPaths", () => {
  test("valid prefixes are passed on as written; absent means none", () => {
    const entries = ["tests", "verify/config.json", "src\\fixtures", ".", "./docs/"];
    const outcome = parsed(taskFile({ policy: { ...POLICY, protectedPaths: entries } }));
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.task.policy.protectedPaths, entries);

    const none = parsed(taskFile());
    assert.ok(none.ok);
    assert.equal("protectedPaths" in none.task.policy, false);

    const empty = parsed(taskFile({ policy: { ...POLICY, protectedPaths: [] } }));
    assert.ok(empty.ok);
    assert.deepEqual(empty.task.policy.protectedPaths, []);
  });

  test("absolute paths, '..' segments and non-strings are rejected", () => {
    const bad: unknown[] = [
      "tests",
      [1],
      [""],
      ["  "],
      ["/etc"],
      ["\\\\server\\share"],
      ["C:\\project\\tests"],
      ["C:tests"],
      ["../outside"],
      ["a/../b"],
      ["a\\..\\b"],
      ["a\u0000b"],
    ];
    for (const value of bad) {
      const outcome = parsed(taskFile({ policy: { ...POLICY, protectedPaths: value } }));
      assert.equal(outcome.ok, false, JSON.stringify(value));
      assert.ok(!outcome.ok && outcome.message.startsWith("policy.protectedPaths"));
    }
  });

  test("the config file's quick form policy carries them too", () => {
    const config = parseConfig({ schemaVersion: 1, limits: BUDGET, policy: { ...POLICY, protectedPaths: ["tests"] } });
    assert.ok(config.ok);
    const quick = buildQuickTask({ workspace: "work", goal: "fix", cwd: BASE, config: config.config });
    assert.ok(quick.ok);
    assert.deepEqual(quick.task.policy.protectedPaths, ["tests"]);
    assert.equal(parseConfig({ schemaVersion: 1, policy: { ...POLICY, protectedPaths: ["../x"] } }).ok, false);
  });

  test("codaryn run hands the protected paths and the repair limits to the assembly", async () => {
    const files: Record<string, unknown> = {
      "task.json": taskFile({
        policy: { ...POLICY, protectedPaths: ["tests"] },
        limits: { ...BUDGET, maxRepairAttempts: 2 },
      }),
      "script.json": { schemaVersion: 1, steps: [{ text: "done" }] },
    };
    const assembled: AssemblyInput[] = [];
    const result = { schemaVersion: 1, kind: "run", status: "done", exitCode: 0 } as unknown as EngineResult;
    const assemble: Assemble = async (input) => {
      assembled.push(input);
      return { ok: true, deps: {} as never, finish: async () => {} };
    };
    const runTask: RunTask = async () => result;
    const outcome = await runCli({
      argv: ["run", "--task", "task.json"],
      env: {},
      cwd: BASE,
      readFile: async (file) => {
        const value = files[path.relative(BASE, file).split(path.sep).join("/")];
        if (value === undefined) throw new Error("missing");
        return JSON.stringify(value);
      },
      isDirectory: async (dir) => dir === path.join(BASE, "work"),
      loadEnvFile: () => {
        throw new Error("no env file");
      },
      locateInWorkspace: lexicalLocate,
      clock: { now: () => 0 },
      randomBytes: (size) => new Uint8Array(size),
      assemble,
      runTask,
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    });
    assert.equal(outcome.exitCode, 0);
    assert.deepEqual(assembled[0]?.task.policy.protectedPaths, ["tests"]);
    assert.equal(assembled[0]?.task.limits.maxRepairAttempts, 2);
    assert.equal(assembled[0]?.task.limits.maxSameFailures, DEFAULT_MAX_SAME_FAILURES);
  });
});

describe("R-7 codaryn revert arguments", () => {
  const RUN = "20261112T031500Z-cdcdcdcd";

  test("--workspace and --run are both required and nothing else is accepted", () => {
    assert.deepEqual(parseRevertArgs(["revert", "--workspace", "w", "--run", RUN]), {
      ok: true,
      args: { command: "revert", workspace: "w", runId: RUN, dryRun: false, quiet: false },
    });
    assert.deepEqual(parseRevertArgs(["revert", "--run", RUN, "--workspace", "w"]).ok, true);
    const bad = [
      ["revert"],
      ["revert", "--workspace", "w"],
      ["revert", "--run", RUN],
      ["revert", "--workspace", "w", "--run", RUN, "--task", "t.json"],
      ["revert", "--workspace", "w", "--workspace", "x", "--run", RUN],
      ["revert", "--workspace", "--run", RUN],
      ["run", "--workspace", "w", "--run", RUN],
    ];
    for (const argv of bad) assert.equal(parseRevertArgs(argv).ok, false, argv.join(" "));
    // `run` does not take --run.
    assert.equal(parseArgs(["run", "--task", "t.json", "--run", RUN]).ok, false);
  });

  test("a run id must be a plain directory name", () => {
    for (const runId of ["../x", "a..b", "-x", ".x", "a/b", "a\\b", "x".repeat(129), "a b"]) {
      assert.equal(parseRevertArgs(["revert", "--workspace", "w", "--run", runId]).ok, false, runId);
    }
    assert.equal(parseRevertArgs(["revert", "--workspace", "w", "--run", "x".repeat(128)]).ok, true);
  });
});

describe("R-7 runRevert output", () => {
  const RUN = "20261112T031500Z-cdcdcdcd";

  function env(revert?: RevertCommand, argv?: readonly string[]): { io: RevertEnvironment; calls: RevertCommandInput[] } {
    const calls: RevertCommandInput[] = [];
    const io: RevertEnvironment = {
      argv: argv ?? ["revert", "--workspace", "work", "--run", RUN],
      cwd: BASE,
      isDirectory: async (dir) => dir === path.join(BASE, "work"),
      clock: { now: () => Date.UTC(2026, 10, 12, 3, 15, 0) },
      randomBytes: (size) => new Uint8Array(size).fill(0xab),
      ...(revert === undefined
        ? {}
        : {
            revert: async (input: RevertCommandInput) => {
              calls.push(input);
              return revert(input);
            },
          }),
    };
    return { io, calls };
  }

  const complete: RevertOutcome = { reverted: [{ path: "a.txt", action: "restored" }, { path: "new.txt", action: "deleted" }], skipped: [] };

  test("everything reverted: kind revert, status complete, exit 0", async () => {
    const { io, calls } = env(async () => ({ ok: true, outcome: complete, runId: RUN, revertedBefore: null }));
    const outcome = await runRevert(io);
    assert.equal(outcome.exitCode, REVERT_EXIT_CODES.complete);
    assert.deepEqual(outcome.output, {
      schemaVersion: 1,
      kind: "revert",
      runId: RUN,
      status: "complete",
      exitCode: 0,
      reverted: complete.reverted,
      skipped: [],
    });
    assert.equal(calls[0]?.workspace, path.join(BASE, "work"));
    assert.equal(calls[0]?.runId, RUN);
    // The lock is taken under an id of its own, never the reverted run's.
    assert.notEqual(calls[0]?.lockId, RUN);
    assert.match(calls[0]?.lockId ?? "", /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  });

  test("a skipped file makes it partial with exit 3", async () => {
    const outcome = await runRevert(
      env(async () => ({ ok: true, outcome: { reverted: [], skipped: [{ path: "a.txt", reason: "changed_since_run" }] }, runId: RUN, revertedBefore: null })).io,
    );
    assert.equal(outcome.exitCode, 3);
    assert.equal(outcome.output.kind === "revert" ? outcome.output.status : "", "partial");
    assert.deepEqual(outcome.output.kind === "revert" ? outcome.output.skipped : [], [{ path: "a.txt", reason: "changed_since_run" }]);
  });

  test("errors stop before anything changes and use CliErrorOutput", async () => {
    const cases: [ReturnType<typeof env>, string][] = [
      [env(async () => ({ ok: true, outcome: complete, runId: RUN, revertedBefore: null }), ["revert", "--workspace", "work"]), "invalid_arguments"],
      [env(async () => ({ ok: true, outcome: complete, runId: RUN, revertedBefore: null }), ["revert", "--workspace", "gone", "--run", RUN]), "workspace_not_found"],
      [env(async () => ({ ok: false, code: "run_not_found", message: "no journal" })), "run_not_found"],
      [env(async () => ({ ok: false, code: "workspace_locked", message: "locked" })), "workspace_locked"],
      [
        env(async () => {
          throw new Error("boom");
        }),
        "internal_error",
      ],
    ];
    for (const [{ io }, expected] of cases) {
      const outcome = await runRevert(io);
      assert.equal(outcome.output.kind === "error" ? outcome.output.code : "", expected);
      assert.equal(outcome.exitCode, CLI_ERROR_EXIT_CODES[expected as keyof typeof CLI_ERROR_EXIT_CODES]);
    }
  });

  test("without a connected revertRun nothing is read or changed", async () => {
    const outcome = await runRevert(env().io);
    assert.equal(outcome.output.kind === "error" ? outcome.output.code : "", "internal_error");
    assert.equal(outcome.exitCode, 70);
    assert.ok(outcome.output.kind === "error" && outcome.output.message.includes("nothing was changed"));
  });
});

describe("R-7 createRevertCommand around the store's revertRun", () => {
  const RUN = "20261112T020000Z-0a0b0c0d";
  const LOCK_ID = "20261112T031500Z-abababab";
  const clock = { now: () => Date.UTC(2026, 10, 12, 3, 15, 0) };

  async function workspace(options: { journal?: boolean; lockedBy?: string } = {}): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "codaryn-unit-revert-"));
    temporaryDirs.push(dir);
    if (options.journal !== false) {
      await mkdir(path.join(dir, ".codaryn", "runs", RUN), { recursive: true });
      await writeFile(path.join(dir, ".codaryn", "runs", RUN, "journal.jsonl"), "", "utf8");
    }
    if (options.lockedBy !== undefined) {
      await mkdir(path.join(dir, ".codaryn"), { recursive: true });
      const lock = { pid: process.pid, runId: options.lockedBy, startedAt: "2026-11-12T03:00:00.000Z" };
      await writeFile(path.join(dir, ".codaryn", "lock.json"), `${JSON.stringify(lock)}\n`, "utf8");
    }
    return dir;
  }

  async function exists(file: string): Promise<boolean> {
    try {
      await stat(file);
      return true;
    } catch {
      return false;
    }
  }

  function fakeRevert(behaviour: (request: RevertRequest) => Promise<RevertOutcome>): { revertRun: RevertRun; requests: RevertRequest[] } {
    const requests: RevertRequest[] = [];
    return {
      requests,
      revertRun: async (request) => {
        requests.push(request);
        return behaviour(request);
      },
    };
  }

  test("the lock is held while revertRun runs and released afterwards", async () => {
    const dir = await workspace();
    const root = await realpath(dir);
    let lockDuringRevert = "";
    const fake = fakeRevert(async () => {
      lockDuringRevert = await readFile(path.join(root, ".codaryn", "lock.json"), "utf8");
      return { reverted: [{ path: "a.txt", action: "restored" }], skipped: [] };
    });
    const outcome = await createRevertCommand(fake.revertRun)({ workspace: dir, runId: RUN, lockId: LOCK_ID, clock });
    assert.deepEqual(outcome, {
      ok: true,
      outcome: { reverted: [{ path: "a.txt", action: "restored" }], skipped: [] },
      runId: RUN,
      revertedBefore: null,
    });
    assert.deepEqual(fake.requests, [{ workspaceRoot: root, runId: RUN }]);
    assert.equal((JSON.parse(lockDuringRevert) as { runId: string }).runId, LOCK_ID);
    assert.equal(await exists(path.join(root, ".codaryn", "lock.json")), false);
  });

  test("a run without a journal in this workspace is run_not_found and nothing is called", async () => {
    const dir = await workspace({ journal: false });
    const fake = fakeRevert(async () => ({ reverted: [], skipped: [] }));
    const outcome = await createRevertCommand(fake.revertRun)({ workspace: dir, runId: RUN, lockId: LOCK_ID, clock });
    assert.equal(outcome.ok ? "" : outcome.code, "run_not_found");
    assert.equal(fake.requests.length, 0);
    assert.equal(await exists(path.join(dir, ".codaryn")), false, "no state directory is created");
  });

  test("a workspace locked by a running task is refused before anything changes", async () => {
    const dir = await workspace({ lockedBy: "20261112T030000Z-11112222" });
    const before = await readFile(path.join(dir, ".codaryn", "lock.json"), "utf8");
    const fake = fakeRevert(async () => ({ reverted: [], skipped: [] }));
    const outcome = await createRevertCommand(fake.revertRun)({ workspace: dir, runId: RUN, lockId: LOCK_ID, clock });
    assert.equal(outcome.ok ? "" : outcome.code, "workspace_locked");
    assert.equal(fake.requests.length, 0);
    assert.equal(await readFile(path.join(dir, ".codaryn", "lock.json"), "utf8"), before, "the other lock is untouched");
  });

  test("a journal revertRun cannot read is invalid_run_record and the lock is released", async () => {
    const dir = await workspace();
    const fake = fakeRevert(async () => {
      throw new Error("journal line 3 is not JSON");
    });
    const outcome = await createRevertCommand(fake.revertRun)({ workspace: dir, runId: RUN, lockId: LOCK_ID, clock });
    assert.equal(outcome.ok ? "" : outcome.code, "invalid_run_record");
    assert.ok(!outcome.ok && !outcome.message.includes("line 3"), "the error text is not passed on");
    assert.equal(await exists(path.join(dir, ".codaryn", "lock.json")), false);
  });

  test("a missing workspace is workspace_not_found", async () => {
    const fake = fakeRevert(async () => ({ reverted: [], skipped: [] }));
    const missing = path.join(tmpdir(), `codaryn-unit-revert-missing-${randomBytes(4).toString("hex")}`);
    const outcome = await createRevertCommand(fake.revertRun)({ workspace: missing, runId: RUN, lockId: LOCK_ID, clock });
    assert.equal(outcome.ok ? "" : outcome.code, "workspace_not_found");
  });
});
