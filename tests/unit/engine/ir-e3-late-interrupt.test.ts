/**
 * IR-E3 (review E): a cancel or the duration limit that comes while the after_verify state check
 * runs (EngineDeps.stateGuard, DR-38) ends the run as that interruption, also without an integrity
 * checker, as the integrity check already does (integrity.test.ts "the duration limit reached during
 * an empty after_verify capture is not reported as done"). A change that check finds still comes
 * first. The end checks (state run_end, integrity checkAtEnd) only turn an end into a safety
 * failure: an interruption that comes while they run leaves the end as the run left it.
 * Fake state guard and integrity checker; the interruption happens inside their capture.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { asRawText } from "../../../src/contracts/index.js";
import type { IntegrityChecker, IntegrityManifest, MaskedText, RawText, StateComparison, StateFingerprint, StateGuard, StateTier } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { finalAnswer, harness } from "./fakes.js";
import type { Harness } from "./fakes.js";

type Print = StateFingerprint & { readonly n: number };
const SHOWN = "runs/20261127T000000Z-0000abcd/result.json";

/**
 * Numbers each capture of a tier. Without tool calls the tier-run captures are: 1 run_start,
 * 2 before_verify, 3 after_verify, 4 run_end. `during` runs inside a capture, before it returns.
 */
class HoldingStateGuard implements StateGuard {
  readonly captures: { run: number; state: number } = { run: 0, state: 0 };
  readonly marked: MaskedText[][] = [];
  constructor(
    private readonly during: (tier: StateTier, index: number) => void = () => {},
    private readonly changeAtRun: number | null = null,
  ) {}
  async capture(tier: StateTier): Promise<StateFingerprint> {
    this.captures[tier] += 1;
    const index = this.captures[tier];
    this.during(tier, index);
    await Promise.resolve();
    return { tier, n: index } as unknown as StateFingerprint;
  }
  compare(before: StateFingerprint, after: StateFingerprint): StateComparison {
    const to = (after as Print).n;
    const changed = after.tier === "run" && to === this.changeAtRun && (before as Print).n !== to ? [asRawText(SHOWN)] : [];
    return { changed, limited: false };
  }
  async markRecordsChanged(changed: readonly MaskedText[]): Promise<void> {
    this.marked.push([...changed]);
  }
}

/** An integrity checker that finds nothing; `during` runs inside capture number `index`. */
class HoldingIntegrity implements IntegrityChecker {
  captures = 0;
  constructor(private readonly during: (index: number) => void) {}
  async capture(): Promise<IntegrityManifest> {
    this.captures += 1;
    this.during(this.captures);
    await Promise.resolve();
    return { entries: [] };
  }
  compare(): readonly RawText[] {
    return [];
  }
}

type Interruption = "cancel" | "duration";
const interrupt = (h: Harness, kind: Interruption): void => {
  if (kind === "cancel") h.controller.abort();
  else h.clock.t = h.deps.task.limits.maxDurationMs;
};
const EXPECTED: Record<Interruption, [string, string, number]> = {
  cancel: ["cancelled", "cancelled", 5],
  duration: ["budget-exhausted", "max_duration", 4],
};
const end = (result: { status: string; reason: string; exitCode: number }) => [result.status, result.reason, result.exitCode];

describe("IR-E3: after_verify state check without an integrity checker", () => {
  for (const kind of ["cancel", "duration"] as const) {
    test(`${kind} while the after_verify state check runs ends the run as ${EXPECTED[kind][1]}, not done`, async () => {
      const h = harness({ steps: [() => finalAnswer()] });
      const guard = new HoldingStateGuard((tier, index) => { if (tier === "run" && index === 3) interrupt(h, kind); });
      const result = await runTask({ ...h.deps, stateGuard: guard });
      assert.deepEqual(end(result), EXPECTED[kind]);
      assert.equal(h.verifiers.runs.length, 1, "the round ran before the check");
      assert.deepEqual(guard.captures, { run: 4, state: 4 }, "the after_verify check was made whole, then the run_end check");
      assert.equal(h.journal.ofType("run_finished")[0]?.reason, EXPECTED[kind][1]);
    });
  }

  test("a change that same check finds comes before the cancel (failed/state_changed)", async () => {
    const h = harness({ steps: [() => finalAnswer()] });
    const guard = new HoldingStateGuard((tier, index) => { if (tier === "run" && index === 3) h.controller.abort(); }, 3);
    const result = await runTask({ ...h.deps, stateGuard: guard });
    assert.deepEqual(end(result), ["failed", "state_changed", 1]);
    assert.deepEqual(result.stateChanged, [SHOWN]);
    assert.deepEqual(guard.marked, [[SHOWN]]);
  });

  test("nothing during the check: the run is done as before", async () => {
    const h = harness({ steps: [() => finalAnswer()] });
    const guard = new HoldingStateGuard();
    const result = await runTask({ ...h.deps, stateGuard: guard });
    assert.deepEqual(end(result), ["done", "verified", 0]);
    assert.deepEqual(guard.captures, { run: 4, state: 4 });
  });
});

describe("IR-E3 (PM decision 2): an interruption during an end check leaves the end as the run left it", () => {
  for (const kind of ["cancel", "duration"] as const) {
    test(`state run_end: ${kind} during the run_end check keeps done`, async () => {
      const h = harness({ steps: [() => finalAnswer()] });
      const guard = new HoldingStateGuard((tier, index) => { if (tier === "run" && index === 4) interrupt(h, kind); });
      const result = await runTask({ ...h.deps, stateGuard: guard });
      assert.deepEqual(end(result), ["done", "verified", 0]);
      assert.deepEqual(h.journal.ofType("state_checked").map((check) => check.phase), ["run_start", "run_end"]);
    });

    test(`integrity end check: ${kind} during the end capture keeps needs-input/no_verifier`, async () => {
      const h = harness({ steps: [() => finalAnswer()], task: { verifiers: [] } });
      // Capture 1 is run_start; with no verifier there is no round, so capture 2 is the end check.
      const integrity = new HoldingIntegrity((index) => { if (index === 2) interrupt(h, kind); });
      const result = await runTask({ ...h.deps, integrity });
      assert.deepEqual(end(result), ["needs-input", "no_verifier", 3]);
      assert.equal(integrity.captures, 2, "the end check ran");
      assert.deepEqual(h.journal.ofType("integrity_checked").map((check) => check.phase), ["run_start", "before_verify"]);
    });
  }
});
