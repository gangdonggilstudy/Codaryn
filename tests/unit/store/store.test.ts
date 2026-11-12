import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type {
  Clock,
  EngineResult,
  Journal,
  JournalEvent,
  MaskedText,
} from "../../../src/contracts/index.js";
import {
  acquireLock,
  createJournal,
  journalRelativePath,
  releaseLock,
  writeResult,
} from "../../../src/store/index.js";

/** Stand-in for `PrivacyGateway.mask` (PM decision P-5). The store itself never produces MaskedText. */
function masked(text: string): MaskedText {
  return text as MaskedText;
}

const START = Date.UTC(2026, 10, 12, 3, 4, 5);

function steppingClock(): Clock {
  let now = START;
  return {
    now() {
      const value = now;
      now += 1000;
      return value;
    },
  };
}

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "codaryn-store-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const RUN_ID = "20261112T030405Z-0a1b2c3d";

const STARTED: JournalEvent = {
  type: "run_started",
  schemaVersion: 1,
  taskId: "doc-example",
  workflow: masked("document"),
  provider: "scripted",
  limits: { maxModelTurns: 8, maxToolCalls: 16, maxTotalTokens: null, maxDurationMs: 60_000 },
};

const MODEL_ERROR: JournalEvent = {
  type: "model_error",
  turn: 1,
  kind: "script_exhausted",
  message: masked("line one\nline two [[CODARYN_SECRET:0123456789abcdef]]"),
};

const FINISHED: JournalEvent = {
  type: "run_finished",
  status: "failed",
  reason: "model_error",
  usage: { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 2000 },
};

function journalFile(root: string, runId: string): string {
  return join(root, ".codaryn", "runs", runId, "journal.jsonl");
}

test("journal writes one JSON record per LF line with seq, at and runId", async () => {
  await withTempDir(async (root) => {
    const journal = createJournal({ workspaceRoot: root, runId: RUN_ID, clock: steppingClock() });
    await journal.append(STARTED);
    await journal.append(MODEL_ERROR);
    await journal.close();

    const text = await readFile(journalFile(root, RUN_ID), "utf8");
    assert.ok(text.endsWith("\n"));
    assert.ok(!text.includes("\r"));
    const lines = text.split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[2], "");

    assert.deepEqual(JSON.parse(lines[0] ?? ""), {
      seq: 1,
      at: "2026-11-12T03:04:05.000Z",
      runId: RUN_ID,
      ...STARTED,
    });
    assert.deepEqual(JSON.parse(lines[1] ?? ""), {
      seq: 2,
      at: "2026-11-12T03:04:06.000Z",
      runId: RUN_ID,
      ...MODEL_ERROR,
    });
    assert.equal(journalRelativePath(RUN_ID), `.codaryn/runs/${RUN_ID}/journal.jsonl`);
  });
});

test("journal is append-only: earlier bytes never change and seq grows by one", async () => {
  await withTempDir(async (root) => {
    const file = journalFile(root, RUN_ID);
    const clock = steppingClock();
    const journal = createJournal({ workspaceRoot: root, runId: RUN_ID, clock });

    await journal.append(STARTED);
    const afterOne = await readFile(file);
    await journal.append(MODEL_ERROR);
    const afterTwo = await readFile(file);
    assert.ok(afterTwo.length > afterOne.length);
    assert.ok(afterTwo.subarray(0, afterOne.length).equals(afterOne));
    await journal.close();

    // A journal opened again for the same run continues the file instead of replacing it.
    const reopened = createJournal({ workspaceRoot: root, runId: RUN_ID, clock });
    await reopened.append(FINISHED);
    await reopened.close();
    const afterThree = await readFile(file);
    assert.ok(afterThree.subarray(0, afterTwo.length).equals(afterTwo));

    const records = afterThree
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { seq: number; type: string });
    assert.deepEqual(
      records.map((record) => record.seq),
      [1, 2, 3],
    );
    assert.deepEqual(
      records.map((record) => record.type),
      ["run_started", "model_error", "run_finished"],
    );
  });
});

test("journal keeps call order and whole lines for appends that are not awaited one by one", async () => {
  await withTempDir(async (root) => {
    const journal = createJournal({ workspaceRoot: root, runId: RUN_ID, clock: steppingClock() });
    const pending: Promise<void>[] = [];
    for (let turn = 1; turn <= 25; turn += 1) {
      pending.push(journal.append({ type: "model_error", turn, kind: "k", message: masked(`m${turn}`) }));
    }
    await Promise.all(pending);
    await journal.close();

    const lines = (await readFile(journalFile(root, RUN_ID), "utf8")).trimEnd().split("\n");
    assert.equal(lines.length, 25);
    lines.forEach((line, index) => {
      const record = JSON.parse(line) as { seq: number; turn: number };
      assert.equal(record.seq, index + 1);
      assert.equal(record.turn, index + 1);
    });
  });
});

test("journal rejects appends after close and unsafe run ids", async () => {
  await withTempDir(async (root) => {
    const journal = createJournal({ workspaceRoot: root, runId: RUN_ID, clock: steppingClock() });
    await journal.append(STARTED);
    await journal.close();
    await assert.rejects(journal.append(FINISHED));
    assert.equal((await readFile(journalFile(root, RUN_ID), "utf8")).trimEnd().split("\n").length, 1);

    for (const runId of ["../escape", "a/b", "a\\b", "..", ""]) {
      assert.throws(
        () => createJournal({ workspaceRoot: root, runId, clock: steppingClock() }),
        TypeError,
        `runId ${JSON.stringify(runId)}`,
      );
    }
  });
});

test("journal refuses to continue a file that ends with an incomplete line", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, ".codaryn", "runs", RUN_ID), { recursive: true });
    const torn = '{"seq":1,"at":"2026-11-12T03:04:05.000Z"';
    await writeFile(journalFile(root, RUN_ID), torn, "utf8");
    const journal = createJournal({ workspaceRoot: root, runId: RUN_ID, clock: steppingClock() });
    await assert.rejects(journal.append(STARTED));
    await journal.close();
    assert.equal(await readFile(journalFile(root, RUN_ID), "utf8"), torn);
  });
});

/** Compile-time check: recording functions do not accept raw strings. Never called. */
export async function rawTextIsRejectedByTheCompiler(journal: Journal, root: string): Promise<void> {
  const raw: string = "unmasked text";
  // @ts-expect-error a plain string is not MaskedText
  await journal.append({ type: "model_error", turn: 1, kind: "k", message: raw });
  // @ts-expect-error a journal line cannot be supplied as text
  await journal.append(raw);
  // @ts-expect-error result.json cannot be supplied as text
  await writeResult(root, raw);
}

test("writeResult stores the result object as result.json next to the journal", async () => {
  await withTempDir(async (root) => {
    const result: EngineResult = {
      schemaVersion: 1,
      kind: "run",
      runId: RUN_ID,
      taskId: "doc-example",
      status: "done",
      reason: "verified",
      exitCode: 0,
      provider: "scripted",
      verifiers: [
        {
          id: "doc",
          kind: "file_rules",
          outcome: "pass",
          evidence: masked("held: \"README.md\" exists (present)"),
          checked: [masked("\"README.md\" exists")],
          limits: [],
        },
      ],
      changes: [
        { path: masked("README.md"), previousHash: null, newHash: "a".repeat(64), created: true },
      ],
      usage: { modelTurns: 2, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 1500 },
      journalPath: journalRelativePath(RUN_ID),
      notices: [masked("설치 절을 추가했다")],
    };

    await writeResult(root, result);

    const dir = join(root, ".codaryn", "runs", RUN_ID);
    const text = await readFile(join(dir, "result.json"), "utf8");
    assert.deepEqual(JSON.parse(text), result);
    assert.equal(text, `${JSON.stringify(result)}\n`);
    assert.deepEqual(await readdir(dir), ["result.json"]);
  });
});

function lockFile(root: string): string {
  return join(root, ".codaryn", "lock.json");
}

/** Pid of a real process that has already exited. */
function exitedPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(child.status, 0);
  return child.pid;
}

test("lock: acquire writes pid, runId and startedAt; a second run is refused; release frees it", async () => {
  // N-25(b): the lock also records when this process started.
  const PROCESS_STARTED_AT = new Date(performance.timeOrigin).toISOString();
  await withTempDir(async (root) => {
    const first = await acquireLock({ workspaceRoot: root, runId: RUN_ID, clock: steppingClock() });
    assert.deepEqual(first, {
      ok: true,
      lock: { pid: process.pid, runId: RUN_ID, startedAt: "2026-11-12T03:04:05.000Z", processStartedAt: PROCESS_STARTED_AT },
    });
    assert.deepEqual(JSON.parse(await readFile(lockFile(root), "utf8")), {
      pid: process.pid,
      runId: RUN_ID,
      startedAt: "2026-11-12T03:04:05.000Z",
      processStartedAt: PROCESS_STARTED_AT,
    });

    const before = await readFile(lockFile(root));
    const second = await acquireLock({ workspaceRoot: root, runId: "other-run", clock: steppingClock() });
    assert.deepEqual(second, {
      ok: false,
      code: "workspace_locked",
      holder: { pid: process.pid, runId: RUN_ID, startedAt: "2026-11-12T03:04:05.000Z", processStartedAt: PROCESS_STARTED_AT },
    });
    assert.ok((await readFile(lockFile(root))).equals(before));

    // Only the holding run can release it.
    assert.equal(await releaseLock({ workspaceRoot: root, runId: "other-run" }), false);
    assert.ok((await readFile(lockFile(root))).equals(before));

    assert.equal(await releaseLock({ workspaceRoot: root, runId: RUN_ID }), true);
    assert.equal(await releaseLock({ workspaceRoot: root, runId: RUN_ID }), false);
    const third = await acquireLock({ workspaceRoot: root, runId: "other-run", clock: steppingClock() });
    assert.equal(third.ok, true);

    // No temporary files stay behind in the state directory.
    assert.deepEqual((await readdir(join(root, ".codaryn"))).sort(), [".gitignore", "lock.json"]);
  });
});

/** The real liveness check (signal 0), as acquireLock uses it by default. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === "EPERM";
  }
}

test("lock: a lock left by a dead process is reclaimed", async () => {
  // This case keeps the real liveness check. W-4: the system may give the exited process's pid to
  // a new process before the lock is read; then the lock is rightly held, so the case is repeated
  // with a fresh pid. Only a refusal while the pid is still dead fails it.
  let reused = true;
  for (let attempt = 1; reused; attempt += 1) {
    await withTempDir(async (root) => {
      await mkdir(join(root, ".codaryn"), { recursive: true });
      const stale = { pid: exitedPid(), runId: "crashed-run", startedAt: "2026-11-11T00:00:00.000Z" };
      await writeFile(lockFile(root), `${JSON.stringify(stale)}\n`, "utf8");

      const outcome = await acquireLock({ workspaceRoot: root, runId: RUN_ID, clock: steppingClock() });
      reused = !outcome.ok && outcome.holder?.pid === stale.pid && alive(stale.pid) && attempt < 5;
      if (reused) return;
      assert.equal(outcome.ok, true);
      assert.deepEqual(JSON.parse(await readFile(lockFile(root), "utf8")), {
        pid: process.pid,
        runId: RUN_ID,
        startedAt: "2026-11-12T03:04:05.000Z",
        processStartedAt: new Date(performance.timeOrigin).toISOString(),
      });
    });
  }
});

test("lock: an unreadable lock file is not reclaimed", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, ".codaryn"), { recursive: true });
    await writeFile(lockFile(root), "not json", "utf8");
    const outcome = await acquireLock({ workspaceRoot: root, runId: RUN_ID, clock: steppingClock() });
    assert.deepEqual(outcome, { ok: false, code: "workspace_locked", holder: null });
    assert.equal(await readFile(lockFile(root), "utf8"), "not json");
  });
});

test("state directory content is excluded from version control by its own ignore file", async () => {
  await withTempDir(async (root) => {
    const journal = createJournal({ workspaceRoot: root, runId: RUN_ID, clock: steppingClock() });
    await journal.append(STARTED);
    await journal.close();
    assert.equal(await readFile(join(root, ".codaryn", ".gitignore"), "utf8"), "*\n");
  });
});
