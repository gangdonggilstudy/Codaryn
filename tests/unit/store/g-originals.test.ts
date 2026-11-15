/**
 * DR-14: the store's reader of a run's originals (the snapshots), for the app layer's comparison
 * view. Same checks as revertRun: one entry per distinct `file_changed` path, the original only
 * when its hash is the path's first `previousHash`, UTF-8 text only. Fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { MAX_READ_BYTES, asRawText, changeShownMatches, maskedParts, maskedPartsEncoding } from "../../../src/contracts/index.js";
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

  test("DR-24 (e): a snapshots directory that is a link is not read through", async () => {
    const root = await workspace();
    await startedRun(root);
    const outside = await workspace();
    await writeFile(join(outside, "1.orig"), "OUTSIDE FILE CONTENT", "utf8");
    await writeFile(join(outside, "index.json"), JSON.stringify({ schemaVersion: 1, entries: [{ path: "doc.txt", existed: true, file: "1.orig" }] }), "utf8");
    await symlink(outside, join(root, ".codaryn", "runs", RUN, "snapshots"), "junction");
    const journal = createJournal({ workspaceRoot: root, runId: RUN, clock });
    await journal.append({ type: "file_changed", callId: "c", path: "doc.txt" as MaskedText, previousHash: sha("OUTSIDE FILE CONTENT"), newHash: sha("now\n"), created: false });
    await journal.close();
    const originals = await readRunOriginals({ workspaceRoot: root, runId: RUN });
    assert.deepEqual(originals.map((entry) => entry.original), [{ unavailable: "unreadable" }]);
    assert.equal(JSON.stringify(originals).includes("OUTSIDE"), false);
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

describe("DR-29, DR-32 (c): how the run masked each changed file, kept as digests with its snapshot", () => {
  const SECRET = "fake-dr29-secret-value";
  const NOW_TOKEN = "[[CODARYN_SECRET:00000000000000bb]]";
  /** A stand-in gateway: the registered secrets become tokens (token ids differ per run). */
  const maskWith = (token: string, secrets: readonly string[]) => (text: string): string => secrets.reduce((masked, secret) => masked.split(secret).join(token), text);
  const runMask = maskWith(TOKEN, [SECRET]);
  /** The digest a tool or view computes: SHA-256 of maskedPartsEncoding(maskedParts(masked text)). */
  const digestOf = (masked: string): ContentHash => sha(maskedPartsEncoding(maskedParts(masked)));
  const snapshotsOf = (root: string): string => join(root, ".codaryn", "runs", RUN, "snapshots");

  /** A run changes `path` from `before` through `writes`, recording the digests as a writing tool does. */
  async function recorded(root: string, path: string, before: string | null, writes: readonly string[], withShown = true): Promise<void> {
    const ws = await createWorkspace({ root });
    const resolved = await ws.resolve(path, "write");
    assert.ok(resolved.ok);
    const recorder = createChangeRecorder({ workspaceRoot: root, runId: RUN });
    const original = before === null ? null : asRawText(before);
    if (withShown) await recorder.saveOriginal(resolved.path, original, before === null ? null : digestOf(runMask(before)));
    else await recorder.saveOriginal(resolved.path, original);
    let previous = before;
    for (const text of writes) {
      await writeFile(join(root, path), text, "utf8");
      if (withShown) {
        assert.ok(recorder.saveNext !== undefined, "the store implements saveNext");
        await recorder.saveNext(resolved.path, sha(text), digestOf(runMask(text)));
      }
      const journal = createJournal({ workspaceRoot: root, runId: RUN, clock });
      await journal.append({ type: "file_changed", callId: "c", path: path as MaskedText, previousHash: previous === null ? null : sha(previous), newHash: sha(text), created: previous === null });
      await journal.close();
      previous = text;
    }
  }

  test("review reproduction R-19 L-3: what is kept holds no visible text, so no guessed secret can be confirmed from it", async () => {
    const root = await workspace();
    await startedRun(root);
    const written = `deploy:\n  token: ${SECRET}\n  region: eu\n`;
    await recorded(root, "deploy.yml", null, [written]);
    const kept = await Promise.all((await readdir(snapshotsOf(root))).filter((name) => name.startsWith("shown-")).map((name) => readFile(join(snapshotsOf(root), name), "utf8")));
    assert.equal(kept.length, 1);
    const text = kept.join("\n");
    for (const visible of ["deploy:", "token: ", "region: eu", SECRET, "CODARYN_SECRET"]) assert.equal(text.includes(visible), false, visible);
    // The R-19 probe: any list of strings kept, joined with a guess, hashed, against any kept hash.
    const hashes = new Set(text.match(/[0-9a-f]{64}/g) ?? []);
    const lists: string[][] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) lists.push(value as string[]);
      else if (value !== null && typeof value === "object") for (const item of Object.values(value)) walk(item);
    };
    for (const file of kept) walk(JSON.parse(file));
    const guesses = ["password", "hunter2", SECRET, "fake-dr29-secret-valuf"];
    assert.deepEqual(guesses.filter((guess) => lists.some((list) => hashes.has(sha(list.join(guess))))), [], "no guess is confirmed");
  });

  test("a view compares digests: same secrets (other token ids) match; without the secret, or with the file changed, they do not", async () => {
    const root = await workspace();
    await startedRun(root);
    const before = `key: ${SECRET}\nold\n`;
    const last = `key: ${SECRET}\nnewer\n`;
    await writeFile(join(root, "notes.md"), before, "utf8");
    await recorded(root, "notes.md", before, [`key: ${SECRET}\nnew\n`, last]);
    const [entry] = await readRunOriginals({ workspaceRoot: root, runId: RUN });
    assert.deepEqual(entry?.shown, { original: digestOf(runMask(before)), next: { sha256: sha(last), partsDigest: digestOf(runMask(last)) } }, "the last write is kept");
    const nowMask = maskWith(NOW_TOKEN, [SECRET]);
    assert.equal(changeShownMatches(entry?.shown, { original: digestOf(nowMask(before)), current: { sha256: sha(last), partsDigest: digestOf(nowMask(last)) } }), true);
    assert.equal(changeShownMatches(entry?.shown, { original: digestOf(before), current: { sha256: sha(last), partsDigest: digestOf(last) } }), false, "without the secret its value would show");
    assert.equal(changeShownMatches(entry?.shown, { original: digestOf(nowMask(before)), current: { sha256: sha("changed\n"), partsDigest: digestOf("changed\n") } }), false, "the file changed since the run");
  });

  test("a created file has no original digest; a caller from before DR-29 gives no shown", async () => {
    const root = await workspace();
    await startedRun(root);
    await recorded(root, "new.txt", null, ["x\n"]);
    await recorded(root, "plain.txt", null, ["y\n"], false);
    const originals = await readRunOriginals({ workspaceRoot: root, runId: RUN });
    assert.deepEqual(originals.find((item) => item.path === "new.txt")?.shown, { original: null, next: { sha256: sha("x\n"), partsDigest: digestOf("x\n") } });
    assert.equal("shown" in (originals.find((item) => item.path === "plain.txt") ?? {}), false);
  });

  test("a kept form that fails the checks is not given (the view then shows no text); the rest stays", async () => {
    const before = "a\n";
    const after = "b\n";
    const good = { schemaVersion: 2, path: "a.txt", original: digestOf("a\n"), next: { sha256: sha(after), partsDigest: digestOf("b\n") } };
    for (const bad of [
      { ...good, extra: 1 },
      { ...good, path: "other.txt" },
      { ...good, original: null },
      { ...good, original: "not-a-digest" },
      { ...good, original: ["a\n"] },
      { ...good, next: { sha256: "x", partsDigest: digestOf("b\n") } },
      { ...good, next: { sha256: sha(after), partsDigest: digestOf("b\n"), parts: ["b\n"] } },
      { ...good, next: { sha256: sha(after), parts: ["b\n"] } },
      { ...good, schemaVersion: 1 },
    ]) {
      const root = await workspace();
      await startedRun(root);
      await writeFile(join(root, "a.txt"), before, "utf8");
      await recorded(root, "a.txt", before, [after]);
      await writeFile(join(snapshotsOf(root), "shown-0.json"), `${JSON.stringify(bad)}\n`, "utf8");
      const [entry] = await readRunOriginals({ workspaceRoot: root, runId: RUN });
      assert.equal(entry !== undefined && "shown" in entry, false, JSON.stringify(bad));
      assert.deepEqual(entry?.original, { text: before }, "the original is still given");
    }
  });

  test("inputs that do not fit are refused before anything is written", async () => {
    const root = await workspace();
    const ws = await createWorkspace({ root });
    const resolved = await ws.resolve("a.txt", "write");
    assert.ok(resolved.ok);
    const recorder = createChangeRecorder({ workspaceRoot: root, runId: RUN });
    await assert.rejects(recorder.saveOriginal(resolved.path, null, digestOf("x")), TypeError, "a created file has no original digest");
    await assert.rejects(recorder.saveOriginal(resolved.path, asRawText("x"), null), TypeError, "an existing file's form is a digest");
    await assert.rejects(recorder.saveOriginal(resolved.path, asRawText("x"), "not-a-digest" as ContentHash), TypeError);
    assert.ok(recorder.saveNext !== undefined);
    await assert.rejects(recorder.saveNext(resolved.path, sha("x"), digestOf("x")), "saveNext before saveOriginal");
    await recorder.saveOriginal(resolved.path, asRawText("x"), digestOf("x"));
    await assert.rejects(recorder.saveNext(resolved.path, "not-a-hash" as ContentHash, digestOf("x")), TypeError);
    await assert.rejects(recorder.saveNext(resolved.path, sha("x"), "not-a-digest" as ContentHash), TypeError);
  });
});
