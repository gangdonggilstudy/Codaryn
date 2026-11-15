/**
 * DR-34 (c) (review R-20 L-2): openai's address rule (`with_version`: no address ending in
 * /responses or /models) is checked on the environment variable path too, in run and doctor.
 * Before, an openai run stopped with provider_not_implemented before its address was read.
 * Fake values built at run time; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CODARYN_OPENAI_API_BASE_URL_ENV, OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { DoctorOutput } from "../../../src/contracts/index.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const OPENAI_VALUE = ["fake", "dr34c", "openai", "value", "0001"].join("-");
const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 };
const CONFIG = { provider: "openai", providers: { openai: { model: "gpt-x", maxOutputTokens: 64 } }, limits: LIMITS };

async function workspace(): Promise<{ base: string; ws: string; configPath: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr34c-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  const configPath = path.join(base, "config.json");
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, ...CONFIG }), "utf8");
  return { base, ws, configPath };
}

describe("DR-34 (c): openai's address rule on the variable path", () => {
  for (const address of ["https://gateway.example/v1/responses", "https://gateway.example/v1/models/", "http://gateway.example/v1"]) {
    test(`run refuses ${address} as invalid_config before anything is made`, async () => {
      const { base, ws, configPath } = await workspace();
      let made = false;
      const outcome = await runCli({
        argv: ["run", "--workspace", ws, "--goal", "g", "--config", configPath, "--quiet"],
        env: { [OPENAI_API_KEY_ENV]: OPENAI_VALUE, [CODARYN_OPENAI_API_BASE_URL_ENV]: address },
        cwd: base,
        readFile: (file) => readFile(file, "utf8"),
        isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
        loadEnvFile: () => {},
        locateInWorkspace: (file, root) => locateInWorkspace(file, root),
        relatePaths: (target, root) => relateRealPaths(target, root),
        clock: { now: () => Date.now() },
        randomBytes: (size) => new Uint8Array(size).fill(8),
        assemble: async () => {
          made = true;
          throw new Error("nothing may be assembled");
        },
        cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
      });
      assert.ok(outcome.output.kind === "error" && outcome.output.code === "invalid_config", JSON.stringify(outcome.output));
      assert.ok(outcome.output.message.startsWith(CODARYN_OPENAI_API_BASE_URL_ENV), outcome.output.message);
      assert.equal(made, false);
    });
  }

  test("doctor's model check fails on the same address", async () => {
    const { base, ws, configPath } = await workspace();
    const outcome = await runDoctor({
      argv: ["doctor", "--config", configPath, "--workspace", ws, "--json"],
      env: { [OPENAI_API_KEY_ENV]: OPENAI_VALUE, [CODARYN_OPENAI_API_BASE_URL_ENV]: "https://gateway.example/v1/responses" },
      cwd: base,
      nodeVersion: "26.13.0",
      readFile: (file) => readFile(file, "utf8"),
      isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
      isFile: async (file) => (await stat(file).catch(() => null))?.isFile() ?? false,
      locateInWorkspace: (file, root) => locateInWorkspace(file, root),
      relatePaths: (target, root) => relateRealPaths(target, root),
    });
    assert.ok("text" in outcome);
    const model = (JSON.parse(outcome.text) as DoctorOutput).checks.find((check) => check.id === "model");
    assert.equal(model?.status, "fail");
    assert.deepEqual(model?.text, { id: "doctor.model.base_url_invalid" });
  });
});
