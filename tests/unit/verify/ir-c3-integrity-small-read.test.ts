/** IR-C3: a real file grows after the integrity reader's fstat; its read budget still holds. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { buildIntegrityChecker, nodeIntegrityFileSystem } from "../../../src/verify/integrity.js";
import { createWorkspace } from "../../../src/workspace/index.js";

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function fixture(t: TestContext): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "codaryn-ir-c3-")));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return root;
}

/** Only the timing/observation boundary is mocked: stat, append and every read use the real file. */
function growAfterStat(t: TestContext, target: string, extra: Uint8Array) {
  const actualOpen = fs.open;
  let grown = false;
  let closed = false;
  let initialSize = -1;
  const readBytes: (() => Promise<number>)[] = [];
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await actualOpen(...args);
    if (args[0] !== target) return handle;
    const actualStat = handle.stat.bind(handle);
    t.mock.method(handle, "stat", async () => {
      const info = await actualStat();
      if (!grown) {
        initialSize = info.size;
        await fs.appendFile(target, extra);
        grown = true;
      }
      return info;
    });
    const read = t.mock.method(handle, "read");
    const readFile = t.mock.method(handle, "readFile");
    readBytes.push(async () => {
      let total = 0;
      for (const call of read.mock.calls) {
        const result = await call.result;
        assert.ok(result !== undefined);
        total += result.bytesRead;
      }
      for (const call of readFile.mock.calls) {
        const result = await call.result;
        assert.ok(result !== undefined);
        total += Buffer.byteLength(result);
      }
      return total;
    });
    const actualClose = handle.close.bind(handle);
    t.mock.method(handle, "close", async () => {
      await actualClose();
      closed = true;
    });
    return handle;
  });
  return {
    initialSize: () => initialSize,
    grew: () => grown,
    closed: () => closed,
    bytes: async () => (await Promise.all(readBytes.map((read) => read()))).reduce((sum, bytes) => sum + bytes, 0),
  };
}

test("IR-C3: a growing small file reads no more than the budget plus one detection byte", async (t) => {
  const root = await fixture(t);
  const target = join(root, "growing.bin");
  await fs.writeFile(target, Buffer.alloc(8, 1));
  const observed = growAfterStat(t, target, Buffer.alloc(1024, 2));
  const budget = 64;
  const result = await nodeIntegrityFileSystem.hashFile(target, budget);
  const bytes = await observed.bytes();
  t.diagnostic(JSON.stringify({ initialBytes: observed.initialSize(), grownBytes: 1032, budget, bytesRead: bytes, closed: observed.closed() }));
  assert.equal(observed.grew(), true, "the actual file grew after the actual fstat");
  assert.equal(result, "too_large");
  assert.equal(observed.closed(), true);
  assert.ok(bytes <= budget + 1, `read ${bytes} bytes for a ${budget}-byte budget (plus one detection byte)`);
});

test("IR-C3: growth keeps capture unchecked/limit while respecting the remaining read budget", async (t) => {
  const root = await fixture(t);
  const target = join(root, "growing.bin");
  await fs.writeFile(target, Buffer.alloc(8, 1));
  const workspace = await createWorkspace({ root });
  const observed = growAfterStat(t, target, Buffer.alloc(1024, 2));
  const manifest = await buildIntegrityChecker(
    { workspace, protectedPaths: ["growing.bin"], externalPaths: [] },
    { maxFiles: 10, maxBytes: 64 },
  ).capture();
  const bytes = await observed.bytes();
  t.diagnostic(JSON.stringify({ captureBytesRead: bytes, budget: 64, closed: observed.closed() }));
  assert.deepEqual(manifest.entries, [{ path: "growing.bin", kind: "unchecked", why: "limit" }]);
  assert.equal(observed.grew(), true);
  assert.equal(observed.closed(), true);
  assert.ok(bytes <= 65, `capture read ${bytes} bytes for a 64-byte budget (plus one detection byte)`);
});

test("IR-C3: empty, exact-budget and binary/BOM contents keep their byte hashes", async (t) => {
  const root = await fixture(t);
  const target = join(root, "bytes.bin");
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(64, 3), Buffer.alloc(128 * 1024 + 7, 9), Buffer.from([0xef, 0xbb, 0xbf, 0, 0xff, 0x0d, 0x0a])]) {
    await fs.writeFile(target, bytes);
    assert.deepEqual(await nodeIntegrityFileSystem.hashFile(target, bytes.length), { sha256: sha(bytes), bytes: bytes.length });
  }
});

test("IR-C3: growth within the remaining budget hashes all new bytes through the same handle", async (t) => {
  const root = await fixture(t);
  const target = join(root, "growing.bin");
  const initial = Buffer.alloc(8, 1);
  const extra = Buffer.alloc(24, 2);
  await fs.writeFile(target, initial);
  const observed = growAfterStat(t, target, extra);
  const bytes = Buffer.concat([initial, extra]);
  assert.deepEqual(await nodeIntegrityFileSystem.hashFile(target, 64), { sha256: sha(bytes), bytes: bytes.length });
  assert.equal(observed.closed(), true);
  assert.equal(await observed.bytes(), bytes.length);
});
