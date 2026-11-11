import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ANTHROPIC_API_KEY_ENV,
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_SEARCH_ENTRIES,
  MAX_SEARCH_MATCHES_PER_FILE,
} from "../../../src/contracts/index.js";
import type { RawToolOutcome } from "../../../src/contracts/index.js";
import { buildChildEnv, createToolRunner } from "../../../src/tools/index.js";
import {
  FAKE_SECRET_A,
  FAKE_SECRET_B,
  OK_PAYLOAD,
  createFakeCommandRunner,
  createFakePrivacy,
  createFakeWorkspace,
  sha256,
  utf8,
} from "./doubles.js";

const never = new AbortController().signal;

function assertFailed(outcome: RawToolOutcome, code: string): void {
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.code, code);
}

function payloadOf(outcome: RawToolOutcome): unknown {
  assert.equal(outcome.ok, true);
  return outcome.ok ? outcome.payload : undefined;
}

// ---- read_file ----

test("read_file removes the BOM from content, reports hadBom and hashes the file bytes", async () => {
  const bytes = utf8("\uFEFF한글 내용\r\n");
  const workspace = createFakeWorkspace({ "문서.txt": bytes, "plain.txt": "abc" });
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });

  const withBom = await tools.execute({ id: "1", name: "read_file", args: { path: "문서.txt" } }, never);
  assert.deepEqual(payloadOf(withBom), {
    path: "문서.txt",
    content: "한글 내용\r\n",
    hash: sha256(bytes),
    hadBom: true,
  });

  const plain = await tools.execute({ id: "2", name: "read_file", args: { path: "plain.txt" } }, never);
  assert.deepEqual(payloadOf(plain), {
    path: "plain.txt",
    content: "abc",
    hash: sha256(utf8("abc")),
    hadBom: false,
  });
});

test("read_file returns workspace failures as outcomes and never reads a rejected path", async () => {
  const workspace = createFakeWorkspace({ "bin.dat": Buffer.from([1, 0, 2]) });
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });

  assertFailed(await tools.execute({ id: "1", name: "read_file", args: { path: "none.txt" } }, never), "not_found");
  assertFailed(await tools.execute({ id: "2", name: "read_file", args: { path: "bin.dat" } }, never), "not_text");
  const reads = workspace.readCalls.length;
  assertFailed(await tools.execute({ id: "3", name: "read_file", args: { path: "../x" } }, never), "policy_denied");
  assert.equal(workspace.readCalls.length, reads);
});

test("a workspace that throws becomes io_error instead of a rejection", async () => {
  const workspace = createFakeWorkspace({ "a.txt": "a" });
  workspace.readText = async () => {
    throw new Error("disk exploded");
  };
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });
  assertFailed(await tools.execute({ id: "1", name: "read_file", args: { path: "a.txt" } }, never), "io_error");
});

// ---- search_files ----

test("search_files filters by nameContains and keeps path order", async () => {
  const workspace = createFakeWorkspace({ "src/b.ts": "", "src/a.ts": "", "docs/a.md": "" });
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });
  const outcome = await tools.execute(
    { id: "1", name: "search_files", args: { path: ".", nameContains: "src/" } },
    never,
  );
  assert.deepEqual(payloadOf(outcome), {
    entries: [
      { path: "src/a.ts", kind: "file" },
      { path: "src/b.ts", kind: "file" },
    ],
    truncated: false,
  });
});

test("search_files with text reports matching lines of files only, with 1-based line numbers", async () => {
  const workspace = createFakeWorkspace({
    "a.txt": "\uFEFFneedle 첫 줄\r\nnothing\r\nsecond needle\r\n",
    "b.txt": "nothing here\n",
    "bin.dat": Buffer.from([110, 0, 101]),
    "needle-dir/c.txt": "x\n",
  });
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });
  const outcome = await tools.execute(
    { id: "1", name: "search_files", args: { path: ".", text: "needle" } },
    never,
  );
  assert.deepEqual(payloadOf(outcome), {
    entries: [
      {
        path: "a.txt",
        kind: "file",
        matches: [
          { line: 1, text: "needle 첫 줄" },
          { line: 3, text: "second needle" },
        ],
      },
    ],
    truncated: false,
  });
});

test("search_files caps matches per file and entries, and marks truncated", async () => {
  const many: Record<string, string> = {};
  for (let i = 0; i < MAX_SEARCH_ENTRIES + 5; i += 1) many[`f${String(i).padStart(4, "0")}.txt`] = "";
  const tools = createToolRunner({ workspace: createFakeWorkspace(many), privacy: createFakePrivacy() });
  const byEntries = payloadOf(
    await tools.execute({ id: "1", name: "search_files", args: { path: "." } }, never),
  ) as { entries: unknown[]; truncated: boolean };
  assert.equal(byEntries.entries.length, MAX_SEARCH_ENTRIES);
  assert.equal(byEntries.truncated, true);

  const lines = "hit\n".repeat(MAX_SEARCH_MATCHES_PER_FILE + 1);
  const tools2 = createToolRunner({
    workspace: createFakeWorkspace({ "a.txt": lines }),
    privacy: createFakePrivacy(),
  });
  const byMatches = payloadOf(
    await tools2.execute({ id: "2", name: "search_files", args: { path: ".", text: "hit" } }, never),
  ) as { entries: { matches: unknown[] }[]; truncated: boolean };
  assert.equal(byMatches.entries[0]?.matches.length, MAX_SEARCH_MATCHES_PER_FILE);
  assert.equal(byMatches.truncated, true);
});

test("search_files passes on the workspace's truncated flag", async () => {
  const workspace = createFakeWorkspace({ "a.txt": "" });
  workspace.listTruncated = true;
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy() });
  const payload = payloadOf(
    await tools.execute({ id: "1", name: "search_files", args: { path: "." } }, never),
  ) as { truncated: boolean };
  assert.equal(payload.truncated, true);
});

// ---- run_command (fake runner; real process behavior belongs to integration tests) ----

test("run_command resolves cwd through the workspace and applies the default timeout", async () => {
  const workspace = createFakeWorkspace();
  const runner = createFakeCommandRunner(async () => OK_PAYLOAD);
  const tools = createToolRunner({ workspace, privacy: createFakePrivacy(), commandRunner: runner });

  const first = await tools.execute(
    { id: "1", name: "run_command", args: { executable: "node", args: ["--test"] } },
    never,
  );
  const second = await tools.execute(
    { id: "2", name: "run_command", args: { executable: "node", args: [], cwd: "sub", timeoutMs: 1234 } },
    never,
  );
  assert.deepEqual(payloadOf(first), OK_PAYLOAD);
  assert.deepEqual(payloadOf(second), OK_PAYLOAD);
  assert.deepEqual(runner.requests, [
    { executable: "node", args: ["--test"], cwdAbsolute: workspace.root, timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS },
    { executable: "node", args: [], cwdAbsolute: `${workspace.root}/sub`, timeoutMs: 1234 },
  ]);
  assert.deepEqual(workspace.resolveCalls, [
    { path: ".", access: "cwd" },
    { path: "sub", access: "cwd" },
  ]);
});

test("run_command passes a timed-out, truncated payload's status through and drops its cut end (V-2)", async () => {
  // The output was cut at an arbitrary byte: its last COMMAND_CAPTURE_SLACK_BYTES are not trusted,
  // so 7 bytes of cut output are dropped whole. Exit code, timeout and the cut mark pass through.
  const timedOut = { exitCode: null, stdout: "partial", stderr: "", timedOut: true, truncated: true };
  const tools = createToolRunner({
    workspace: createFakeWorkspace(),
    privacy: createFakePrivacy(),
    commandRunner: createFakeCommandRunner(async () => timedOut),
  });
  const outcome = await tools.execute(
    { id: "1", name: "run_command", args: { executable: "node", args: [] } },
    never,
  );
  assert.deepEqual(payloadOf(outcome), { ...timedOut, stdout: "" });
});

test("run_command does not start a process for a rejected cwd or an aborted signal", async () => {
  const runner = createFakeCommandRunner(async () => OK_PAYLOAD);
  const tools = createToolRunner({
    workspace: createFakeWorkspace(),
    privacy: createFakePrivacy(),
    commandRunner: runner,
  });
  for (const cwd of ["..", ".codaryn"]) {
    assertFailed(
      await tools.execute({ id: "1", name: "run_command", args: { executable: "node", args: [], cwd } }, never),
      "policy_denied",
    );
  }
  const aborted = new AbortController();
  aborted.abort();
  assertFailed(
    await tools.execute({ id: "2", name: "run_command", args: { executable: "node", args: [] } }, aborted.signal),
    "cancelled",
  );
  assert.equal(runner.requests.length, 0);
});

test("run_command reports spawn failure, cancellation during the run, and a throwing runner", async () => {
  const make = (runner: ReturnType<typeof createFakeCommandRunner>) =>
    createToolRunner({ workspace: createFakeWorkspace(), privacy: createFakePrivacy(), commandRunner: runner });
  const call = { id: "1", name: "run_command", args: { executable: "node", args: [] } } as const;

  const spawnFailed = await make(
    createFakeCommandRunner(async () => ({ spawnFailed: true, message: "could not start process (ENOENT)" })),
  ).execute(call, never);
  assertFailed(spawnFailed, "spawn_failed");

  const controller = new AbortController();
  let sawSignal: AbortSignal | undefined;
  const cancelled = await make(
    createFakeCommandRunner(async (_request, signal) => {
      sawSignal = signal;
      controller.abort();
      return { exitCode: null, stdout: "", stderr: "", timedOut: false, truncated: false };
    }),
  ).execute(call, controller.signal);
  assertFailed(cancelled, "cancelled");
  assert.equal(sawSignal, controller.signal);

  const threw = await make(
    createFakeCommandRunner(async () => {
      throw new Error("boom");
    }),
  ).execute(call, never);
  assertFailed(threw, "io_error");
});

// ---- child environment (pure function of the real runner) ----

test("buildChildEnv passes only allow-listed variables", () => {
  const parent = {
    Path: "C:\\bin",
    SystemRoot: "C:\\Windows",
    TEMP: "C:\\tmp",
    CODARYN_TEST_SECRET: FAKE_SECRET_A,
    [ANTHROPIC_API_KEY_ENV]: FAKE_SECRET_B,
    NODE_OPTIONS: "--inspect",
    UNSET: undefined,
  };
  assert.deepEqual(buildChildEnv(parent, "win32"), {
    Path: "C:\\bin",
    SystemRoot: "C:\\Windows",
    TEMP: "C:\\tmp",
  });
  // POSIX names are case-sensitive: only exact allow-list names pass.
  assert.deepEqual(buildChildEnv({ PATH: "/bin", Path: "x", HOME: "/h", SECRET: "s" }, "linux"), {
    PATH: "/bin",
    HOME: "/h",
  });
});
