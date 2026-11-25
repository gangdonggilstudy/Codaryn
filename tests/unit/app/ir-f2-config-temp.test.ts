/**
 * IR-F2: replacing the config file leaves no temporary file when writing it fails after it was made.
 * A temporary file this writer did not make (EEXIST) is never removed. The I/O double makes the
 * synthetic temporary file, writes a few bytes to it and then fails, at the old call (fs.writeFile)
 * and at the new one (a handle from fs.open), so the same test runs before and after the change.
 * Every file is synthetic and stays under an owned temporary directory; no disk is filled.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { writeConfigAtomic } from "../../../src/app/config-write.js";

async function fixture(t: TestContext): Promise<{ root: string; file: string }> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-f2-")));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const file = path.join(root, "config.json");
  await fs.writeFile(file, "before");
  return { root, file };
}

const isTemporary = (file: unknown): boolean => /[\\/]\.config\.json\.[0-9a-f]{12}\.tmp$/.test(String(file));

/** `before(file)` runs before the temporary file is made; `partial` is written to it, then `fault` is thrown. */
function failingTemporary(t: TestContext, fault: Error, partial: string | null, before?: (file: string) => Promise<void>): void {
  const realWriteFile = fs.writeFile.bind(fs);
  const realOpen = fs.open.bind(fs);
  t.mock.method(fs, "writeFile", async (...args: Parameters<typeof fs.writeFile>) => {
    if (!isTemporary(args[0])) return realWriteFile(...args);
    await before?.(String(args[0]));
    if (partial === null) return realWriteFile(...args);
    await realWriteFile(args[0], partial, { encoding: "utf8", flag: "wx" });
    throw fault;
  });
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (!isTemporary(args[0])) return realOpen(...args);
    await before?.(String(args[0]));
    const handle: FileHandle = await realOpen(...args);
    if (partial === null) return handle;
    const write = handle.write.bind(handle);
    const fail = async (): Promise<never> => {
      await write(partial, null, "utf8");
      throw fault;
    };
    handle.writeFile = fail as FileHandle["writeFile"];
    handle.write = fail as unknown as FileHandle["write"];
    return handle;
  });
  t.after(() => t.mock.restoreAll());
}

test("IR-F2 a temporary file that fails after a partial write is removed; the config stays", async (t) => {
  const { root, file } = await fixture(t);
  const fault = Object.assign(new Error("synthetic partial write failure"), { code: "ENOSPC" });
  failingTemporary(t, fault, "af");
  await assert.rejects(writeConfigAtomic(file, "after", { exclusive: false, expected: "before" }), (error: unknown) => error === fault);
  t.mock.restoreAll();
  assert.equal(await fs.readFile(file, "utf8"), "before");
  assert.deepEqual(await fs.readdir(root), ["config.json"]);
});

test("IR-F2 a temporary name that already exists (EEXIST) is not this writer's: it is not removed", async (t) => {
  const { root, file } = await fixture(t);
  const write = fs.writeFile.bind(fs);
  let other = "";
  failingTemporary(t, new Error("unused"), null, async (temporary) => {
    other = temporary;
    await write(temporary, "SOMEONE ELSE");
  });
  await assert.rejects(writeConfigAtomic(file, "after", { exclusive: false, expected: "before" }), { code: "EEXIST" });
  t.mock.restoreAll();
  assert.equal(await fs.readFile(file, "utf8"), "before");
  assert.equal(await fs.readFile(other, "utf8"), "SOMEONE ELSE");
  assert.deepEqual((await fs.readdir(root)).sort(), ["config.json", path.basename(other)].sort());
});

test("IR-F2 control: a replacement writes the exact bytes, keeps the mode and leaves only the config", async (t) => {
  const { root, file } = await fixture(t);
  await fs.chmod(file, 0o600);
  const mode = (await fs.stat(file)).mode & 0o777;
  const text = '﻿{\r\n\t"model": "synthetic-é"\r\n}\r\n';
  await writeConfigAtomic(file, text, { exclusive: false, expected: "before" });
  assert.deepEqual(await fs.readFile(file), Buffer.from(text, "utf8"));
  assert.equal((await fs.stat(file)).mode & 0o777, mode);
  assert.deepEqual(await fs.readdir(root), ["config.json"]);
});
