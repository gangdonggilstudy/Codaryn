/**
 * Unit U-293, Codex V-31 L-1: the app's hook on the process's signals (AppEnvironment.onSignal) at its
 * edges. A run's cancel source registers SIGINT and SIGTERM when it is made and removes both at the
 * run's end. The source the app took from the CLI (src/cli/cancel.ts createCancelSource) registered
 * the two in one expression and removed them in one loop, so a registration that threw left the one
 * made before it in place, and a removal that threw skipped the other (and its exception took the
 * run's end with it). Now a registration that fails removes what was registered before it, and the
 * start is refused as before (internal_error); each removal is tried on its own and none of them
 * changes the run's end. On the usual path, where the CLI gives process.on and process.off, neither
 * throws. Written first and seen failing on a973b15. Temporary folders, scripted model, fake values only.
 */

import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppEnvironment, RunHandle } from "../../../src/app/index.js";
import { WRITE_NOTES, appEnvironment, setupRun, taskRequest } from "./support.js";

type SignalName = "SIGINT" | "SIGTERM";

/** An onSignal that records each registration and removal, and throws where told. */
function signals(throwing: { readonly on?: SignalName; readonly off?: SignalName } = {}): { readonly calls: string[]; readonly onSignal: NonNullable<AppEnvironment["onSignal"]> } {
  const calls: string[] = [];
  return {
    calls,
    onSignal(name) {
      if (throwing.on === name) throw new Error(`gsec: registering ${name} failed`);
      calls.push(`on ${name}`);
      return () => {
        calls.push(`off ${name}`);
        if (throwing.off === name) throw new Error(`gsec: removing ${name} failed`);
      };
    },
  };
}

async function start(onSignal: NonNullable<AppEnvironment["onSignal"]>) {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
  const app = createCodarynApp(await appEnvironment(base, { onSignal }));
  return { base, outcome: await app.startRun(taskRequest(base)) };
}

const lockLeftIn = async (base: string): Promise<boolean> => (await stat(path.join(base, "work", ".codaryn", "lock.json")).catch(() => null)) !== null;

describe("Codex V-31 L-1: the signal hook at its edges", () => {
  test("a registration that throws after one succeeded: that one is removed, the start is refused as before, nothing is held", async () => {
    const { calls, onSignal } = signals({ on: "SIGTERM" });
    const { base, outcome } = await start(onSignal);
    assert.equal(outcome.ok, false, JSON.stringify(outcome));
    assert.equal((outcome as { error: { code: string } }).error.code, "internal_error");
    assert.deepEqual(calls, ["on SIGINT", "off SIGINT"], "no registration is left behind");
    assert.equal(await lockLeftIn(base), false, "the run was not assembled");
  });

  test("the first registration throwing: nothing is registered, nothing to remove, the start is refused", async () => {
    const { calls, onSignal } = signals({ on: "SIGINT" });
    const { outcome } = await start(onSignal);
    assert.equal(outcome.ok, false);
    assert.deepEqual(calls, []);
  });

  test("a removal that throws: the other is still removed, and the run's end stands", async () => {
    const { calls, onSignal } = signals({ off: "SIGINT" });
    const { base, outcome } = await start(onSignal);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const done = await (outcome as { handle: RunHandle }).handle.done;
    assert.ok(done.ok, `the run's end is kept: ${JSON.stringify(done)}`);
    assert.equal(done.result.status, "done");
    assert.deepEqual(calls, ["on SIGINT", "on SIGTERM", "off SIGINT", "off SIGTERM"], "both removals were tried");
    assert.equal(await lockLeftIn(base), false, "the lock was released");
  });
});
