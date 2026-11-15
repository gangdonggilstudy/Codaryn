/**
 * U-257 (U-201's hand-off, U-220's leftover): a confirmed `codaryn cleanup` whose workspace lock could
 * not be released at its end (CleanupOutcome.lockLeft, U-201's store) carried `lockLeft` in its JSON
 * already, but its text said nothing. The text now ends with U-201's line (lockReleaseFailedLine,
 * `lock.release_failed`), as a run's, an apply's and a revert's summaries do. Only then: every other
 * output of cleanup is as before, character for character.
 * Here the release's removal of lock.json fails (EBUSY, injected only there, as U-220's test does); the
 * run, the preview and the cleanup are the CLI's own, in process, with the real store. Scripted model,
 * temporary folders.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { MESSAGE_LANGUAGES } from "../../../src/contracts/index.js";
import type { CleanupOutput, EngineResult, MessageLanguage } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { renderCleanup, runCleanup } from "../../../src/cli/cleanup.js";
import { lockReleaseFailedLine } from "../../../src/cli/human/index.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { releaseLock } from "../../../src/store/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
let now = Date.now() - 600_000;
const clock = { now: () => (now += 1000) };
let seed = 41;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

const TASK = {
  schemaVersion: 1,
  id: "u257",
  goal: "g",
  workflow: "label",
  workspaceRoot: "./ws",
  model: { provider: "scripted", scriptPath: "./script.json" },
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
  privacy: { secretEnv: [] },
  limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
  verifiers: [],
};

const require = createRequire(import.meta.url);
const promises: { rm: typeof import("node:fs/promises").rm } = require("node:fs/promises");

/** Runs `run` while removing <base>/ws/.codaryn/lock.json fails with EBUSY; every other removal is real. */
async function whileLockStays<T>(base: string, run: () => Promise<T>): Promise<T> {
  const lock = path.join(base, "ws", ".codaryn", "lock.json").toLowerCase();
  const original = promises.rm;
  promises.rm = async (target, options) => {
    if (path.resolve(String(target)).toLowerCase() === lock) throw Object.assign(new Error("U-257 injected EBUSY"), { code: "EBUSY" });
    return original(target, options);
  };
  syncBuiltinESMExports();
  try {
    return await run();
  } finally {
    promises.rm = original;
    syncBuiltinESMExports();
  }
}

/** The lock left behind, released by its own id (U-176: the same id's release still removes it). */
async function takeBack(base: string): Promise<void> {
  const lock = path.join(base, "ws", ".codaryn", "lock.json");
  if (!existsSync(lock)) return;
  const runId = (JSON.parse(readFileSync(lock, "utf8")) as { runId: string }).runId;
  assert.equal(await releaseLock({ workspaceRoot: path.join(base, "ws"), runId }), true);
}

/** A workspace with one finished run (no change, no check: needs-input/no_verifier); its run id. */
async function workspaceWithRun(): Promise<{ base: string; runId: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-u257-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "ws"));
  await writeFile(path.join(base, "ws", "a.txt"), "alpha\n", "utf8");
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
  await writeFile(path.join(base, "task.json"), JSON.stringify(TASK), "utf8");
  const ran = await runCli({
    argv: ["run", "--task", "task.json"],
    env: {},
    cwd: base,
    readFile: (file: string) => readFile(file, "utf8"),
    isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    loadEnvFile: () => {},
    locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
    relatePaths: (target: string, root: string) => relateRealPaths(target, root),
    clock,
    randomBytes,
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  });
  assert.equal(ran.output.kind, "run", JSON.stringify(ran.output));
  return { base, runId: (ran.output as EngineResult).runId };
}

/** `codaryn cleanup --workspace ws --run <id>` and `extra` (a preview, or `--include-not-reverted --confirm <prefix>`) in `language`. */
async function cleanup(base: string, runId: string, language: MessageLanguage, extra: readonly string[]) {
  return runCleanup({
    argv: ["cleanup", "--workspace", "ws", "--run", runId, ...extra],
    cwd: base,
    env: {},
    clock,
    messages: createMessageCatalog(language),
  });
}

const textOf = (outcome: Awaited<ReturnType<typeof cleanup>>): string => ("text" in outcome ? String(outcome.text) : "");

for (const language of MESSAGE_LANGUAGES) {
  const catalog = createMessageCatalog(language);
  const LINE = catalog.format("lock.release_failed");

  describe(`U-257 (${language}): a cleanup whose lock could not be released says so in its text`, () => {
    test("the confirmed cleanup removed what it was asked to; the text ends with the lock line; the exit code is its own", async () => {
      const { base, runId } = await workspaceWithRun();
      const preview = JSON.parse(textOf(await cleanup(base, runId, language, ["--json"]))) as { plan: { digest: string } };
      const digest = preview.plan.digest.slice(0, 12);
      const left = await whileLockStays(base, () => cleanup(base, runId, language, ["--include-not-reverted", "--confirm", digest]));
      const lines = textOf(left).trimEnd().split("\n");
      assert.equal(lines.at(-1), LINE, lines.join("\n"));
      assert.equal(lines.filter((line) => line === LINE).length, 1);
      assert.equal(left.exitCode, 0, "removed: exit 0, as with the lock released");
      assert.equal(existsSync(path.join(base, "ws", ".codaryn", "runs", runId)), false, "the run's records were removed");
      assert.ok(existsSync(path.join(base, "ws", ".codaryn", "lock.json")), "the lock is left");
      await takeBack(base);
    });

    test("the JSON carries lockLeft as before (U-201); the text is the only new place", async () => {
      const { base, runId } = await workspaceWithRun();
      const preview = JSON.parse(textOf(await cleanup(base, runId, language, ["--json"]))) as { plan: { digest: string } };
      const left = await whileLockStays(base, () => cleanup(base, runId, language, ["--include-not-reverted", "--confirm", preview.plan.digest.slice(0, 12), "--json"]));
      const output = JSON.parse(textOf(left)) as { outcome: { lockLeft?: boolean } };
      assert.equal(output.outcome.lockLeft, true);
      await takeBack(base);
    });

    test("the lock released: no such line, the text as before", async () => {
      const { base, runId } = await workspaceWithRun();
      const preview = JSON.parse(textOf(await cleanup(base, runId, language, ["--json"]))) as { plan: { digest: string } };
      const released = await cleanup(base, runId, language, ["--include-not-reverted", "--confirm", preview.plan.digest.slice(0, 12)]);
      assert.equal(textOf(released).includes(LINE), false, textOf(released));
      assert.equal(existsSync(path.join(base, "ws", ".codaryn", "lock.json")), false);
    });

    test("renderCleanup: the line only with outcome.lockLeft true; every other output is the one without the field", () => {
      const outcome = { ok: true, removed: [], kept: [], items: [] } as unknown as Extract<CleanupOutput, { readonly outcome: unknown }>["outcome"];
      const base = { schemaVersion: 1, kind: "cleanup", status: "nothing_removed", exitCode: 0 } as const;
      const plain = renderCleanup({ ...base, outcome } as unknown as CleanupOutput, catalog);
      const left = renderCleanup({ ...base, outcome: { ...outcome, lockLeft: true } } as unknown as CleanupOutput, catalog);
      assert.equal(left, `${plain}${lockReleaseFailedLine(true, catalog)}\n`);
      for (const value of [false, undefined, "true", 1]) {
        assert.equal(renderCleanup({ ...base, outcome: { ...outcome, lockLeft: value } } as unknown as CleanupOutput, catalog), plain, String(value));
      }
    });
  });
}
