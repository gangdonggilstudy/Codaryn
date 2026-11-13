/**
 * U-87 (design gap C-12, architecture.md A-1; PM answer): a key that cannot be sent as it is (S-11:
 * printable ASCII 0x21-0x7E, no space; no length or prefix rule, second-provider-facts C-3).
 * - run (PM 1): stays as it is, a run result that says what happened (DR-48: the shape machines
 *   read does not change). Pinned here: no request leaves, the key value is nowhere (stdout,
 *   stderr, the state directory), and the result carries modelError not_configured at turn 1.
 * - doctor (PM 2): the key check fails when the key is set but unusable, with the reason and never
 *   the value (doctor.api_key.unusable).
 * The real CLI under the net guard; the provider address is a counting server on 127.0.0.1;
 * the default config location is a test folder. Fake values only.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import type { DoctorOutput, EngineResult } from "../../../src/contracts/index.js";

const temporaryDirs: string[] = [];
const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const guard = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;

/** Fake keys of the wrong form, built from parts: a space inside, and a letter outside ASCII. */
const BAD_KEYS = {
  space: ["fake", "key with", "space", "0042"].join("-"),
  nonAscii: ["fake", "kéy", "0042"].join("-"),
};

let requests = 0;
const server = createServer((_request, response) => {
  requests += 1;
  response.writeHead(500).end();
});
let address = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

/** Every file under `dir`, as text. */
async function allText(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const parts: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) parts.push(await allText(full));
    else parts.push(await readFile(full, "utf8").catch(() => ""));
  }
  return parts.join("\n");
}

async function setup(key: string): Promise<{ base: string; cli: (args: readonly string[]) => { status: number | null; stdout: string; stderr: string }; guardLog: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u87-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "ws"));
  const home = path.join(base, "home");
  await mkdir(home);
  const task = {
    schemaVersion: 1,
    id: "u87",
    goal: "g",
    workflow: "test",
    workspaceRoot: "./ws",
    model: { provider: "anthropic", model: "fake-model", maxOutputTokens: 64 },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 10_000 },
    verifiers: [],
  };
  await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
  const guardLog = path.join(base, "net-guard.log");
  const env: Record<string, string> = {
    APPDATA: home,
    LOCALAPPDATA: home,
    XDG_CONFIG_HOME: home,
    HOME: home,
    USERPROFILE: home,
    CODARYN_LANG: "en",
    CODARYN_API_BASE_URL: address,
    CODARYN_IT_NET_GUARD_LOG: guardLog,
    ANTHROPIC_API_KEY: key,
  };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    base,
    guardLog,
    cli: (args) => {
      const run = spawnSync(process.execPath, ["--import", guard, main, ...args], { cwd: base, env, encoding: "utf8" });
      return { status: run.status, stdout: run.stdout, stderr: run.stderr };
    },
  };
}

describe("U-87: a key of the wrong form", () => {
  for (const [name, key] of Object.entries(BAD_KEYS)) {
    test(`run (key with ${name}): a run result as before; nothing sent; the key nowhere; modelError not_configured`, async () => {
      const box = await setup(key);
      const before = requests;
      const run = box.cli(["run", "--task", "task.json", "--quiet"]);
      assert.equal(run.status, 1, run.stdout + run.stderr);
      const result = JSON.parse(run.stdout) as EngineResult;
      assert.deepEqual([result.kind, result.status, result.reason], ["run", "failed", "model_error"]);
      assert.deepEqual(result.modelError, { kind: "not_configured", turn: 1, retryable: false });
      assert.equal(requests, before, "no request reached the provider address");
      assert.equal(await stat(box.guardLog).then(() => true, () => false), false, "nothing tried another host");
      const state = await allText(path.join(box.base, "ws", ".codaryn"));
      for (const printed of [run.stdout, run.stderr, state]) assert.equal(printed.includes(key), false, "the key value is never written");
    });

    test(`doctor (key with ${name}): the key check fails with its reason, never the value`, async () => {
      const box = await setup(key);
      const doctor = box.cli(["doctor", "--task", "task.json", "--json"]);
      const output = JSON.parse(doctor.stdout) as DoctorOutput;
      const check = output.checks.find((entry) => entry.id === "api_key");
      assert.equal(check?.status, "fail", JSON.stringify(check));
      assert.match(check?.message ?? "", /printable ASCII/);
      assert.deepEqual(check?.text, { id: "doctor.api_key.unusable", params: { keyEnv: "ANTHROPIC_API_KEY" } });
      assert.equal(doctor.stdout.includes(key) || doctor.stderr.includes(key), false, "the key value is never printed");
      assert.equal(requests, 0, "doctor sends nothing");
    });
  }
});
