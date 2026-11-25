/** IR-A1/A3: interruption at the final response and approved-file boundaries; IR-A2's request budget. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { asRawText } from "../../../src/contracts/index.js";
import type { ApprovedChangesPlan, ContentHash, Journal, StateFingerprint, StateGuard } from "../../../src/contracts/index.js";
import { runApprovedPlan, runTask } from "../../../src/engine/index.js";
import { HASH_A, HASH_B, finalAnswer, harness, readCall, response } from "./fakes.js";
import type { Harness } from "./fakes.js";

type Completion = "verifiers" | "human_review";

function finalRun(completion: Completion, beforeStored: (run: Harness) => void = () => {}) {
  const run = harness({
    steps: [() => finalAnswer()],
    task: { verifiers: [], completion, ...(completion === "human_review" ? { humanReview: { checklist: ["check the result"] } } : {}) },
  });
  const journal: Journal = {
    async append(event) {
      if (event.type === "model_response") {
        beforeStored(run);
        // The interruption happens while this record is still pending, not after the run ended.
        await Promise.resolve();
      }
      return run.journal.append(event);
    },
    close: () => run.journal.close(),
  };
  run.deps = { ...run.deps, journal };
  return run;
}

describe("IR-A1: final response without automatic verifiers", () => {
  for (const completion of ["verifiers", "human_review"] as const) {
    test(completion + ": cancellation while model_response is stored wins over completion", async () => {
      const run = finalRun(completion, (current) => current.controller.abort());
      const result = await runTask(run.deps);
      assert.deepEqual([result.status, result.reason, result.exitCode], ["cancelled", "cancelled", 5]);
      assert.equal(result.review, undefined);
      assert.equal(run.model.requests.length, 1);
      assert.equal(run.verifiers.runs.length, 0);
      assert.equal(run.journal.ofType("run_finished")[0]?.reason, "cancelled");
      assert.equal(run.journal.closed, true);
    });

    test(completion + ": duration reached while model_response is stored wins over completion", async () => {
      const run = finalRun(completion, (current) => { current.clock.t = current.deps.task.limits.maxDurationMs; });
      const result = await runTask(run.deps);
      assert.deepEqual([result.status, result.reason, result.exitCode], ["budget-exhausted", "max_duration", 4]);
      assert.equal(result.review, undefined);
      assert.equal(run.model.requests.length, 1);
      assert.equal(run.verifiers.runs.length, 0);
      assert.equal(run.journal.ofType("run_finished")[0]?.reason, "max_duration");
      assert.equal(run.journal.closed, true);
    });

    test(completion + ": an uninterrupted final answer retains its existing outcome", async () => {
      const run = finalRun(completion);
      const result = await runTask(run.deps);
      assert.deepEqual([result.status, result.reason, result.exitCode],
        ["needs-input", completion === "human_review" ? "awaiting_review" : "no_verifier", 3]);
      assert.ok(result.notices.some((notice) => notice.includes("no automatic verification")));
      assert.deepEqual(result.review, completion === "human_review" ? { checklist: ["check the result"] } : undefined);
    });
  }

  test("the run-end state change still overrides cancellation", async () => {
    let changed = false;
    const marked: (readonly string[])[] = [];
    const run = finalRun("verifiers", (current) => { changed = true; current.controller.abort(); });
    const guard: StateGuard = {
      async capture(tier) { return { tier } as StateFingerprint; },
      compare(_before, after) { return { changed: changed && after.tier === "run" ? [asRawText("result.json")] : [], limited: false }; },
      async markRecordsChanged(paths) { marked.push(paths); },
    };
    const result = await runTask({ ...run.deps, stateGuard: guard });
    assert.deepEqual([result.status, result.reason, result.exitCode], ["failed", "state_changed", 1]);
    assert.deepEqual(result.stateChanged, ["result.json"]);
    assert.deepEqual(marked, [["result.json"]]);
  });

  test("the final protected-material check records a change without replacing cancellation", async () => {
    let changed = false;
    const run = finalRun("verifiers", (current) => { changed = true; current.controller.abort(); });
    const result = await runTask({
      ...run.deps,
      integrity: {
        async capture() { return { entries: [{ path: asRawText("tests/check.ts"), kind: "file", sha256: (changed ? HASH_B : HASH_A) as ContentHash }] }; },
        compare(before, after) { return JSON.stringify(before) === JSON.stringify(after) ? [] : [asRawText("tests/check.ts")]; },
      },
    });
    assert.deepEqual([result.status, result.reason, result.exitCode], ["cancelled", "cancelled", 5]);
    assert.deepEqual(result.protectedChanged, ["tests/check.ts"]);
    assert.deepEqual(run.journal.ofType("integrity_checked").at(-1)?.changed, ["tests/check.ts"]);
  });
});

function approvedRun(fileNow: ApprovedChangesPlan["fileNow"], duration = 600_000) {
  const run = harness({ steps: [() => finalAnswer()], task: { plan: "run", limits: { maxDurationMs: duration } } });
  let claims = 0;
  const approved: ApprovedChangesPlan = {
    planRunId: "20261113T080000Z-0000aaaa",
    digest: HASH_A as ContentHash,
    approval: "cli-flag",
    plan: { schemaVersion: 1, kind: "changes", runId: "20261113T080000Z-0000aaaa", summary: ["write a note"],
      files: [{ path: "note.md", change: "create", sha256: null, shown: ["note.md"] }] },
    fileNow,
    async markApplied() { claims += 1; return "marked"; },
  };
  const execute = () => {
    const { policy, ...deps } = run.deps;
    return runApprovedPlan({ ...deps, approved, policyFor: () => policy });
  };
  return { run, execute, claims: () => claims };
}

describe("IR-A3: approved-file probes receive the run's interruption signal", () => {
  test("the internal deadline aborts a pending probe without user cancellation", async () => {
    let probeAborted = false;
    const current = approvedRun(async (_file, signal) => new Promise((resolve) => {
      const finish = () => {
        clearTimeout(watchdog);
        signal.removeEventListener("abort", stopped);
        resolve({ kind: "missing" });
      };
      const stopped = () => { probeAborted = true; finish(); };
      // An independent, bounded fallback also lets the unfixed engine finish and report failure.
      const watchdog = setTimeout(finish, 500);
      if (signal.aborted) stopped();
      else signal.addEventListener("abort", stopped, { once: true });
    }), 50);
    const result = await current.execute();
    assert.equal(probeAborted, true, "the file probe itself must observe the internal deadline");
    assert.equal(current.run.controller.signal.aborted, false, "the caller did not cancel");
    assert.equal(current.run.clock.now(), 0, "the fake clock did not cause the stop");
    assert.deepEqual([result.status, result.reason, result.exitCode], ["budget-exhausted", "max_duration", 4]);
    assert.equal(current.run.model.requests.length, 0);
    assert.equal(current.claims(), 0);
    assert.equal(current.run.journal.closed, true);
  });

  test("user cancellation still aborts a pending probe before the claim or model request", async () => {
    let probeAborted = false;
    const current = approvedRun(async (_file, signal) => {
      const stopped = () => { probeAborted = true; };
      signal.addEventListener("abort", stopped, { once: true });
      current.run.controller.abort();
      signal.removeEventListener("abort", stopped);
      return { kind: "missing" };
    });
    const result = await current.execute();
    assert.equal(probeAborted, true);
    assert.deepEqual([result.status, result.reason, result.exitCode], ["cancelled", "cancelled", 5]);
    assert.equal(current.run.model.requests.length, 0);
    assert.equal(current.claims(), 0);
  });

  test("an uninterrupted fresh probe retains the normal claimed and verified run", async () => {
    let probes = 0;
    const current = approvedRun(async (_file, signal) => {
      probes += 1;
      assert.equal(signal.aborted, false);
      return { kind: "missing" };
    });
    const result = await current.execute();
    assert.deepEqual([result.status, result.reason, result.exitCode], ["done", "verified", 0]);
    assert.equal(probes, 1);
    assert.equal(current.claims(), 1);
    assert.equal(current.run.model.requests.length, 1);
  });
});

describe("IR-A2: tokens forbid additional requests, not processing the response already received", () => {
  for (const outputTokens of [40, 50]) {
    test("a final response totaling " + (60 + outputTokens) + " tokens at a budget of 100 is still verified", async () => {
      const run = harness({ steps: [() => response([], { usage: { inputTokens: 60, outputTokens } })], task: { limits: { maxTotalTokens: 100 } } });
      const result = await runTask(run.deps);
      assert.deepEqual([result.status, result.reason, result.exitCode], ["done", "verified", 0]);
      assert.deepEqual([result.usage.inputTokens, result.usage.outputTokens], [60, outputTokens]);
      assert.equal(run.model.requests.length, 1);
      assert.deepEqual(run.verifiers.runs, ["v1"]);
    });
  }

  test("every tool in the received response is processed before a further model request is refused", async () => {
    const run = harness({ steps: [() => response([readCall("first"), readCall("second")], { usage: { inputTokens: 60, outputTokens: 50 } }), () => finalAnswer()],
      task: { limits: { maxTotalTokens: 100 } } });
    const result = await runTask(run.deps);
    assert.deepEqual([result.status, result.reason, result.exitCode], ["budget-exhausted", "max_total_tokens", 4]);
    assert.equal(run.model.requests.length, 1);
    assert.deepEqual(run.tools.executed.map((call) => call.id), ["first", "second"]);
    assert.equal(run.journal.ofType("tool_result").length, 2);
    assert.deepEqual([result.usage.inputTokens, result.usage.outputTokens], [60, 50]);
  });
});
