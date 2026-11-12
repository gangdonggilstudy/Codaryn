/**
 * Review R-16 L-1: a revert that could not put a file back leaves it in `.codaryn/parked/<runId>/`
 * (listParkedFiles). doctor's `lock` check warns with the number of such files
 * (`doctor.lock.parked_left`); a lock problem found first keeps its text and the warning joins the
 * message. Real files; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { DoctorOutput } from "../../../src/contracts/index.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import type { LockState } from "../../../src/cli/doctor.js";
import { lexicalLocate } from "./locate.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

async function workspace(parked: number): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-doctor-parked-"));
  temporaryDirs.push(base);
  const dir = path.join(base, ".codaryn", "parked", "20261112T080000Z-0000abcd");
  await mkdir(dir, { recursive: true });
  for (let index = 0; index < parked; index += 1) await writeFile(path.join(dir, `${index}`), "x", "utf8");
  return base;
}

async function lockCheck(ws: string, lock: LockState = "none"): Promise<{ status: string; message: string; text?: { id: string; params?: unknown } }> {
  const outcome = await runDoctor({
    argv: ["doctor", "--workspace", ws, "--json"],
    env: {},
    cwd: ws,
    nodeVersion: "26.0.0",
    readFile: (file) => readFile(file, "utf8"),
    isDirectory: async (dir) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
    isFile: async () => false,
    locateInWorkspace: lexicalLocate,
    relatePaths: async () => "separate",
    inspectLock: async () => lock,
  });
  assert.ok("text" in outcome, JSON.stringify(outcome));
  const check = (JSON.parse(outcome.text) as DoctorOutput).checks.find((item) => item.id === "lock");
  assert.ok(check !== undefined);
  return check as unknown as { status: string; message: string; text?: { id: string; params?: unknown } };
}

describe("R-16 L-1: doctor names the files a revert left parked", () => {
  test("parked files make the lock check warn with their number", async () => {
    const check = await lockCheck(await workspace(2));
    assert.equal(check.status, "warn", JSON.stringify(check));
    assert.deepEqual([check.text?.id, check.text?.params], ["doctor.lock.parked_left", { count: 2 }]);
    assert.ok(check.message.includes(".codaryn/parked"), check.message);
  });

  test("no parked file: the lock check is as before", async () => {
    const check = await lockCheck(await workspace(0));
    assert.deepEqual([check.status, check.text?.id], ["ok", "doctor.lock.none"]);
  });

  test("a lock problem keeps its text; the parked warning joins the message", async () => {
    const check = await lockCheck(await workspace(1), "held");
    assert.deepEqual([check.status, check.text?.id], ["warn", "doctor.lock.held"]);
    assert.ok(check.message.includes(".codaryn/parked"), check.message);
  });
});
