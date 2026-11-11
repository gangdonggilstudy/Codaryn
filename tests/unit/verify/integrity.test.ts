/**
 * K2 (U-1): the integrity list of protected material. `capture` hashes every file below
 * `policy.protectedPaths` and the config's `integrity.paths`; `compare` lists what changed.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";

import { MAX_INTEGRITY_BYTES, MAX_INTEGRITY_FILES, asRawText } from "../../../src/contracts/index.js";
import type { IntegrityEntry, IntegrityManifest, Workspace } from "../../../src/contracts/index.js";
import { createIntegrityChecker } from "../../../src/verify/index.js";
import { DEFAULT_INTEGRITY_LIMITS, buildIntegrityChecker, nodeIntegrityFileSystem } from "../../../src/verify/integrity.js";
import type { IntegrityFileSystem } from "../../../src/verify/integrity.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const IS_WINDOWS = process.platform === "win32";

interface Sandbox {
  readonly ws: string;
  readonly outside: string;
  readonly workspace: Workspace;
}

async function sandbox(t: TestContext): Promise<Sandbox> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "codaryn-integrity-")));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const ws = join(base, "ws");
  const outside = join(base, "outside");
  await mkdir(ws);
  await mkdir(outside);
  return { ws, outside, workspace: await createWorkspace({ root: ws }) };
}

async function put(root: string, relative: string, data: string | Uint8Array): Promise<string> {
  const full = join(root, ...relative.split("/"));
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
  return full;
}

const sha = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const paths = (manifest: IntegrityManifest): string[] => manifest.entries.map((entry) => entry.path);
const entryAt = (manifest: IntegrityManifest, at: string): IntegrityEntry | undefined =>
  manifest.entries.find((entry) => entry.path === at);
/** Absolute display form: `/` separated. */
const shown = (absolute: string): string => absolute.replace(/\\/g, "/");

async function dirLink(target: string, link: string): Promise<void> {
  await symlink(target, link, IS_WINDOWS ? "junction" : "dir");
}

describe("K2 capture", () => {
  test("lists every file below the protected entries with its SHA-256; directories have no entry; missing is absent", async (t) => {
    const sb = await sandbox(t);
    const big = Buffer.alloc(1_500_000, 7); // read as a stream (over 1 MiB)
    await put(sb.ws, "tests/a.test.js", "test a\n");
    await put(sb.ws, "tests/sub/b.test.js", "test b\n");
    await put(sb.ws, "tests/sub/blob.bin", big);
    await put(sb.ws, "src/app.js", "not protected\n");
    await mkdir(join(sb.ws, "tests", "empty"));

    const checker = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["./tests/", "verifier.json"], externalPaths: [] });
    const manifest = await checker.capture();
    assert.deepEqual(manifest.entries, [
      { path: "tests/a.test.js", kind: "file", sha256: sha("test a\n") },
      { path: "tests/sub/b.test.js", kind: "file", sha256: sha("test b\n") },
      { path: "tests/sub/blob.bin", kind: "file", sha256: sha(big) },
      { path: "verifier.json", kind: "absent" },
    ]);
    assert.deepEqual(checker.compare(manifest, manifest), []);
    assert.deepEqual(checker.compare(manifest, await checker.capture()), [], "a second capture of unchanged files matches");
  });

  test("a changed, an added and a removed file are reported; an unchanged one is not", async (t) => {
    const sb = await sandbox(t);
    await put(sb.ws, "tests/a.test.js", "a1\n");
    await put(sb.ws, "tests/keep.test.js", "same\n");
    await put(sb.ws, "tests/sub/b.test.js", "b\n");
    const checker = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["tests"], externalPaths: [] });
    const before = await checker.capture();

    await put(sb.ws, "tests/a.test.js", "a2\n");
    await put(sb.ws, "tests/new.test.js", "new\n");
    await rm(join(sb.ws, "tests", "sub", "b.test.js"));
    const after = await checker.capture();

    assert.deepEqual(checker.compare(before, after), ["tests/a.test.js", "tests/new.test.js", "tests/sub/b.test.js"]);
    assert.deepEqual(checker.compare(after, before), ["tests/a.test.js", "tests/new.test.js", "tests/sub/b.test.js"]);
  });

  test("a rename that keeps the content is reported as the old and the new path", async (t) => {
    const sb = await sandbox(t);
    await put(sb.ws, "tests/old-name.test.js", "same content\n");
    const checker = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["tests"], externalPaths: [] });
    const before = await checker.capture();
    await rename(join(sb.ws, "tests", "old-name.test.js"), join(sb.ws, "tests", "new-name.test.js"));
    const after = await checker.capture();
    assert.equal(entryAt(after, "tests/new-name.test.js")?.kind, "file");
    assert.deepEqual(checker.compare(before, after), ["tests/new-name.test.js", "tests/old-name.test.js"]);
  });

  test("exact bytes: LF to CRLF is a change; Korean names are shown as written", async (t) => {
    const sb = await sandbox(t);
    await put(sb.ws, "검증/한글 파일.txt", "첫 줄\n둘째 줄\n");
    const checker = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["검증"], externalPaths: [] });
    const before = await checker.capture();
    assert.deepEqual(before.entries, [{ path: "검증/한글 파일.txt", kind: "file", sha256: sha("첫 줄\n둘째 줄\n") }]);

    await put(sb.ws, "검증/한글 파일.txt", "첫 줄\r\n둘째 줄\r\n");
    const after = await checker.capture();
    assert.equal(entryAt(after, "검증/한글 파일.txt")?.kind, "file");
    assert.deepEqual(checker.compare(before, after), ["검증/한글 파일.txt"]);
  });

  test("'.' lists the root without the state directory; an entry at or under the state directory adds nothing", async (t) => {
    const sb = await sandbox(t);
    await put(sb.ws, "a.txt", "a\n");
    await put(sb.ws, "dir/b.txt", "b\n");
    await put(sb.ws, ".codaryn/runs/r1/journal.jsonl", "{}\n");

    const whole = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["."], externalPaths: [] });
    const before = await whole.capture();
    assert.deepEqual(paths(before), ["a.txt", "dir/b.txt"]);
    await put(sb.ws, ".codaryn/runs/r1/journal.jsonl", "{}\n{}\n");
    assert.deepEqual(whole.compare(before, await whole.capture()), [], "the state directory is never entered");

    const state = createIntegrityChecker({
      workspace: sb.workspace,
      protectedPaths: [".codaryn", ".codaryn/runs", "./.CODARYN/runs/r1"],
      externalPaths: [],
    });
    assert.deepEqual((await state.capture()).entries, []);
  });

  test("a link below an entry is recorded by its target text and not followed; an entry that is a link is followed", async (t) => {
    const sb = await sandbox(t);
    const first = join(sb.outside, "first");
    const second = join(sb.outside, "second");
    await put(first, "inside-target.txt", "x\n");
    await mkdir(second);
    await put(sb.ws, "tests/a.test.js", "a\n");
    const link = join(sb.ws, "tests", "linked");
    await dirLink(first, link);

    const checker = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["tests"], externalPaths: [] });
    const before = await checker.capture();
    assert.deepEqual(before.entries, [
      { path: "tests/a.test.js", kind: "file", sha256: sha("a\n") },
      { path: "tests/linked", kind: "link", sha256: sha(await readlink(link)) },
    ]);

    await rm(link, { recursive: false, force: true });
    await dirLink(second, link);
    assert.deepEqual(checker.compare(before, await checker.capture()), ["tests/linked"], "a new target is a change");

    // The entry itself is a link: followed to its real path, shown under the entry's own name.
    await put(sb.ws, "spec/s.test.js", "s\n");
    await dirLink(join(sb.ws, "spec"), join(sb.ws, "tests2"));
    const followed = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["tests2"], externalPaths: [] });
    assert.deepEqual((await followed.capture()).entries, [{ path: "tests2/s.test.js", kind: "file", sha256: sha("s\n") }]);

    // An entry whose link target is missing: nothing protected exists there now.
    await dirLink(join(sb.outside, "missing"), join(sb.ws, "dangling"));
    const dangling = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["dangling"], externalPaths: [] });
    assert.deepEqual((await dangling.capture()).entries, [{ path: "dangling", kind: "absent" }]);
  });

  test("overlapping entries list each path once", async (t) => {
    const sb = await sandbox(t);
    await put(sb.ws, "tests/unit/u.test.js", "u\n");
    await put(sb.ws, "tests/t.test.js", "t\n");
    const checker = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["tests", "tests/unit", "tests"], externalPaths: [] });
    assert.deepEqual(paths(await checker.capture()), ["tests/t.test.js", "tests/unit/u.test.js"]);
  });
});

describe("K2 paths outside the workspace (integrity.paths)", () => {
  test("a file and a directory are listed by absolute, '/' separated paths, and their changes are reported", async (t) => {
    const sb = await sandbox(t);
    const baseline = join(sb.outside, "baseline");
    const settings = await put(sb.outside, "settings.json", '{"a":1}\n');
    await put(baseline, "t1.test.js", "t1\n");
    await put(baseline, "deep/t2.test.js", "t2\n");
    await put(sb.ws, "tests/w.test.js", "w\n");

    const checker = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["tests"], externalPaths: [baseline, settings] });
    const before = await checker.capture();
    assert.deepEqual(before.entries, [
      { path: `${shown(baseline)}/deep/t2.test.js`, kind: "file", sha256: sha("t2\n") },
      { path: `${shown(baseline)}/t1.test.js`, kind: "file", sha256: sha("t1\n") },
      { path: shown(settings), kind: "file", sha256: sha('{"a":1}\n') },
      { path: "tests/w.test.js", kind: "file", sha256: sha("w\n") },
    ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));

    await put(sb.outside, "settings.json", '{"a":2}\n');
    await rm(baseline, { recursive: true });
    const after = await checker.capture();
    assert.equal(entryAt(after, shown(baseline))?.kind, "absent");
    assert.deepEqual(
      checker.compare(before, after),
      [shown(baseline), `${shown(baseline)}/deep/t2.test.js`, `${shown(baseline)}/t1.test.js`, shown(settings)],
    );
  });
});

describe("K2 case (Windows)", () => {
  test("an entry spelled in another case lists the same files under its own spelling; a case-only rename is reported", { skip: !IS_WINDOWS }, async (t) => {
    const sb = await sandbox(t);
    await put(sb.ws, "Tests/Case.test.js", "c\n");
    const checker = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["tests"], externalPaths: [] });
    const before = await checker.capture();
    assert.deepEqual(before.entries, [{ path: "tests/Case.test.js", kind: "file", sha256: sha("c\n") }]);
    assert.deepEqual(checker.compare(before, await checker.capture()), [], "stable across captures");

    await rename(join(sb.ws, "Tests", "Case.test.js"), join(sb.ws, "Tests", "case.test.js"));
    const after = await checker.capture();
    assert.deepEqual(paths(after), ["tests/case.test.js"]);
    assert.deepEqual(checker.compare(before, after), ["tests/Case.test.js", "tests/case.test.js"]);

    // The state directory is recognized in any case.
    await put(sb.ws, ".Codaryn/x.txt", "state\n");
    const root = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["."], externalPaths: [] });
    assert.deepEqual(paths(await root.capture()), ["Tests/case.test.js"]);
  });
});

describe("K2 unreadable paths", () => {
  function failing(match: (target: string) => boolean, on: keyof IntegrityFileSystem, code = "EACCES"): IntegrityFileSystem {
    const fail = (target: string): never => {
      throw Object.assign(new Error(`${code}: injected`), { code });
    };
    return {
      ...nodeIntegrityFileSystem,
      [on]: (target: string, ...rest: unknown[]) =>
        match(target) ? fail(target) : (nodeIntegrityFileSystem[on] as (...args: unknown[]) => unknown)(target, ...rest),
    } as IntegrityFileSystem;
  }

  test("a file that cannot be read, a directory that cannot be listed and a path lstat refuses become unchecked/unreadable", async (t) => {
    const sb = await sandbox(t);
    await put(sb.ws, "tests/ok.test.js", "ok\n");
    await put(sb.ws, "tests/locked.test.js", "locked\n");
    await put(sb.ws, "tests/private/p.test.js", "p\n");
    await put(sb.ws, "tests/odd.test.js", "odd\n");
    const options = { workspace: sb.workspace, protectedPaths: ["tests"], externalPaths: [] };

    const readFails = failing((target) => target.endsWith("locked.test.js"), "hashFile", "EBUSY");
    const listFails = failing((target) => target.endsWith("private"), "readdir", "EPERM");
    const statFails = failing((target) => target.endsWith("odd.test.js"), "lstat", "EACCES");
    const files: IntegrityFileSystem = {
      ...nodeIntegrityFileSystem,
      hashFile: readFails.hashFile,
      readdir: listFails.readdir,
      lstat: statFails.lstat,
    };
    const checker = buildIntegrityChecker(options, DEFAULT_INTEGRITY_LIMITS, files);
    const manifest = await checker.capture();
    assert.deepEqual(manifest.entries, [
      { path: "tests/locked.test.js", kind: "unchecked", why: "unreadable" },
      { path: "tests/odd.test.js", kind: "unchecked", why: "unreadable" },
      { path: "tests/ok.test.js", kind: "file", sha256: sha("ok\n") },
      { path: "tests/private", kind: "unchecked", why: "unreadable" },
    ]);
    assert.deepEqual(
      checker.compare(manifest, manifest),
      ["tests/locked.test.js", "tests/odd.test.js", "tests/private"],
      "an unchecked path can never be shown unchanged",
    );

    const fine = await buildIntegrityChecker(options).capture();
    assert.deepEqual(checker.compare(fine, manifest), ["tests/locked.test.js", "tests/odd.test.js", "tests/private", "tests/private/p.test.js"]);
  });

  test("an entry whose real path cannot be resolved for another reason than a missing file is unreadable, not absent", async (t) => {
    const sb = await sandbox(t);
    await put(sb.ws, "tests/a.test.js", "a\n");
    const files = failing((target) => target.endsWith("tests"), "realpath", "EPERM");
    const manifest = await buildIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["tests"], externalPaths: [] }, DEFAULT_INTEGRITY_LIMITS, files).capture();
    assert.deepEqual(manifest.entries, [{ path: "tests", kind: "unchecked", why: "unreadable" }]);
  });
});

describe("K2 limits", () => {
  test("the default limits are the contract's", () => {
    assert.deepEqual(DEFAULT_INTEGRITY_LIMITS, { maxFiles: MAX_INTEGRITY_FILES, maxBytes: MAX_INTEGRITY_BYTES });
  });

  test("file limit: the entry being listed and every later entry become one unchecked/limit entry each; earlier entries stay", async (t) => {
    const sb = await sandbox(t);
    await put(sb.ws, "first/1.txt", "1");
    await put(sb.ws, "first/2.txt", "2");
    for (let i = 0; i < 5; i += 1) await put(sb.ws, `big/f${i}.txt`, String(i));
    await put(sb.ws, "later/l.txt", "l");
    const checker = buildIntegrityChecker(
      { workspace: sb.workspace, protectedPaths: ["first", "big", "later", "missing"], externalPaths: [join(sb.outside, "x")] },
      { maxFiles: 3, maxBytes: DEFAULT_INTEGRITY_LIMITS.maxBytes },
    );
    const manifest = await checker.capture();
    assert.deepEqual(manifest.entries, [
      { path: "big", kind: "unchecked", why: "limit" },
      { path: "first/1.txt", kind: "file", sha256: sha("1") },
      { path: "first/2.txt", kind: "file", sha256: sha("2") },
      { path: "later", kind: "unchecked", why: "limit" },
      { path: "missing", kind: "unchecked", why: "limit" },
      { path: shown(join(sb.outside, "x")), kind: "unchecked", why: "limit" },
    ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
    assert.deepEqual(checker.compare(manifest, manifest), ["big", "later", "missing", shown(join(sb.outside, "x"))].sort());
  });

  test("byte limit: the bytes of all files count together", async (t) => {
    const sb = await sandbox(t);
    await put(sb.ws, "a/six.txt", "123456");
    await put(sb.ws, "b/six.txt", "abcdef");
    const checker = buildIntegrityChecker(
      { workspace: sb.workspace, protectedPaths: ["a", "b"], externalPaths: [] },
      { maxFiles: DEFAULT_INTEGRITY_LIMITS.maxFiles, maxBytes: 10 },
    );
    assert.deepEqual((await checker.capture()).entries, [
      { path: "a/six.txt", kind: "file", sha256: sha("123456") },
      { path: "b", kind: "unchecked", why: "limit" },
    ]);
  });

  test("byte limit with the contract's MAX_INTEGRITY_BYTES: a larger file is not read", async (t) => {
    const sb = await sandbox(t);
    const huge = join(sb.ws, "huge", "data.bin");
    await mkdir(dirname(huge));
    const handle = await open(huge, "w");
    try {
      await handle.truncate(MAX_INTEGRITY_BYTES + 1);
    } finally {
      await handle.close();
    }
    let hashed = 0;
    const files: IntegrityFileSystem = {
      ...nodeIntegrityFileSystem,
      hashFile: (file, maxBytes) => {
        hashed += 1;
        return nodeIntegrityFileSystem.hashFile(file, maxBytes);
      },
    };
    const manifest = await buildIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["huge"], externalPaths: [] }, DEFAULT_INTEGRITY_LIMITS, files).capture();
    assert.deepEqual(manifest.entries, [{ path: "huge", kind: "unchecked", why: "limit" }]);
    assert.equal(hashed, 0, "the size alone decides; nothing is read");
  });

  test("a large directory over the contract's MAX_INTEGRITY_FILES becomes unchecked/limit", { timeout: 120_000 }, async (t) => {
    const sb = await sandbox(t);
    const dir = join(sb.ws, "many");
    await mkdir(dir);
    for (let start = 0; start <= MAX_INTEGRITY_FILES; start += 500) {
      const batch: Promise<void>[] = [];
      for (let i = start; i < Math.min(start + 500, MAX_INTEGRITY_FILES + 1); i += 1) batch.push(writeFile(join(dir, `f${i}.txt`), ""));
      await Promise.all(batch);
    }
    await put(sb.ws, "small/s.txt", "s");
    const checker = createIntegrityChecker({ workspace: sb.workspace, protectedPaths: ["small", "many"], externalPaths: [] });
    const manifest = await checker.capture();
    assert.deepEqual(manifest.entries, [
      { path: "many", kind: "unchecked", why: "limit" },
      { path: "small/s.txt", kind: "file", sha256: sha("s") },
    ]);
  });
});

describe("K2 compare", () => {
  const h1 = sha("1");
  const h2 = sha("2");
  const manifest = (entries: IntegrityEntry[]): IntegrityManifest => ({ entries });
  const before = manifest([
    { path: asRawText("a"), kind: "file", sha256: h1 },
    { path: asRawText("b"), kind: "link", sha256: h2 },
    { path: asRawText("c"), kind: "absent" },
    { path: asRawText("d"), kind: "unchecked", why: "unreadable" },
    { path: asRawText("f"), kind: "file", sha256: h1 },
  ]);
  const after = manifest([
    { path: asRawText("a"), kind: "file", sha256: h1 },
    { path: asRawText("b"), kind: "file", sha256: h2 },
    { path: asRawText("c"), kind: "absent" },
    { path: asRawText("d"), kind: "unchecked", why: "unreadable" },
    { path: asRawText("e"), kind: "file", sha256: h1 },
    { path: asRawText("f"), kind: "file", sha256: h2 },
  ]);

  test("reports paths in one manifest only, a different kind or hash, and every unchecked path; sorted and unique", () => {
    const checker = createIntegrityChecker({ workspace: { root: "unused" } as Workspace, protectedPaths: [], externalPaths: [] });
    assert.deepEqual(checker.compare(before, after), ["b", "d", "e", "f"]);
    assert.deepEqual(checker.compare(before, before), ["d"], "compare(m, m) lists exactly the unchecked paths");
    assert.deepEqual(checker.compare(manifest([]), manifest([])), []);
  });
});
