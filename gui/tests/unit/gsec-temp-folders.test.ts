/**
 * G-sec (U-284): the G-sec cases leave no temporary folder and no process behind, whether they pass,
 * fail or run out of time. Each fixture runs in a Node process of its own, as `node --test` runs a
 * file, and records the folders it made; its process must end by itself (nothing it started may keep
 * it alive), and none of those folders may be left.
 * - The IPC harness (gsec-ipc-harness.ts) makes one root for its workspaces when it is loaded. Before
 *   U-284 nothing removed it: every run of the sender, args and approvals files left one in the
 *   system's temporary folder, whatever the outcome (17 were found after a day's runs).
 * - A host-process case (gsec-host-support.ts) makes a folder, starts the real engine host there and
 *   may start a CLI run there. Before U-284 it cleaned up in a `finally` of its own body, which a case
 *   that ran out of time never reaches (the host then keeps the file's process alive and the CLI run
 *   holds the folder), and a host that failed to start left its folder.
 * Folders this case removes for a fixture are only those the fixture recorded, directly in the
 * system's temporary folder, with a G-sec name.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { exists, skip } from "./gsec-host-support.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMP = path.resolve(os.tmpdir());
const G_SEC_FOLDER = /^codaryn-gsec-(?:host-)?[A-Za-z0-9]{6}$/;

/** Whether `dir` is a folder a G-sec case makes: directly in the temporary folder, with a G-sec name. */
function isGsecFolder(dir: string): boolean {
  const resolved = path.resolve(dir);
  const parent = path.dirname(resolved);
  const same = process.platform === "win32" ? parent.toLowerCase() === TEMP.toLowerCase() : parent === TEMP;
  return same && G_SEC_FOLDER.test(path.basename(resolved));
}

interface FixtureRun {
  /** False when the fixture's process was still running at the bound and was stopped. */
  readonly endedByItself: boolean;
  readonly output: string;
  /** The folders it made, as it recorded them (each once). */
  readonly recorded: readonly string[];
}

const recordedIn = async (file: string): Promise<string[]> => [...new Set((await fs.readFile(file, "utf8").catch(() => "")).split(/\r?\n/).filter((line) => line.length > 0))];

/** Runs the built fixture `name` in a Node process of its own, for at most `boundMs`. */
async function runFixture(t: TestContext, name: string, boundMs: number): Promise<FixtureRun> {
  const recordDir = await fs.mkdtemp(path.join(TEMP, "codaryn-gsec-record-"));
  const recordFile = path.join(recordDir, "made.txt");
  // Without NODE_TEST_CONTEXT (the test runner's own), the fixture reports as a file run on its own does.
  const { NODE_TEST_CONTEXT: _runner, ...env } = process.env;
  const child = spawn(process.execPath, [path.join(HERE, name)], { env: { ...env, GSEC_FIXTURE_RECORD: recordFile }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let closed = false;
  const ended = new Promise<void>((resolve) => child.once("close", () => ((closed = true), resolve())));
  // Whatever the fixture left is removed after this case, so it leaves nothing either. A CLI run a
  // stopped fixture left behind ends by itself within its 40 s wait, so the removal waits that out.
  t.after(async () => {
    if (!closed) {
      child.kill();
      await ended;
    }
    for (const dir of await recordedIn(recordFile)) if (isGsecFolder(dir)) await fs.rm(dir, { recursive: true, force: true, maxRetries: 60, retryDelay: 500 });
    await fs.rm(recordDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<"bound">((resolve) => (timer = setTimeout(() => resolve("bound"), boundMs)));
  const first = await Promise.race([ended.then(() => "ended" as const), bound]);
  clearTimeout(timer);
  return { endedByItself: first === "ended", output, recorded: await recordedIn(recordFile) };
}

/** The fixture's own summary: how many of its cases passed, failed and were cancelled (ran out of time). */
function summary(output: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of output.matchAll(/^(?:ℹ|#) (pass|fail|cancelled) ([0-9]+)$/gm)) counts[match[1]!] = Number(match[2]);
  return counts;
}

describe("G-sec: no temporary folder and no process left behind", () => {
  test("U-284: the IPC harness's cases leave no temporary folder, whether they pass, fail or run out of time", { timeout: 120_000 }, async (t) => {
    const run = await runFixture(t, "gsec-fixture-temp-harness.js", 60_000);
    assert.equal(run.endedByItself, true, `the fixture's process ended by itself:\n${run.output.slice(-2000)}`);
    assert.deepEqual(summary(run.output), { pass: 1, fail: 1, cancelled: 1 }, run.output.slice(-2000));
    assert.ok(run.recorded.length > 0 && run.recorded.every(isGsecFolder), `the fixture recorded G-sec folders: ${JSON.stringify(run.recorded)}`);
    for (const dir of run.recorded) assert.equal(await exists(dir), false, `left behind: ${dir}`);
  });

  test("U-284: a host-process case that fails or runs out of time leaves no folder and no process", { skip, timeout: 240_000 }, async (t) => {
    const run = await runFixture(t, "gsec-fixture-temp-host.js", 90_000);
    assert.equal(run.endedByItself, true, `the fixture's process ended by itself (nothing it started kept it alive):\n${run.output.slice(-2000)}`);
    assert.deepEqual(summary(run.output), { pass: 0, fail: 1, cancelled: 1 }, run.output.slice(-2000));
    assert.equal(run.recorded.length, 2, `one folder per case: ${JSON.stringify(run.recorded)}`);
    assert.ok(run.recorded.every(isGsecFolder), JSON.stringify(run.recorded));
    for (const dir of run.recorded) assert.equal(await exists(dir), false, `left behind: ${dir}`);
  });
});
