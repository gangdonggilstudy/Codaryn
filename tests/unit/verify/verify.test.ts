import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";

import { asRawText } from "../../../src/contracts/index.js";
import type {
  ReadTextOutcome,
  ResolvedPath,
  ResolvePathOutcome,
  RunCommandPayload,
  VerifierConfig,
  Workspace,
} from "../../../src/contracts/index.js";
import { createRawVerifierResult, createVerifierRunner } from "../../../src/verify/index.js";
import type {
  CommandRunner,
  CommandRunRequest,
  CommandSpawnFailure,
  RawVerifierResultInput,
} from "../../../src/verify/index.js";

/** Contract stand-in for the workspace module (PM decision P-5). Reads real files under `root`. */
function workspaceDouble(root: string, unreadable: readonly string[] = []): Workspace {
  return {
    root,
    async resolve(path: string): Promise<ResolvePathOutcome> {
      const absolute = resolve(root, path);
      const rel = relative(root, absolute);
      if (rel.startsWith("..") || isAbsolute(rel)) return { ok: false, code: "outside_root" };
      const normalized = rel === "" ? "." : rel.split(sep).join("/");
      if (normalized === ".codaryn" || normalized.startsWith(".codaryn/")) {
        return { ok: false, code: "state_dir" };
      }
      return { ok: true, path: { absolute, relative: normalized } as unknown as ResolvedPath };
    },
    async readText(path: ResolvedPath): Promise<ReadTextOutcome> {
      if (unreadable.includes(path.relative)) return { ok: false, code: "io_error" };
      try {
        const bytes = await readFile(path.absolute);
        return {
          ok: true,
          snapshot: {
            path,
            hash: createHash("sha256").update(bytes).digest("hex"),
            text: asRawText(bytes.toString("utf8")),
          },
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return { ok: false, code: code === "ENOENT" ? "not_found" : "io_error" };
      }
    },
    async list() {
      return { ok: false, code: "io_error" };
    },
    async writeText() {
      return { ok: false, code: "io_error" };
    },
  };
}

interface FakeRunner extends CommandRunner {
  readonly requests: CommandRunRequest[];
}

function fakeCommandRunner(reply: RunCommandPayload | CommandSpawnFailure | Error): FakeRunner {
  const requests: CommandRunRequest[] = [];
  return {
    requests,
    async run(request) {
      requests.push(request);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

function exited(exitCode: number | null, extra: Partial<RunCommandPayload> = {}): RunCommandPayload {
  return { exitCode, stdout: "", stderr: "", timedOut: false, truncated: false, ...extra };
}

const neverRun = fakeCommandRunner(new Error("the command runner must not be used here"));

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-verify-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function live(): AbortSignal {
  return new AbortController().signal;
}

const DOC = "# Guide\n\n## 설치\n\nSee [usage](docs/usage.md).\n";

test("VF-01 document rules pass in a directory without Git", async () => {
  await withTempDir(async (root) => {
    await writeFile(join(root, "README.md"), DOC, "utf8");
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "usage.md"), "# Usage\n", "utf8");
    const runner = createVerifierRunner({ workspace: workspaceDouble(root), commandRunner: neverRun });

    const result = await runner.run(
      {
        id: "doc",
        kind: "file_rules",
        rules: [
          { type: "contains", path: "README.md", text: "## 설치" },
          { type: "exists", path: "docs/usage.md" },
          { type: "exists", path: "docs" },
          { type: "absent", path: "DRAFT.md" },
          { type: "not_contains", path: "README.md", text: "TODO" },
        ],
      },
      live(),
    );

    assert.equal(result.id, "doc");
    assert.equal(result.kind, "file_rules");
    assert.equal(result.outcome, "pass");
    assert.equal(result.checked.length, 5);
    assert.ok(Array.isArray(result.limits));
    assert.equal(neverRun.requests.length, 0);
  });
});

test("VF-01 each rule type fails when it does not hold", async () => {
  await withTempDir(async (root) => {
    await writeFile(join(root, "README.md"), DOC, "utf8");
    const runner = createVerifierRunner({ workspace: workspaceDouble(root), commandRunner: neverRun });
    const failing: readonly VerifierConfig[] = [
      { id: "a", kind: "file_rules", rules: [{ type: "contains", path: "README.md", text: "## 사용법" }] },
      { id: "b", kind: "file_rules", rules: [{ type: "exists", path: "docs/usage.md" }] },
      { id: "c", kind: "file_rules", rules: [{ type: "absent", path: "README.md" }] },
      { id: "d", kind: "file_rules", rules: [{ type: "not_contains", path: "README.md", text: "## 설치" }] },
      { id: "e", kind: "file_rules", rules: [{ type: "contains", path: "MISSING.md", text: "x" }] },
    ];
    for (const config of failing) {
      const result = await runner.run(config, live());
      assert.equal(result.outcome, "fail", `verifier ${config.id}`);
      assert.ok(result.checked.length >= 1);
    }

    const mixed = await runner.run(
      {
        id: "mixed",
        kind: "file_rules",
        rules: [
          { type: "exists", path: "README.md" },
          { type: "contains", path: "README.md", text: "## 사용법" },
        ],
      },
      live(),
    );
    assert.equal(mixed.outcome, "fail");
    assert.equal(mixed.checked.length, 2);
  });
});

test("file_rules is inconclusive when a file cannot be read or a path is rejected", async () => {
  await withTempDir(async (root) => {
    await writeFile(join(root, "README.md"), DOC, "utf8");
    await writeFile(join(root, "locked.md"), "secret-free text\n", "utf8");
    const runner = createVerifierRunner({
      workspace: workspaceDouble(root, ["locked.md"]),
      commandRunner: neverRun,
    });
    const cases: readonly VerifierConfig[] = [
      { id: "unreadable", kind: "file_rules", rules: [{ type: "contains", path: "locked.md", text: "text" }] },
      { id: "unreadable-not", kind: "file_rules", rules: [{ type: "not_contains", path: "locked.md", text: "zzz" }] },
      { id: "missing-not", kind: "file_rules", rules: [{ type: "not_contains", path: "MISSING.md", text: "x" }] },
      { id: "outside", kind: "file_rules", rules: [{ type: "absent", path: "../elsewhere.md" }] },
      { id: "state", kind: "file_rules", rules: [{ type: "exists", path: ".codaryn/lock.json" }] },
      { id: "empty", kind: "file_rules", rules: [] },
    ];
    for (const config of cases) {
      const result = await runner.run(config, live());
      assert.equal(result.outcome, "inconclusive", `verifier ${config.id}`);
      assert.ok(result.checked.length >= 1, `verifier ${config.id}`);
      assert.ok(Array.isArray(result.limits));
    }

    // A rule that does not hold decides the result even when another rule is undecided.
    const failAndUndecided = await runner.run(
      {
        id: "both",
        kind: "file_rules",
        rules: [
          { type: "contains", path: "locked.md", text: "text" },
          { type: "absent", path: "README.md" },
        ],
      },
      live(),
    );
    assert.equal(failAndUndecided.outcome, "fail");
  });
});

test("file_rules evidence does not copy file content", async () => {
  await withTempDir(async (root) => {
    await writeFile(join(root, "notes.md"), "marker-line\nPRIVATE-BODY-LINE\n", "utf8");
    const runner = createVerifierRunner({ workspace: workspaceDouble(root), commandRunner: neverRun });
    const result = await runner.run(
      { id: "n", kind: "file_rules", rules: [{ type: "contains", path: "notes.md", text: "marker-line" }] },
      live(),
    );
    assert.equal(result.outcome, "pass");
    assert.ok(!result.evidence.includes("PRIVATE-BODY-LINE"));
    assert.ok(!result.checked.join("\n").includes("PRIVATE-BODY-LINE"));
  });
});

test("VF-02 command verifier: exit code 0 passes, non-zero fails, timeout is inconclusive", async () => {
  await withTempDir(async (root) => {
    const workspace = workspaceDouble(root);
    const config: VerifierConfig = { id: "t", kind: "command", executable: "node", args: ["--test"] };

    const zero = fakeCommandRunner(exited(0));
    const pass = await createVerifierRunner({ workspace, commandRunner: zero }).run(config, live());
    assert.equal(pass.outcome, "pass");
    assert.equal(pass.kind, "command");
    assert.ok(pass.checked.length >= 1);
    assert.deepEqual(zero.requests, [
      { executable: "node", args: ["--test"], cwdAbsolute: resolve(root), timeoutMs: 60_000 },
    ]);

    const nonZero = fakeCommandRunner(exited(1, { stderr: "1 test failed" }));
    const fail = await createVerifierRunner({ workspace, commandRunner: nonZero }).run(config, live());
    assert.equal(fail.outcome, "fail");
    assert.ok(fail.evidence.includes("1 test failed"));

    const timeout = fakeCommandRunner(exited(null, { timedOut: true }));
    const late = await createVerifierRunner({ workspace, commandRunner: timeout }).run(config, live());
    assert.equal(late.outcome, "inconclusive");
    assert.ok(late.checked.length >= 1);
  });
});

test("command verifier: expected exit code, cwd and timeout come from the configuration", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, "pkg"));
    const workspace = workspaceDouble(root);
    const config: VerifierConfig = {
      id: "t",
      kind: "command",
      executable: "tool",
      args: [],
      cwd: "pkg",
      timeoutMs: 1234,
      expectExitCode: 3,
    };

    const three = fakeCommandRunner(exited(3));
    assert.equal((await createVerifierRunner({ workspace, commandRunner: three }).run(config, live())).outcome, "pass");
    assert.deepEqual(three.requests, [
      { executable: "tool", args: [], cwdAbsolute: join(resolve(root), "pkg"), timeoutMs: 1234 },
    ]);

    const zero = fakeCommandRunner(exited(0));
    assert.equal((await createVerifierRunner({ workspace, commandRunner: zero }).run(config, live())).outcome, "fail");
  });
});

test("command verifier is inconclusive when the command cannot be judged", async () => {
  await withTempDir(async (root) => {
    const workspace = workspaceDouble(root);
    const config: VerifierConfig = { id: "t", kind: "command", executable: "node", args: [] };

    const spawnFailed = fakeCommandRunner({ spawnFailed: true, message: "executable not found" });
    assert.equal(
      (await createVerifierRunner({ workspace, commandRunner: spawnFailed }).run(config, live())).outcome,
      "inconclusive",
    );

    const killed = fakeCommandRunner(exited(null));
    assert.equal(
      (await createVerifierRunner({ workspace, commandRunner: killed }).run(config, live())).outcome,
      "inconclusive",
    );

    const throwing = fakeCommandRunner(new Error("runner broke"));
    const thrown = await createVerifierRunner({ workspace, commandRunner: throwing }).run(config, live());
    assert.equal(thrown.outcome, "inconclusive");
    assert.ok(thrown.checked.length >= 1);

    const outside = fakeCommandRunner(exited(0));
    const rejected = await createVerifierRunner({ workspace, commandRunner: outside }).run(
      { ...config, cwd: "../outside" },
      live(),
    );
    assert.equal(rejected.outcome, "inconclusive");
    assert.equal(outside.requests.length, 0);

    const cancelled = new AbortController();
    cancelled.abort();
    const notStarted = fakeCommandRunner(exited(0));
    const aborted = await createVerifierRunner({ workspace, commandRunner: notStarted }).run(
      config,
      cancelled.signal,
    );
    assert.equal(aborted.outcome, "inconclusive");
    assert.equal(notStarted.requests.length, 0);
  });
});

test("VF-03 a result without checked or limits cannot be created", () => {
  const complete: RawVerifierResultInput = {
    id: "v",
    kind: "file_rules",
    outcome: "pass",
    evidence: "held",
    checked: ["README.md exists"],
    limits: [],
  };

  const noLimits = createRawVerifierResult(complete);
  assert.deepEqual(noLimits.limits, []);
  assert.deepEqual(noLimits.checked, ["README.md exists"]);

  const withLimits = createRawVerifierResult({ ...complete, limits: ["links are not followed"] });
  assert.deepEqual(withLimits.limits, ["links are not followed"]);

  const broken = (change: Record<string, unknown>): RawVerifierResultInput => {
    const copy: Record<string, unknown> = { ...complete, ...change };
    for (const key of Object.keys(change)) {
      if (change[key] === undefined) delete copy[key];
    }
    return copy as unknown as RawVerifierResultInput;
  };

  assert.throws(() => createRawVerifierResult(broken({ checked: undefined })), TypeError);
  assert.throws(() => createRawVerifierResult(broken({ checked: [] })), TypeError);
  assert.throws(() => createRawVerifierResult(broken({ checked: ["  "] })), TypeError);
  assert.throws(() => createRawVerifierResult(broken({ checked: "README.md exists" })), TypeError);
  assert.throws(() => createRawVerifierResult(broken({ limits: undefined })), TypeError);
  assert.throws(() => createRawVerifierResult(broken({ limits: null })), TypeError);
  assert.throws(() => createRawVerifierResult(broken({ limits: [1] })), TypeError);
  assert.throws(() => createRawVerifierResult(broken({ outcome: "ok" })), TypeError);
});
