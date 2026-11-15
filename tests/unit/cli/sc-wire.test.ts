/**
 * S-C wiring: the phase 2 assembly (snapshots and `codaryn revert` with the real store), S-1
 * (files that shape a run must lie outside the workspace) and S-5 (no network or device path is
 * touched). Real modules on temporary directories where files exist; recorded fakes otherwise.
 * Scripted model, fake values only, no network.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { assembleRun, createRevertCommand } from "../../../src/cli/assemble.js";
import { runRevert } from "../../../src/cli/revert.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment, CliRunOutcome } from "../../../src/cli/run.js";
import { locateInWorkspace } from "../../../src/cli/security/index.js";
import { revertRun } from "../../../src/store/index.js";
import { lexicalLocate, recordedText } from "./locate.js";

const FAKE_SECRET = "fake-secret-VALUE-0088";
const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function code(outcome: CliRunOutcome): string {
  return outcome.output.kind === "error" ? outcome.output.code : outcome.output.status;
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

function realIo(base: string, argv: readonly string[], extra: Partial<CliEnvironment> = {}): CliEnvironment {
  return {
    argv,
    env: { CODARYN_UNIT_SECRET: FAKE_SECRET },
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (dir) => {
      try {
        return (await stat(dir)).isDirectory();
      } catch {
        return false;
      }
    },
    loadEnvFile: () => {
      throw new Error("no env file in this test");
    },
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    clock: { now: () => Date.now() },
    randomBytes: (size) => randomBytes(size),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    ...extra,
  };
}

function task(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: "sc-wire",
    goal: "change two files",
    workflow: "code",
    workspaceRoot: "./work",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: ["CODARYN_UNIT_SECRET"] },
    limits: { maxModelTurns: 6, maxToolCalls: 6, maxTotalTokens: null, maxDurationMs: 60_000 },
    verifiers: [{ id: "new", kind: "file_rules", rules: [{ type: "exists", path: "new.txt" }] }],
    ...overrides,
  });
}

describe("phase 2 assembly: snapshots and codaryn revert with the real store", () => {
  /** Runs a task that changes a.txt (it holds a fake secret) and creates new.txt. */
  async function changedWorkspace(): Promise<{ base: string; runId: string; original: Buffer }> {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-unit-wire2-"));
    temporaryDirs.push(base);
    await mkdir(path.join(base, "work"));
    const original = Buffer.from(`first line\r\nkey=${FAKE_SECRET}\r\n`, "utf8");
    await writeFile(path.join(base, "work", "a.txt"), original);
    const steps = [
      { toolCalls: [{ name: "read_file", args: { path: "a.txt" } }] },
      {
        toolCalls: [
          {
            name: "write_file",
            args: { path: "a.txt", expectedHash: sha(original), change: { kind: "replace_text", oldText: "first line", newText: "edited line" } },
          },
          { name: "write_file", args: { path: "new.txt", expectedHash: null, change: { kind: "replace_all", content: "created\n" } } },
        ],
      },
      { text: "done" },
    ];
    await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
    await writeFile(path.join(base, "task.json"), task(), "utf8");
    const outcome = await runCli(realIo(base, ["run", "--task", "task.json"]));
    assert.equal(code(outcome), "done");
    assert.equal(outcome.output.kind === "run" ? outcome.output.changes.length : 0, 2);
    return { base, runId: outcome.output.kind === "run" ? outcome.output.runId : "", original };
  }

  function revertIo(base: string, runId: string) {
    return {
      argv: ["revert", "--workspace", "work", "--run", runId],
      cwd: base,
      isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() === true,
      clock: { now: () => Date.now() },
      randomBytes: (size: number) => randomBytes(size),
      revert: createRevertCommand(revertRun),
    };
  }

  test("write_file keeps the original in snapshots/, never in the journal or the result", async () => {
    const { base, runId } = await changedWorkspace();
    const snapshots = path.join(base, "work", ".codaryn", "runs", runId, "snapshots");
    assert.ok(await exists(snapshots));
    // The snapshot is the raw original (R-8); the journal and the result hold only masked text.
    const kept = (await readdir(snapshots, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
    const texts = await Promise.all(kept.map((entry) => readFile(path.join(entry.parentPath, entry.name), "utf8")));
    assert.ok(texts.some((text) => text.includes(`key=${FAKE_SECRET}`)));
    assert.equal((await recordedText(path.join(base, "work"))).includes(FAKE_SECRET), false);
  });

  test("revert restores the original bytes and deletes the created file", async () => {
    const { base, runId, original } = await changedWorkspace();
    const outcome = await runRevert(revertIo(base, runId));
    assert.equal(outcome.exitCode, 0);
    assert.deepEqual(outcome.output, {
      schemaVersion: 1,
      kind: "revert",
      runId,
      status: "complete",
      exitCode: 0,
      reverted: [
        { path: "a.txt", action: "restored" },
        { path: "new.txt", action: "deleted" },
      ],
      skipped: [],
    });
    assert.deepEqual(await readFile(path.join(base, "work", "a.txt")), original);
    assert.equal(existsSync(path.join(base, "work", "new.txt")), false);
    assert.equal(JSON.stringify(outcome).includes(FAKE_SECRET), false);
    assert.equal(existsSync(path.join(base, "work", ".codaryn", "lock.json")), false);
  });

  test("a file changed after the run is kept and reported; the rest is reverted (exit 3)", async () => {
    const { base, runId } = await changedWorkspace();
    await writeFile(path.join(base, "work", "a.txt"), "the user's later edit\n", "utf8");
    const outcome = await runRevert(revertIo(base, runId));
    assert.equal(outcome.exitCode, 3);
    assert.equal(outcome.output.kind === "revert" ? outcome.output.status : "", "partial");
    assert.deepEqual(outcome.output.kind === "revert" ? outcome.output.skipped : [], [{ path: "a.txt", reason: "changed_since_run" }]);
    assert.equal(await readFile(path.join(base, "work", "a.txt"), "utf8"), "the user's later edit\n");
    assert.equal(existsSync(path.join(base, "work", "new.txt")), false);
  });

  test("an unknown run id is run_not_found and creates nothing", async () => {
    const { base } = await changedWorkspace();
    const outcome = await runRevert(revertIo(base, "20261112T000000Z-00000000"));
    assert.equal(outcome.output.kind === "error" ? outcome.output.code : "", "run_not_found");
    assert.equal(outcome.exitCode, 2);
  });
});

describe("S-1 files that shape a run must lie outside the workspace", () => {
  async function layout(): Promise<string> {
    const base = await mkdtemp(path.join(tmpdir(), "codaryn-unit-s1-"));
    temporaryDirs.push(base);
    await mkdir(path.join(base, "work"));
    const script = JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] });
    await writeFile(path.join(base, "script.json"), script, "utf8");
    await writeFile(path.join(base, "work", "script.json"), script, "utf8");
    await writeFile(path.join(base, "task.json"), task(), "utf8");
    await writeFile(path.join(base, "work", "task.json"), task({ workspaceRoot: ".", model: { provider: "scripted", scriptPath: "../script.json" } }), "utf8");
    await writeFile(path.join(base, "work", "c.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");
    await writeFile(path.join(base, "work", "x.env"), "", "utf8");
    return base;
  }

  test("a task, script, config or env file inside the workspace is rejected before the run", async () => {
    const base = await layout();
    const cases: [string[], Partial<CliEnvironment>, string][] = [
      [["run", "--task", "work/task.json"], {}, "invalid_task"],
      [["run", "--task", "task.json"], {}, "ok"],
      [["run", "--task", "task.json", "--config", "work/c.json"], {}, "invalid_config"],
      [["run", "--task", "task.json", "--vars-file", "work/x.env"], { loadEnvFile: () => {} }, "invalid_config"],
    ];
    for (const [argv, extra, expected] of cases) {
      const outcome = await runCli(realIo(base, argv, extra));
      if (expected === "ok") {
        assert.equal(outcome.output.kind, "run", argv.join(" "));
      } else {
        assert.equal(code(outcome), expected, argv.join(" "));
        assert.ok(outcome.output.kind === "error" && outcome.output.message.includes("inside the workspace"));
      }
    }
    await writeFile(path.join(base, "task.json"), task({ model: { provider: "scripted", scriptPath: "./work/script.json" } }), "utf8");
    assert.equal(code(await runCli(realIo(base, ["run", "--task", "task.json"]))), "invalid_script");
  });

  test("a location that cannot be confirmed is rejected like inside", async () => {
    const base = await layout();
    const outcome = await runCli(realIo(base, ["run", "--task", "task.json"], { locateInWorkspace: async () => "unknown" }));
    assert.equal(code(outcome), "invalid_task");
  });
});

describe("S-5 network and device paths are rejected before any file access", () => {
  const BASE = path.resolve("/tmp/codaryn-unit-s5");
  const windows = process.platform === "win32";
  const UNC = windows ? "\\\\attacker.invalid\\share\\file.json" : "/dev/tcp/attacker.invalid/80";
  const DEVICE = windows ? "\\\\.\\pipe\\codaryn" : "/dev/stdin";

  function fake(argv: readonly string[], files: Record<string, string> = {}, env: Record<string, string> = {}) {
    const touched: string[] = [];
    const io: CliEnvironment = {
      argv,
      env,
      cwd: BASE,
      readFile: async (file) => {
        touched.push(file);
        const value = files[path.relative(BASE, file).split(path.sep).join("/")];
        if (value === undefined) throw new Error("missing");
        return value;
      },
      isDirectory: async (dir) => {
        touched.push(dir);
        return dir === path.join(BASE, "work");
      },
      loadEnvFile: (file) => {
        touched.push(file);
      },
      locateInWorkspace: lexicalLocate,
      clock: { now: () => 0 },
      randomBytes: (size) => new Uint8Array(size),
      assemble: async () => ({ ok: false, code: "internal_error", message: "not reached" }),
      cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    };
    return { io, touched };
  }

  test("command line paths and CODARYN_CONFIG", async () => {
    const cases: [readonly string[], Record<string, string>, string][] = [
      [["run", "--task", UNC], {}, "invalid_task"],
      [["run", "--task", DEVICE], {}, "invalid_task"],
      [["run", "--workspace", UNC, "--goal", "g"], {}, "invalid_arguments"],
      [["run", "--task", "t.json", "--config", UNC], {}, "invalid_config"],
      [["run", "--task", "t.json", "--vars-file", UNC], {}, "invalid_config"],
      [["run", "--task", "t.json", "--cancel-file", DEVICE], {}, "invalid_arguments"],
      [["run", "--task", "t.json"], { CODARYN_CONFIG: UNC }, "invalid_config"],
    ];
    for (const [argv, env, expected] of cases) {
      const { io, touched } = fake(argv, {}, env);
      const outcome = await runCli(io);
      assert.equal(code(outcome), expected, argv.join(" "));
      assert.ok(outcome.output.kind === "error" && outcome.output.message.includes("network or device path"));
      assert.equal(touched.some((file) => file.includes("attacker") || file.includes("pipe") || file.startsWith("/dev")), false);
    }
  });

  test("workspaceRoot and scriptPath in a task file", async () => {
    const base = JSON.parse(task()) as Record<string, unknown>;
    for (const overrides of [{ workspaceRoot: UNC }, { model: { provider: "scripted", scriptPath: DEVICE } }]) {
      const { io, touched } = fake(["run", "--task", "t.json"], { "t.json": JSON.stringify({ ...base, ...overrides }) });
      const outcome = await runCli(io);
      assert.equal(code(outcome), "invalid_task", JSON.stringify(overrides));
      assert.deepEqual(touched, [path.join(BASE, "t.json")], "only the task file was read");
    }
  });
});
