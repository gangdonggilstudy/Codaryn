/**
 * U-284 fixture, not a test file of its own: gsec-temp-folders.test.ts runs it in a Node process of
 * its own. Host-process cases written as gsec-host-process.test.ts writes them, that fail or run out
 * of time while the real engine host runs in their folder and a CLI run holds the workspace there.
 * Each records its folder in the file that GSEC_FIXTURE_RECORD names. The held run's model step
 * waits only a few seconds, so a run a stopped fixture leaves behind soon ends by itself.
 */

import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cli, exists, lockFile, startHost, taskFile, waitFor, within } from "./gsec-host-support.js";

const SHORT_WAIT = { text: "waiting", delayMs: 8_000 };

function record(dir: string): void {
  const file = process.env["GSEC_FIXTURE_RECORD"];
  if (file !== undefined && file !== "") appendFileSync(file, `${dir}\n`, "utf8");
}

/** A case as gsec-host-process.test.ts writes it: the host and a held CLI run, then `then`. */
async function heldCase(then: () => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gsec-host-"));
  record(dir);
  const { host } = await startHost(dir);
  const cancelFile = path.join(dir, "cancel.flag");
  let running: ReturnType<typeof cli> | null = null;
  try {
    running = cli(dir, ["run", "--task", await taskFile(dir, "holding", [SHORT_WAIT]), "--json", "--cancel-file", cancelFile]);
    await waitFor(() => exists(lockFile(dir)), "the CLI's run taking the lock");
    await then();
  } finally {
    if (running !== null) {
      await fs.writeFile(cancelFile, "", "utf8").catch(() => undefined);
      await within(running.ended, 30_000, "the CLI's run ending after the case").catch(() => undefined);
    }
    await host.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test("gsec fixture: a host case that fails", { timeout: 60_000 }, async () => {
  await heldCase(async () => assert.fail("gsec fixture: a failing case"));
});

test("gsec fixture: a host case that runs out of time", { timeout: 15_000 }, async () => {
  await heldCase(() => new Promise(() => undefined));
});
