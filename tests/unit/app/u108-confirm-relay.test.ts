/**
 * Unit U-108 (B-4, DR-3, adapter-contract 5.9): the app layer relays the engine's permission
 * question (EngineDeps.confirm, U-74) to the adapter (RunObserver.confirm).
 * - The request is the contract's ConfirmRequest; the run's signal is passed on (it aborts when the
 *   run is cancelled or its time is up).
 * - No observer, no `confirm`, one that throws, or an answer that is not one of the decisions is
 *   `dismissed`: recorded as deny by default, never as the person's. The answer's `decision` is read
 *   once, as an own data property (a getter is not called).
 * - The two journal records (`confirmation_requested`, then `confirmation_answered`) reach the
 *   observer as run events, the question before `confirm` is called.
 * The config file cannot hold an asking rule yet (U-74), so the test's runTask gives the real engine
 * a policy gate whose command rule asks. Scripted model, temporary folders, fake values only.
 * Reproduced first (todo until the app layer relays it).
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppHooks, RunEvent, RunHandle, RunObserver } from "../../../src/app/index.js";
import type { EngineResult, JournalRecord } from "../../../src/contracts/index.js";
import { runTask as engineRunTask } from "../../../src/engine/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { WRITE_NOTES, appEnvironment, readJournal, setupRun, taskRequest } from "./support.js";

const TODO = { todo: "U-108: the app layer does not relay the permission question yet" };

/** The command the model asks to run; it leaves `ran.txt` when it runs. */
const MARK = "require('fs').writeFileSync('ran.txt', 'x')";
const NODE_RULE = { executable: process.execPath, argsPrefix: ["-e"], allowExtraArgs: true };

/** The real engine, with a policy gate whose command rules ask (ConfirmableCommandRule). */
const askingEngine: AppHooks = {
  runTask: async (deps) => {
    const workspace = await createWorkspace({ root: deps.task.workspaceRoot });
    const config = { ...deps.task.policy, commands: deps.task.policy.commands.map((rule) => ({ ...rule, confirm: true as const })) };
    return engineRunTask({ ...deps, task: { ...deps.task, policy: config }, policy: createPolicyGate({ config, workspace }) });
  },
};

interface Asked {
  readonly base: string;
  readonly result: EngineResult;
  /** The run events' records (none without an observer). */
  readonly records: readonly JournalRecord[];
  /** The journal as stored. */
  readonly stored: readonly JournalRecord[];
  readonly ran: boolean;
}

/** A run whose model asks to run MARK; `confirm` (or none) answers; `observe` is told of the handle. */
async function askingRun(confirm: RunObserver["confirm"] | "none" | "no-observer", observe?: (handle: RunHandle) => void): Promise<Asked> {
  const base = await setupRun({}, { policy: { commands: [NODE_RULE], network: "deny", destructive: "deny", restorePathTokens: false } }, [
    { toolCalls: [{ name: "run_command", args: { executable: process.execPath, args: ["-e", MARK] } }] },
    WRITE_NOTES,
    { text: "done" },
  ]);
  const app = createCodarynApp(await appEnvironment(base), askingEngine);
  const events: RunEvent[] = [];
  const observer: RunObserver | undefined =
    confirm === "no-observer" ? undefined : { onEvent: (event) => events.push(event), ...(confirm === "none" ? {} : { confirm }) };
  const started = await app.startRun(taskRequest(base), observer);
  assert.ok(started.ok, JSON.stringify(started));
  observe?.(started.handle);
  const ended = await started.handle.done;
  assert.ok(ended.ok, JSON.stringify(ended));
  return {
    base,
    result: ended.result,
    records: events.flatMap((event) => (event.kind === "record" ? [event.record] : [])),
    stored: await readJournal(base, started.handle.runId),
    ran: existsSync(path.join(base, "work", "ran.txt")),
  };
}

function answered(records: readonly JournalRecord[]): [unknown, unknown] {
  const record = records.find((item) => (item.type as string) === "confirmation_answered") as unknown as { decision?: unknown; by?: unknown } | undefined;
  return [record?.decision, record?.by];
}

describe("U-108 (B-4): the permission question goes to RunObserver.confirm", () => {
  test("allow_once: asked with the contract's request and the run's signal, after its event; the command runs", TODO, async () => {
    const asked: { request: Record<string, unknown>; signal: AbortSignal }[] = [];
    const run = await askingRun(async (request, signal) => {
      asked.push({ request: request as unknown as Record<string, unknown>, signal });
      return { decision: "allow_once" };
    });
    assert.equal(asked.length, 1);
    const one = asked[0];
    assert.deepEqual(
      [one?.request["kind"], one?.request["id"], one?.request["tool"], one?.request["permission"], one?.request["argumentCount"]],
      ["permission", "q1", "run_command", "command", 2],
    );
    assert.ok(one?.signal instanceof AbortSignal && !one.signal.aborted);
    assert.equal(JSON.stringify(one?.request).includes(MARK), false, "the arguments are never in the question");
    assert.deepEqual(answered(run.stored), ["allow_once", "user"]);
    const types = run.records.map((record) => record.type as string);
    assert.ok(types.indexOf("confirmation_requested") < types.indexOf("confirmation_answered"), types.join(","));
    assert.equal(run.ran, true, "the command ran after the person's allow_once");
  });

  test("the question's event is delivered before confirm is called", TODO, async () => {
    const order: string[] = [];
    const base = await setupRun({}, { policy: { commands: [NODE_RULE], network: "deny", destructive: "deny", restorePathTokens: false } }, [
      { toolCalls: [{ name: "run_command", args: { executable: process.execPath, args: ["-e", MARK] } }] },
      WRITE_NOTES,
      { text: "done" },
    ]);
    const app = createCodarynApp(await appEnvironment(base), askingEngine);
    const started = await app.startRun(taskRequest(base), {
      onEvent: (event) => {
        if (event.kind === "record" && (event.record.type as string).startsWith("confirmation_")) order.push(event.record.type);
      },
      confirm: async () => {
        order.push("confirm called");
        return { decision: "deny" };
      },
    });
    assert.ok(started.ok);
    await started.handle.done;
    assert.deepEqual(order, ["confirmation_requested", "confirm called", "confirmation_answered"]);
  });

  test("deny: recorded as the person's; the command does not run", TODO, async () => {
    let calls = 0;
    const run = await askingRun(async () => {
      calls += 1;
      return { decision: "deny" };
    });
    assert.equal(calls, 1);
    assert.deepEqual([answered(run.stored), run.ran], [["deny", "user"], false]);
  });

  test("no observer, no confirm, a throw or an answer that is no decision: dismissed, deny by default", TODO, async () => {
    for (const [name, confirm] of [
      ["no observer", "no-observer"],
      ["no confirm", "none"],
    ] as const) {
      const run = await askingRun(confirm);
      assert.deepEqual([answered(run.stored), run.ran], [["deny", "default"], false], name);
    }
    let getterReads = 0;
    const proto = Object.create({ decision: "allow_once" }) as object;
    const answers: [string, RunObserver["confirm"]][] = [
      ["throws", async () => Promise.reject(new Error("the window closed"))],
      ["throws at once", (() => {
        throw new Error("sync");
      }) as RunObserver["confirm"]],
      ["unknown decision", async () => ({ decision: "yes" }) as never],
      ["null", async () => null as never],
      ["a string", async () => "allow_once" as never],
      ["a getter", async () => ({ get decision() {
        getterReads += 1;
        return "allow_once";
      } }) as never],
      ["on the prototype", async () => proto as never],
    ];
    let called = 0;
    for (const [name, confirm] of answers) {
      const run = await askingRun(((request: never, signal: never) => {
        called += 1;
        return (confirm as (request: never, signal: never) => Promise<never>)(request, signal);
      }) as RunObserver["confirm"]);
      assert.deepEqual([answered(run.stored), run.ran], [["deny", "default"], false], name);
    }
    assert.equal(called, answers.length, "each was asked");
    assert.equal(getterReads, 0, "a getter answer is not called");
  });

  test("a cancel while the question waits: the signal confirm got aborts; deny by cancelled, the run cancelled", TODO, async () => {
    let handle: RunHandle | null = null;
    let signalSeen: AbortSignal | null = null;
    const run = await askingRun(
      (_request, signal) => {
        signalSeen = signal;
        // The person has not answered; the run is cancelled meanwhile.
        setImmediate(() => handle?.cancel());
        return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ decision: "allow_once" }), { once: true }));
      },
      (started) => {
        handle = started;
      },
    );
    assert.equal((signalSeen as AbortSignal | null)?.aborted, true);
    assert.deepEqual([answered(run.stored), run.result.status, run.ran], [["deny", "cancelled"], "cancelled", false]);
  });
});
