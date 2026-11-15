/** U-323: strict public apply parity. Scripted fixtures; no API or raw channel activation. */
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { ApplyObserver, AppHooks, ApplyPlanRequest } from "../../../src/app/index.js";
import type { ApplyEvent, RunEvent, ConfirmRequest } from "../../../src/contracts/app.js";
import type { MaskedText } from "../../../src/contracts/index.js";
import { applyPlan as applyEngine, runApprovedPlan as carryEngine } from "../../../src/engine/index.js";
import { appEnvironment, setupRun, taskForm, taskRequest, WRITE_NOTES } from "./support.js";

async function fixture(kind: "moves" | "changes") {
  const actions = [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }, { kind: "discard", path: "b.txt" }];
  const plan = kind === "moves"
    ? { name: "propose_plan", args: { summary: "sort", actions } }
    : { name: "propose_changes", args: { summary: "write notes", files: [{ path: "NOTES.md", change: "create" }] } };
  const base = await setupRun({ "a.txt": "alpha\n", "b.txt": "beta\n" }, {
    workflowRef: kind === "moves" ? "organize" : "rewrite", privacy: { secretEnv: [] },
    ...(kind === "moves" ? { verifiers: [], policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move", "discard"] } } : {}),
  }, [{ toolCalls: [plan] }, { text: "planned" }]);
  const configPath = kind === "changes" ? path.join(base, "config.json") : null;
  if (configPath) await writeFile(configPath, JSON.stringify({ schemaVersion: 1, workflows: { rewrite: { tools: ["read_file", "write_file", "propose_changes"], plan: "run" } } }));
  const handlers = new Set<() => void>();
  const env = await appEnvironment(base, { env: {}, onSignal: (_name, handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; } });
  const initial = createCodarynApp(env);
  const start = await initial.startRun(taskRequest(base, { configPath }));
  assert.ok(start.ok, JSON.stringify(start));
  const end = await start.handle.done;
  assert.ok(end.ok && end.result.plan);
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [WRITE_NOTES, { text: "done" }] }));
  const request: ApplyPlanRequest = { settings: taskForm(base, { configPath }), planRunId: start.handle.runId, digest: end.result.plan.digest, cancelFile: null, unsafeMoveConsent: null };
  return { base, env, request, handlers, work: path.join(base, "work") };
}

function noRaw(observer: ApplyObserver, reads: { count: number }): ApplyObserver {
  for (const field of ["onStoredRecord", "onStoredRunRecord"]) Object.defineProperty(observer, field, { get() { reads.count++; throw new Error("raw getter must not be read"); } });
  return observer;
}

for (const kind of ["moves", "changes"] as const) test(`U-323: ${kind} handle gate, raw getters zero, late methods/this and stored bytes`, async () => {
  const f = await fixture(kind);
  let returned = false;
  let engineCalls = 0;
  const events: Array<ApplyEvent | RunEvent> = [];
  const reads = { count: 0 };
  const observer = noRaw({}, reads);
  let earlyCalls = 0;
  const early = () => { earlyCalls++; };
  observer.onEvent = early;
  observer.onRunEvent = early;
  const hooks: AppHooks = kind === "moves" ? { applyPlan: async (deps) => { assert.ok(returned); engineCalls++; return applyEngine(deps); } }
    : { runApprovedPlan: async (deps) => { assert.ok(returned); engineCalls++; return carryEngine(deps); } };
  const started = await createCodarynApp(f.env, hooks).applyPlan(f.request, observer);
  assert.ok(started.ok, JSON.stringify(started));
  assert.deepEqual(Object.keys(started.handle), ["runId", "cancel", "done"]);
  assert.equal(engineCalls, 0);
  assert.equal(earlyCalls, 0);
  returned = true;
  const late = function(this: ApplyObserver, event: ApplyEvent | RunEvent) { assert.equal(this, observer); assert.ok(returned); events.push(structuredClone(event)); };
  observer.onEvent = late;
  observer.onRunEvent = late;
  const done = await started.handle.done;
  assert.ok(done.ok, JSON.stringify(done));
  assert.equal(done.output.reason, "verified");
  assert.equal(engineCalls, 1);
  assert.equal(reads.count, 0);
  assert.equal(earlyCalls, 0);
  assert.equal(f.handlers.size, 0);
  started.handle.cancel();
  const records = events.flatMap((event) => event.kind === "record" ? [event.record] : []);
  const journal = (await readFile(path.join(f.work, ".codaryn/runs", started.handle.runId, "journal.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const expected = journal.filter((record) => record.type !== "plan_item_started");
  assert.deepEqual(records, expected);
  assert.equal(JSON.stringify(records), JSON.stringify(expected), "masked event bytes and field order match stored records");
  assert.equal(new Set(records.map((r) => r.runId + ":" + r.seq)).size, records.length);
  assert.equal(reads.count, 0);
});

for (const kind of ["moves", "changes"] as const) test(`U-323: ${kind} preserves its distinct late subscription rule`, async () => {
  const f = await fixture(kind);
  let count = 0;
  const observer: ApplyObserver = {};
  const started = await createCodarynApp(f.env).applyPlan(f.request, observer);
  assert.ok(started.ok);
  observer.onEvent = () => { count++; };
  observer.onRunEvent = () => { count++; };
  assert.ok((await started.handle.done).ok);
  assert.equal(count > 0, kind === "changes");
});

test("U-323: moves getter subscription is before handle and delivered getters retain timing/this", async () => {
  const f = await fixture("moves");
  const timeline: string[] = [];
  const observer: ApplyObserver = {};
  Object.defineProperty(observer, "onEvent", { get() {
    timeline.push("get");
    return function(this: ApplyObserver) { assert.equal(this, observer); timeline.push("event"); };
  } });
  const started = await createCodarynApp(f.env).applyPlan(f.request, observer);
  assert.ok(started.ok);
  timeline.push("handle");
  assert.deepEqual(timeline, ["get", "handle"]);
  assert.ok((await started.handle.done).ok);
  assert.ok(timeline.length > 2);
  for (let i = 2; i < timeline.length; i += 3) assert.deepEqual(timeline.slice(i, i + 3), ["get", "get", "event"]);
});

test("U-323: changes confirm late lookup/this and rejection produce one dismissed answer", async () => {
  const f = await fixture("changes");
  let returned = false;
  let calls = 0;
  const observer = noRaw({}, { count: 0 });
  const question: ConfirmRequest = { kind: "permission", id: "u323-confirm", callId: "synthetic-call", tool: "run_command", permission: "command", subject: "node" as MaskedText, argumentCount: 1 };
  const app = createCodarynApp(f.env, { runApprovedPlan: async (deps) => {
    assert.ok(returned);
    assert.deepEqual(await deps.confirm!(question, deps.signal), { decision: "dismissed" });
    return carryEngine(deps);
  } });
  const started = await app.applyPlan(f.request, observer);
  assert.ok(started.ok);
  returned = true;
  observer.confirm = async function() { assert.equal(this, observer); calls++; throw new Error("synthetic rejection"); };
  assert.ok((await started.handle.done).ok);
  assert.equal(calls, 1);
  assert.equal(f.handlers.size, 0);
});

test("U-323: a moves event getter that throws after subscription retains the original failure", async () => {
  const f = await fixture("moves");
  let returned = false;
  const observer: ApplyObserver = {};
  Object.defineProperty(observer, "onEvent", { get() {
    if (returned) throw new Error("synthetic getter failure");
    return () => {};
  } });
  const started = await createCodarynApp(f.env).applyPlan(f.request, observer);
  assert.ok(started.ok);
  returned = true;
  const done = await started.handle.done;
  assert.ok(!done.ok && done.error.code === "internal_error");
  assert.equal(f.handlers.size, 0);
});

test("U-323: consent refusal precedes I/O and immediate cancel resolves done with no raw reads or handlers", async () => {
  const f = await fixture("moves");
  const before = (await readdir(path.join(f.work, ".codaryn/runs"))).sort();
  const noRead = createCodarynApp({ ...f.env, readFile: async () => { throw new Error("must not read"); } });
  const refused = await noRead.applyPlan({ ...f.request, settings: { ...f.request.settings, input: { kind: "task", taskPath: "missing" } }, unsafeMoveConsent: { digest: "other" } });
  assert.ok(!refused.ok && refused.error.code === "invalid_arguments");
  assert.deepEqual((await readdir(path.join(f.work, ".codaryn/runs"))).sort(), before);
  const reads = { count: 0 };
  const started = await createCodarynApp(f.env).applyPlan(f.request, noRaw({}, reads));
  assert.ok(started.ok);
  started.handle.cancel(); started.handle.cancel();
  const done = await started.handle.done;
  assert.ok(done.ok && done.output.reason === "cancelled");
  assert.equal(reads.count, 0);
  assert.equal(f.handlers.size, 0);
});

test("U-323: overlapping append keeps each getter failure on its own stored seq, including null/undefined", async () => {
  for (const thrown of [undefined, null, new Error("synthetic overlap getter")]) {
    for (const hiddenFirst of [false, true]) {
      const f = await fixture("moves");
      let armed = false;
      let failed = false;
      const observer: ApplyObserver = {};
      Object.defineProperty(observer, "onEvent", { get() {
        if (armed && !failed) { failed = true; throw thrown; }
        return () => {};
      } });
      const app = createCodarynApp(f.env, { applyPlan: async (deps) => {
        armed = true;
        const checked = { type: "plan_checked" as const, problems: [], inventoryLimitReached: false };
        const hidden = { type: "plan_item_started" as const, index: 0, action: { kind: "move" as const, from: "a.txt" as MaskedText, to: "sorted/a.txt" as MaskedText, sha256: "0".repeat(64) } };
        const entries = hiddenFirst ? [hidden, checked, checked] : [checked, hidden, checked];
        const settled = await Promise.allSettled(entries.map((entry) => deps.journal.append(entry)));
        const failureIndex = hiddenFirst ? 1 : 0;
        for (let i = 0; i < settled.length; i++) {
          const item = settled[i]!;
          if (i === failureIndex) {
            assert.equal(item.status, "rejected");
            if (item.status === "rejected") assert.equal(item.reason, thrown);
          } else assert.equal(item.status, "fulfilled");
        }
        await deps.journal.close();
        return { schemaVersion: 1, kind: "apply", runId: deps.runId, planRunId: deps.planRunId, taskId: deps.taskId,
          digest: deps.digest, status: "done", reason: "verified", exitCode: 0, applied: [], verifiers: [],
          usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 },
          journalPath: `.codaryn/runs/${deps.runId}/journal.jsonl`, notices: [],
        };
      } });
      const started = await app.applyPlan(f.request, observer);
      assert.ok(started.ok);
      assert.ok((await started.handle.done).ok);
      assert.ok(failed);
      assert.equal(f.handlers.size, 0);
    }
  }
});
