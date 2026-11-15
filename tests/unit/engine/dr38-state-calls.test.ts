/**
 * DR-38 (PM after 93eed67): where the engine calls the state guard (EngineDeps.stateGuard), and how
 * a change to the run records ends the run. A fake guard; the store's own guard is tested by the
 * store (tests/unit/store/dr38-state-guard.test.ts).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MaskedText, RawText, StateComparison, StateFingerprint, StateGuard, StateTier, ToolCall } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { FakeTools, FakeVerifiers, finalAnswer, harness, response } from "./fakes.js";
import type { Log } from "./fakes.js";

type Print = StateFingerprint & { readonly n: number };

/**
 * Numbers each capture of a tier (1, 2, ...) and reports `changed` when comparing up to the capture
 * `change[tier]` names. `limited` is reported for tier state when asked.
 */
class FakeStateGuard implements StateGuard {
  readonly captures: { run: number; state: number } = { run: 0, state: 0 };
  readonly marked: MaskedText[][] = [];
  constructor(
    private readonly options: { change?: { tier: StateTier; at: number; paths: string[] }; limited?: boolean; failCapture?: boolean; log?: Log } = {},
  ) {}
  async capture(tier: StateTier): Promise<StateFingerprint> {
    this.options.log?.push(`guard.capture.${tier}`);
    if (this.options.failCapture === true) throw new Error("no fingerprint");
    this.captures[tier] += 1;
    return { tier, n: this.captures[tier] } as unknown as StateFingerprint;
  }
  compare(before: StateFingerprint, after: StateFingerprint): StateComparison {
    const { change } = this.options;
    const to = (after as Print).n;
    const changed = change !== undefined && change.tier === after.tier && to === change.at && (before as Print).n !== to ? (change.paths as RawText[]) : [];
    return { changed, limited: after.tier === "state" && this.options.limited === true };
  }
  async markRecordsChanged(changed: readonly MaskedText[]): Promise<void> {
    this.marked.push([...changed]);
  }
}

const runCommand = (id: string): ToolCall => ({ id, name: "run_command", args: { executable: "node", args: ["--test"] } });
const COMMAND_OK = { ok: true as const, payload: { exitCode: 0, stdout: "", stderr: "", timedOut: false, truncated: false } };
const SHOWN = "runs/20261112T000000Z-0000abcd/snapshots/shown-0.json";

function run(guard: FakeStateGuard | undefined, options: { log?: Log; verifiers?: FakeVerifiers } = {}) {
  const h = harness({
    steps: [() => response([runCommand("c1")]), () => finalAnswer()],
    tools: new FakeTools(() => COMMAND_OK, options.log),
    ...(options.verifiers === undefined ? {} : { verifiers: options.verifiers }),
    ...(options.log === undefined ? {} : { log: options.log }),
  });
  return { h, done: runTask(guard === undefined ? h.deps : { ...h.deps, stateGuard: guard }) };
}

const checks = (h: ReturnType<typeof harness>) => h.journal.ofType("state_checked");

describe("DR-38: the engine checks the run records with the state guard", () => {
  test("nothing changed: recorded at the run's start and end only; the run is done", async () => {
    const guard = new FakeStateGuard();
    const { h, done } = run(guard);
    const result = await done;
    assert.deepEqual([result.status, result.reason], ["done", "verified"]);
    assert.deepEqual(checks(h).map((c) => c.phase), ["run_start", "run_end"]);
    assert.deepEqual(result.stateChanged, []);
    // start: run+state; command: run twice; verify round: run+state twice; end: run+state.
    assert.deepEqual(guard.captures, { run: 6, state: 4 });
  });

  test("the command window: after the call's decision is recorded, around the execution, before its result", async () => {
    const log: Log = [];
    const guard = new FakeStateGuard({ log });
    const { done } = run(guard, { log });
    await done;
    const at = log.indexOf("tools.execute");
    assert.deepEqual(log.slice(at - 1, at + 3), ["guard.capture.run", "tools.execute", "guard.capture.run", "journal.tool_result"]);
  });

  test("a change made by the command: recorded after_command with the call, marked, and the run ends failed/state_changed", async () => {
    const guard = new FakeStateGuard({ change: { tier: "run", at: 3, paths: [SHOWN] } });
    const { h, done } = run(guard);
    const result = await done;
    assert.deepEqual([result.status, result.reason], ["failed", "state_changed"]);
    const changed = checks(h).find((c) => c.phase === "after_command");
    assert.deepEqual([changed?.callId, changed?.changed], ["c1", [SHOWN]]);
    assert.deepEqual(guard.marked, [[SHOWN]]);
    assert.deepEqual(result.stateChanged, [SHOWN]);
    assert.equal(h.model.requests.length, 1, "no further model request");
    assert.equal(h.journal.ofType("tool_result").length, 0, "the result of a call whose window saw a change is not recorded");
  });

  test("a change elsewhere in the state directory during the verification round ends the run", async () => {
    const guard = new FakeStateGuard({ change: { tier: "state", at: 3, paths: ["runs/20261111T000000Z-0000eeee/result.json"] } });
    const { h, done } = run(guard);
    const result = await done;
    assert.deepEqual([result.status, result.reason], ["failed", "state_changed"]);
    assert.equal(checks(h).at(-1)?.phase, "after_verify");
  });

  test("a change found only at the run's end replaces done", async () => {
    const guard = new FakeStateGuard({ change: { tier: "run", at: 6, paths: [SHOWN] } });
    const { h, done } = run(guard);
    const result = await done;
    assert.deepEqual([result.status, result.reason], ["failed", "state_changed"]);
    assert.deepEqual(checks(h).at(-1), { type: "state_checked", phase: "run_end", changed: [SHOWN], limited: false });
  });

  test("tier state too large to check: recorded, and the run goes on", async () => {
    const guard = new FakeStateGuard({ limited: true });
    const { h, done } = run(guard);
    const result = await done;
    assert.equal(result.status, "done");
    assert.ok(checks(h).every((c) => c.limited), "every recorded check says so");
    assert.ok(checks(h).some((c) => c.phase === "before_verify"), "a round's check is recorded when limited");
  });

  test("a capture that cannot be made ends the run failed/state_changed (fail closed)", async () => {
    const { done } = run(new FakeStateGuard({ failCapture: true }));
    const result = await done;
    assert.deepEqual([result.status, result.reason], ["failed", "state_changed"]);
  });

  test("no guard: no state check and no field, as before", async () => {
    const { h, done } = run(undefined);
    const result = await done;
    assert.equal(checks(h).length, 0);
    assert.equal(Object.hasOwn(result, "stateChanged"), false);
  });
});
