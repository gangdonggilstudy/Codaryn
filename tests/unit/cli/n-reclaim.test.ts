/**
 * PM notice (DR-27 b): on a volume without hard links a lock file is made by an exclusive create,
 * so an attempt that ended in between can leave `.codaryn/lock.json.reclaim` empty or cut off. The
 * store waits for such a file and never clears it, so a dead lock is then never reclaimed. doctor's
 * lock check names that file (`reclaim_left`); a reclaim file the next run clears does not warn.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import type { DoctorOutput } from "../../../src/contracts/index.js";
import { inspectLockFile, runDoctor } from "../../../src/cli/doctor.js";
import { lexicalLocate } from "./locate.js";

const LOCK = path.join("/w", ".codaryn", "lock.json");
const RECLAIM = path.join("/w", ".codaryn", "lock.json.reclaim");
const lockText = (pid: number): string => `${JSON.stringify({ pid, runId: "20261112T050000Z-0000abcd", startedAt: "2026-11-12T05:00:00.000Z" })}\n`;

/** Reads only the files given; any other path is missing. */
function files(map: Record<string, string>): (file: string) => Promise<string> {
  return async (file) => {
    const text = map[file];
    if (text === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return text;
  };
}

const ALIVE = 1111;
const DEAD = 2222;
const isAlive = (pid: number): boolean => pid === ALIVE;
const noStart = async (): Promise<number | null> => null;

describe("doctor's lock check and the reclaim file", () => {
  test("an empty or cut-off reclaim file is reported, whatever lock.json holds", async () => {
    for (const reclaim of ["", '{"pid":11', `{"pid":${DEAD}`]) {
      for (const lock of [undefined, lockText(DEAD), lockText(ALIVE)]) {
        const read = files({ [RECLAIM]: reclaim, ...(lock === undefined ? {} : { [LOCK]: lock }) });
        assert.equal(await inspectLockFile("/w", read, isAlive, noStart), "reclaim_left", JSON.stringify([reclaim, lock]));
      }
    }
  });

  test("a reclaim file whose owner still runs is reported", async () => {
    assert.equal(await inspectLockFile("/w", files({ [RECLAIM]: lockText(ALIVE), [LOCK]: lockText(DEAD) }), isAlive, noStart), "reclaim_left");
  });

  test("a whole reclaim file that is not understood is cleared by the next run (the store's rule): lock.json decides", async () => {
    for (const reclaim of ["not json\n", `${JSON.stringify({ pid: "x" })}\n`]) {
      assert.equal(await inspectLockFile("/w", files({ [RECLAIM]: reclaim, [LOCK]: lockText(DEAD) }), isAlive, noStart), "stale", reclaim);
    }
  });

  test("a reclaim file whose owner has ended is cleared by the next run: lock.json decides", async () => {
    const reclaim = lockText(DEAD);
    assert.equal(await inspectLockFile("/w", files({ [RECLAIM]: reclaim, [LOCK]: lockText(DEAD) }), isAlive, noStart), "stale");
    assert.equal(await inspectLockFile("/w", files({ [RECLAIM]: reclaim, [LOCK]: lockText(ALIVE) }), isAlive, noStart), "held");
    assert.equal(await inspectLockFile("/w", files({ [RECLAIM]: reclaim }), isAlive, noStart), "none");
  });

  test("without a reclaim file nothing changes", async () => {
    assert.equal(await inspectLockFile("/w", files({}), isAlive, noStart), "none");
    assert.equal(await inspectLockFile("/w", files({ [LOCK]: lockText(DEAD) }), isAlive, noStart), "stale");
  });

  test("doctor --json warns and names the reclaim file", async () => {
    const outcome = await runDoctor({
      argv: ["doctor", "--workspace", "w", "--json"],
      env: {},
      cwd: path.resolve("/tmp/codaryn-reclaim"),
      nodeVersion: "26.0.0",
      readFile: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      isDirectory: async () => true,
      isFile: async () => false,
      locateInWorkspace: lexicalLocate,
      relatePaths: async () => "separate",
      inspectLock: async () => "reclaim_left",
    });
    assert.ok("text" in outcome);
    const check = (JSON.parse(outcome.text) as DoctorOutput).checks.find((item) => item.id === "lock");
    assert.equal(check?.status, "warn");
    assert.ok(String(check?.message).includes(".codaryn/lock.json.reclaim"), String(check?.message));
  });
});
