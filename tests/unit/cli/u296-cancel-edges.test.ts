/**
 * Unit U-296 (the CLI migration's C-6a; PM after p5a's proposal, from Codex V-31 L-1 and U-293's
 * u293-v31-signal-edges): the CLI's cancel source (src/cli/cancel.ts createCancelSource) at its
 * edges. It registers SIGINT and SIGTERM when a run's cancel source is made and removes both at the
 * end; `codaryn run`, apply's plan of moves and apply's run of a run plan all take it (main.ts). It
 * registered the two in one expression and removed them in one loop, so a registration that threw
 * left the one made before it in place, and a removal that threw skipped the other and took the run's
 * end with it. The app's createRunCancelSource (src/app/cancel.ts) has both edges whole; the CLI's
 * helper passes it on, so the three are made whole at once:
 * - a registration that throws removes what was registered before it and is thrown on (the run is
 *   refused as before, before anything is assembled);
 * - each removal is tried on its own, and none of them changes the run's end.
 * On the usual path (process.on and process.off) neither throws, and nothing else changes.
 * Written first and seen failing on 94b9259 (todo). Temporary folders, scripted model, fake values only.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { createCancelSource } from "../../../src/cli/cancel.js";
import { runCli } from "../../../src/cli/run.js";
import { cliIo, exists, setupRun } from "./k-support.js";

type SignalName = "SIGINT" | "SIGTERM";

/** An onSignal that records each registration and removal, and throws where told. */
function signals(throwing: { readonly on?: SignalName; readonly off?: SignalName } = {}): {
  readonly calls: string[];
  readonly onSignal: (name: SignalName, handler: () => void) => () => void;
} {
  const calls: string[] = [];
  return {
    calls,
    onSignal(name) {
      if (throwing.on === name) throw new Error(`u296: registering ${name} failed`);
      calls.push(`on ${name}`);
      return () => {
        calls.push(`off ${name}`);
        if (throwing.off === name) throw new Error(`u296: removing ${name} failed`);
      };
    },
  };
}


describe("U-296: the CLI's cancel source at its edges", () => {
  test("a registration that throws after one succeeded: that one is removed and the error is thrown on", () => {
    const { calls, onSignal } = signals({ on: "SIGTERM" });
    assert.throws(() => createCancelSource({ cancelFile: null, fileExists: () => false, onSignal }), /registering SIGTERM failed/);
    assert.deepEqual(calls, ["on SIGINT", "off SIGINT"], "no registration is left behind");
  });

  test("the first registration throwing: nothing is registered and the error is thrown on", () => {
    const { calls, onSignal } = signals({ on: "SIGINT" });
    assert.throws(() => createCancelSource({ cancelFile: null, fileExists: () => false, onSignal }), /registering SIGINT failed/);
    assert.deepEqual(calls, []);
  });

  test("a removal that throws: the other is still removed and dispose does not throw", () => {
    const { calls, onSignal } = signals({ off: "SIGINT" });
    const source = createCancelSource({ cancelFile: null, fileExists: () => false, onSignal });
    source.dispose();
    assert.deepEqual(calls, ["on SIGINT", "on SIGTERM", "off SIGINT", "off SIGTERM"], "both removals were tried");
  });

  test("codaryn run, a registration that throws: the run is refused before anything is assembled and nothing is left registered", async () => {
    const base = await setupRun({ "README.md": "# Title\n" }, {}, [{ text: "done" }]);
    const { calls, onSignal } = signals({ on: "SIGTERM" });
    await assert.rejects(runCli(cliIo(base, { cancelSignal: (cancelFile) => createCancelSource({ cancelFile, fileExists: () => false, onSignal }) })), /registering SIGTERM failed/);
    assert.deepEqual(calls, ["on SIGINT", "off SIGINT"], "no registration is left behind");
    assert.equal(await exists(path.join(base, "work", ".codaryn", "lock.json")), false, "the run was not assembled");
  });

  test("codaryn run, a removal that throws: the other is still removed and the run's end stands", async () => {
    const base = await setupRun({ "README.md": "# Title\n" }, {}, [{ text: "done" }]);
    const { calls, onSignal } = signals({ off: "SIGINT" });
    const outcome = await runCli(cliIo(base, { cancelSignal: (cancelFile) => createCancelSource({ cancelFile, fileExists: () => false, onSignal }) }));
    assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
    assert.deepEqual([outcome.exitCode, (outcome.output as { status?: unknown }).status], [0, "done"]);
    assert.deepEqual(calls, ["on SIGINT", "on SIGTERM", "off SIGINT", "off SIGTERM"], "both removals were tried");
    assert.equal(await exists(path.join(base, "work", ".codaryn", "lock.json")), false, "the lock was released");
  });
});
