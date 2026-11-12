/**
 * U-36 (review R-66 R66-M1, PM): `review` and `changes` drew their text in English on the real CLI
 * whatever the language: src/cli/main.ts gave runChanges and runReview no catalog (plan and apply had
 * one), so the renderers fell back to their English of before U-36. The unit tests called the
 * renderers with a catalog directly and did not see it.
 * The real CLI under the net guard, scripted model, nothing is sent; the default config location is
 * a test folder. CODARYN_LANG chooses the language.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";
import type { EngineResult } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.resolve(here, "..", "..", "..", "src", "cli", "main.js");
const guard = pathToFileURL(path.resolve(here, "..", "..", "support", "net-guard.js")).href;
const HANGUL = /[가-힣]/u;

const LIMITS = { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 };
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };

interface Box {
  readonly base: string;
  cli(args: readonly string[], language: "ko" | "en"): { status: number | null; stdout: string; stderr: string };
}

async function box(task: Record<string, unknown>, steps: unknown[]): Promise<Box> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u36-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "ws"));
  await writeFile(path.join(base, "ws", "a.txt"), "alpha\n", "utf8");
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
  const home = path.join(base, "home");
  await mkdir(home);
  const env: Record<string, string> = { APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, HOME: home, USERPROFILE: home };
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    base,
    cli: (args, language) => {
      const run = spawnSync(process.execPath, ["--import", guard, main, ...args], { cwd: base, env: { ...env, CODARYN_LANG: language }, encoding: "utf8" });
      return { status: run.status, stdout: run.stdout, stderr: run.stderr };
    },
  };
}

const baseTask = { schemaVersion: 1, goal: "g", workspaceRoot: "./ws", model: { provider: "scripted", scriptPath: "./script.json" }, privacy: { secretEnv: [] }, limits: LIMITS, verifiers: [] };

describe("U-36 (R66-M1): the real CLI draws review and changes in the chosen language", () => {
  test("review in Korean: the catalog's lines, none of the English of before", async () => {
    const b = await box({ ...baseTask, id: "u36-review", workflow: "label", policy: POLICY, workflowRef: "analyze" }, [{ text: "done" }]);
    const ran = JSON.parse(b.cli(["run", "--task", "task.json", "--quiet"], "ko").stdout) as EngineResult;
    assert.equal(ran.reason, "awaiting_review", JSON.stringify(ran));
    const review = b.cli(["review", "--task", "task.json", "--run", ran.runId, "--accept"], "ko");
    assert.equal(review.status, 0, review.stdout + review.stderr);
    assert.match(review.stdout, HANGUL, review.stdout);
    for (const english of ["Review of run", "The run's result and records are unchanged"]) assert.equal(review.stdout.includes(english), false, review.stdout);
  });

  test("changes in Korean: the catalog's lines, none of the English of before; in English the catalog's English", async () => {
    const steps = [
      { toolCalls: [{ name: "write_file", args: { path: "kept.md", expectedHash: null, change: { kind: "replace_all", content: "x\n" } } }] },
      { text: "done" },
    ];
    const b = await box({ ...baseTask, id: "u36-changes", workflow: "test", policy: POLICY }, steps);
    const ran = JSON.parse(b.cli(["run", "--task", "task.json", "--quiet"], "ko").stdout) as EngineResult;
    assert.equal(ran.changes.length, 1, JSON.stringify(ran));
    const korean = b.cli(["changes", "--task", "task.json", "--run", ran.runId], "ko");
    assert.equal(korean.status, 0, korean.stdout + korean.stderr);
    assert.match(korean.stdout, HANGUL, korean.stdout);
    for (const english of ["changes of run", "created by the run", "as the run left it"]) assert.equal(korean.stdout.includes(english), false, korean.stdout);
    const english = b.cli(["changes", "--task", "task.json", "--run", ran.runId], "en");
    const heading = (createMessageCatalog("en").format as (id: string, params: Record<string, string>) => string)("changes.heading", { runId: ran.runId });
    assert.ok(english.stdout.startsWith(heading), english.stdout);
    assert.doesNotMatch(english.stdout, HANGUL);
  });
});
