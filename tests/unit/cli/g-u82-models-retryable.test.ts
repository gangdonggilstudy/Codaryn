/**
 * U-82 (DR-68, review R-75 M1): the transport tells whether a failure may be tried again, also when
 * it has no HTTP status (a refused connection: true). The run result took that verdict, but
 * `models --json` did not: src/cli/models.ts gave cliErrorFacts the listing's kind and status only,
 * so a refused connection had no `retryable`. Now the listing's own `retryable` goes with them.
 * The real CLI under the net guard; each provider's address is a closed 127.0.0.1 port (nothing
 * listens; no other host is tried); retries are 0 so the test does not wait. Fake keys only.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV, OPENAI_API_KEY_ENV, type CliErrorOutput } from "../../../src/contracts/index.js";

const temporaryDirs: string[] = [];
const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const guard = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;
/** Not real key formats; built from parts (G-10). */
const ANTHROPIC_FAKE = ["fake", "u82", "anthropic", "0042"].join("-");
const OPENAI_FAKE = ["fake", "u82", "openai", "0042"].join("-");

let closed = "";
before(async () => {
  // A port that was just free: bound, read, closed. Nothing listens on it during the test.
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closed = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

async function models(args: readonly string[], extraEnv: Record<string, string>): Promise<{ status: number | null; output: CliErrorOutput; guardLog: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u82-"));
  temporaryDirs.push(base);
  const home = path.join(base, "home");
  await mkdir(home);
  // No retries, so the refused connection is told at once.
  await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, maxRetries: 0, providers: { openai: { maxRetries: 0 } } }), "utf8");
  const guardLog = path.join(base, "net-guard.log");
  const env: Record<string, string> = { APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, HOME: home, USERPROFILE: home, CODARYN_LANG: "en", CODARYN_IT_NET_GUARD_LOG: guardLog, ...extraEnv };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  const run = spawnSync(process.execPath, ["--import", guard, main, "models", "--config", "config.json", "--json", ...args], { cwd: base, env, encoding: "utf8" });
  return { status: run.status, output: JSON.parse(run.stdout) as CliErrorOutput, guardLog };
}

describe("U-82 (R-75 M1): models --json takes the transport's verdict on a refused connection", () => {
  test("anthropic: model_list_failed with retryable true", async () => {
    const { output, guardLog } = await models([], { [ANTHROPIC_API_KEY_ENV]: ANTHROPIC_FAKE, CODARYN_API_BASE_URL: closed });
    assert.deepEqual([output.kind, output.code, output.category, output.retryable], ["error", "model_list_failed", "environment", true], JSON.stringify(output));
    assert.equal(JSON.stringify(output).includes(ANTHROPIC_FAKE), false, "the key value is not printed");
    assert.equal(await stat(guardLog).then(() => true, () => false), false, "no other host was tried");
  });

  test("openai: model_list_failed with retryable true", async () => {
    const { output, guardLog } = await models(["--provider", "openai"], { [OPENAI_API_KEY_ENV]: OPENAI_FAKE, CODARYN_OPENAI_API_BASE_URL: closed });
    assert.deepEqual([output.kind, output.code, output.category, output.retryable], ["error", "model_list_failed", "environment", true], JSON.stringify(output));
    assert.equal(JSON.stringify(output).includes(OPENAI_FAKE), false, "the key value is not printed");
    assert.equal(await stat(guardLog).then(() => true, () => false), false, "no other host was tried");
  });
});
