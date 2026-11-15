/**
 * U-284 fixture, not a test file of its own: gsec-temp-folders.test.ts runs it in a Node process of
 * its own. IPC harness cases (gsec-ipc-harness.ts) that pass, fail and run out of time; each records
 * the harness's temporary root (the folder of the workspace it opened) in the file that
 * GSEC_FIXTURE_RECORD names.
 */

import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createIpc } from "./gsec-ipc-harness.js";

function record(dir: string): void {
  const file = process.env["GSEC_FIXTURE_RECORD"];
  if (file !== undefined && file !== "") appendFileSync(file, `${dir}\n`, "utf8");
}

async function opened(): Promise<void> {
  const ipc = await createIpc();
  const { root } = await ipc.openWorkspace();
  record(path.dirname(root));
}

test("gsec fixture: a harness case that passes", async () => {
  await opened();
});

test("gsec fixture: a harness case that fails", async () => {
  await opened();
  assert.fail("gsec fixture: a failing case");
});

test("gsec fixture: a harness case that runs out of time", { timeout: 2_000 }, async () => {
  await opened();
  await new Promise(() => undefined);
});
