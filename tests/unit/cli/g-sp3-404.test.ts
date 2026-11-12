/**
 * Y-4 with SP-3: the hint that HTTP 404 usually means an unknown model id follows the provider's
 * own outcome (ModelOutcome.httpStatus), not the first characters of its message. A stand-in
 * provider is injected; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { EngineResult, ModelOutcome } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { MODEL_NOT_FOUND_HINT, runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
const KEY = ["fake", "sp3", "key", "value", "0001"].join("-");

async function runWith(outcome: ModelOutcome): Promise<EngineResult> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-sp3-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  const config = { schemaVersion: 1, model: "claude-x", maxOutputTokens: 100, limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 } };
  await writeFile(path.join(base, "config.json"), JSON.stringify(config), "utf8");
  const run = await runCli({
    argv: ["run", "--workspace", ws, "--goal", "g", "--config", "config.json", "--quiet"],
    env: { ANTHROPIC_API_KEY: KEY },
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    relatePaths: (target, root) => relateRealPaths(target, root),
    clock: { now: () => Date.now() },
    randomBytes: (size) => new Uint8Array(size).fill(4),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    createAnthropicProvider: () => ({ name: "anthropic", complete: async () => outcome }),
  });
  assert.equal(run.output.kind, "run", JSON.stringify(run.output));
  return run.output as EngineResult;
}

describe("Y-4 (SP-3): the model-not-found hint follows httpStatus", () => {
  test("HTTP status 404 gives the hint whatever the message says", async () => {
    const result = await runWith({ ok: false, kind: "api_error", message: "the API said: not found", httpStatus: 404 });
    assert.equal(result.reason, "model_error");
    assert.ok(result.notices.includes(MODEL_NOT_FOUND_HINT as never), JSON.stringify(result.notices));
  });

  test("a message that only starts with 'HTTP 404', without the status, gives none", async () => {
    const result = await runWith({ ok: false, kind: "api_error", message: "HTTP 404 in a quoted error body" });
    assert.equal(result.reason, "model_error");
    assert.equal(result.notices.includes(MODEL_NOT_FOUND_HINT as never), false, JSON.stringify(result.notices));
  });

  test("another status gives none", async () => {
    const result = await runWith({ ok: false, kind: "api_error", message: "HTTP 400 bad request", httpStatus: 400 });
    assert.equal(result.notices.includes(MODEL_NOT_FOUND_HINT as never), false);
  });
});
