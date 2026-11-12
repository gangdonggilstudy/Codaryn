/**
 * DR-14: the store's reader of a run's originals (the snapshots), for the app layer's comparison
 * view. Same checks as revertRun: one entry per distinct `file_changed` path, the original only
 * when its hash is the path's first `previousHash`, UTF-8 text only. Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { MAX_READ_BYTES, asRawText } from "../../../src/contracts/index.js";
import type { ContentHash, MaskedText } from "../../../src/contracts/index.js";
import { RevertRunError, createChangeRecorder, createJournal, readRunOriginals } from "../../../src/store/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const RUN = "20260102T030405Z-0a1b2c3d";
const TOKEN = "[[CODARYN_SECRET:00000000000000aa]]";
const sha = (data: string | Uint8Array): ContentHash => createHash("sha256").update(data).digest("hex") as ContentHash;
const clock = { now: () => Date.UTC(2026, 0, 2, 3, 4, 5) };

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-g-orig-")));
  roots.push(root);
  return root;
}

/** Records one change of `path` from `before` (null: did not exist) to `after`, keeping the original as a run does. */
async function change(root: string, path: string, before: string | null, after: string, recorded = path): Promise<void> {
  const ws = await createWorkspace({ root });
  const resolved = await ws.resolve(path, "write");
  assert.ok(resolved.ok);
  await createChangeRecorder({ workspaceRoot: root, runId: RUN }).saveOriginal(resolved.path, before === null ? null : asRawText(before));
  await writeFile(join(root, path), after, "utf8");
  const journal = createJournal({ workspaceRoot: root, runId: RUN, clock });
  await journal.append({ type: "file_changed", callId: "c", path: recorded as MaskedText, previousHash: before === null ? null : sha(before), newHash: sha(after), created: before === null });
  await journal.close();
}

async function startedRun(root: string): Promise<void> {
  const journal = createJournal({ workspaceRoot: root, runId: RUN, clock });
  await journal.append({ type: "run_started", schemaVersion: 1, taskId: "t", workflow: "x" as MaskedText, provider: "scripted", limits: { maxModelTurns: 1, maxToolCalls: 1, maxTotalTokens: null, maxDurationMs: 1 } });
  await journal.close();
}

describe("readRunOriginals (DR-14)", () => {
  test("one entry per changed path: the original text, or none for a created file; the first before and the last after", async () => {
    const root = await workspace();
    await writeFile(join(root, "README.md"), "# Title\n", "utf8");
    await startedRun(root);
    await change(root, "README.md", "# Title\n", "# Title\n\nadded\n");
    await change(root, "notes.txt", null, "x\n");
    await change(root, "README.md", "# Title\n\nadded\n", "# Title\n\nadded twice\n");
    const originals = await readRunOriginals({ workspaceRoot: root, runId: RUN });
    assert.deepEqual(originals, [
      { path: "README.md", created: false, before: sha("# Title\n"), after: sha("# Title\n\nadded twice\n"), original: { text: "# Title\n" } },
      { path: "notes.txt", created: true, before: null, after: sha("x\n"), original: null },
    ]);
  });

  test("an original that is not usable says why: snapshot_missing, masked_path, not_text, too_large", async () => {
    const root = await workspace();
    await startedRun(root);
    await writeFile(join(root, "a.txt"), "a\n", "utf8");
    await change(root, "a.txt", "a\n", "a2\n");
    await writeFile(join(root, ".codaryn", "runs", RUN, "snapshots", "1.orig"), "tampered\n", "utf8");

    await writeFile(join(root, "secret.txt"), "s\n", "utf8");
    await change(root, "secret.txt", "s\n", "s2\n", `${TOKEN}.txt`);

    // A non-UTF-8 original and an oversized one, kept by hand in the documented layout.
    const binary = Uint8Array.from([0xff, 0xfe, 0x00, 0x81]);
    const big = "b".repeat(MAX_READ_BYTES + 1);
    const snapshots = join(root, ".codaryn", "runs", RUN, "snapshots");
    const index = JSON.parse(await readFile(join(snapshots, "index.json"), "utf8")) as { entries: unknown[] };
    index.entries.push({ path: "bin.dat", existed: true, file: "8.orig" }, { path: "big.txt", existed: true, file: "9.orig" });
    await writeFile(join(snapshots, "8.orig"), binary);
    await writeFile(join(snapshots, "9.orig"), big, "utf8");
    await writeFile(join(snapshots, "index.json"), JSON.stringify({ schemaVersion: 1, entries: index.entries }), "utf8");
    const journal = createJournal({ workspaceRoot: root, runId: RUN, clock });
    await journal.append({ type: "file_changed", callId: "c", path: "bin.dat" as MaskedText, previousHash: sha(binary), newHash: sha("t\n"), created: false });
    await journal.append({ type: "file_changed", callId: "c", path: "big.txt" as MaskedText, previousHash: sha(big), newHash: sha("t\n"), created: false });
    await journal.close();

    const originals = await readRunOriginals({ workspaceRoot: root, runId: RUN });
    assert.deepEqual(
      originals.map((entry) => [entry.path, entry.original]),
      [
        ["a.txt", { unavailable: "snapshot_missing" }],
        [`${TOKEN}.txt`, { unavailable: "masked_path" }],
        ["bin.dat", { unavailable: "not_text" }],
        ["big.txt", { unavailable: "too_large" }],
      ],
    );
  });

  test("a missing run, a broken journal and a linked run directory reject like revertRun; an apply run has no originals", async () => {
    await assert.rejects(readRunOriginals({ workspaceRoot: await workspace(), runId: RUN }), (error: unknown) => error instanceof RevertRunError && error.code === "run_not_found");

    const broken = await workspace();
    await mkdir(join(broken, ".codaryn", "runs", RUN), { recursive: true });
    await writeFile(join(broken, ".codaryn", "runs", RUN, "journal.jsonl"), "{not json\n", "utf8");
    await assert.rejects(readRunOriginals({ workspaceRoot: broken, runId: RUN }), (error: unknown) => error instanceof RevertRunError && error.code === "invalid_run_record");

    const elsewhere = await workspace();
    await startedRun(elsewhere);
    const linked = await workspace();
    await mkdir(join(linked, ".codaryn", "runs"), { recursive: true });
    await symlink(join(elsewhere, ".codaryn", "runs", RUN), join(linked, ".codaryn", "runs", RUN), "junction");
    await assert.rejects(readRunOriginals({ workspaceRoot: linked, runId: RUN }), (error: unknown) => error instanceof RevertRunError && error.code === "invalid_run_record");

    const apply = await workspace();
    await mkdir(join(apply, ".codaryn", "runs", RUN), { recursive: true });
    const started = { seq: 1, at: "2026-01-02T03:04:05.000Z", runId: RUN, type: "apply_started", schemaVersion: 1, planRunId: "20260102T030000Z-00000000", taskId: "t", digest: "d".repeat(64), approval: "cli-flag", actions: 1, maxDurationMs: 1000 };
    await writeFile(join(apply, ".codaryn", "runs", RUN, "journal.jsonl"), `${JSON.stringify(started)}\n`, "utf8");
    assert.deepEqual(await readRunOriginals({ workspaceRoot: apply, runId: RUN }), []);
  });
});
