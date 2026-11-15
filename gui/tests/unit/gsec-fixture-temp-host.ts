/**
 * U-284 fixture, not a test file of its own: gsec-temp-folders.test.ts runs it in a Node process of
 * its own. Host-process cases written as gsec-host-process.test.ts writes them (a folder from
 * `scratch`, the host and the CLI run started through gsec-host-support.ts), that fail or run out of
 * time while the real engine host runs in their folder and a CLI run holds the workspace there.
 * Each records its folder in the file that GSEC_FIXTURE_RECORD names. The held run's model step
 * waits 40 s: longer than scratch's removal keeps trying (its rm retries back off for about 21 s in
 * all), so a run the cleanup did not end keeps the folder from going; and short enough that a run a
 * stopped fixture left behind ends by itself soon after.
 */

import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { cli, exists, lockFile, scratch, startHost, taskFile, waitFor } from "./gsec-host-support.js";

const HELD_WAIT = { text: "waiting", delayMs: 40_000 };

function record(dir: string): void {
  const file = process.env["GSEC_FIXTURE_RECORD"];
  if (file !== undefined && file !== "") appendFileSync(file, `${dir}\n`, "utf8");
}

/** A case as gsec-host-process.test.ts writes it: the host and a held CLI run, then `then`. */
async function heldCase(t: TestContext, then: () => Promise<void>): Promise<void> {
  const space = await scratch(t);
  record(space.dir);
  await startHost(space);
  const cancelFile = path.join(space.dir, "cancel.flag");
  cli(space, ["run", "--task", await taskFile(space.dir, "holding", [HELD_WAIT]), "--json", "--cancel-file", cancelFile], cancelFile);
  await waitFor(() => exists(lockFile(space.dir)), "the CLI's run taking the lock");
  await then();
}

test("gsec fixture: a host case that fails", { timeout: 60_000 }, async (t) => {
  await heldCase(t, async () => assert.fail("gsec fixture: a failing case"));
});

test("gsec fixture: a host case that runs out of time", { timeout: 15_000 }, async (t) => {
  await heldCase(t, () => new Promise(() => undefined));
});
