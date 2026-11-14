/** Public writer fixtures; all files are synthetic and stay under an owned temporary directory. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import * as legacy from "../../../src/cli/models.js";
import type { ConfigWriteOptions, ModelsEnvironment } from "../../../src/cli/models.js";
import { withModel, writeConfigAtomic } from "../../../src/app/config-write.js";
import type { ConfigWriteOptions as AppConfigWriteOptions } from "../../../src/app/config-write.js";

async function fixture(t: TestContext): Promise<{ root: string; file: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-u330-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, file: path.join(root, "config.json") };
}

test("U330 legacy exports and writer call signatures remain public", () => {
  assert.deepEqual(Object.keys(legacy).sort(), ["renderModels", "runModels", "withModel", "writeConfigAtomic"]);
  assert.equal(legacy.withModel, withModel);
  assert.equal(legacy.writeConfigAtomic, writeConfigAtomic);
  assert.equal(legacy.withModel.length, 2);
  assert.equal(legacy.writeConfigAtomic.length, 3);
  const options: ConfigWriteOptions = { exclusive: false, expected: null };
  const appOptions: AppConfigWriteOptions = options;
  const legacyOptions: ConfigWriteOptions = appOptions;
  const hook: NonNullable<ModelsEnvironment["writeConfig"]> = writeConfigAtomic;
  const legacyWriter: typeof writeConfigAtomic = legacy.writeConfigAtomic;
  const appWriter: typeof legacy.writeConfigAtomic = writeConfigAtomic;
  assert.equal(legacyOptions, options);
  assert.equal(hook, legacyWriter);
  assert.equal(appWriter, legacyWriter);
});

test("U330 withModel preserves BOM, CRLF, tabs, final newline and field position", () => {
  const input = '\ufeff{\r\n\t"schemaVersion": 1,\r\n\t"keep": 2\r\n}\r\n';
  assert.equal(legacy.withModel(input, "new-model"), '\ufeff{\r\n\t"schemaVersion": 1,\r\n\t"model": "new-model",\r\n\t"keep": 2\r\n}\r\n');
  assert.equal(legacy.withModel('{\n    "model": "old",\n    "keep": true\n}', "new-model"), '{\n    "model": "new-model",\n    "keep": true\n}');
});

test("U330 withModel keeps provider fields and does not validate model ids", () => {
  assert.equal(legacy.withModel('{"model":"top","providers":{"openai":{"keep":3,"model":"old"}}}', "", "openai"), '{\n  "model": "top",\n  "providers": {\n    "openai": {\n      "keep": 3,\n      "model": ""\n    }\n  }\n}');
  assert.deepEqual(JSON.parse(legacy.withModel('{"providers":[]}', 'bad id/"', "anthropic")), { providers: { anthropic: { model: 'bad id/"' } } });
  assert.throws(() => legacy.withModel("{", "new"), SyntaxError);
  assert.throws(() => legacy.withModel("null", "new"), TypeError);
});

test("U330 exclusive creation preserves bytes and rejects an existing target", async (t) => {
  const { file } = await fixture(t);
  const text = '\ufeff{\r\n\t"model":"synthetic"\r\n}\r\n';
  const result: Promise<void> = legacy.writeConfigAtomic(file, text, {
    exclusive: true,
    get expected(): string | null { throw new Error("exclusive must not read expected"); },
  });
  assert.equal(await result, undefined);
  assert.equal(await fs.readFile(file, "utf8"), text);
  await assert.rejects(legacy.writeConfigAtomic(file, "changed", { exclusive: true, expected: null }), { code: "EEXIST" });
  assert.equal(await fs.readFile(file, "utf8"), text);
});

test("U330 replacement preserves mode, exact bytes and reads expected after starting", async (t) => {
  const { root, file } = await fixture(t);
  await fs.writeFile(file, "before", { mode: 0o600 });
  const mode = (await fs.stat(file)).mode & 0o777;
  const trace: string[] = [];
  const result = legacy.writeConfigAtomic(file, "after\r\n", {
    get exclusive() { trace.push("exclusive"); return false; },
    get expected() { trace.push("expected"); return "before"; },
  });
  assert.deepEqual(trace, ["exclusive"]);
  await result;
  assert.deepEqual(trace, ["exclusive", "expected"]);
  assert.equal(await fs.readFile(file, "utf8"), "after\r\n");
  assert.equal((await fs.stat(file)).mode & 0o777, mode);
  assert.deepEqual(await fs.readdir(root), ["config.json"]);
});

for (const expected of ["stale", null]) {
  test(`U330 expected ${String(expected)} refuses replacement and leaves no temporary file`, async (t) => {
    const { root, file } = await fixture(t);
    await fs.writeFile(file, "before");
    await assert.rejects(legacy.writeConfigAtomic(file, "after", { exclusive: false, expected }), { message: "the config file changed while models ran" });
    assert.equal(await fs.readFile(file, "utf8"), "before");
    assert.deepEqual(await fs.readdir(root), ["config.json"]);
  });
}

test("U330 missing replacement target propagates ENOENT and creates nothing", async (t) => {
  const { root, file } = await fixture(t);
  await assert.rejects(legacy.writeConfigAtomic(file, "after", { exclusive: false, expected: null }), { code: "ENOENT" });
  assert.deepEqual(await fs.readdir(root), []);
});

for (const operation of ["stat", "chmod", "readFile", "rename"] as const) {
  test(`U330 ${operation} failure preserves the original error and target`, async (t) => {
    const { root, file } = await fixture(t);
    await fs.writeFile(file, "before");
    const fault = Object.assign(new Error(`synthetic ${operation} failure`), { code: "EIO" });
    const stub = t.mock.method(fs, operation, async () => { throw fault; });
    try {
      await assert.rejects(legacy.writeConfigAtomic(file, "after", { exclusive: false, expected: "before" }), (error: unknown) => error === fault);
    } finally {
      stub.mock.restore();
    }
    assert.equal(await fs.readFile(file, "utf8"), "before");
    assert.deepEqual(await fs.readdir(root), ["config.json"]);
  });
}

test("U330 failed temporary creation propagates its error without entering cleanup", async (t) => {
  const { root, file } = await fixture(t);
  await fs.writeFile(file, "before");
  const fault = Object.assign(new Error("synthetic temporary write failure"), { code: "ENOSPC" });
  const write = t.mock.method(fs, "writeFile", async () => { throw fault; });
  const remove = t.mock.method(fs, "rm", async () => { throw new Error("cleanup must not run"); });
  try {
    await assert.rejects(legacy.writeConfigAtomic(file, "after", { exclusive: false, expected: "before" }), (error: unknown) => error === fault);
    assert.equal(remove.mock.callCount(), 0);
  } finally {
    write.mock.restore();
    remove.mock.restore();
  }
  assert.equal(await fs.readFile(file, "utf8"), "before");
  assert.deepEqual(await fs.readdir(root), ["config.json"]);
});

test("U330 cleanup error overrides rename error and leaves the temporary bytes", async (t) => {
  const { root, file } = await fixture(t);
  await fs.writeFile(file, "before");
  const renameFault = Object.assign(new Error("synthetic rename failure"), { code: "EPERM" });
  const cleanupFault = Object.assign(new Error("synthetic cleanup failure"), { code: "EBUSY" });
  const rename = t.mock.method(fs, "rename", async () => { throw renameFault; });
  const remove = t.mock.method(fs, "rm", async () => { throw cleanupFault; });
  try {
    await assert.rejects(legacy.writeConfigAtomic(file, "after", { exclusive: false, expected: "before" }), (error: unknown) => error === cleanupFault);
  } finally {
    rename.mock.restore();
    remove.mock.restore();
  }
  assert.equal(await fs.readFile(file, "utf8"), "before");
  const temporary = (await fs.readdir(root)).filter((name) => name !== "config.json");
  assert.equal(temporary.length, 1);
  assert.equal(await fs.readFile(path.join(root, temporary[0]!), "utf8"), "after");
});
