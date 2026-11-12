/**
 * A-1: the app layer's environment handling (adapter-contract section 4). The variables file is
 * read without touching process.env, with the same results process.loadEnvFile gives the CLI.
 * Fake values only.
 */

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { copyEnvironment, createNodeAppEnvironment, loadVarsInto, readVarsFileSync } from "../../../src/app/index.js";
import { tempDir } from "./support.js";

describe("copyEnvironment", () => {
  test("Windows: names match without case, keep their first spelling, and the source is not changed", () => {
    const source = { Path: "C:\\bin", HOME: undefined, Codaryn_Value: "a" };
    const env = copyEnvironment(source, "win32");
    assert.equal(env["PATH"], "C:\\bin");
    assert.equal(env["path"], "C:\\bin");
    assert.equal("CODARYN_VALUE" in env, true);
    assert.equal("HOME" in env, false, "undefined values are not copied");

    env["codaryn_value"] = "b";
    env["NEW_NAME"] = "c";
    assert.deepEqual({ ...env }, { Path: "C:\\bin", Codaryn_Value: "b", NEW_NAME: "c" });
    delete env["PATH"];
    assert.equal(env["Path"], undefined);
    assert.deepEqual(source, { Path: "C:\\bin", HOME: undefined, Codaryn_Value: "a" });
  });

  test("elsewhere: a plain copy with case-sensitive names", () => {
    const env = copyEnvironment({ Path: "/bin", HOME: undefined }, "linux");
    assert.equal(env["PATH"], undefined);
    assert.deepEqual({ ...env }, { Path: "/bin" });
  });
});

describe("variables file", () => {
  const CONTENT = [
    "APP_EQ_KEEP=after",
    "# a comment",
    'APP_EQ_A="quoted value"',
    "export APP_EQ_B=exported",
    "APP_EQ_C=  spaced  ",
    "APP_EQ_D='single # not a comment'",
    "APP_EQ_E=x # trailing comment",
    'APP_EQ_F="multi',
    'line"',
    "",
  ].join("\n");

  test("readVarsFileSync gives what process.loadEnvFile loads, and loadVarsInto keeps names already set as it does", async () => {
    const file = path.join(await tempDir(), "vars.env");
    await writeFile(file, CONTENT, "utf8");
    const parsed = readVarsFileSync(file);
    const names = Object.keys(parsed);
    assert.deepEqual(names.sort(), ["APP_EQ_A", "APP_EQ_B", "APP_EQ_C", "APP_EQ_D", "APP_EQ_E", "APP_EQ_F", "APP_EQ_KEEP"]);
    for (const name of names) assert.equal(process.env[name], undefined, `${name} must not be set before the test`);

    process.env["APP_EQ_KEEP"] = "before";
    try {
      process.loadEnvFile(file);
      const env: Record<string, string | undefined> = { APP_EQ_KEEP: "before" };
      loadVarsInto(env, file, readVarsFileSync);
      for (const name of names) assert.equal(env[name], process.env[name], name);
      assert.equal(env["APP_EQ_KEEP"], "before");
    } finally {
      for (const name of names) delete process.env[name];
    }
  });

  test("readVarsFileSync does not change process.env and throws for a missing file", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "vars.env");
    await writeFile(file, "APP_EQ_ONLY_READ=value-not-loaded\n", "utf8");
    assert.deepEqual(readVarsFileSync(file), { APP_EQ_ONLY_READ: "value-not-loaded" });
    assert.equal(process.env["APP_EQ_ONLY_READ"], undefined);
    assert.throws(() => readVarsFileSync(path.join(dir, "absent.env")));
  });
});

describe("createNodeAppEnvironment", () => {
  test("snapshots the process and finds the codaryn package root as the install directory", async () => {
    const environment = await createNodeAppEnvironment();
    assert.equal(environment.cwd, process.cwd());
    assert.equal(environment.nodeVersion, process.versions.node);
    assert.notEqual(environment.env, process.env, "a snapshot, not the live object");
    assert.notEqual(environment.installDir, null);
    const pkg = JSON.parse(await environment.readFile(path.join(environment.installDir as string, "package.json"))) as { name?: string };
    assert.equal(pkg.name, "codaryn");
  });
});
