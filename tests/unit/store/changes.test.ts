/**
 * WS-06 and R-6/R-7: change snapshots and revert, on real files in a temporary directory.
 * A run is simulated the way write_file does it: read, keep the original, write, record file_changed.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";

import { JOURNAL_FILE_NAME, RUNS_DIR_NAME, SNAPSHOTS_DIR_NAME, STATE_DIR_NAME } from "../../../src/contracts/index.js";
import type {
  ChangeRecorder,
  Clock,
  Journal,
  MaskedText,
  RawText,
  RevertOutcome,
  Workspace,
} from "../../../src/contracts/index.js";
import {
  RevertRunError,
  createChangeRecorder,
  createJournal,
  revertRun,
  snapshotsRelativePath,
} from "../../../src/store/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const RUN_ID = "20261112T050607Z-0f1e2d3c";
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const CANARY = "fake-original-CANARY-7731";
const clock: Clock = { now: () => Date.UTC(2026, 10, 12, 5, 6, 7) };

/** Stand-ins for the privacy gateway and file reads (PM decision P-5). */
const masked = (text: string): MaskedText => text as MaskedText;
const raw = (text: string): RawText => text as RawText;
const sha = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-revert-")));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function put(root: string, relative: string, bytes: Buffer | string): Promise<void> {
  const file = join(root, relative);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

const bytesOf = (root: string, relative: string): Promise<Buffer> => readFile(join(root, relative));
const runPath = (root: string, ...rest: string[]): string => join(root, STATE_DIR_NAME, RUNS_DIR_NAME, RUN_ID, ...rest);

interface FakeRun {
  readonly workspace: Workspace;
  readonly recorder: ChangeRecorder;
  readonly journal: Journal;
  calls: number;
}

async function startRun(root: string): Promise<FakeRun> {
  return {
    workspace: await createWorkspace({ root }),
    recorder: createChangeRecorder({ workspaceRoot: root, runId: RUN_ID }),
    journal: createJournal({ workspaceRoot: root, runId: RUN_ID, clock }),
    calls: 0,
  };
}

/** One write_file call: read, keep the original, write, record. */
async function change(run: FakeRun, relative: string, next: string): Promise<void> {
  const resolved = await run.workspace.resolve(relative, "write");
  assert.ok(resolved.ok);
  const read = await run.workspace.readText(resolved.path);
  if (!read.ok) assert.equal(read.code, "not_found");
  const before = read.ok ? read.snapshot : null;
  await run.recorder.saveOriginal(resolved.path, before === null ? null : before.text);
  const written = await run.workspace.writeText({
    path: resolved.path,
    expectedHash: before === null ? null : before.hash,
    text: raw(next),
  });
  assert.ok(written.ok);
  run.calls += 1;
  await run.journal.append({
    type: "file_changed",
    callId: `call-${run.calls}`,
    path: masked(resolved.path.relative),
    previousHash: written.previousHash,
    newHash: written.newHash,
    created: written.created,
  });
}

async function readIndex(root: string): Promise<{ schemaVersion: number; entries: { path: string; existed: boolean; file?: string }[] }> {
  return JSON.parse(await readFile(runPath(root, SNAPSHOTS_DIR_NAME, "index.json"), "utf8"));
}

async function revertKeepingJournal(root: string): Promise<RevertOutcome> {
  const before = await readFile(runPath(root, JOURNAL_FILE_NAME));
  const outcome = await revertRun({ workspaceRoot: root, runId: RUN_ID });
  assert.deepEqual(await readFile(runPath(root, JOURNAL_FILE_NAME)), before, "revert must not write to the journal");
  return outcome;
}

describe("revertRun (WS-06)", () => {
  test("restores the original bytes: CRLF, BOM, Korean text and a Korean path", async () => {
    await withRoot(async (root) => {
      const originals: Record<string, Buffer> = {
        "crlf.txt": Buffer.from("line one\r\nline two\r\n", "utf8"),
        "bom.md": Buffer.concat([BOM, Buffer.from("# 제목\r\n본문 내용\n", "utf8")]),
        "문서/메모.txt": Buffer.from(`한글 메모 ${CANARY}\r\n`, "utf8"),
      };
      for (const [relative, bytes] of Object.entries(originals)) await put(root, relative, bytes);

      const run = await startRun(root);
      await change(run, "crlf.txt", "line one\r\nchanged\r\n");
      await change(run, "bom.md", "﻿# 제목\r\n바뀐 본문\n");
      await change(run, "문서/메모.txt", "다른 내용\n");
      await run.journal.close();

      const outcome = await revertKeepingJournal(root);
      assert.deepEqual(outcome, {
        reverted: [
          { path: "crlf.txt", action: "restored" },
          { path: "bom.md", action: "restored" },
          { path: "문서/메모.txt", action: "restored" },
        ],
        skipped: [],
      });
      for (const [relative, bytes] of Object.entries(originals)) assert.deepEqual(await bytesOf(root, relative), bytes, relative);

      // A second revert finds the originals, not the run's results, and leaves them alone.
      const again = await revertRun({ workspaceRoot: root, runId: RUN_ID });
      assert.deepEqual(again.reverted, []);
      assert.deepEqual(
        again.skipped.map((file) => file.reason),
        ["changed_since_run", "changed_since_run", "changed_since_run"],
      );
      for (const [relative, bytes] of Object.entries(originals)) assert.deepEqual(await bytesOf(root, relative), bytes, relative);
    });
  });

  test("a file the user changed or removed after the run is not touched", async () => {
    await withRoot(async (root) => {
      await put(root, "edited.txt", "before\n");
      await put(root, "removed.txt", "before\n");
      await put(root, "kept.txt", "before kept\n");
      const run = await startRun(root);
      await change(run, "edited.txt", "by the run\n");
      await change(run, "removed.txt", "by the run\n");
      await change(run, "kept.txt", "by the run\n");
      await run.journal.close();

      await put(root, "edited.txt", "the user's later edit\n");
      await rm(join(root, "removed.txt"));

      const outcome = await revertKeepingJournal(root);
      assert.deepEqual(outcome, {
        reverted: [{ path: "kept.txt", action: "restored" }],
        skipped: [
          { path: "edited.txt", reason: "changed_since_run" },
          { path: "removed.txt", reason: "changed_since_run" },
        ],
      });
      assert.equal(await readFile(join(root, "edited.txt"), "utf8"), "the user's later edit\n");
      assert.equal(existsSync(join(root, "removed.txt")), false);
      assert.equal(await readFile(join(root, "kept.txt"), "utf8"), "before kept\n");
    });
  });

  test("a file the run created is deleted, unless the user changed it afterwards", async () => {
    await withRoot(async (root) => {
      const run = await startRun(root);
      await change(run, "new/created.txt", "made by the run\n");
      await change(run, "new/created.txt", "made by the run, changed again\n");
      await change(run, "also-new.txt", "made by the run\n");
      await run.journal.close();
      await put(root, "also-new.txt", "the user kept working on it\n");

      const outcome = await revertKeepingJournal(root);
      assert.deepEqual(outcome, {
        reverted: [{ path: "new/created.txt", action: "deleted" }],
        skipped: [{ path: "also-new.txt", reason: "changed_since_run" }],
      });
      assert.equal(existsSync(join(root, "new", "created.txt")), false);
      assert.equal(await readFile(join(root, "also-new.txt"), "utf8"), "the user kept working on it\n");
    });
  });

  test("a file changed several times goes back to its first original", async () => {
    await withRoot(async (root) => {
      const original = Buffer.concat([BOM, Buffer.from("v0 원문\r\n", "utf8")]);
      await put(root, "multi.txt", original);
      const run = await startRun(root);
      await change(run, "multi.txt", "v1\n");
      await change(run, "multi.txt", "v2\n");
      await change(run, "multi.txt", "v3\n");
      await run.journal.close();

      const index = await readIndex(root);
      assert.deepEqual(index.entries, [{ path: "multi.txt", existed: true, file: "1.orig" }]);
      assert.deepEqual(await readFile(runPath(root, SNAPSHOTS_DIR_NAME, "1.orig")), original);

      const outcome = await revertKeepingJournal(root);
      assert.deepEqual(outcome, { reverted: [{ path: "multi.txt", action: "restored" }], skipped: [] });
      assert.deepEqual(await bytesOf(root, "multi.txt"), original);
    });
  });

  test("a missing snapshot skips only that file; no snapshots at all skips every file", async () => {
    await withRoot(async (root) => {
      await put(root, "x.txt", "x before\n");
      await put(root, "y.txt", "y before\n");
      const run = await startRun(root);
      await change(run, "x.txt", "x by the run\n");
      await change(run, "y.txt", "y by the run\n");
      await run.journal.close();

      const xEntry = (await readIndex(root)).entries.find((entry) => entry.path === "x.txt");
      assert.ok(xEntry?.file !== undefined);
      await rm(runPath(root, SNAPSHOTS_DIR_NAME, xEntry.file));

      const outcome = await revertKeepingJournal(root);
      assert.deepEqual(outcome, {
        reverted: [{ path: "y.txt", action: "restored" }],
        skipped: [{ path: "x.txt", reason: "missing_snapshot" }],
      });
      assert.equal(await readFile(join(root, "x.txt"), "utf8"), "x by the run\n");

      await put(root, "y.txt", "y by the run\n");
      await rm(runPath(root, SNAPSHOTS_DIR_NAME), { recursive: true });
      const none = await revertKeepingJournal(root);
      assert.deepEqual(none, {
        reverted: [],
        skipped: [
          { path: "x.txt", reason: "missing_snapshot" },
          { path: "y.txt", reason: "missing_snapshot" },
        ],
      });
      assert.equal(await readFile(join(root, "y.txt"), "utf8"), "y by the run\n");
    });
  });

  test("a path recorded with a privacy token is missing_snapshot; other files are reverted", async () => {
    await withRoot(async (root) => {
      await put(root, "plain.txt", "plain before\n");
      const run = await startRun(root);
      await change(run, "plain.txt", "plain by the run\n");
      await run.journal.append({
        type: "file_changed",
        callId: "call-token",
        path: masked("notes/[[CODARYN_SECRET:0123456789abcdef]].txt"),
        previousHash: null,
        newHash: sha("whatever"),
        created: true,
      });
      await run.journal.close();

      const outcome = await revertKeepingJournal(root);
      assert.deepEqual(outcome, {
        reverted: [{ path: "plain.txt", action: "restored" }],
        skipped: [{ path: "notes/[[CODARYN_SECRET:0123456789abcdef]].txt", reason: "missing_snapshot" }],
      });
    });
  });

  test("a failure on one file is reported for that file and the others continue", async () => {
    await withRoot(async (root) => {
      await put(root, "a.txt", "a before\n");
      await put(root, "b.txt", "b before\n");
      const run = await startRun(root);
      await change(run, "a.txt", "a by the run\n");
      await change(run, "b.txt", "b by the run\n");
      await run.journal.close();

      // b.txt cannot be read any more: it became a directory.
      await rm(join(root, "b.txt"));
      await mkdir(join(root, "b.txt"));

      const outcome = await revertKeepingJournal(root);
      assert.deepEqual(outcome, {
        reverted: [{ path: "a.txt", action: "restored" }],
        skipped: [{ path: "b.txt", reason: "io_error" }],
      });
      assert.equal(await readFile(join(root, "a.txt"), "utf8"), "a before\n");
    });
  });

  test("a snapshot that is not the state the run's first change replaced is not used", async () => {
    await withRoot(async (root) => {
      await put(root, "race.txt", "the user's text at write time\n");
      const run = await startRun(root);
      const resolved = await run.workspace.resolve("race.txt", "write");
      assert.ok(resolved.ok);
      // The tool kept what it read earlier; the file changed before its first successful write.
      await run.recorder.saveOriginal(resolved.path, raw("what the tool read earlier\n"));
      const written = await run.workspace.writeText({
        path: resolved.path,
        expectedHash: sha("the user's text at write time\n"),
        text: raw("by the run\n"),
      });
      assert.ok(written.ok);
      await run.journal.append({
        type: "file_changed",
        callId: "call-1",
        path: masked("race.txt"),
        previousHash: written.previousHash,
        newHash: written.newHash,
        created: false,
      });
      await run.journal.close();

      const outcome = await revertKeepingJournal(root);
      assert.deepEqual(outcome, { reverted: [], skipped: [{ path: "race.txt", reason: "missing_snapshot" }] });
      assert.equal(await readFile(join(root, "race.txt"), "utf8"), "by the run\n");
    });
  });

  test("a recorded path that leaves the workspace is never written", async () => {
    await withRoot(async (root) => {
      const workspaceRoot = join(root, "work");
      await mkdir(workspaceRoot);
      await put(root, "outside.txt", "outside\n");
      const journal = createJournal({ workspaceRoot, runId: RUN_ID, clock });
      await journal.append({
        type: "file_changed",
        callId: "call-1",
        path: masked("../outside.txt"),
        previousHash: null,
        newHash: sha("outside\n"),
        created: true,
      });
      await journal.close();

      const outcome = await revertRun({ workspaceRoot, runId: RUN_ID });
      assert.deepEqual(outcome, { reverted: [], skipped: [{ path: "../outside.txt", reason: "missing_snapshot" }] });
      assert.equal(await readFile(join(root, "outside.txt"), "utf8"), "outside\n");
    });
  });

  test("a recorded path inside the state directory is never written, even with a matching snapshot entry", async () => {
    await withRoot(async (root) => {
      const target = `${STATE_DIR_NAME}/kept-by-codaryn.txt`;
      await put(root, target, "state data\n");
      await mkdir(runPath(root, SNAPSHOTS_DIR_NAME), { recursive: true });
      await writeFile(
        runPath(root, SNAPSHOTS_DIR_NAME, "index.json"),
        JSON.stringify({ schemaVersion: 1, entries: [{ path: target, existed: false }] }),
      );
      const journal = createJournal({ workspaceRoot: root, runId: RUN_ID, clock });
      await journal.append({
        type: "file_changed",
        callId: "call-1",
        path: masked(target),
        previousHash: null,
        newHash: sha("state data\n"),
        created: true,
      });
      await journal.close();

      const outcome = await revertKeepingJournal(root);
      assert.deepEqual(outcome, { reverted: [], skipped: [{ path: target, reason: "changed_since_run" }] });
      assert.equal(await readFile(join(root, target), "utf8"), "state data\n");
    });
  });

  test("a snapshot index that cannot be understood skips every file as io_error", async () => {
    await withRoot(async (root) => {
      await put(root, "a.txt", "a before\n");
      const run = await startRun(root);
      await change(run, "a.txt", "a by the run\n");
      await run.journal.close();
      await writeFile(runPath(root, SNAPSHOTS_DIR_NAME, "index.json"), "{broken");

      const outcome = await revertKeepingJournal(root);
      assert.deepEqual(outcome, { reverted: [], skipped: [{ path: "a.txt", reason: "io_error" }] });
      assert.equal(await readFile(join(root, "a.txt"), "utf8"), "a by the run\n");
    });
  });

  test("a journal that is missing or cannot be parsed rejects and nothing is changed", async () => {
    await withRoot(async (root) => {
      await assert.rejects(revertRun({ workspaceRoot: root, runId: RUN_ID }), (error: unknown) => {
        assert.ok(error instanceof RevertRunError);
        assert.equal(error.code, "run_not_found");
        return true;
      });

      await put(root, "a.txt", "a before\n");
      const run = await startRun(root);
      await change(run, "a.txt", "a by the run\n");
      await run.journal.close();
      const journalFile = runPath(root, JOURNAL_FILE_NAME);
      const good = await readFile(journalFile, "utf8");

      const broken: Record<string, string> = {
        "incomplete last line": `${good}{"seq":2`,
        "line that is not JSON": `${good}not json\n`,
        "record of another run": `${good}${JSON.stringify({ seq: 2, runId: "other-run", type: "run_finished" })}\n`,
        "file_changed without a valid newHash": `${good}${JSON.stringify({ seq: 2, runId: RUN_ID, type: "file_changed", path: "a.txt", previousHash: null, newHash: "nope", created: true })}\n`,
      };
      for (const [label, text] of Object.entries(broken)) {
        await writeFile(journalFile, text, "utf8");
        await assert.rejects(revertRun({ workspaceRoot: root, runId: RUN_ID }), (error: unknown) => {
          assert.ok(error instanceof RevertRunError, label);
          assert.equal(error.code, "invalid_run_record", label);
          assert.equal(error.message.includes("a.txt"), false, label);
          return true;
        });
        assert.equal(await readFile(join(root, "a.txt"), "utf8"), "a by the run\n", label);
      }
    });
  });
});

describe("createChangeRecorder (R-6)", () => {
  test("snapshots live apart from the journal; the index holds paths and existence only", async () => {
    await withRoot(async (root) => {
      const secretPath = "fake-secret-name-4410.txt";
      await put(root, "doc.txt", `text with ${CANARY}\n`);
      await put(root, secretPath, `more ${CANARY}\n`);
      const run = await startRun(root);
      await change(run, "doc.txt", "replaced\n");
      await change(run, secretPath, "replaced\n");
      await change(run, "created.txt", "new\n");
      await run.journal.close();

      assert.equal(snapshotsRelativePath(RUN_ID), `${STATE_DIR_NAME}/${RUNS_DIR_NAME}/${RUN_ID}/${SNAPSHOTS_DIR_NAME}`);
      assert.deepEqual((await readdir(runPath(root))).sort(), [JOURNAL_FILE_NAME, SNAPSHOTS_DIR_NAME].sort());
      assert.deepEqual((await readdir(runPath(root, SNAPSHOTS_DIR_NAME))).sort(), ["1.orig", "2.orig", "index.json"]);

      const journal = await readFile(runPath(root, JOURNAL_FILE_NAME), "utf8");
      assert.equal(journal.includes(CANARY), false, "original content must not reach the journal");

      const indexText = await readFile(runPath(root, SNAPSHOTS_DIR_NAME, "index.json"), "utf8");
      assert.equal(indexText.includes(CANARY), false, "the index holds no content");
      assert.deepEqual(JSON.parse(indexText), {
        schemaVersion: 1,
        entries: [
          { path: "doc.txt", existed: true, file: "1.orig" },
          { path: secretPath, existed: true, file: "2.orig" },
          { path: "created.txt", existed: false },
        ],
      });
      assert.equal(await readFile(runPath(root, SNAPSHOTS_DIR_NAME, "1.orig"), "utf8"), `text with ${CANARY}\n`);
    });
  });

  test("keeps the first original per path, tells 'did not exist' from an empty file, and continues an earlier index", async () => {
    await withRoot(async (root) => {
      const workspace = await createWorkspace({ root });
      const resolve = async (relative: string) => {
        const resolved = await workspace.resolve(relative, "write");
        assert.ok(resolved.ok);
        return resolved.path;
      };
      const first = createChangeRecorder({ workspaceRoot: root, runId: RUN_ID });
      await first.saveOriginal(await resolve("p.txt"), raw("first\r\n"));
      await first.saveOriginal(await resolve("p.txt"), raw("second\r\n"));
      await first.saveOriginal(await resolve("absent.txt"), null);
      await first.saveOriginal(await resolve("empty.txt"), raw(""));

      const later = createChangeRecorder({ workspaceRoot: root, runId: RUN_ID });
      await Promise.all([
        later.saveOriginal(await resolve("p.txt"), raw("third\r\n")),
        later.saveOriginal(await resolve("q.txt"), raw("q\n")),
        later.saveOriginal(await resolve("q.txt"), raw("q again\n")),
      ]);

      assert.deepEqual((await readIndex(root)).entries, [
        { path: "p.txt", existed: true, file: "1.orig" },
        { path: "absent.txt", existed: false },
        { path: "empty.txt", existed: true, file: "2.orig" },
        { path: "q.txt", existed: true, file: "3.orig" },
      ]);
      assert.equal(await readFile(runPath(root, SNAPSHOTS_DIR_NAME, "1.orig"), "utf8"), "first\r\n");
      assert.equal((await readFile(runPath(root, SNAPSHOTS_DIR_NAME, "2.orig"))).length, 0);
      assert.equal(await readFile(runPath(root, SNAPSHOTS_DIR_NAME, "3.orig"), "utf8"), "q\n");
    });
  });

  test("rejects when nothing can be kept, so the tool does not write", async () => {
    await withRoot(async (root) => {
      const workspace = await createWorkspace({ root });
      const resolved = await workspace.resolve("p.txt", "write");
      assert.ok(resolved.ok);

      // The snapshots directory is taken by a file.
      await mkdir(runPath(root), { recursive: true });
      await writeFile(runPath(root, SNAPSHOTS_DIR_NAME), "not a directory");
      const blocked = createChangeRecorder({ workspaceRoot: root, runId: RUN_ID });
      await assert.rejects(blocked.saveOriginal(resolved.path, raw("x")));

      // An index that cannot be understood is not overwritten.
      await rm(runPath(root, SNAPSHOTS_DIR_NAME));
      await mkdir(runPath(root, SNAPSHOTS_DIR_NAME));
      await writeFile(runPath(root, SNAPSHOTS_DIR_NAME, "index.json"), "{broken");
      const confused = createChangeRecorder({ workspaceRoot: root, runId: RUN_ID });
      await assert.rejects(confused.saveOriginal(resolved.path, raw("x")));
      assert.equal(await readFile(runPath(root, SNAPSHOTS_DIR_NAME, "index.json"), "utf8"), "{broken");

      // Lone surrogates cannot be the text a tool read from a UTF-8 file.
      const recorder = createChangeRecorder({ workspaceRoot: root, runId: "another-run" });
      await assert.rejects(recorder.saveOriginal(resolved.path, raw("\uD800")), TypeError);
    });
  });
});
