/**
 * DR-32 (a), DR-33 (reviews R-19 L-1 and Codex): refusing a run (S-6 files, S-8 arguments) rests on
 * the registered key values and only the contract's narrowed shapes (API_KEY_PATTERN_SOURCES); the
 * loose `sk-` shape is for hiding output only (API_KEY_MASK_PATTERN_SOURCES). Ordinary names that
 * only start with `sk-` must not stop a run. The samples here are ordinary or key-like under both
 * the DR-32 and the DR-33 shapes, so the cases hold when the contract narrows once more.
 * Fake values built at run time; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { OPENAI_API_KEY_ENV } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { hideKeys } from "../../../src/cli/text-safety.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

/** Ordinary names: lower case with hyphens, which no refusal shape takes. */
const ORDINARY = [
  ["sk", "onboarding", "checklist", "for", "new", "hires", "2026"].join("-"),
  ["sk", "1234", "implement", "the", "new", "billing", "flow"].join("-"),
];
/** A key-like text under every refusal shape: a distinct prefix, then mixed letters and digits. */
const KEY_LIKE = `${"sk"}-${"proj"}-${"Ab3x".repeat(10)}`;
/** The value a person set for the OpenAI key, not key-shaped. */
const OPENAI_VALUE = ["fake", "dr32", "value", "0001"].join("-");
const LIMITS = { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 };

async function quickRun(goal: string, env: Record<string, string> = {}): Promise<{ code: string | null }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-dr32-"));
  temporaryDirs.push(base);
  const ws = path.join(base, "ws");
  await mkdir(ws);
  await writeFile(path.join(base, "config.json"), JSON.stringify({ schemaVersion: 1, limits: LIMITS }), "utf8");
  const outcome = await runCli({
    argv: ["run", "--workspace", ws, "--goal", goal, "--config", "config.json", "--quiet"],
    env,
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    relatePaths: (target, root) => relateRealPaths(target, root),
    clock: { now: () => Date.now() },
    randomBytes: (size) => new Uint8Array(size).fill(5),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  });
  return { code: outcome.output.kind === "error" ? outcome.output.code : null };
}

describe("DR-32 (a): what refuses a run", () => {
  test("an ordinary name that starts with sk- in the goal is not a key", async () => {
    for (const name of ORDINARY) {
      // The quick form without a key stops later as provider_not_configured, never as key_in_file.
      const { code } = await quickRun(`move ${name} into archive`);
      assert.notEqual(code, "key_in_file", name);
    }
  });

  test("a key-like text and a registered key value in the goal still refuse the run", async () => {
    assert.equal((await quickRun(`use ${KEY_LIKE}`)).code, "key_in_file");
    assert.equal((await quickRun(`use ${OPENAI_VALUE}`, { [OPENAI_API_KEY_ENV]: OPENAI_VALUE })).code, "key_in_file");
  });
});

describe("DR-32 (a): what is hidden in output", () => {
  test("the loose shape is still hidden in output, with the key-like text and the value", () => {
    for (const text of [...ORDINARY.map((name) => `${name}${"x".repeat(32)}`), KEY_LIKE, OPENAI_VALUE]) {
      const hidden = hideKeys(`before ${text} after`, [OPENAI_VALUE]);
      assert.equal(hidden.includes(text), false, text);
      assert.ok(hidden.startsWith("before ") && hidden.endsWith(" after"), hidden);
    }
  });
});
