/** C3R-1: real large files obey the byte budget through one bounded, always-closed handle. */
import assert from "node:assert/strict";
import { createHash, Hash } from "node:crypto";
import type { BinaryLike, Encoding } from "node:crypto";
import nativeFs from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { buildIntegrityChecker, nodeIntegrityFileSystem } from "../../../src/verify/integrity.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const MiB = 1024 * 1024;
const CHUNK = 64 * 1024;
const sha = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

async function fixture(t: TestContext): Promise<string> {
  const temporary = await fs.realpath(tmpdir());
  const root = await fs.realpath(await fs.mkdtemp(join(temporary, "codaryn-c3r1-")));
  assert.ok(root.startsWith(temporary.endsWith(sep) ? temporary : temporary + sep));
  t.after(async () => {
    assert.equal(resolve(root), root);
    assert.ok(root.startsWith(temporary.endsWith(sep) ? temporary : temporary + sep));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return root;
}

interface Timing {
  beforeStat?: () => Promise<void>;
  afterStat?: () => Promise<void>;
  failReadAfter?: number;
}

/** Observe real fs/crypto operations; only growth timing and the read failure are injected. */
function observe(t: TestContext, target: string, timing: Timing = {}) {
  const actualOpen = fs.open, actualNativeOpen = nativeFs.open, actualNativeRead = nativeFs.read;
  const actualUpdate = Hash.prototype.update;
  const pending: Promise<void>[] = [];
  const streamFds = new Set<number>();
  const requestLengths: number[] = [], bufferLengths: number[] = [], hashChunks: number[] = [];
  let opens = 0, closes = 0, pathOpens = 0, handleBytes = 0, streamBytes = 0, statSize = -1;
  let beforeDone = false, afterDone = false;
  t.mock.method(nativeFs, "open", (...args: unknown[]) => {
    if (args[0] === target && args[1] === "r") {
      pathOpens++;
      const callback = args.at(-1);
      assert.equal(typeof callback, "function");
      args[args.length - 1] = (error: Error | null, fd: number) => {
        if (error === null) streamFds.add(fd);
        return Reflect.apply(callback as Function, undefined, [error, fd]);
      };
    }
    return Reflect.apply(actualNativeOpen, nativeFs, args);
  });
  t.mock.method(nativeFs, "read", (...args: unknown[]) => {
    if (streamFds.has(args[0] as number)) {
      const callback = args.at(-1);
      assert.equal(typeof callback, "function");
      const done = Promise.withResolvers<void>();
      pending.push(done.promise);
      args[args.length - 1] = (error: Error | null, bytesRead: number, buffer: unknown) => {
        if (error === null) streamBytes += bytesRead;
        try { return Reflect.apply(callback as Function, undefined, [error, bytesRead, buffer]); }
        finally { done.resolve(); }
      };
    }
    return Reflect.apply(actualNativeRead, nativeFs, args);
  });
  t.mock.method(Hash.prototype, "update", function (this: Hash, data: BinaryLike, encoding?: Encoding) {
    hashChunks.push(typeof data === "string" ? Buffer.byteLength(data, encoding) : data.byteLength);
    return Reflect.apply(actualUpdate, this, [data, encoding]);
  });
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await actualOpen(...args);
    if (args[0] !== target || args[1] !== "r") return handle;
    opens++;
    const actualStat = handle.stat.bind(handle), actualRead = handle.read.bind(handle), actualClose = handle.close.bind(handle);
    t.mock.method(handle, "stat", async () => {
      if (!beforeDone) { beforeDone = true; await timing.beforeStat?.(); }
      const info = await actualStat();
      statSize = info.size;
      if (!afterDone) { afterDone = true; await timing.afterStat?.(); }
      return info;
    });
    t.mock.method(handle, "read", async (...readArgs: unknown[]) => {
      assert.ok(Buffer.isBuffer(readArgs[0]));
      bufferLengths.push(readArgs[0].byteLength);
      requestLengths.push(readArgs[2] as number);
      if (timing.failReadAfter !== undefined && handleBytes >= timing.failReadAfter) {
        throw Object.assign(new Error("synthetic read failure"), { code: "EIO" });
      }
      const result = await Reflect.apply(actualRead, handle, readArgs) as { bytesRead: number; buffer: Buffer };
      handleBytes += result.bytesRead;
      return result;
    });
    t.mock.method(handle, "close", async () => { await actualClose(); closes++; });
    return handle;
  });
  return async () => {
    for (let i = 0; i < pending.length; i++) await pending[i];
    return { opens, closes, pathOpens, statSize, bytesRead: handleBytes + streamBytes,
      hashBytes: hashChunks.reduce((sum, size) => sum + size, 0), hashChunks, requestLengths, bufferLengths };
  };
}

test("C3R-1: a large file growing after fstat reads at most the budget plus one detection byte", async t => {
  const root = await fixture(t), target = join(root, "growing.bin");
  const initial = Buffer.alloc(MiB + 7, 1), budget = initial.length + 31;
  await fs.writeFile(target, initial);
  const measured = observe(t, target, { afterStat: () => fs.appendFile(target, Buffer.alloc(128 * 1024, 2)) });
  const result = await nodeIntegrityFileSystem.hashFile(target, budget);
  const seen = await measured();
  t.diagnostic(JSON.stringify({ budget, ...seen }));
  assert.equal(result, "too_large");
  assert.equal(seen.statSize, initial.length);
  assert.ok((await fs.stat(target)).size > budget);
  assert.ok(seen.bytesRead <= budget + 1, `read ${seen.bytesRead} bytes for budget ${budget} (+1 detection byte)`);
  assert.deepEqual([seen.opens, seen.closes, seen.pathOpens], [1, 1, 0]);
});

test("C3R-1: growth between lstat and fstat makes capture unchecked/limit without reading or hashing", async t => {
  const root = await fixture(t), target = join(root, "growing.bin"), budget = 96 * 1024;
  await fs.writeFile(target, Buffer.alloc(8, 1));
  const workspace = await createWorkspace({ root });
  const measured = observe(t, target, { beforeStat: () => fs.appendFile(target, Buffer.alloc(MiB, 2)) });
  const manifest = await buildIntegrityChecker({ workspace, protectedPaths: ["growing.bin"], externalPaths: [] }, { maxFiles: 10, maxBytes: budget }).capture();
  const seen = await measured();
  t.diagnostic(JSON.stringify({ budget, ...seen }));
  assert.deepEqual(manifest.entries, [{ path: "growing.bin", kind: "unchecked", why: "limit" }]);
  assert.ok(seen.statSize > budget);
  assert.deepEqual([seen.bytesRead, seen.hashBytes, seen.closes, seen.pathOpens], [0, 0, 1, 0]);
});

for (const size of [128 * 1024 + 9, 1_500_000]) {
  test(`C3R-1: fstat size ${size} already exceeds the budget, so no bytes are read or hashed`, async t => {
    const root = await fixture(t), target = join(root, "oversized.bin"), budget = 96 * 1024;
    await fs.writeFile(target, Buffer.alloc(size, 3));
    const measured = observe(t, target);
    const result = await nodeIntegrityFileSystem.hashFile(target, budget);
    const seen = await measured();
    t.diagnostic(JSON.stringify({ budget, ...seen }));
    assert.equal(result, "too_large");
    assert.equal(seen.statSize, size);
    assert.deepEqual([seen.bytesRead, seen.hashBytes, seen.opens, seen.closes, seen.pathOpens], [0, 0, 1, 1, 0]);
  });
}

test("C3R-1: a 1.5 MB binary file at the exact budget keeps its SHA-256 and bounded hash chunks", async t => {
  const root = await fixture(t), target = join(root, "binary.bin");
  const data = Buffer.alloc(1_500_000, 0xff);
  data.set([0xef, 0xbb, 0xbf, 0, 0x0d, 0x0a]);
  const expected = { sha256: sha(data), bytes: data.length };
  await fs.writeFile(target, data);
  const measured = observe(t, target);
  assert.deepEqual(await nodeIntegrityFileSystem.hashFile(target, data.length), expected);
  const seen = await measured();
  assert.equal(seen.bytesRead, data.length);
  assert.equal(seen.hashBytes, data.length);
  assert.ok(seen.hashChunks.length > 1 && seen.hashChunks.every(size => size <= CHUNK));
  assert.ok(seen.bufferLengths.every(size => size <= CHUNK));
  assert.equal(seen.closes, 1);
});

test("C3R-1: a large file growing within budget keeps all bytes on the original handle", async t => {
  const root = await fixture(t), target = join(root, "growing.bin");
  const initial = Buffer.alloc(MiB + 17, 4), extra = Buffer.alloc(32 * 1024, 5);
  const data = Buffer.concat([initial, extra]), expected = { sha256: sha(data), bytes: data.length };
  await fs.writeFile(target, initial);
  const measured = observe(t, target, { afterStat: () => fs.appendFile(target, extra) });
  assert.deepEqual(await nodeIntegrityFileSystem.hashFile(target, data.length), expected);
  const seen = await measured();
  assert.equal(seen.bytesRead, data.length);
  assert.deepEqual([seen.opens, seen.closes, seen.pathOpens], [1, 1, 0]);
  assert.ok(seen.requestLengths.length > 1 && seen.requestLengths.every(length => length <= CHUNK));
});

test("C3R-1: a large-file read error stays unchecked/unreadable and closes the original handle", async t => {
  const root = await fixture(t), target = join(root, "unreadable.bin");
  await fs.writeFile(target, Buffer.alloc(1_500_000, 6));
  const workspace = await createWorkspace({ root });
  const measured = observe(t, target, { failReadAfter: CHUNK });
  const manifest = await buildIntegrityChecker({ workspace, protectedPaths: ["unreadable.bin"], externalPaths: [] }, { maxFiles: 10, maxBytes: 2 * MiB }).capture();
  const seen = await measured();
  assert.deepEqual(manifest.entries, [{ path: "unreadable.bin", kind: "unchecked", why: "unreadable" }]);
  assert.equal(seen.bytesRead, CHUNK);
  assert.equal(seen.hashBytes, CHUNK);
  assert.deepEqual([seen.opens, seen.closes, seen.pathOpens], [1, 1, 0]);
});
